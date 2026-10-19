'use strict';
/* NEXO Studio SPA - real endpoints, no demo results invented by the frontend. */
const $=(q,root=document)=>root.querySelector(q);
const $$=(q,root=document)=>[...root.querySelectorAll(q)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=(v,n=155)=>String(v??'').length>n?String(v).slice(0,n)+'…':String(v??'');
const fmt=d=>d?new Date(d).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'}):'—';
let state={agents:[],tasks:[],meetings:[],channels:[],routines:[],memories:[],approvals:[],activity:[],whatsappGroups:{},settings:{},engine:{}};
let integrations=[],current='inicio',currentChat='',currentChannel='',busy=false,polling=false,previewConnector='';
let chatAbort=null, liveEventAbort=null, roomDraft=null, liveReconnectTimer=null;
let apiHost=localStorage.getItem('nexo_api_url')||'';
let accessToken=sessionStorage.getItem('nexo_access_token')||'';
// The Android/PWA shell can load without a NEXO backend. Local drafts are explicitly
// drafts (never shown as running IA agents) and can be imported when connected.
const DRAFT_KEY='nexo_agent_drafts_v1';
function readLocalDrafts(){try{const x=JSON.parse(localStorage.getItem(DRAFT_KEY)||'[]');return Array.isArray(x)?x.filter(a=>a&&typeof a.name==='string'&&String(a.id).startsWith('local-')).slice(0,50):[];}catch{return [];}}
let localDrafts=readLocalDrafts();
let connection={online:false,reason:'Comprobando conexión…',code:'CONNECTING'};
function setError(message,code='HTTP'){const e=new Error(message);e.code=code;return e;}
function isConnectionIssue(e){return ['NETWORK','INVALID_RESPONSE','BAD_JSON','UNAVAILABLE'].includes(e?.code);}
function storeDrafts(){try{localStorage.setItem(DRAFT_KEY,JSON.stringify(localDrafts));}catch{throw setError('Sin espacio para guardar el borrador en este dispositivo.','STORAGE');}}
function agentByAny(id){return localDrafts.find(a=>a.id===id)||agentBy(id);}
function localAgent(a){return a&&String(a.id).startsWith('local-');}
function storeDraft(payload,id=''){
 const data={...payload,id:id&&id.startsWith('local-')?id:'local-'+(globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2))};
 if(!data.name||!data.role)throw Error('Nombre y puesto son obligatorios.');
 const idx=localDrafts.findIndex(a=>a.id===data.id);
 if(idx>=0)localDrafts[idx]=data;else localDrafts.push(data);
 storeDrafts();renderConnection();renderAgents();return data;
}
function deleteDraft(id){localDrafts=localDrafts.filter(a=>a.id!==id);storeDrafts();renderConnection();renderAgents();}
async function syncDrafts(){
 if(!connection.online)throw Error('Conectá primero el servidor de NEXO para sincronizar los borradores.');
 let count=0;
 for(const draft of [...localDrafts]){
   const {id,...payload}=draft;
   const result=await post('/api/agents',payload);
   // After creation it is already persistent: discard the draft to avoid duplicate uploads.
   localDrafts=localDrafts.filter(a=>a.id!==id);storeDrafts();count++;
   if(payload.isManager||payload.active===false){
     try{await patch('/api/agents/'+encodeURIComponent(result.agent.id),{isManager:!!payload.isManager,active:!!payload.active});}
     catch(e){toast('Agente importado; revisá su estado de manager/activo: '+e.message,true);}
   }
 }
 await refresh(true);renderAgents();toast(`${count} agente(s) sincronizado(s) con el servidor.`);
}
function renderConnection(){
 const bar=$('#connection-notice');if(!bar)return;
 const online=connection.online;
 bar.hidden=online&&!localDrafts.length;
 bar.classList.toggle('offline',!online);
 const title=$('#connection-title'),desc=$('#connection-detail'),sync=$('#sync-drafts'),retry=$('#retry-connection');
 if(!online){
   title.textContent='Servidor de NEXO sin conectar';
   desc.textContent=connection.reason+' Podés guardar agentes como borradores en este teléfono, pero para que trabajen con IA hay que conectar el servidor.';
 }else{
   title.textContent=localDrafts.length+' borrador(es) pendiente(s)';
   desc.textContent='Tu servidor está conectado. Importá tus agentes guardados en este dispositivo cuando quieras.';
 }
 sync.hidden=!online||!localDrafts.length;sync.textContent='Sincronizar '+localDrafts.length+' borrador(es)';
 retry.hidden=online;
}

