'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const http=require('node:http');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');

test('Ollama API adapter and manager use real model protocol',async t=>{
  let requests=[];
  const mock=http.createServer(async(req,res)=>{
    const parts=[];for await(const c of req)parts.push(c);
    if(req.url==='/api/tags'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({models:[{name:'llama3.2'}]}));return;}
    const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
    requests.push(data);
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({message:{role:'assistant',content:'Propuesta concreta desde un modelo de prueba.'}}));
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'nexo-ollama-'));
  process.env.DATA_FILE=path.join(folder,'db.json');
  process.env.OLLAMA_URL=`http://127.0.0.1:${mock.address().port}`;
  const {server,init}=require('../server');
  await init();
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>mock.close(r));await fs.rm(folder,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(url,method='GET',payload)=>{
    const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});return [r.status,await r.json()];
  };
  let [s,state]=await call('/api/bootstrap');assert.equal(s,200);
  const id=state.agents[0].id;
  let [code,chat]=await call('/api/chats/'+id,'POST',{message:'Prepará un breve plan'});
  assert.equal(code,200);assert.match(chat.reply,/modelo de prueba/);
  assert.equal(requests.length,1);assert.equal(requests[0].model,'llama3.2');
  assert.equal(requests[0].messages.at(-1).content,'Prepará un breve plan');
  assert.equal(requests[0].messages.filter(x=>x.content==='Prepará un breve plan').length,1,'No repite el mensaje en el contexto');
  let [code2,task]=await call('/api/tasks','POST',{title:'Test del manager',prompt:'Construí una propuesta',agentIds:state.agents.slice(0,3).map(x=>x.id)});
  assert.equal(code2,202);
  let done=false;for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,20));let [a,b]=await call('/api/bootstrap');if(b.tasks[0].status==='done'){done=true;assert.equal(b.tasks[0].contributions.length,3);assert.match(b.tasks[0].managerSummary,/modelo de prueba/);break;}}
  assert.equal(done,true);assert.ok(requests.length>=5,'Tres agentes y síntesis del manager');
});
