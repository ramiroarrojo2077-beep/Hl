'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');const fs=require('node:fs/promises');const path=require('node:path');
const root=path.join(os.tmpdir(),'nexo-test-'+process.pid+'-'+Date.now());
process.env.DATA_FILE=path.join(root,'state.json');
const {server,init,db,waCloud}=require('../server');
let base;
async function api(url,method='GET',payload) {
 const r=await fetch(base+url, {method,headers:{'Content-Type':'application/json'}, ...(payload!==undefined?{body:JSON.stringify(payload)}:{})});
 return {status:r.status,data:await r.json()};
}
test('official WhatsApp signature verification and payload filtering',()=>{
 const crypto=require('node:crypto');
 process.env.WA_VERIFY_TOKEN='verify-key';process.env.WA_APP_SECRET='test-secret';process.env.WA_PHONE_NUMBER_ID='123';
 const raw=Buffer.from('{"object":"whatsapp_business_account"}');
 const signature='sha256='+crypto.createHmac('sha256','test-secret').update(raw).digest('hex');
 assert.equal(waCloud.verifySignature(raw,signature),true);
 assert.equal(waCloud.verifySignature(raw,'sha256='+('0'.repeat(64))),false);
 assert.equal(waCloud.validateWebhook(new URLSearchParams('hub.mode=subscribe&hub.verify_token=verify-key')),true);
 assert.equal(waCloud.validateWebhook(new URLSearchParams('hub.mode=subscribe&hub.verify_token=wrong')),false);
 assert.equal(waCloud.inboundMessages({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages:[{id:'m1',from:'5491112345678',type:'text',text:{body:'!bot hola'}},{id:'m2',from:'54911',type:'image'}]}}]}]}).length,1);
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
 assert.equal(a.status,201);assert.equal(a.data.agent.personality,'Colaborativo, concreto y responsable');
 let persona=await api('/api/agents/'+a.data.agent.id,'PATCH',{personality:'Divertido y curioso',tone:'cercano',initiative:'alta',communication:'detallada'});assert.equal(persona.status,200);assert.equal(persona.data.agent.personality,'Divertido y curioso');
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
 let wa=await api('/api/whatsapp/contacts','POST',{phone:'5491112345678',enabled:true,consentConfirmed:false,mode:'comando',agentId:a.data.agent.id});
 assert.equal(wa.status,400);
 wa=await api('/api/whatsapp/contacts','POST',{phone:'5491112345678',label:'Prueba',consentConfirmed:true,mode:'comando',agentId:a.data.agent.id});
 assert.equal(wa.status,201);assert.equal(wa.data.contact.consent,false);
 const sig=await fetch(base+'/api/whatsapp/webhook',{method:'POST',body:'{}',headers:{'x-hub-signature-256':'sha256='+('0'.repeat(64))}});
 assert.equal(sig.status,403,'Rechaza eventos que no fueron firmados por Meta');
 const noConsent=await api('/api/whatsapp/send','POST',{phone:'5491112345678',message:'hola',confirmation:'ENVIAR'});
 assert.equal(noConsent.status,403,'No permite enviar a contactos sin consentimiento');
 
 // WhatsApp Cloud API: webhook firmado, doble autorización y respuesta usando Ollama simulado.
 process.env.WA_ACCESS_TOKEN='fake-test-token';process.env.WA_PHONE_NUMBER_ID='123';process.env.WA_APP_SECRET='test-secret';process.env.WA_VERIFY_TOKEN='verify-key';
 const verified=await fetch(base+'/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-key&hub.challenge=ok');
 assert.equal(verified.status,200);assert.equal(await verified.text(),'ok');
 const realFetch=global.fetch;let sentMessages=[],usedPersonality=false;
 global.fetch=async(url,options={})=>{
   const value=String(url);
   if(value.startsWith('https://graph.facebook.com/')){sentMessages.push(JSON.parse(options.body));return new Response(JSON.stringify({messages:[{id:'wamid.test'}]}),{status:200,headers:{'Content-Type':'application/json'}});}
   if(value.includes('/api/chat')&&value.includes(':11434')){
     const request=JSON.parse(options.body);if(request.messages[0].content.includes('Divertido y curioso'))usedPersonality=true;
     return new Response(JSON.stringify({message:{content:'¡Hola! Soy Nico, te puedo dar una mano.'}}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   return realFetch(url,options);
 };
 const signBody=(msg)=>{const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages:[{id:msg.id,from:'5491112345678',type:'text',text:{body:msg.body}}]}}]}]});return {body,signature:'sha256='+require('node:crypto').createHmac('sha256',process.env.WA_APP_SECRET).update(body).digest('hex')};};
 const receive=async(msg)=>{const {body,signature}=signBody(msg);return realFetch(base+'/api/whatsapp/webhook',{method:'POST',body,headers:{'x-hub-signature-256':signature,'Content-Type':'application/json'}});};
 try {
   let event=await receive({id:'msg-consent',body:'!bot aceptar'});assert.equal(event.status,200);
   let agreed=false;for(let i=0;i<70;i++){await new Promise(r=>setTimeout(r,15));if(db().whatsappContacts['5491112345678'].consent){agreed=true;break;}}
   assert.equal(agreed,true,'Contacto confirma recepción con !bot aceptar');
   assert.equal(sentMessages.length,1,'Se devuelve confirmación como bot identificado');
   await api('/api/settings','POST',{provider:'ollama',model:'llama3.2',dailyEnabled:false,dailyTime:'08:30',timezone:'America/Argentina/Buenos_Aires'});
   event=await receive({id:'msg-question',body:'!bot ¿Cómo estás?'});assert.equal(event.status,200);
   let answered=false;for(let i=0;i<70;i++){await new Promise(r=>setTimeout(r,15));if(sentMessages.length>=2){answered=true;break;}}
   assert.equal(answered,true,'El bot envía respuesta mediante API oficial');assert.match(sentMessages[1].text.body,/Nico/);
   assert.equal(usedPersonality,true,'El prompt del modelo incluye la personalidad particular del agente');
   event=await receive({id:'msg-question',body:'!bot ¿Cómo estás?'});assert.equal(event.status,200);
   await new Promise(r=>setTimeout(r,50));assert.equal(sentMessages.length,2,'No procesa dos veces el mismo mensaje');
 } finally {global.fetch=realFetch;await api('/api/settings','POST',{provider:'demo',model:'llama3.2',dailyEnabled:false,dailyTime:'08:30',timezone:'America/Argentina/Buenos_Aires'});}
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