const titles={inicio:'Dashboard',agentes:'Equipo',canales:'Canales',tareas:'Misiones',reuniones:'Reuniones',rutinas:'Automatizaciones',chats:'Chat privado',memoria:'Memoria',aprobaciones:'Aprobaciones',integraciones:'Integraciones',ajustes:'Configuración'};
let toastTimer;
function toast(msg,err=false){const el=$('#toast');el.textContent=msg;el.className=err?'visible error':'visible';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',4800);}
async function api(url,{method='GET',body}={}){
 const h={'Accept':'application/json'};if(body!==undefined)h['Content-Type']='application/json';if(accessToken)h.Authorization='Bearer '+accessToken;
 let r;try{r=await fetch(apiHost+url,{method,headers:h,...(body!==undefined?{body:JSON.stringify(body)}:{})});}catch(e){throw setError('No se pudo contactar al servidor de NEXO. Revisá la dirección y que esté encendido.','NETWORK');}
 const ct=r.headers.get('content-type')||'';
 if(!ct.toLowerCase().includes('application/json'))throw setError(
   'La dirección de la app devolvió una página en lugar de la API de NEXO (HTTP '+r.status+'). Si estás usando una APK, configurá una dirección HTTPS del backend en Configuración.','INVALID_RESPONSE');
 let j;try{j=await r.json();}catch{throw setError('La API respondió con un JSON dañado. Revisá el servidor de NEXO.','BAD_JSON');}
 if(j===null||typeof j!=='object'||Array.isArray(j))throw setError('La API devolvió datos inesperados. Revisá que la URL sea del backend de NEXO.','BAD_JSON');
 if(!r.ok)throw setError(j.error||'Error HTTP '+r.status,r.status===401||r.status===403?'AUTH':'HTTP');return j;
}
async function requestStream(url,body,onLine,signal) {
 const headers={'Content-Type':'application/json','Accept':'application/x-ndjson'};
 if(accessToken)headers.Authorization='Bearer '+accessToken;
 const r=await fetch(apiHost+url,{method:'POST',headers,body:JSON.stringify(body),signal});
 if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(j.error||'Error HTTP '+r.status);}
 if(!r.body)throw Error('Este navegador no soporta recibir respuestas progresivas.');
 const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
 while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let ix;
   while((ix=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,ix);buffer=buffer.slice(ix+1);if(line.trim())onLine(JSON.parse(line));}
 }
 if(buffer.trim())onLine(JSON.parse(buffer));
}
function connectEvents() {
 liveEventAbort?.abort();if(!connection.online)return;const controller=new AbortController();liveEventAbort=controller;
 async function listen(){
   const headers={Accept:'text/event-stream'};if(accessToken)headers.Authorization='Bearer '+accessToken;
   const r=await fetch(apiHost+'/api/events',{headers,signal:controller.signal});if(!r.ok)throw Error('Eventos no disponibles');
   const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
   while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let ix;
     while((ix=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,ix);buffer=buffer.slice(ix+2);const kind=packet.match(/^event: (.+)$/m)?.[1],raw=packet.match(/^data: (.+)$/m)?.[1];
       if(kind&&raw){try{handleLiveEvent(kind,JSON.parse(raw));}catch(e){console.warn('Evento inválido',e);}}}
   }
   throw Error('Stream cerrado');
 }
 listen().catch(()=>{}).finally(()=>{if(!controller.signal.aborted)liveReconnectTimer=setTimeout(()=>{if(liveEventAbort===controller)connectEvents();},2500);});
}
let roomRefreshTimer;
function handleLiveEvent(kind,payload){
 if(kind==='room.delta' && current==='canales' && currentChannel===payload.channelId) {
   const feed=$('#channel-feed');let element=feed.querySelector('[data-live-room]');
   if(!element){element=document.createElement('div');element.dataset.liveRoom='true';element.className='live-response';feed.append(element);}
   element.textContent=`✦ ${payload.name} está hablando: ${payload.content}`;feed.scrollTop=feed.scrollHeight;
 }
 if(kind==='meeting.turn'||kind==='meeting.status'){if(current==='reuniones')void refresh();}
 if(kind==='room.status'||kind==='room.turn') {
   if(roomRefreshTimer)clearTimeout(roomRefreshTimer);
   roomRefreshTimer=setTimeout(()=>{void refresh();},kind==='room.turn'?100:180);
 }
}
const post=(u,b)=>api(u,{method:'POST',body:b});const patch=(u,b)=>api(u,{method:'PATCH',body:b});const remove=u=>api(u,{method:'DELETE'});
function val(id){return $('#'+id)?.value?.trim()||'';}
function agentBy(id){return state.agents.find(a=>a.id===id);}
function activeAgents(){return state.agents.filter(a=>a.active);}
function agentOptions(extra=false){return (extra?'<option value="">Manager predeterminado</option>':'')+activeAgents().map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.role)}</option>`).join('');}
function pickAgents(id,selected=null){const el=$('#'+id);if(!el)return;const chosen=selected||activeAgents().map(a=>a.id);el.innerHTML=activeAgents().map(a=>`<label class="agent-pick"><input type="checkbox" name="agentPick" value="${esc(a.id)}" ${chosen.includes(a.id)?'checked':''}><span>${esc(a.emoji||'✧')} ${esc(a.name)}</span><small>${esc(a.role)}</small></label>`).join('')||'<p class="muted">Creá un agente activo primero.</p>';}
function picks(id){return $$('#'+id+' input[type=checkbox]:checked').map(el=>el.value);}
function icon(a){return `<span class="agent-avatar">${esc(a.emoji||'✧')}</span>`;}
function agentCard(a){return `<article class="agent-card"><div class="agent-top">${icon(a)}<span class="agent-status ${localAgent(a)?'draft':a.active?'':'off'}"><i></i> ${localAgent(a)?'BORRADOR LOCAL':a.active?'ACTIVO':'PAUSADO'}</span></div><h3>${esc(a.name)}</h3><p class="agent-role">${esc(a.role)}${a.isManager?' · MANAGER':''}</p><p class="agent-desc">${esc(short(a.personality||a.instructions||'Especialista de tu equipo.',145))}</p><div class="agent-bottom"><span>${esc(a.team||'General')} · ${esc(a.tone||'profesional')} · ${esc(a.model||state.settings.model||'IA')}</span><button data-edit-agent="${esc(a.id)}">Configurar ↗</button></div></article>`;}
const empty=msg=>`<div class="empty">${esc(msg)}</div>`;
function renderHome(){
 $('#metric-agents').textContent=activeAgents().length;
 $('#metric-tasks').textContent=state.tasks.filter(x=>x.status==='done').length;
 $('#metric-meetings').textContent=state.meetings.length;
 $('#metric-routines').textContent=state.routines.filter(x=>x.enabled).length;
 $('#sidebar-agents').textContent=state.agents.length;
 $('#sidebar-approvals').textContent=state.approvals.filter(x=>x.status==='pending').length;
 $('#engine-name').textContent=state.settings.provider==='demo'?'Modo demostración':(state.settings.provider==='ollama'?'Ollama local':'API compatible');
 $('#engine-status').textContent=state.settings.provider==='demo'?'Sin IA real':(state.settings.model||'Motor por configurar');
 $('#home-agents').innerHTML=activeAgents().map(a=>`<button class="mini-agent" data-chat-agent="${esc(a.id)}">${icon(a)}<div><strong>${esc(a.name)}</strong><small>${esc(a.role)}</small></div><span>↗</span></button>`).join('')||empty('Todavía no hay agentes activos.');
 $('#home-activity').innerHTML=(state.activity||[]).slice(0,10).map(x=>`<div class="activity"><span class="activity-icon">✦</span><div><strong>${esc(x.content)}</strong><small>${fmt(x.at)}</small></div></div>`).join('')||empty('La actividad del equipo aparecerá acá.');
}
function renderAgents(){
 const shown=[...state.agents,...localDrafts];
 $('#agents-grid').innerHTML=shown.map(agentCard).join('')||empty(connection.online?'Tu equipo está vacío.':'No se pudieron cargar los agentes del servidor. Revisá la conexión o creá un borrador local.');
 $('#agent-summary').textContent=state.agents.length+' agentes · '+localDrafts.length+' borradores';
}
function statusBadge(s){return `<span class="status ${esc(s||'pending')}">${esc(({running:'TRABAJANDO',stopped:'DETENIDA',done:'LISTO',failed:'ERROR',interrupted:'INTERRUMPIDO',pending:'PENDIENTE',approved:'APROBADO',rejected:'RECHAZADO'}[s])||s||'PENDIENTE')}</span>`;}
function detailBlock(label,text){return text?`<details><summary>${esc(label)} ↓</summary><pre>${esc(text)}</pre></details>`:'';}
function renderTasks(){pickAgents('task-agent-picks');$('#task-total').textContent=state.tasks.length;
 $('#task-list').innerHTML=state.tasks.map(t=>`<article class="record"><div class="record-top"><strong>${esc(t.title)}</strong>${statusBadge(t.status)}</div><p class="muted">${esc(short(t.prompt,190))}</p><small class="muted">${fmt(t.createdAt)} · ${t.agentIds?.length||0} agentes</small>${t.contributions?.length?`<details><summary>Ver aportes (${t.contributions.length})</summary>${t.contributions.map(c=>`<div class="contribution"><strong>${esc(c.name)} · ${esc(c.role)}</strong>${esc(c.response||c.error)}</div>`).join('')}</details>`:''}${detailBlock('Informe del manager',t.managerSummary)}${t.error?`<p class="warn-text">${esc(t.error)}</p>`:''}</article>`).join('')||empty('Todavía no lanzaste misiones.');}
function renderMeetings(){
 const focused=document.activeElement?.closest?.('form[data-meeting-id]');const activeId=focused?.dataset.meetingId||'';const draft=focused?.querySelector('input[name=message]')?.value||'';
 pickAgents('meeting-agent-picks');
 $('#meeting-list').innerHTML=state.meetings.map(m=>`<article class="record"><div class="record-top"><strong>${esc(m.topic)}</strong>${statusBadge(m.status)}</div><small class="muted">${fmt(m.at)} · ${m.turns?.length||0} participantes hablaron</small>${m.status==='running'?`<div class="inline-actions"><span class="live-label"><i></i> REUNIÓN EN CURSO</span><button class="mini-button delete" data-stop-meeting="${esc(m.id)}">■ Detener</button></div><form class="meeting-interject" data-meeting-id="${esc(m.id)}"><input name="message" maxlength="800" placeholder="Aportá una idea al equipo…" required/><button class="mini-button" type="submit">Enviar al equipo ↗</button></form>`:''}${m.turns?.length?`<details open><summary>Intervenciones en directo (${m.turns.length})</summary>${m.turns.map(t=>`<div class="contribution"><strong>${esc(t.name)} · ${esc(t.role||'')}</strong><small>${fmt(t.at)}</small><p class="meeting-speech">${esc(t.message)}</p><button type="button" class="mini-button" data-read-meeting>♫ Escuchar</button></div>`).join('')}</details>`:''}${detailBlock('Acta y decisiones',m.summary)}${m.error?`<p class="warn-text">${esc(m.error)}</p>`:''}</article>`).join('')||empty('Aún no hubo reuniones.');
 if(activeId){const target=$$('#meeting-list form[data-meeting-id]').find(f=>f.dataset.meetingId===activeId)?.querySelector('input[name=message]');if(target){target.value=draft;target.focus();}}
}
function renderRoutines(){pickAgents('routine-agent-picks');$('#routine-list').innerHTML=state.routines.map(r=>`<article class="record"><div class="record-top"><strong>${esc(r.title)}</strong><span class="status ${r.enabled?'done':'interrupted'}">${r.enabled?'ACTIVA':'PAUSADA'}</span></div><p class="muted">${esc(short(r.prompt,200))}</p><small class="muted">${r.frequency==='daily'?'Diaria':'Semanal'} a las ${esc(r.time)} · ${r.action==='task'?'Misión':'Reunión'}</small><div class="inline-actions"><button class="mini-button" data-run-routine="${esc(r.id)}">▶ Ejecutar ahora</button><button class="mini-button" data-toggle-routine="${esc(r.id)}" data-enable="${!r.enabled}">${r.enabled?'Pausar':'Activar'}</button><button class="mini-button delete" data-delete-routine="${esc(r.id)}">Eliminar</button></div><small class="muted">Última ejecución: ${fmt(r.lastRunAt)} (${esc(r.lastStatus)})</small></article>`).join('')||empty('Todavía no hay automatizaciones.');}
function messageView(m){const agent=agentBy(m.agentId);const isUser=m.role==='user';return `<div class="message ${isUser?'user':''} ${m.role==='manager'?'manager':''}"><span class="message-badge">${isUser?'●':esc(agent?.emoji||'✦')}</span><div class="message-main"><div class="message-head"><strong>${esc(m.name|| (isUser?'Vos':agent?.name||'Asistente'))}</strong><span>${fmt(m.at)}</span></div><div class="message-body">${esc(m.content)}</div>${!isUser&&m.role!=='error'?`<button type="button" class="read-message" data-read-message="${esc(m.id||'')}" title="Leer en voz alta">♫ Escuchar</button>`:''}</div></div>`;}
function chooseChannel(id){currentChannel=id;renderChannels();}
function renderChannels(){
 const feed=$('#channel-feed'), atBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100, scrollPosition=feed.scrollTop;
 $('#channel-list').innerHTML=state.channels.map(c=>`<button class="channel-item ${c.id===currentChannel?'active':''}" data-channel="${esc(c.id)}"><span class="channel-hash">#</span><span><strong>${esc(c.name)}</strong><small>${(c.agentIds||[]).length} agentes</small></span></button>`).join('')||empty('Creá un canal de equipo.');
 const c=state.channels.find(c=>c.id===currentChannel)||state.channels[0];if(c&&!currentChannel)currentChannel=c.id;
 $('#channel-header').innerHTML=c?`<span class="channel-hash">#</span><div><strong>${esc(c.name)}</strong><small>${esc(c.description||'Canal compartido')} · ${c.busy?'Respondiendo…':'Disponible'}</small></div><button class="mini-button delete" style="margin-left:auto" data-delete-channel="${esc(c.id)}">Eliminar</button>`:'<p class="muted">Elegí o creá un canal.</p>';
 $('#channel-feed').innerHTML=c?(c.messages?.length?c.messages.map(messageView).join(''):empty('Escribí una misión y tu equipo responderá en paralelo.')):empty('Todavía no hay canales.');
 $('#channel-form button').disabled=!c||!!c.busy;
 const running=c?.session?.status==='running'||c?.session?.status==='stopping';
 $('#debate-form').classList.toggle('disabled',!c);
 $('#debate-start').disabled=!c||!!c.busy;
 $('#debate-stop').hidden=!running;
 $('#debate-stop').disabled=c?.session?.status==='stopping';
 $('#debate-status').textContent=!c?'Seleccioná un canal':running?`${c.session.turnsDone}/${c.session.maxTurns} intervenciones · ${c.session.status==='stopping'?'Deteniendo…':'en vivo'}`:c.session?`Último debate: ${c.session.status} · ${c.session.turnsDone} turnos`:'Sin debate activo';
 if(c?.session?.status==='failed')$('#debate-status').textContent+=' · '+(c.session.error||'error');
 if(c?.session?.status==='running')$('#debate-topic').value=c.session.topic;
 feed.scrollTop=atBottom?feed.scrollHeight:scrollPosition;
}

