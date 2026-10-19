'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');const fs=require('node:fs/promises');const path=require('node:path');
const root=path.join(os.tmpdir(),'nexo-test-'+process.pid+'-'+Date.now());
process.env.DATA_FILE=path.join(root,'state.json');
const {server,init,db,matchMessage}=require('../server');
let base;
async function api(url,method='GET',payload) {
 const r=await fetch(base+url, {method,headers:{'Content-Type':'application/json'}, ...(payload!==undefined?{body:JSON.stringify(payload)}:{})});
 return {status:r.status,data:await r.json()};
}
test('WhatsApp opt-in policy triggers only with eligible messages',()=>{
 const a={name:'Nico'};
 assert.equal(matchMessage({body:'Hola a todos'},a,'comando','me'),null);
 assert.equal(matchMessage({body:'!bot ¿qué es esto?'},a,'comando','me').explicit,true);
 assert.equal(matchMessage({body:'@Nico ayudame'},a,'mencion','me').explicit,true);
 assert.equal(matchMessage({body:'¿Qué hora es acá?'},a,'participar','me').explicit,false);
 assert.equal(matchMessage({body:'Qué onda'},a,'participar','me'),null);
});
test('end-to-end local app endpoints',async t=>{
 await fs.mkdir(root,{recursive:true}); await init();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 let s=await api('/api/bootstrap');assert.equal(s.status,200);assert.equal(s.data.agents.length,4);
 assert.equal(s.data.settings.provider,'ollama');
 let models=await api('/api/models');assert.equal(models.status,200);
 let settings=await api('/api/settings','POST',{provider:'demo',model:'llama3.2',dailyEnabled:true,dailyTime:'08:30',timezone:'America/Argentina/Buenos_Aires'});
 assert.equal(settings.status,200);
 let invalid=await api('/api/settings','POST',{provider:'demo',model:'llama3.2',dailyEnabled:false,dailyTime:'08:99',timezone:'America/Argentina/Buenos_Aires'});
 assert.equal(invalid.status,400);
 let a=await api('/api/agents','POST',{name:'Nico',role:'Soporte',instructions:'Responde preguntas de amigos'});
 assert.equal(a.status,201);
 let c=await api('/api/chats/'+a.data.agent.id,'POST',{message:'Hola Nico'});
 assert.equal(c.status,200);assert.match(c.data.reply,/MODO DEMOSTRACIÓN/);
 let hist=await api('/api/chats/'+a.data.agent.id);assert.equal(hist.data.messages.length,2);
 let task=await api('/api/tasks','POST',{title:'Mi primer plan',prompt:'Hacer un chatbot gratis',agentIds:s.data.agents.slice(1,3).map(x=>x.id)});
 assert.equal(task.status,202);assert.equal(task.data.task.status,'running');
 let meet=await api('/api/meetings','POST',{topic:'Daily del equipo'});
 assert.equal(meet.status,202);
 let ok=false;
 for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,40));const data=(await api('/api/bootstrap')).data;if(data.tasks[0].status==='done'&&data.meetings[0].status==='done'){ok=true;assert.equal(data.tasks[0].contributions.length,2);assert.equal(data.meetings[0].turns.length,5);break;}}
 assert.equal(ok,true,'El manager finalizó tareas y reuniones');
 let wa=await api('/api/whatsapp/group','POST',{groupId:'fake',enabled:true,consent:true,mode:'comando',agentId:a.data.agent.id});
 assert.equal(wa.status,400);
 // Chat progresivo: verifica que la ruta envía fragmentos NDJSON reales.
 const streamed=await fetch(base+'/api/chats/'+a.data.agent.id+'/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Probando streaming'})});
 assert.equal(streamed.status,200);
 assert.match(streamed.headers.get('content-type'),/application\/x-ndjson/);
 const packets=(await streamed.text()).trim().split('\n').map(line=>JSON.parse(line));
 assert.deepEqual(packets.map(x=>x.type),['start','delta','done']);
 assert.match(packets[1].text,/MODO DEMOSTRACIÓN/);
 hist=await api('/api/chats/'+a.data.agent.id);
 assert.equal(hist.data.messages.length,4);
 // Conversación autónoma con varios agentes, límite de turnos y parada humana.
 const channel=await api('/api/channels','POST',{name:'Pruebas NEXO',description:'Integración de debates',agentIds:[a.data.agent.id,s.data.agents[1].id],withManager:false});
 assert.equal(channel.status,201);
 const id=channel.data.channel.id;
 const started=await api('/api/channels/'+id+'/discussion','POST',{topic:'Mejorar el motor',maxTurns:3,maxMinutes:1});
 assert.equal(started.status,202);
 let firstTurn=false;
 for(let i=0;i<70;i++) {await new Promise(r=>setTimeout(r,30));const c=await api('/api/channels/'+id);if(c.data.channel.session?.turnsDone>=1){firstTurn=true;break;}}
 assert.equal(firstTurn,true,'Se generó al menos una intervención de agentes');
 const stopped=await api('/api/channels/'+id+'/discussion/stop','POST',{});
 assert.equal(stopped.status,202);
 let fullyStopped=false;
 for(let i=0;i<70;i++){await new Promise(r=>setTimeout(r,30));const c=await api('/api/channels/'+id);if(c.data.channel.session?.status==='stopped'&&!c.data.channel.busy){fullyStopped=true;assert.ok(c.data.channel.messages.some(x=>x.role==='assistant'));break;}}
 assert.equal(fullyStopped,true,'El debate respeta la orden de detenerse');
 let staticIndex=await fetch(base+'/');assert.equal(staticIndex.status,200);assert.match(await staticIndex.text(),/NEXO/);
});
