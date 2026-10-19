import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createApp } from '../server.mjs';
import { createProvider } from '../runtime/provider.mjs';
import { validateArguments } from '../runtime/agent.mjs';
import { Computer } from '../runtime/computer.mjs';

const final = text => ({text,calls:[],continuation:[],toolResult:()=>null});
const tool = (name,args) => ({text:'',calls:[{id:'call-1',name,args}],continuation:[{role:'assistant',content:''}],toolResult:(call,result)=>({role:'tool',content:JSON.stringify(result)})});
async function until(fn, timeout=3000){const start=Date.now();for(;;){const value=fn();if(value)return value;if(Date.now()-start>timeout)throw new Error('Timeout de prueba');await new Promise(r=>setTimeout(r,5));}}
function request(app,path,method='GET',data,headers={}) {
  return new Promise(resolve=>{
    const req=Readable.from(data===undefined?[]:[Buffer.from(typeof data==='string'?data:JSON.stringify(data))]);
    req.url=path.startsWith('/')?path:`/api/${path}`;req.method=method;req.headers={host:'localhost:3000','content-type':'application/json','x-orbita-token':app.token,...headers};
    const response={headers:{},headersSent:false,setHeader(k,v){this.headers[k]=v;},writeHead(status,h){this.status=status;Object.assign(this.headers,h);this.headersSent=true;},end(content){let value;try{value=JSON.parse(content);}catch{value=content;}resolve({status:this.status,data:value,headers:this.headers});}};
    app.server.emit('request',req,response);
  });
}
async function setup(t,options={}) {
  const dir=mkdtempSync(join(tmpdir(),'orbita-test-'));
  const app=createApp({dataDir:dir,seed:false,scheduler:false,provider:async()=>final('Respuesta de prueba'),...options});
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  const res=await request(app,'bots','POST',{name:'Analista',role:'Analizar',instructions:'Cita evidencia'});
  assert.equal(res.status,201);return {app,botId:res.data.id,dir};
}