function renderChatList(){
 $('#chat-list').innerHTML=state.agents.map(a=>`<button class="channel-item ${a.id===currentChat?'active':''}" data-chat-agent="${esc(a.id)}">${icon(a)}<span><strong>${esc(a.name)}</strong><small>${esc(a.role)}</small></span></button>`).join('');
 const a=agentBy(currentChat)||state.agents[0];if(a&&!currentChat)currentChat=a.id;
 $('#chat-header').innerHTML=a?`${icon(a)}<div><strong>${esc(a.name)}</strong><small>${esc(a.role)} · ${a.active?'Disponible':'Pausado'}</small></div>`:empty('Elegí un agente.');
 $('#chat-form button').disabled=!a||!a.active;
}
async function loadChat(){if(!currentChat)return;const id=currentChat;try{const d=await api('/api/chats/'+encodeURIComponent(id));if(currentChat!==id)return;$('#chat-feed').innerHTML=d.messages.length?d.messages.map(m=>messageView({...m,agentId:id})).join(''):empty('Empezá a conversar con el agente.');}catch(e){toast(e.message,true);}}
function renderMemories(){
 $('#memory-count').textContent=state.memories.length;
 const currentSelected=$('#memory-agent').value;$('#memory-agent').innerHTML='<option value="">Todo el equipo</option>'+state.agents.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');$('#memory-agent').value=currentSelected;
 const q=val('memory-search').toLowerCase();$('#memory-list').innerHTML=state.memories.filter(m=>((m.title+' '+m.content).toLowerCase().includes(q))).map(m=>`<article class="record"><div class="record-top"><strong>${esc(m.title)}</strong><button class="mini-button delete" data-delete-memory="${esc(m.id)}">Eliminar</button></div><p class="muted">${esc(m.content)}</p><small class="muted">${esc(agentBy(m.agentId)?.name||'Todo el equipo')} · ${fmt(m.createdAt)}</small></article>`).join('')||empty('No se encontraron notas.');}
