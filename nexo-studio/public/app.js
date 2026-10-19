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
const titles={inicio:'Dashboard',agentes:'Equipo',canales:'Canales',tareas:'Misiones',reuniones:'Reuniones',rutinas:'Automatizaciones',chats:'Chat privado',memoria:'Memoria',aprobaciones:'Aprobaciones',integraciones:'Integraciones',ajustes:'Configuración'};
let toastTimer;
function toast(msg,err=false){const el=$('#toast');el.textContent=msg;el.className=err?'visible error':'visible';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',4800);}
async function api(url,{method='GET',body}={}){
 const h={'Accept':'application/json'};if(body!==undefined)h['Content-Type']='application/json';if(accessToken)h.Authorization='Bearer '+accessToken;
 let r;try{r=await fetch(apiHost+url,{method,headers:h,...(body!==undefined?{body:JSON.stringify(body)}:{})});}catch(e){throw Error('No hay conexión con NEXO. Revisá la dirección del servidor.');}
 let j;try{j=await r.json();}catch{throw Error('Respuesta no válida del servidor.');}
 if(!r.ok)throw Error(j.error||'Error HTTP '+r.status);return j;
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
 liveEventAbort?.abort();const controller=new AbortController();liveEventAbort=controller;
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
function agentCard(a){return `<article class="agent-card"><div class="agent-top">${icon(a)}<span class="agent-status ${a.active?'':'off'}"><i></i> ${a.active?'ACTIVO':'PAUSADO'}</span></div><h3>${esc(a.name)}</h3><p class="agent-role">${esc(a.role)}${a.isManager?' · MANAGER':''}</p><p class="agent-desc">${esc(short(a.instructions||'Especialista de tu equipo.',145))}</p><div class="agent-bottom"><span>${esc(a.team||'General')} · ${esc(a.model||state.settings.model||'IA')}</span><button data-edit-agent="${esc(a.id)}">Configurar ↗</button></div></article>`;}
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
function renderAgents(){ $('#agents-grid').innerHTML=state.agents.map(agentCard).join('')||empty('Tu equipo está vacío.');$('#agent-summary').textContent=state.agents.length+' agentes';}
function statusBadge(s){return `<span class="status ${esc(s||'pending')}">${esc(({running:'TRABAJANDO',done:'LISTO',failed:'ERROR',interrupted:'INTERRUMPIDO',pending:'PENDIENTE',approved:'APROBADO',rejected:'RECHAZADO'}[s])||s||'PENDIENTE')}</span>`;}
function detailBlock(label,text){return text?`<details><summary>${esc(label)} ↓</summary><pre>${esc(text)}</pre></details>`:'';}
function renderTasks(){pickAgents('task-agent-picks');$('#task-total').textContent=state.tasks.length;
 $('#task-list').innerHTML=state.tasks.map(t=>`<article class="record"><div class="record-top"><strong>${esc(t.title)}</strong>${statusBadge(t.status)}</div><p class="muted">${esc(short(t.prompt,190))}</p><small class="muted">${fmt(t.createdAt)} · ${t.agentIds?.length||0} agentes</small>${t.contributions?.length?`<details><summary>Ver aportes (${t.contributions.length})</summary>${t.contributions.map(c=>`<div class="contribution"><strong>${esc(c.name)} · ${esc(c.role)}</strong>${esc(c.response||c.error)}</div>`).join('')}</details>`:''}${detailBlock('Informe del manager',t.managerSummary)}${t.error?`<p class="warn-text">${esc(t.error)}</p>`:''}</article>`).join('')||empty('Todavía no lanzaste misiones.');}
function renderMeetings(){pickAgents('meeting-agent-picks');$('#meeting-list').innerHTML=state.meetings.map(m=>`<article class="record"><div class="record-top"><strong>${esc(m.topic)}</strong>${statusBadge(m.status)}</div><small class="muted">${fmt(m.at)}</small>${m.turns?.length?`<details><summary>Intervenciones (${m.turns.length})</summary>${m.turns.map(t=>`<div class="contribution"><strong>${esc(t.name)}</strong>${esc(t.message)}</div>`).join('')}</details>`:''}${detailBlock('Acta y decisiones',m.summary)}${m.error?`<p class="warn-text">${esc(m.error)}</p>`:''}</article>`).join('')||empty('Aún no hubo reuniones.');}
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
 $('#wa-active-groups').innerHTML=Object.values(state.whatsappGroups||{}).map(g=>`<p>${esc(g.groupName||g.groupId)} · ${g.enabled?'Activo':'Pausado'} · ${esc(g.mode)}</p>`).join('')||'<p>Sin grupos autorizados.</p>';
 const id=$('#wa-agent').value;$('#wa-agent').innerHTML=agentOptions();if(activeAgents().some(a=>a.id===id))$('#wa-agent').value=id;
}
async function pollWA(){if(current!=='integraciones')return;try{const d=await api('/api/whatsapp/status');$('#wa-status').textContent=d.status;$('#wa-error').textContent=d.error||'';$('#wa-qr').hidden=!d.qr;if(d.qr)$('#wa-qr').src=d.qr;const chosen=$('#wa-group').value;$('#wa-group').innerHTML=(d.groups||[]).map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')||'<option value="">Sin grupos detectados</option>';if((d.groups||[]).some(g=>g.id===chosen))$('#wa-group').value=chosen;}catch(e){$('#wa-error').textContent=e.message;}}
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
 state=await api('/api/bootstrap');renderHome();renderWhatsApp();
 if(current==='agentes')renderAgents();
 if(current==='tareas'&&document.activeElement?.closest('#task-form')===null)renderTasks();else if(current==='tareas'){$('#task-list').innerHTML=state.tasks.map(t=>`<article class="record"><strong>${esc(t.title)}</strong> ${statusBadge(t.status)}</article>`).join('');}
 if(current==='reuniones')renderMeetings();
 if(current==='rutinas')renderRoutines();
 if(current==='memoria')renderMemories();
 if(current==='aprobaciones')renderApprovals();
 if(current==='canales')renderChannels();
 if(current==='integraciones'&&full)await refreshCatalog();
 if(full&&current==='ajustes')renderSettings();
 }catch(e){if(full)toast(e.message,true);$('#engine-status').textContent='Servidor sin conexión';}finally{polling=false;}}
function goto(page){if(!titles[page])return;current=page;$$('.page').forEach(p=>p.classList.toggle('visible',p.id==='page-'+page));$$('[data-page]').forEach(b=>{b.classList.toggle('selected',b.dataset.page===page);b.classList.toggle('active',b.dataset.page===page);});$('#breadcrumb').textContent=titles[page].toUpperCase();$('#sidebar').classList.remove('open');$('#backdrop').classList.remove('show');
 if(page==='agentes')renderAgents();if(page==='tareas')renderTasks();if(page==='reuniones')renderMeetings();if(page==='rutinas')renderRoutines();if(page==='chats'){renderChatList();void loadChat();}if(page==='canales')renderChannels();if(page==='memoria')renderMemories();if(page==='aprobaciones')renderApprovals();if(page==='integraciones'){renderWhatsApp();void refreshCatalog();void pollWA();void detectOllama();}if(page==='ajustes'){renderSettings();void detectOllama();}
 location.hash=page;
}
function openAgent(a=null){$('#agent-form').reset();$('#agent-dialog-title').textContent=a?'Editar agente':'Crear agente';$('#agent-id').value=a?.id||'';$('#agent-name').value=a?.name||'';$('#agent-role').value=a?.role||'';$('#agent-emoji').value=a?.emoji||'✧';$('#agent-team').value=a?.team||'General';$('#agent-model').value=a?.model||'';$('#agent-instructions').value=a?.instructions||'';$('#agent-manager').checked=!!a?.isManager;$('#agent-active').checked=a?a.active:true;$('#agent-delete').hidden=!a;$('#agent-dialog').showModal();}
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
 if(x.hasAttribute('data-read-message')) {const spoken=x.closest('.message')?.querySelector('.message-body')?.textContent;if(spoken){if(!('speechSynthesis' in window))toast('Este dispositivo no permite lectura por voz.',true);else{speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(spoken.slice(0,4000));utterance.lang='es-AR';speechSynthesis.speak(utterance);}}return;}
 if(x.dataset.page)goto(x.dataset.page);
 if(x.dataset.go)goto(x.dataset.go);
 if(x.dataset.editAgent)openAgent(agentBy(x.dataset.editAgent));
 if(x.dataset.chatAgent){currentChat=x.dataset.chatAgent;goto('chats');renderChatList();void loadChat();}
 if(x.dataset.channel){chooseChannel(x.dataset.channel);}
 if(x.dataset.deleteChannel){if(confirm('¿Eliminar este canal y su historial?')){await remove('/api/channels/'+encodeURIComponent(x.dataset.deleteChannel));currentChannel='';await refresh();renderChannels();}}
 if(x.dataset.deleteMemory){if(confirm('¿Eliminar esta nota?')){await remove('/api/memories/'+encodeURIComponent(x.dataset.deleteMemory));await refresh();}}
 if(x.dataset.deleteRoutine){if(confirm('¿Eliminar esta rutina?')){await remove('/api/routines/'+encodeURIComponent(x.dataset.deleteRoutine));await refresh();}}
 if(x.dataset.toggleRoutine){await patch('/api/routines/'+encodeURIComponent(x.dataset.toggleRoutine),{enabled:x.dataset.enable==='true'});await refresh();}
 if(x.dataset.runRoutine){await post('/api/routines/'+encodeURIComponent(x.dataset.runRoutine)+'/run',{});toast('Automatización ejecutada.');await refresh();}
 if(x.dataset.approve){await patch('/api/approvals/'+encodeURIComponent(x.dataset.approve),{status:x.dataset.status});toast('Decisión registrada; no se ejecutó ninguna acción externa.');await refresh();}
 if(x.dataset.openConnector)openConnector(x.dataset.openConnector);
 }catch(err){toast(err.message,true);}
 });
 $('#open-menu').onclick=()=>{$('#sidebar').classList.add('open');$('#backdrop').classList.add('show');};
 $('#backdrop').onclick=()=>{$('#sidebar').classList.remove('open');$('#backdrop').classList.remove('show');};
 $('#mobile-more').onclick=$('#open-menu').onclick;
 $('#global-create').onclick=$('#add-agent').onclick=()=>openAgent();
 $('#agent-close').onclick=$('#agent-cancel').onclick=()=>$('#agent-dialog').close();
 $('#agent-form').addEventListener('submit',e=>doForm(e,async()=>{const id=val('agent-id');const b={name:val('agent-name'),role:val('agent-role'),instructions:val('agent-instructions'),emoji:val('agent-emoji'),team:val('agent-team'),model:val('agent-model'),active:$('#agent-active').checked,isManager:$('#agent-manager').checked};if(id)await patch('/api/agents/'+encodeURIComponent(id),b);else await post('/api/agents',b);$('#agent-dialog').close();await refresh();renderAgents();toast('Agente guardado.');}));
 $('#agent-delete').onclick=async()=>{const id=val('agent-id');if(!confirm('¿Eliminar el agente y su historial privado?'))return;try{await remove('/api/agents/'+encodeURIComponent(id));$('#agent-dialog').close();await refresh();renderAgents();toast('Agente eliminado.');}catch(e){toast(e.message,true);}};
 $('#add-channel').onclick=()=>{$('#channel-create-form').reset();$('#channel-dialog').showModal();pickAgents('channel-picks');};
 $('#channel-close').onclick=$('#channel-cancel').onclick=()=>$('#channel-dialog').close();
 $('#channel-create-form').addEventListener('submit',e=>doForm(e,async()=>{const d=await post('/api/channels',{name:val('channel-name'),description:val('channel-description'),agentIds:picks('channel-picks'),withManager:$('#channel-manager').checked});currentChannel=d.channel.id;$('#channel-dialog').close();await refresh();renderChannels();toast('Canal creado.');}));
 $('#task-form').addEventListener('submit',e=>doForm(e,async()=>{await post('/api/tasks',{title:val('task-title'),prompt:val('task-prompt'),agentIds:picks('task-agent-picks')});$('#task-title').value='';$('#task-prompt').value='';await refresh();renderTasks();toast('Misión iniciada.');}));
 $('#meeting-form').addEventListener('submit',e=>doForm(e,async()=>{await post('/api/meetings',{topic:val('meeting-topic'),agentIds:picks('meeting-agent-picks')});$('#meeting-topic').value='';await refresh();toast('Reunión iniciada.');}));
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
 $('#save-connection').onclick=e=>{e.preventDefault();const proposed=val('app-api-url').replace(/\/$/,'');if(proposed&&(!/^https:\/\/[^?#/]+$/i.test(proposed))){toast('Para Android usá una URL HTTPS del servidor.',true);return;}apiHost=proposed;accessToken=val('app-token');localStorage.setItem('nexo_api_url',apiHost);if(accessToken)sessionStorage.setItem('nexo_access_token',accessToken);else sessionStorage.removeItem('nexo_access_token');toast('Conexión guardada en este dispositivo.');connectEvents();void refresh(true);};
 $('#download-backup').onclick=async()=>{try{const h=accessToken?{Authorization:'Bearer '+accessToken}:{};const r=await fetch(apiHost+'/api/export',{headers:h});if(!r.ok)throw Error('Error descargando respaldo.');const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download='nexo-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}catch(e){toast(e.message,true);}};
 $('#wa-connect').onclick=async()=>{try{await post('/api/whatsapp/connect',{});toast('Iniciando WhatsApp opcional…');setTimeout(pollWA,1800);}catch(e){toast(e.message,true);}};
 $('#wa-form').addEventListener('submit',e=>doForm(e,async()=>{await post('/api/whatsapp/group',{groupId:val('wa-group'),agentId:val('wa-agent'),mode:val('wa-mode'),enabled:true,consent:$('#wa-consent').checked});await refresh();toast('Grupo autorizado.');}));
 $('#wa-disable').onclick=async()=>{try{await post('/api/whatsapp/group',{groupId:val('wa-group'),enabled:false});await refresh();toast('Grupo desactivado.');}catch(e){toast(e.message,true);}};
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
async function boot(){bind();$('#top-clock').textContent=new Date().toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'}).toUpperCase();const params=new URLSearchParams(location.search);if(params.has('oauth_error'))toast(params.get('oauth_error'),true);else if(params.has('connected'))toast('Cuenta Google conectada.');if(params.has('oauth_error')||params.has('connected'))history.replaceState({},'',location.pathname+'#integraciones');await refresh(true);goto(location.hash.slice(1) in titles?location.hash.slice(1):'inicio');connectEvents();setInterval(()=>{if(document.hidden)return;void refresh();if(current==='integraciones')void pollWA();if(current==='chats'&&!busy)void loadChat();},5000);}
boot();
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1'))navigator.serviceWorker.register('/sw.js').catch(()=>{});