test('F01: conversación real del motor se persiste; no se sustituye por demo',async t=>{
  const {app,botId}=await setup(t,{provider:async messages=>{assert.match(messages[0].content,/Cita evidencia/);return final('Resultado del proveedor de prueba');}});
  const job=await request(app,`bots/${botId}/tasks`,'POST',{prompt:'Analiza el informe'});assert.equal(job.status,202);
  await until(()=>app.state().jobs[0]?.status==='done');
  const history=(await request(app,`bots/${botId}/messages`)).data;
  assert.deepEqual(history.map(m=>m.role),['user','assistant']);assert.equal(history[1].demo,0);assert.equal(history[1].content,'Resultado del proveedor de prueba');
});
test('F02: una escritura no sucede antes de aprobar; aprobación inmutable de un solo uso',async t=>{
  let steps=0;
  const {app,botId}=await setup(t,{provider:async messages=>{
    if(steps++===0)return tool('write_file',{name:'informe.md',content:'# Resultado verificado'});
    assert.match(messages.at(-1).content,/saved/);return final('Archivo creado');
  }});
  await request(app,`bots/${botId}/tasks`,'POST',{prompt:'Escribe informe'});
  const approval=await until(()=>app.state().calls.find(c=>c.status==='pending'));
  assert.equal(app.state().files.length,0);
  assert.equal((await request(app,`approvals/${approval.id}`,'POST',{allow:true,arguments:{content:'alterado'}})).status,200);
  assert.equal((await request(app,`approvals/${approval.id}`,'POST',{allow:true})).status,409);
  await until(()=>app.state().jobs[0].status==='done');
  assert.equal(app.state().files.length,1);
  const file=(await request(app,`files/${app.state().files[0].id}`)).data;assert.equal(file.content,'# Resultado verificado');
});
test('F02: rechazar y caducar bloquean el efecto',async t=>{
  for(const decision of ['deny','expire']){
    let step=0;
    const {app,botId}=await setup(t,{approvalMs:decision==='expire'?25:500,provider:async()=>step++===0?tool('write_file',{name:'no.txt',content:'NO'}):final('No ejecutado')});
    app.startJob(botId,'No ejecutar');
    const approval=await until(()=>app.state().calls[0]);
    if(decision==='deny')await request(app,`approvals/${approval.id}`,'POST',{allow:false});
    await until(()=>app.state().jobs[0].status==='done');
    assert.equal(app.state().files.length,0);assert.equal(app.state().calls[0].status,decision==='deny'?'denied':'expired');
  }
});
test('F02: detener una tarea pendiente cancela el permiso y no ejecuta',async t=>{
  const {app,botId}=await setup(t,{provider:async()=>tool('write_file',{name:'no.txt',content:'NO'})});
  const job=app.startJob(botId,'Cancelar');const call=await until(()=>app.state().calls[0]);
  assert.equal((await request(app,`jobs/${job.id}/cancel`,'POST',{})).status,200);
  await until(()=>app.state().calls[0].status==='cancelled');
  assert.equal((await request(app,`approvals/${call.id}`,'POST',{allow:true})).status,409);
  assert.equal(app.state().files.length,0);
});
test('F01: exclusión de tareas simultáneas por bot; error de proveedor visible',async t=>{
  let release;const gate=new Promise(r=>{release=r;});
  const {app,botId}=await setup(t,{provider:async()=>{await gate;return final('Listo');}});
  app.startJob(botId,'Primera');
  assert.equal((await request(app,`bots/${botId}/tasks`,'POST',{prompt:'Segunda'})).status,409);
  release();await until(()=>app.state().jobs[0].status==='done');
});
test('F03: memoria y skills se reutilizan sin mezclar conversaciones entre bots',async t=>{
  let captured;
  const {app,botId}=await setup(t,{provider:async messages=>{captured=messages;return final('Entendido');}});
  await request(app,`bots/${botId}`,'PATCH',{memory:'Prefiero tablas'});
  await request(app,'skills','POST',{name:'Revisar',instructions:'Validar las fuentes antes de concluir'});
  const other=await request(app,'bots','POST',{name:'Escritor',role:'Escribir'});
  app.startJob(botId,'Mi dato privado por conversación');await until(()=>app.state().jobs.find(j=>j.bot_id===botId)?.status==='done');
  assert.match(captured[0].content,/Prefiero tablas/);assert.match(captured[0].content,/Revisar/);
  assert.doesNotMatch(captured[0].content,/Validar las fuentes/);
  app.startJob(other.data.id,'Hola');await until(()=>app.state().jobs.find(j=>j.bot_id===other.data.id)?.status==='done');
  assert.doesNotMatch(JSON.stringify(captured),/Mi dato privado por conversación|Prefiero tablas/);
});
test('F04: scheduler dispara una vez, guarda siguiente ejecución y respeta pausa',async t=>{
  const {app,botId}=await setup(t);
  const r=await request(app,'routines','POST',{name:'Informe',bot_id:botId,prompt:'Haz informe',interval_hours:24,next_run:Date.now()-10});assert.equal(r.status,201);
  app.tick();app.tick();await until(()=>app.state().jobs[0]?.status==='done');assert.equal(app.state().jobs.length,1);
  assert.ok(app.state().routines[0].next_run>Date.now());
  await request(app,`routines/${r.data.id}`,'PATCH',{enabled:false});
  app.db.prepare('UPDATE routines SET next_run=0').run();app.tick();assert.equal(app.state().jobs.length,1);
});
test('F05: archivos compartidos de texto, límites y conservación al borrar el bot',async t=>{
  const {app,botId}=await setup(t);
  assert.equal((await request(app,'files','POST',{bot_id:botId,name:'../clave.txt',content:'no'})).status,400);
  assert.equal((await request(app,'files','POST',{bot_id:botId,name:'dato.txt',content:'x'.repeat(45001)})).status,400);
  const f=await request(app,'files','POST',{bot_id:botId,name:'datos.csv',content:'mes,ventas\nenero,50'});assert.equal(f.status,201);
  assert.match((await request(app,`files/${f.data.id}`)).data.content,/enero/);
  await request(app,`bots/${botId}`,'DELETE');assert.equal(app.state().files.length,1);assert.equal(app.state().files[0].bot_id,null);
});
test('F06: delegación aprobada inicia al especialista y registra un resultado',async t=>{
  let specialist;
  const {app,botId}=await setup(t,{provider:async messages=>{
    if(messages[0].content.includes('Eres Especialista'))return final('Revisión completada');
    if(messages.at(-1).role==='tool')return final('Tarea entregada al especialista');
    return tool('delegate',{bot_id:specialist,prompt:'Revisa este documento'});
  }});
  specialist=(await request(app,'bots','POST',{name:'Especialista',role:'Revisor'})).data.id;
  app.startJob(botId,'Delega');const approval=await until(()=>app.state().calls[0]);
  await request(app,`approvals/${approval.id}`,'POST',{allow:true});
  await until(()=>app.state().jobs.length===2&&app.state().jobs.every(j=>j.status==='done'));
  assert.equal((await request(app,`bots/${specialist}/messages`)).data.at(-1).content,'Revisión completada');
});
test('Protección de API: Host, Origin, CSRF, JSON inválido y tamaños',async t=>{
  const {app}=await setup(t);
  assert.equal((await request(app,'state','GET',undefined,{host:'evil.example'})).status,403);
  assert.equal((await request(app,'state','GET',undefined,{origin:'https://evil.example'})).status,403);
  assert.equal((await request(app,'bots','POST',{name:'X',role:'Y'},{'x-orbita-token':'incorrecto'})).status,403);
  assert.equal((await request(app,'bots','POST','{broken')).status,400);
  assert.equal((await request(app,'bots','POST','null')).status,400);
  assert.equal((await request(app,'bots','POST',[])).status,400);
  assert.equal((await request(app,'bots','POST',{name:'',role:'Y'})).status,400);
  assert.equal((await request(app,'bots','POST','x'.repeat(130000))).status,413);
});
test('Herramientas: rechaza funciones desconocidas y argumentos fuera del contrato',()=>{
  assert.throws(()=>validateArguments('exec',{}));
  assert.throws(()=>validateArguments('terminal',{command:'ls',cwd:'/'}));
  assert.throws(()=>validateArguments('browser',{action:'navigate'}));
  assert.throws(()=>validateArguments('write_file',{name:'x.txt',content:12}));
});
test('Inicio: recursos locales disponibles y configuración sin secretos',async t=>{
  const {app}=await setup(t,{apiKey:'clave-no-publicable',providerName:'xai'});
  for(const path of ['/','/styles.css','/app.js','/favicon.svg','/tray.png']){
    const result=await request(app,path);assert.equal(result.status,200);assert.ok(result.headers['Content-Security-Policy']);
  }
  const cfg=await request(app,'config');assert.equal(cfg.data.provider,'xai');assert.ok(cfg.data.csrf);assert.doesNotMatch(JSON.stringify(cfg.data),/clave-no-publicable/);
  assert.equal((await request(app,'/.env')).status,404);
});
test('Navegador: allowlist exacta, sin credenciales ni esquemas locales',()=>{
  const c=new Computer('/tmp/test',{allowedHosts:'example.com'});
  assert.equal(c.allowed('https://example.com/path'),true);
  for(const url of ['file:///etc/passwd','https://example.com.evil.test','https://u:p@example.com','http://127.0.0.1','data:text/html,hello'])assert.equal(c.allowed(url),false);
});
test('Adaptador xAI envía herramientas, no guarda respuestas remotas y procesa resultados',async()=>{
  let payload;
  const provider=createProvider({provider:'xai',model:'test',key:'secret-test',fetcher:async(url,init)=>{assert.equal(url,'https://api.x.ai/v1/responses');payload=JSON.parse(init.body);return {ok:true,json:async()=>({output:[{type:'function_call',call_id:'c1',name:'list_files',arguments:'{}'}]})};}});
  const out=await provider([{role:'user',content:'Hola'}],[],new AbortController().signal);
  assert.equal(payload.store,false);assert.equal(out.calls[0].name,'list_files');assert.deepEqual(out.toolResult(out.calls[0],{ok:true}),{type:'function_call_output',call_id:'c1',output:'{"ok":true}'});
});
test('Adaptador Ollama usa inferencia local y no simula respuestas ante fallos',async()=>{
  const p=createProvider({provider:'ollama',model:'qwen3:8b',endpoint:'http://127.0.0.1:11434',fetcher:async(url,init)=>{assert.match(url,/api\/chat$/);const data=JSON.parse(init.body);assert.equal(data.stream,false);return {ok:true,json:async()=>({message:{role:'assistant',content:'Respuesta local'}})};}});
  assert.equal((await p([],[],new AbortController().signal)).text,'Respuesta local');
  const fail=createProvider({provider:'ollama',model:'missing',endpoint:'http://127.0.0.1:11434',fetcher:async()=>({ok:false,status:404})});
  await assert.rejects(()=>fail([],[],new AbortController().signal),/Ollama respondió HTTP 404/);
});
test('Persistencia y recuperación: reiniciar no repite operaciones pendientes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'orbita-restart-'));
  let app=createApp({dataDir:dir,seed:false,scheduler:false,provider:async()=>tool('write_file',{name:'no.txt',content:'no'})});
  try{
    const bot=(await request(app,'bots','POST',{name:'Persistente',role:'Trabajo'})).data.id;
    app.startJob(bot,'Pendiente');await until(()=>app.state().calls.length===1);await app.close();
    app=createApp({dataDir:dir,seed:false,scheduler:false,provider:async()=>{throw new Error('No debe ejecutarse');}});
    assert.equal(app.state().bots[0].name,'Persistente');assert.equal(app.state().jobs[0].status,'error');assert.equal(app.state().calls[0].status,'cancelled');assert.equal(app.state().files.length,0);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