function renderApprovals(){$('#approval-list').innerHTML=state.approvals.map(a=>`<article class="record"><div class="record-top"><strong>${esc(a.title)}</strong>${statusBadge(a.status)}</div><p class="muted">${esc(a.description)}</p>${a.status==='pending'?`<div class="inline-actions"><button class="mini-button" data-approve="${esc(a.id)}" data-status="approved">Aprobar</button><button class="mini-button delete" data-approve="${esc(a.id)}" data-status="rejected">Rechazar</button></div>`:''}<small class="muted">${fmt(a.createdAt)}</small></article>`).join('')||empty('No hay acciones pendientes de revisión.');}
function renderSettings(){$('#settings-provider').value=state.settings.provider||'ollama';$('#settings-model').value=state.settings.model||'llama3.2';$('#settings-daily').checked=!!state.settings.dailyEnabled;$('#settings-time').value=state.settings.dailyTime||'09:00';$('#settings-timezone').value=state.settings.timezone||'America/Argentina/Buenos_Aires';$('#app-api-url').value=apiHost;$('#app-token').value=accessToken;}
function renderWhatsApp(){
 const contacts=Object.values(state.whatsappContacts||{});
 $('#wa-active-groups').innerHTML=contacts.map(c=>`<article class="wa-contact"><strong>${esc(c.label||c.phone)} · ${esc(c.phone)}</strong><small>${c.enabled?(c.consent?'Autorizado y activo':'Esperando !bot aceptar'):'Pausado'} · ${esc(c.mode||'comando')} · ${esc(agentBy(c.agentId)?.name||'Sin agente')}</small><button class="mini-button delete" data-wa-delete="${esc(c.phone)}">Desconectar</button></article>`).join('')||'<p class="muted">No hay contactos autorizados. El alta exige consentimiento del contacto desde WhatsApp.</p>';
 const id=$('#wa-agent').value;$('#wa-agent').innerHTML=agentOptions();if(activeAgents().some(a=>a.id===id))$('#wa-agent').value=id;
}
async function pollWA(){if(current!=='integraciones')return;try{const d=await api('/api/whatsapp/status');$('#wa-status').textContent=d.configured?'Configurado':'Faltan credenciales';$('#wa-error').textContent=d.missing?.length?'En el servidor faltan: '+d.missing.join(', '):'';$('#wa-webhook-help').textContent='Webhook: '+d.webhookPath+' · Necesita HTTPS y un servidor accesible desde Meta. Los grupos personales no tienen acceso mediante este conector.';}catch(e){$('#wa-error').textContent=e.message;}}
function renderCatalog(){
 const cat=$('#connector-catalog');if(!cat)return;
 const groups=['Productividad','Redes sociales','Comunicación','Desarrollo','Contenido'];
 cat.innerHTML=groups.map(group=>{const items=integrations.filter(x=>x.category===group&&x.id!=='whatsapp');if(!items.length)return '';return `<div class="catalog-group"><h3>${esc(group)}</h3><div class="connector-grid">${items.map(c=>`<article class="connector-card"><div class="connector-head"><span class="connector-icon">${esc(c.icon)}</span><span class="connector-status ${c.connected?'linked':c.kind==='planned'?'planned':''}">${c.connected?'● CONECTADO':c.kind==='planned'?'PRÓXIMAMENTE':c.kind==='google'&&!c.available?'REQUIERE OAUTH':'○ DESCONECTADO'}</span></div><h4>${esc(c.name)}</h4><p>${esc(c.ability)}</p><div class="connector-foot"><span>${esc(c.mode)}</span><div class="connector-actions"><button class="mini-button" data-open-connector="${esc(c.id)}">${c.kind==='planned'?'Detalles':'Configurar'}</button>${c.connected&&!['planned','separate'].includes(c.kind)?`<button class="mini-button" data-preview-connector="${esc(c.id)}">Usar ↗</button>`:''}</div></div></article>`).join('')}</div></div>`;}).join('');
}
function openConnector(id){const c=integrations.find(x=>x.id===id);if(!c)return;previewConnector=id;
 $('#connector-title').textContent=c.name;$('#connector-description').textContent=c.help;
 const cfg=$('#connector-config');cfg.innerHTML='';const action=$('#connector-actions');action.innerHTML='';
 if(c.kind==='google'){
 cfg.innerHTML=`<p class="muted">Google solicita autorización para leer correo, eventos y metadatos de Drive. No se conceden permisos de envío, edición o borrado.</p>`;
 action.innerHTML='<button type="button" class="button primary" id="google-connect">Autorizar con Google ↗</button>'+(c.connected?'<button type="button" class="button ghost" id="connector-disconnect">Desconectar Google</button>':'');
 }else if(c.kind==='planned'||c.kind==='separate'){
 cfg.innerHTML=`<p class="muted">${esc(c.ability)}</p>`;
 }else{
 cfg.innerHTML=(c.fields||[]).map(f=>`<label>${esc(f.label)}<input name="${esc(f.key)}" type="${f.secret?'password':'text'}" autocomplete="off" required placeholder="${f.secret?'Pegá la credencial aquí':esc(f.label)}"/></label>`).join('');
 action.innerHTML=`<button class="button primary" type="submit">${c.connected?'Actualizar credenciales':'Guardar conexión'}</button>${c.connected?'<button type="button" class="button ghost" id="connector-disconnect">Desconectar</button>':''}`;
 }
 $('#connector-dialog').showModal();
}
function openPreview(id){const c=integrations.find(x=>x.id===id);previewConnector=id;$('#connector-preview').hidden=false;$('#connector-read-row').hidden=c?.kind==='outbound';$('#connector-send-row').hidden=c?.kind!=='outbound';$('#connector-preview-title').textContent=c?.name||id;$('#connector-preview-output').textContent='Cargando…';$('#connector-brief-agent').innerHTML=agentOptions();}
async function refreshCatalog(){try{integrations=(await api('/api/connectors/catalog')).items;renderCatalog();}catch(e){toast(e.message,true);}}
async function refresh(full=false){if(polling)return;polling=true;try{
 const wasOnline=connection.online;
 const loaded=await api('/api/bootstrap');
 if(!Array.isArray(loaded.agents)||!loaded.settings||typeof loaded.settings!=='object')throw setError('La dirección no corresponde al backend de NEXO Studio.','BAD_JSON');
 state=loaded;connection={online:true,reason:'',code:'OK'};renderConnection();renderHome();renderWhatsApp();
 if(!wasOnline)setTimeout(()=>connectEvents(),0);
 if(current==='agentes')renderAgents();
 if(current==='tareas'&&document.activeElement?.closest('#task-form')===null)renderTasks();else if(current==='tareas'){$('#task-list').innerHTML=state.tasks.map(t=>`<article class="record"><strong>${esc(t.title)}</strong> ${statusBadge(t.status)}</article>`).join('');}
 if(current==='reuniones')renderMeetings();
 if(current==='rutinas')renderRoutines();
 if(current==='memoria')renderMemories();
 if(current==='aprobaciones')renderApprovals();
 if(current==='canales')renderChannels();
 if(current==='integraciones'&&full)await refreshCatalog();
 if(full&&current==='ajustes')renderSettings();
 }catch(e){
 connection={online:false,reason:e.message,code:e.code||'UNAVAILABLE'};
 liveEventAbort?.abort();clearTimeout(liveReconnectTimer);renderConnection();if(current==='agentes')renderAgents();
 if(full)toast(e.message,true);$('#engine-status').textContent='Servidor sin conexión';
}finally{polling=false;}}
function goto(page){if(!titles[page])return;current=page;$$('.page').forEach(p=>p.classList.toggle('visible',p.id==='page-'+page));$$('[data-page]').forEach(b=>{b.classList.toggle('selected',b.dataset.page===page);b.classList.toggle('active',b.dataset.page===page);});$('#breadcrumb').textContent=titles[page].toUpperCase();$('#sidebar').classList.remove('open');$('#backdrop').classList.remove('show');
 if(page==='agentes')renderAgents();if(page==='tareas')renderTasks();if(page==='reuniones')renderMeetings();if(page==='rutinas')renderRoutines();if(page==='chats'){renderChatList();void loadChat();}if(page==='canales')renderChannels();if(page==='memoria')renderMemories();if(page==='aprobaciones')renderApprovals();if(page==='integraciones'){renderWhatsApp();void refreshCatalog();void pollWA();void detectOllama();}if(page==='ajustes'){renderSettings();void detectOllama();}
 location.hash=page;
}
function openAgent(a=null){$('#agent-form').reset();$('#agent-dialog-title').textContent=a?'Editar agente':'Crear agente';$('#agent-id').value=a?.id||'';$('#agent-name').value=a?.name||'';$('#agent-role').value=a?.role||'';$('#agent-emoji').value=a?.emoji||'✧';$('#agent-team').value=a?.team||'General';$('#agent-model').value=a?.model||'';$('#agent-instructions').value=a?.instructions||'';$('#agent-personality').value=a?.personality||'';$('#agent-tone').value=a?.tone||'profesional';$('#agent-initiative').value=a?.initiative||'equilibrada';$('#agent-communication').value=a?.communication||'directa';$('#agent-manager').checked=!!a?.isManager;$('#agent-active').checked=a?a.active:true;$('#agent-delete').hidden=!a;$('#agent-dialog').showModal();}
async function detectOllama(){try{const d=await api('/api/models');$('#ollama-connection').textContent=d.online?'Disponible':'Sin conexión';$('#model-list').textContent=d.models?.length?'Modelos: '+d.models.join(', '):'Instalá Ollama y descargá un modelo con ollama pull llama3.2';}catch(e){$('#ollama-connection').textContent='Sin conexión';}}
async function doForm(event,fn){event.preventDefault();const btn=event.submitter||event.target.querySelector('button[type=submit]');if(btn)btn.disabled=true;try{await fn();}catch(e){toast(e.message,true);}finally{if(btn)btn.disabled=false;}}
async function streamPrivateChat(msg) {
 const agentId=currentChat;if(busy||!agentId)return;
 busy=true;const controller=new AbortController();chatAbort=controller;
 $('#chat-input').value='';$('#chat-cancel').hidden=false;$('#chat-stream-status').textContent='Recibiendo respuesta en tiempo real…';
 const feed=$('#chat-feed');feed.insertAdjacentHTML('beforeend',messageView({role:'user',name:'Vos',content:msg,at:new Date().toISOString()})+`<div class="live-response" id="ai-typing">Esperando al modelo…</div>`);feed.scrollTop=feed.scrollHeight;
 let content='';
 try {
   await requestStream('/api/chats/'+encodeURIComponent(agentId)+'/stream',{message:msg},event=>{
     if(event.type==='delta'){content+=event.text;if(currentChat===agentId){$('#ai-typing').textContent=content;feed.scrollTop=feed.scrollHeight;}}
     if(event.type==='error')throw Error(event.message);
   },controller.signal);
   if(!controller.signal.aborted){await loadChat();$('#chat-stream-status').textContent='Respuesta finalizada.';}
 }catch(e){if(e.name==='AbortError'){$('#chat-stream-status').textContent='Respuesta interrumpida por vos.';}else{toast(e.message,true);$('#chat-stream-status').textContent='La respuesta tuvo un error.';}}
 finally {busy=false;chatAbort=null;$('#chat-cancel').hidden=true;$('#ai-typing')?.remove();if(currentChat===agentId)await loadChat();}
}
function enableDictation(){
 const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SpeechRecognition){toast('Tu navegador no ofrece dictado por voz. Podés usar el micrófono del teclado.',true);return;}
 const recognition=new SpeechRecognition();recognition.lang='es-AR';recognition.interimResults=false;recognition.maxAlternatives=1;
 $('#chat-mic').disabled=true;$('#chat-stream-status').textContent='Micrófono activo · escuchando…';
 recognition.onresult=event=>{$('#chat-input').value=($('#chat-input').value+' '+event.results[0][0].transcript).trim();};
 recognition.onerror=event=>toast('No se pudo reconocer la voz: '+event.error,true);
 recognition.onend=()=>{$('#chat-mic').disabled=false;$('#chat-stream-status').textContent='Dictado detenido. Revisá el texto antes de enviarlo.';};
 try{recognition.start();}catch(e){$('#chat-mic').disabled=false;toast(e.message,true);}
}
function bind(){
 document.addEventListener('click',async e=>{const x=e.target.closest('button');if(!x)return;
 try{
 if(x.hasAttribute('data-read-meeting')){const spoken=x.closest('.contribution')?.querySelector('.meeting-speech')?.textContent;if(spoken&&'speechSynthesis' in window){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(spoken.slice(0,4000));u.lang='es-AR';speechSynthesis.speak(u);}else toast('Voz no disponible en este navegador.',true);return;}
 if(x.hasAttribute('data-read-message')) {const spoken=x.closest('.message')?.querySelector('.message-body')?.textContent;if(spoken){if(!('speechSynthesis' in window))toast('Este dispositivo no permite lectura por voz.',true);else{speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(spoken.slice(0,4000));utterance.lang='es-AR';speechSynthesis.speak(utterance);}}return;}
 if(x.dataset.page)goto(x.dataset.page);
 if(x.dataset.go)goto(x.dataset.go);
 if(x.dataset.editAgent)openAgent(agentByAny(x.dataset.editAgent));
 if(x.dataset.chatAgent){if(!connection.online){toast('Conectá el servidor antes de chatear con la IA.',true);return;}currentChat=x.dataset.chatAgent;goto('chats');renderChatList();void loadChat();}
 if(x.dataset.channel){chooseChannel(x.dataset.channel);}
 if(x.dataset.deleteChannel){if(confirm('¿Eliminar este canal y su historial?')){await remove('/api/channels/'+encodeURIComponent(x.dataset.deleteChannel));currentChannel='';await refresh();renderChannels();}}
 if(x.dataset.deleteMemory){if(confirm('¿Eliminar esta nota?')){await remove('/api/memories/'+encodeURIComponent(x.dataset.deleteMemory));await refresh();}}
 if(x.dataset.deleteRoutine){if(confirm('¿Eliminar esta rutina?')){await remove('/api/routines/'+encodeURIComponent(x.dataset.deleteRoutine));await refresh();}}
 if(x.dataset.toggleRoutine){await patch('/api/routines/'+encodeURIComponent(x.dataset.toggleRoutine),{enabled:x.dataset.enable==='true'});await refresh();}
 if(x.dataset.runRoutine){await post('/api/routines/'+encodeURIComponent(x.dataset.runRoutine)+'/run',{});toast('Automatización ejecutada.');await refresh();}
 if(x.dataset.approve){await patch('/api/approvals/'+encodeURIComponent(x.dataset.approve),{status:x.dataset.status});toast('Decisión registrada; no se ejecutó ninguna acción externa.');await refresh();}
 if(x.dataset.stopMeeting){await post('/api/meetings/'+encodeURIComponent(x.dataset.stopMeeting)+'/stop',{});toast('Reunión detenida.');await refresh();}
 if(x.dataset.waDelete){if(!confirm('¿Desconectar este contacto del bot?'))return;await remove('/api/whatsapp/contacts/'+encodeURIComponent(x.dataset.waDelete));toast('Contacto desconectado.');await refresh();}
 if(x.dataset.openConnector)openConnector(x.dataset.openConnector);
 }catch(err){toast(err.message,true);}
 });
 $('#open-menu').onclick=()=>{$('#sidebar').classList.add('open');$('#backdrop').classList.add('show');};
 $('#backdrop').onclick=()=>{$('#sidebar').classList.remove('open');$('#backdrop').classList.remove('show');};
 $('#mobile-more').onclick=$('#open-menu').onclick;
 $('#global-create').onclick=$('#add-agent').onclick=()=>openAgent();
 $('#agent-close').onclick=$('#agent-cancel').onclick=()=>$('#agent-dialog').close();
 $('#agent-form').addEventListener('submit',e=>doForm(e,async()=>{
 const id=val('agent-id');const b={name:val('agent-name'),role:val('agent-role'),instructions:val('agent-instructions'),personality:val('agent-personality'),tone:val('agent-tone'),initiative:val('agent-initiative'),communication:val('agent-communication'),emoji:val('agent-emoji'),team:val('agent-team'),model:val('agent-model'),active:$('#agent-active').checked,isManager:$('#agent-manager').checked};
 if(localAgent({id})||(!id&&!connection.online)){
   storeDraft(b,id);$('#agent-dialog').close();toast('Borrador guardado en este dispositivo. Conectá el servidor para activar la IA.');return;
 }
 if(!connection.online)throw Error('No se puede editar un agente del servidor sin conexión. Reintentá cuando esté disponible.');
 try{if(id)await patch('/api/agents/'+encodeURIComponent(id),b);else await post('/api/agents',b);}
 catch(err){if(!id&&isConnectionIssue(err)){
   connection={online:false,reason:err.message,code:err.code};storeDraft(b);$('#agent-dialog').close();toast('No se pudo conectar. Guardé el agente como borrador local.');return;
 }throw err;}
 $('#agent-dialog').close();await refresh();renderAgents();toast('Agente guardado en el servidor.');
 }));
 $('#agent-delete').onclick=async()=>{
 const id=val('agent-id');if(!confirm(localAgent({id})?'¿Eliminar este borrador local?':'¿Eliminar el agente y su historial privado?'))return;
 try{
   if(localAgent({id})){deleteDraft(id);$('#agent-dialog').close();toast('Borrador eliminado.');return;}
   if(!connection.online)throw Error('Conectá el servidor para eliminar este agente.');
   await remove('/api/agents/'+encodeURIComponent(id));$('#agent-dialog').close();await refresh();renderAgents();toast('Agente eliminado.');
 }catch(e){toast(e.message,true);}};
 $('#open-connection').onclick=()=>goto('ajustes');
 $('#retry-connection').onclick=async()=>{await refresh(true);if(connection.online){toast('Servidor conectado.');connectEvents();}};
 $('#sync-drafts').onclick=async()=>{try{$('#sync-drafts').disabled=true;await syncDrafts();}catch(e){toast('No se pudieron sincronizar todos los borradores: '+e.message,true);}finally{$('#sync-drafts').disabled=false;}};
 $('#add-channel').onclick=()=>{$('#channel-create-form').reset();$('#channel-dialog').showModal();pickAgents('channel-picks');};
 $('#channel-close').onclick=$('#channel-cancel').onclick=()=>$('#channel-dialog').close();
 $('#channel-create-form').addEventListener('submit',e=>doForm(e,async()=>{const d=await post('/api/channels',{name:val('channel-name'),description:val('channel-description'),agentIds:picks('channel-picks'),withManager:$('#channel-manager').checked});currentChannel=d.channel.id;$('#channel-dialog').close();await refresh();renderChannels();toast('Canal creado.');}));
 $('#task-form').addEventListener('submit',e=>doForm(e,async()=>{await post('/api/tasks',{title:val('task-title'),prompt:val('task-prompt'),agentIds:picks('task-agent-picks')});$('#task-title').value='';$('#task-prompt').value='';await refresh();renderTasks();toast('Misión iniciada.');}));
 $('#meeting-list').addEventListener('submit',e=>{const form=e.target.closest('form[data-meeting-id]');if(!form)return;doForm(e,async()=>{await post('/api/meetings/'+encodeURIComponent(form.dataset.meetingId)+'/messages',{message:form.querySelector('input[name=message]').value});await refresh();toast('Tu aporte se incorporó a la reunión.');});});
 $('#meeting-form').addEventListener('submit',e=>doForm(e,async()=>{await post('/api/meetings',{topic:val('meeting-topic'),agentIds:picks('meeting-agent-picks'),minutes:Number(val('meeting-minutes'))});$('#meeting-topic').value='';await refresh();toast('Reunión iniciada.');}));
 $('#routine-frequency').onchange=()=>$('#weekday-label').classList.toggle('hidden',val('routine-frequency')!=='weekly');
 $('#routine-form').addEventListener('submit',e=>doForm(e,async()=>{await post('/api/routines',{title:val('routine-title'),prompt:val('routine-prompt'),action:val('routine-action'),frequency:val('routine-frequency'),time:val('routine-time'),weekday:Number(val('routine-weekday')),agentIds:picks('routine-agent-picks')});$('#routine-title').value='';$('#routine-prompt').value='';await refresh();toast('Rutina configurada.');}));
 $('#chat-form').addEventListener('submit',e=>{e.preventDefault();const msg=val('chat-input');if(msg&&!busy)void streamPrivateChat(msg);});
 $('#chat-cancel').onclick=()=>chatAbort?.abort();
 $('#chat-mic').onclick=enableDictation;
 $('#debate-form').addEventListener('submit',e=>doForm(e,async()=>{if(!currentChannel)return;await post('/api/channels/'+encodeURIComponent(currentChannel)+'/discussion',{topic:val('debate-topic'),maxTurns:Number(val('debate-turns')),maxMinutes:10});await refresh();toast('Debate iniciado.');}));
 $('#debate-stop').onclick=async()=>{try{await post('/api/channels/'+encodeURIComponent(currentChannel)+'/discussion/stop',{});await refresh();}catch(e){toast(e.message,true);}};
 $('#channel-form').addEventListener('submit',e=>doForm(e,async()=>{if(!currentChannel)return;await post('/api/channels/'+encodeURIComponent(currentChannel)+'/messages',{message:val('channel-input')});$('#channel-input').value='';await refresh();renderChannels();toast('Los agentes están elaborando respuestas.');}));
 $('#memory-search').oninput=renderMemories;
 $('#memory-form').addEventListener('submit',e=>doForm(e,async()=>{await post('/api/memories',{title:val('memory-title'),content:val('memory-content'),agentId:val('memory-agent')||null});$('#memory-title').value='';$('#memory-content').value='';await refresh();toast('Memoria guardada.');}));
 $('#approval-form').addEventListener('submit',e=>doForm(e,async()=>{await post('/api/approvals',{title:val('approval-title'),description:val('approval-description')});$('#approval-title').value='';$('#approval-description').value='';await refresh();toast('Solicitud registrada.');}));
 $('#settings-form').addEventListener('submit',e=>doForm(e,async()=>{await post('/api/settings',{provider:val('settings-provider'),model:val('settings-model'),dailyEnabled:$('#settings-daily').checked,dailyTime:val('settings-time'),timezone:val('settings-timezone')});await refresh();toast('Motor actualizado.');}));
 $('#save-connection').onclick=e=>{e.preventDefault();const proposed=val('app-api-url').replace(/\/$/,'');if(proposed&&(!/^https:\/\/[^?#/]+$/i.test(proposed))){toast('Para Android usá una URL HTTPS del servidor.',true);return;}apiHost=proposed;accessToken=val('app-token');localStorage.setItem('nexo_api_url',apiHost);if(accessToken)sessionStorage.setItem('nexo_access_token',accessToken);else sessionStorage.removeItem('nexo_access_token');void refresh(true).then(()=>{if(connection.online){toast('Conexión comprobada: servidor de NEXO disponible.');connectEvents();}else{toast('Conexión guardada, pero todavía no funciona: '+connection.reason,true);}});};
 $('#download-backup').onclick=async()=>{try{const h=accessToken?{Authorization:'Bearer '+accessToken}:{};const r=await fetch(apiHost+'/api/export',{headers:h});if(!r.ok)throw Error('Error descargando respaldo.');const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download='nexo-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}catch(e){toast(e.message,true);}};
 $('#wa-reload').onclick=()=>{void pollWA();};
 $('#wa-form').addEventListener('submit',e=>doForm(e,async()=>{
    const d=await post('/api/whatsapp/contacts',{phone:val('wa-phone'),label:val('wa-label'),agentId:val('wa-agent'),mode:val('wa-mode'),consentConfirmed:$('#wa-consent').checked});
    $('#wa-phone').value='';$('#wa-label').value='';$('#wa-consent').checked=false;
    await refresh();toast(d.instruction);
 }));
 $('#connector-close').onclick=$('#connector-cancel').onclick=()=>$('#connector-dialog').close();
 $('#connector-form').addEventListener('submit',e=>doForm(e,async()=>{const c=integrations.find(x=>x.id===previewConnector);if(!c||!['token','outbound','public'].includes(c.kind))return;const data={};for(const f of c.fields)data[f.key]=$(`#connector-config [name="${f.key}"]`).value;await post('/api/connectors/'+c.id,data);$('#connector-dialog').close();await refreshCatalog();toast(c.name+' configurado.');}));
 $('#connector-actions').addEventListener('click',async e=>{if(e.target.id==='google-connect'){try{const r=await api('/api/connectors/google/start');location.href=r.url;}catch(err){toast(err.message,true);}}if(e.target.id==='connector-disconnect'){if(!confirm('¿Desconectar este servicio y borrar su credencial?'))return;try{await remove('/api/connectors/'+previewConnector);$('#connector-dialog').close();await refreshCatalog();toast('Servicio desconectado.');}catch(err){toast(err.message,true);}}});
 $('#connector-preview').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
 if(b.id==='connector-preview-close'){$('#connector-preview').hidden=true;return;}
 if(b.id==='connector-read'){const result=await api('/api/connectors/'+previewConnector+'/data');$('#connector-preview-output').textContent=JSON.stringify(result.items,null,2);}
 if(b.id==='connector-brief'){$('#connector-preview-output').textContent='El agente está analizando datos…';const r=await post('/api/connectors/'+previewConnector+'/brief',{agentId:val('connector-brief-agent')});$('#connector-preview-output').textContent=r.reply;}
 if(b.id==='connector-send'){const msg=val('connector-message');if(!msg)throw Error('Escribí un mensaje para enviar.');if(!confirm('¿Confirmás el envío de este mensaje real a '+previewConnector+'?'))return;await post('/api/connectors/'+previewConnector+'/send',{message:msg,confirmation:'ENVIAR'});toast('Mensaje enviado con confirmación.');}
 }catch(err){toast(err.message,true);$('#connector-preview-output').textContent='Error: '+err.message;}});
 $('#connector-catalog').addEventListener('click',e=>{const b=e.target.closest('[data-preview-connector]');if(b){openPreview(b.dataset.previewConnector);}});
}
async function boot(){bind();$('#top-clock').textContent=new Date().toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'}).toUpperCase();const params=new URLSearchParams(location.search);if(params.has('oauth_error'))toast(params.get('oauth_error'),true);else if(params.has('connected'))toast('Cuenta Google conectada.');if(params.has('oauth_error')||params.has('connected'))history.replaceState({},'',location.pathname+'#integraciones');await refresh(true);goto(location.hash.slice(1) in titles?location.hash.slice(1):'inicio');if(connection.online)connectEvents();setInterval(()=>{if(document.hidden)return;void refresh();if(connection.online&&current==='integraciones')void pollWA();if(connection.online&&current==='chats'&&!busy)void loadChat();},5000);}
boot();
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1'))navigator.serviceWorker.register('/sw.js').catch(()=>{});
