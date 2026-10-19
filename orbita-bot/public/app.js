import { ApiClient, normalizeServerURL } from './connection.js';
import { isNative, copyText, saveText, setupLifecycle } from './platform.js';
const $ = (s, root=document) => root.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const icons = {
 plus:'M12 5v14M5 12h14', search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 chat:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3l1.6-5A8.5 8.5 0 1 1 21 11.5Z',
 clock:'M12 8v5l3 2M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
 file:'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 13h8M8 17h6',
 skill:'m12 3 3 6 7 3-7 3-3 7-3-7-7-3 7-3 3-6Z',
 settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
 activity:'M2 12h4l3-8 6 16 3-8h4', arrow:'M12 19V5m-6 6 6-6 6 6',
 paperclip:'m9 15 7-7a3 3 0 0 1 4 4L10 22a5 5 0 0 1-7-7L14 4',
 more:'M5 12h.01M12 12h.01M19 12h.01', close:'m6 6 12 12M6 18 18 6',
 download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
 play:'m8 4 12 8-12 8V4Z', pause:'M8 4v16M16 4v16', menu:'M3 6h18M3 12h18M3 18h18',
 computer:'M2 3h20v14H2V3Zm6 18h8m-4-4v4', copy:'M8 8h13v13H8V8ZM4 16H2V2h14v2',
 shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 9 3 3 5-5',
 stop:'M6 6h12v12H6V6Z', edit:'m15 4 5 5M4 15 16 3l5 5L9 20H4v-5Z'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] ?? icons.chat}"/></svg>`;
const btn = (action, text, symbol, extra='') => `<button class="btn" data-action="${action}" ${extra}>${symbol ? icon(symbol) : ''}${text}</button>`;
const ib = (action,label,symbol,extra='') => `<button type="button" class="icon-btn" data-action="${action}" aria-label="${label}" title="${label}" ${extra}>${icon(symbol)}</button>`;
const avatar = (bot,large=false) => `<span class="avatar ${escape(bot.color)} ${large?'large':''}">${escape(bot.name.slice(0,1).toUpperCase())}</span>`;
const date = value => new Date(value).toLocaleString('es',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const names = {chat:'Conversación',routines:'Rutinas',files:'Archivos',skills:'Skills',activity:'Actividad',settings:'Ajustes',computer:'Ordenador'};
const statuses = {running:'En curso',pending:'Por aprobar',approved:'Aprobado',done:'Completado',error:'Error',cancelled:'Detenido',denied:'Rechazado',expired:'Caducado'};
let state={bots:[],jobs:[],files:[],routines:[],skills:[],calls:[]}, config={}, active=null, view='chat', messages=[], query='', mobile=false, signature='', refreshing=false;
const drafts = new Map();
const dialog = $('#dialog');
let toastTimer, pollTimer, client=new ApiClient(), connected=false, connectionIssue='', modelStatus=null, sending=false;
const storage={get(key,session=false){try{return (session?sessionStorage:localStorage).getItem(key)??'';}catch{return '';}},set(key,value,session=false){try{(session?sessionStorage:localStorage).setItem(key,value);}catch{}}};
let serverURL=storage.get('orbita-server'), accessKey=storage.get('orbita-access',true);

function toast(text) { $('#toast').textContent=text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500); }
async function api(path,method='GET',data){return client.request(path,method,data);}
function connectionScreen(error=''){
  connected=false;clearInterval(pollTimer);if(dialog.open)dialog.close();
  $('#app').innerHTML=`<main class="connection-screen"><section class="connection-card"><img src="./favicon.svg" alt="" width="52" height="52"><div class="eyebrow">ÓRBITA · TU EQUIPO DE AGENTES</div><h1>Conecta tu espacio</h1><p>La app se conecta al motor que ejecuta tus bots. Introduce la dirección de tu servidor.</p><form id="connect-form"><label class="field"><span>Dirección del servidor</span><input name="server" type="url" inputmode="url" autocomplete="url" placeholder="https://bots.tudominio.com" value="${escape(serverURL||(!isNative&&location.protocol.startsWith('http')?location.origin:''))}" required></label><label class="field"><span>Clave de conexión</span><input name="access" type="password" autocomplete="current-password" placeholder="ORBITA_ACCESS_TOKEN del servidor" value="${escape(accessKey)}"></label><label class="check"><input type="checkbox" name="development" ${storage.get('orbita-development')==='true'?'checked':''}> Permitir HTTP de desarrollo (solo red de confianza)</label><p class="form-error" role="alert">${escape(error)}</p><button type="submit" class="btn primary connect-submit">Conectar</button></form><details><summary>Cómo preparar el motor</summary><p>En tu PC o servidor inicia Órbita con <code>npm start</code>. Para Android configura el acceso remoto y usa una URL HTTPS. «localhost» en el teléfono apunta al propio teléfono.</p><p>La clave de conexión pertenece a Órbita; no es tu clave de xAI. Se conserva solo durante esta sesión.</p></details></section></main>`;
  $('#connect-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=$('button[type=submit]',form),data=new FormData(form);button.disabled=true;
    try{
      const nextURL=normalizeServerURL(String(data.get('server')),{allowInsecureDevelopment:data.has('development')});
      if(isNative&&!String(data.get('access')).trim())throw new Error('Introduce la clave de conexión del motor.');
      serverURL=nextURL;accessKey=String(data.get('access')).trim();
      const candidate=new ApiClient({baseURL:serverURL,accessToken:accessKey});
      const nextConfig=await candidate.request('config');
      client=candidate;config=nextConfig;state={bots:[],jobs:[],files:[],routines:[],skills:[],calls:[]};messages=[];active=null;drafts.clear();modelStatus=null;
      storage.set('orbita-server',serverURL);storage.set('orbita-access',accessKey,true);storage.set('orbita-development',String(data.has('development')));
      await finishConnect();
    }catch(error){$('.form-error',form).textContent=error.message;button.disabled=false;}
  };
}
async function checkModel(){
  const checkingClient=client;
  try{const health=await checkingClient.request('health');if(checkingClient!==client)return;modelStatus=health.model;}
  catch(error){if(checkingClient!==client)return;modelStatus={ready:false,message:error.message,status:'offline'};}
  if(connected)render();
}
function notices(){
  if(connectionIssue)return `<div class="connection-banner" role="status"><span>${escape(connectionIssue)}</span><button data-action="reconnect">Reintentar</button><button data-action="connection">Conexión</button></div>`;
  if(modelStatus&&!modelStatus.ready)return `<div class="connection-banner" role="status"><span>${escape(modelStatus.message)}</span><button data-action="check-model">Comprobar de nuevo</button></div>`;
  return '';
}
async function finishConnect(){
  connected=true;connectionIssue='';await refresh(true);clearInterval(pollTimer);
  pollTimer=setInterval(()=>{if(!dialog.open&&!document.hidden)void refresh();},2000);
  void checkModel();
}
async function boot(){
  if(isNative&&!serverURL){connectionScreen();return;}
  try{
    if(serverURL)serverURL=normalizeServerURL(serverURL,{allowInsecureDevelopment:storage.get('orbita-development')==='true'});
    client=new ApiClient({baseURL:serverURL,accessToken:accessKey});config=await api('config');await finishConnect();
  }catch(error){connectionScreen(error.message);}
}
function selected(){return state.bots.find(x=>x.id===active);}
function running(botId=active){return state.jobs.find(x=>x.bot_id===botId && x.status==='running');}
function markup(text) {
  return text.split(/```[^\n]*\n([\s\S]*?)```/g).map((part,index)=>index%2 ? `<pre><code>${escape(part)}</code></pre>` : part.split(/\n\n+/).map(p=>{
    const safe=escape(p).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`\n]+)`/g,'<code>$1</code>');
    return /^###? /.test(p)?`<h3>${safe.replace(/^###? /,'')}</h3>`:`<p>${safe}</p>`;
  }).join('')).join('');
}
function nav() {
  const count=state.calls.filter(c=>c.status==='pending').length;
  return `<aside class="sidebar ${mobile?'open':''}" aria-label="Navegación principal">
    <div class="brand"><img src="/favicon.svg" alt="">Órbita<span>PERSONAL</span><button class="icon-btn mobile-close" data-action="menu" aria-label="Cerrar menú">${icon('close')}</button></div>
    <button class="new" data-action="new-bot">${icon('plus')} Nuevo bot <small>⌘ N</small></button>
    <label class="search">${icon('search')}<input id="search" type="search" placeholder="Buscar bots…" aria-label="Buscar bots" value="${escape(query)}"></label>
    <div class="label">Tus bots <span>${state.bots.length}</span></div><div class="bots-list">${botList()}</div>
    <nav class="nav">${[['activity','activity'],['routines','clock'],['files','file'],['skills','skill'],['computer','computer'],['settings','settings']].map(([key,symbol])=>`<button class="nav-item ${view===key?'active':''}" data-action="view" data-view="${key}" ${view===key?'aria-current="page"':''}>${icon(symbol)}${names[key]}${key==='activity'&&count?`<b>${count}</b>`:''}</button>`).join('')}</nav>
    <div class="account"><span class="avatar">T</span><div><strong>Tu espacio personal</strong><small>Datos guardados en el motor</small></div></div>
  </aside>`;
}
function botList(){return state.bots.filter(b=>`${b.name} ${b.role}`.toLowerCase().includes(query.toLowerCase())).map(b=>`<button class="bot-item ${b.id===active&&view==='chat'?'active':''}" data-action="bot" data-id="${b.id}" ${b.id===active&&view==='chat'?'aria-current="page"':''}>${avatar(b)}<span class="bot-text"><strong>${escape(b.name)}</strong><small>${running(b.id)?'Trabajando…':escape(b.role)}</small></span>${running(b.id)?'<span class="dot working"></span>':''}</button>`).join('') || '<p class="no-results">No hay bots que mostrar.</p>';}
function render() {
  const focused=document.activeElement, focusId=focused?.id, position=focused?.selectionStart;
  const scroller=$('.messages'), previousScroll=scroller?.scrollTop, atBottom=scroller?scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop<100:true;
  const b=selected();
  $('#app').innerHTML=`<div class="shell">${mobile?'<button class="mobile-scrim" data-action="menu" aria-label="Cerrar navegación" tabindex="-1"></button>':''}${nav()}<section class="workspace"><header class="topbar"><div class="crumb">${ib('menu','Abrir menú','menu','class="menu-toggle"')}<span class="muted">Mi espacio</span><span class="muted divider">/</span><strong>${escape(view==='chat'?(b?.name??'Tus bots'):names[view])}</strong></div><div class="top-actions"><span class="badge"><span class="dot"></span>${config.local?'Motor local':'Motor conectado'}</span>${view==='chat'&&b?ib('export-chat','Exportar conversación','download')+ib('edit-bot','Editar bot','settings'):''}</div></header>${notices()}<main id="main" class="content">${view==='chat'?chat(b):page()}</main></section></div>`;
  $('.crumb .icon-btn')?.classList.add('menu-toggle');
  if(focusId && document.getElementById(focusId)) { const el=document.getElementById(focusId);el.focus({preventScroll:true});try{el.setSelectionRange(position,position);}catch{} }
  const next=$('.messages');if(next)next.scrollTop=atBottom?next.scrollHeight:(previousScroll??0);
}
function approvalCard(c) {
  return `<div class="approval"><strong>${icon('shield')} Revisa esta acción · ${escape(c.name)}</strong><p>El bot espera tu decisión. Caduca a las ${new Date(c.expires_at).toLocaleTimeString('es')}.</p><details open><summary>Operación y argumentos exactos</summary><pre>${escape(JSON.stringify(JSON.parse(c.arguments),null,2))}</pre></details><div class="actions"><button class="btn primary" data-action="approve" data-id="${c.id}">Permitir una vez</button><button class="btn" data-action="deny" data-id="${c.id}">Rechazar</button></div></div>`;
}
function chat(bot) {
  if(!bot)return `<div class="page"><div class="empty">${icon('chat')}<h1>Crea tu primer bot</h1><p>Dale un nombre, un rol y una tarea concreta.</p>${btn('new-bot','Crear bot','plus')}</div></div>`;
  const job=running(), pending=state.calls.filter(c=>c.bot_id===bot.id&&c.status==='pending'), latest=state.jobs.find(j=>j.bot_id===bot.id);
  const error=latest?.status==='error'?`<div class="error-card" role="alert">${escape(latest.error)}<button data-action="retry" data-id="${latest.id}">Volver a intentar esta tarea</button></div>`:'';
  const conversation=messages.length?messages.map(m=>`<article class="message ${m.role}">${m.role==='assistant'?`<div class="byline">${avatar(bot)}${escape(bot.name)}<small>${date(m.created_at)}</small></div>`:''}<div class="message-body">${m.role==='assistant'?markup(m.content):escape(m.content)}</div>${m.role==='assistant'?`<div class="message-tools"><button data-action="copy" data-id="${m.id}">${icon('copy')} Copiar</button></div>`:''}</article>`).join(''):
    `<div class="welcome">${avatar(bot,true)}<div class="eyebrow">${escape(bot.role.toUpperCase())}</div><h1>Dale una tarea a ${escape(bot.name)}</h1><p>Comparte el objetivo y el contexto.<br>Tu bot puede usar herramientas y volver a ti cuando necesite aprobación.</p><div class="suggestions"><button class="suggestion" data-action="suggest" data-prompt="Revisa los archivos compartidos y prepara un resumen de los puntos importantes. Guarda el resultado en resumen.md.">${icon('file')}Resume mis archivos</button><button class="suggestion" data-action="suggest" data-prompt="Ayúdame a convertir un objetivo en un plan de trabajo. Primero pregúntame por el objetivo, el plazo y los recursos.">${icon('skill')}Convierte una idea en un plan</button><button class="suggestion" data-action="suggest" data-prompt="Quiero definir un proceso repetible. Pregúntame qué tarea quiero automatizar y ayúdame a guardarla como skill.">${icon('clock')}Crea un proceso reutilizable</button></div></div>`;
  return `<div class="chat-layout"><section class="chat" aria-label="Conversación con ${escape(bot.name)}"><div class="messages" role="log" aria-label="Mensajes">${conversation}${error}${latest?.status==='cancelled'?'<p class="pending-line">Tarea detenida. Los cambios ya realizados se conservan.</p>':''}${pending.map(approvalCard).join('')}${job?`<p class="pending-line"><span class="dot working"></span>${pending.length?'Esperando tu aprobación…':'Trabajando en la tarea…'} <button class="btn" data-action="stop" data-id="${job.id}">${icon('stop')}Detener</button></p>`:''}</div><div class="composer-area"><form id="composer" class="composer"><label class="sr-only" for="prompt">Mensaje para ${escape(bot.name)}</label><textarea id="prompt" name="prompt" placeholder="¿Qué necesitas resolver?" maxlength="12000" rows="2" ${job||sending?'disabled':''}>${escape(drafts.get(active)??'')}</textarea><div class="composer-footer"><div class="composer-left">${ib('upload','Adjuntar archivo de texto','paperclip')}<small>${config.provider==='ollama'?'Modelo local':'xAI'} · ${escape(config.model)}</small></div><button class="send" type="submit" aria-label="Enviar tarea" ${job||sending?'disabled':''}>${icon('arrow')}</button></div></form><div class="footnote">Las respuestas provienen de tu modelo. Revisa las acciones antes de aprobarlas.</div></div></section><aside class="detail-panel"><div class="label">Perfil del bot</div>${avatar(bot)}<h3 class="profile-name">${escape(bot.name)}</h3><p>${escape(bot.role)}</p><hr><h3>Instrucciones</h3><p>${escape(bot.instructions||'Todavía no hay instrucciones.')}</p><div class="label">Memoria persistente</div><p>${escape(bot.memory||'Guarda preferencias para que el bot las recuerde entre tareas.')}</p>${btn('edit-bot','Editar contexto','edit')}<div class="label">Herramientas</div><div class="detail-row">${icon('file')}Archivos y skills<small>Disponibles</small></div><div class="detail-row">${icon('shield')}Acciones<small>Con aprobación</small></div><div class="detail-row">${icon('computer')}Ordenador${ib('computer','Ver ordenador','more')}</div><hr><p>Un bot conserva su rol y conversación. Los archivos y skills se comparten con todo tu equipo.</p></aside></div>`;
}
function heading(title,description,button=''){return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${button}</div>`;}
function empty(title,description,action,label,symbol){return `<div class="empty">${icon(symbol)}<h2>${title}</h2><p>${description}</p>${action?btn(action,label,'plus'):''}</div>`;}
function page() {
  let html='';
  if(view==='routines')html=heading('Rutinas','El trabajo recurrente, en manos de tus bots.',btn('new-routine','Nueva rutina','plus'))+`<div class="notice">Se ejecutan mientras el motor esté encendido, aunque cierres la APK. El horario se muestra en tu zona local (${escape(Intl.DateTimeFormat().resolvedOptions().timeZone)}). La frecuencia se calcula en intervalos de horas; puede variar la hora local con el cambio de horario estacional.</div>`+(state.routines.length?`<div class="grid">${state.routines.map(r=>`<article class="card"><div class="card-head"><h3>${escape(r.name)}</h3><span class="badge">${r.enabled?'Activa':'Pausada'}</span></div><p>${escape(r.prompt)}</p><small>${escape(state.bots.find(b=>b.id===r.bot_id)?.name)} · Cada ${r.interval_hours} h<br>Próxima: ${date(r.next_run)}</small><div class="actions">${btn('run-routine','Ejecutar','play',`data-id="${r.id}"`)}${btn('toggle-routine',r.enabled?'Pausar':'Activar',r.enabled?'pause':'play',`data-id="${r.id}"`)}${ib('delete-routine','Eliminar rutina','trash',`data-id="${r.id}"`)}</div></article>`).join('')}</div>`:empty('Un buen proceso merece repetirse','Asigna una tarea, elige un bot y define cuándo debe ejecutarse.','new-routine','Crear rutina','clock'));
  if(view==='files')html=heading('Archivos compartidos','Contexto y resultados disponibles para todos tus bots.',btn('upload','Añadir archivo','plus'))+(state.files.length?`<div class="list-table">${state.files.map(f=>`<div class="file-row"><span class="avatar">${icon('file')}</span><div class="grow"><strong>${escape(f.name)}</strong><small>${f.size.toLocaleString('es')} caracteres · ${escape(state.bots.find(b=>b.id===f.bot_id)?.name??'Bot eliminado')} · ${date(f.created_at)}</small></div>${ib('download-file','Descargar '+escape(f.name),'download',`data-id="${f.id}"`)}${ib('delete-file','Eliminar '+escape(f.name),'trash',`data-id="${f.id}"`)}</div>`).join('')}</div>`:empty('El contexto empieza aquí','Sube documentos TXT, Markdown, CSV o JSON para trabajar con ellos.','upload','Añadir archivo','file'));
  if(view==='skills')html=heading('Skills','Instrucciones reutilizables para todo tu equipo.',btn('new-skill','Nueva skill','plus'))+(state.skills.length?`<div class="grid">${state.skills.map(s=>`<article class="card"><div class="card-head"><h3>${icon('skill')} ${escape(s.name)}</h3>${ib('delete-skill','Eliminar skill','trash',`data-id="${s.id}"`)}</div><p>${escape(s.instructions)}</p><small>Disponible para todos los bots mediante sus herramientas de skills.</small></article>`).join('')}</div>`:empty('Enséñales cómo trabajas','Guarda los pasos, el formato del resultado y los límites de un proceso.','new-skill','Crear skill','skill'));
  if(view==='activity')html=heading('Actividad','Operaciones, aprobaciones y resultados reales de tus agentes.')+(state.calls.length?state.calls.map(c=>c.status==='pending'?approvalCard(c):`<article class="call"><div class="card-head"><strong>${escape(state.bots.find(b=>b.id===c.bot_id)?.name)} · ${escape(c.name)}</strong><span class="status ${c.status}">${statuses[c.status]}</span></div><small>${date(c.created_at)}</small><details><summary>Ver argumentos y resultado</summary><pre>${escape(JSON.stringify(JSON.parse(c.arguments),null,2))}</pre><pre>${escape(c.result??'Sin resultado.')}</pre></details></article>`).join(''):empty('Todavía no hay actividad','Cuando un bot utilice una herramienta, verás aquí su operación y resultado.',null,null,'activity'));
  if(view==='settings')html=heading('Tu espacio, tus reglas','Configuración del modelo y límites de ejecución.',btn('connection','Cambiar conexión','settings'))+`<div class="settings-grid"><article class="card"><h3>Modelo de inteligencia artificial</h3><p>Proveedor: <strong>${config.provider==='ollama'?'Ollama local':'xAI'}</strong><br>Modelo: <strong>${escape(config.model)}</strong></p><p>${escape(modelStatus?.message??'Comprobando el proveedor…')}</p><p>Configura el archivo privado <code>.env</code> y reinicia la aplicación.</p><pre>MODEL_PROVIDER=ollama\nOLLAMA_MODEL=qwen3:8b</pre><p>Para usar xAI, selecciona <code>MODEL_PROVIDER=xai</code> y configura <code>XAI_API_KEY</code>. El proveedor puede cobrar por uso.</p></article><article class="card"><h3>Datos y permisos</h3><p>Las conversaciones, la memoria y los archivos se guardan en el servidor al que te conectaste.</p><p>Crear archivos, cambiar memoria, delegar y usar el ordenador requiere tu aprobación. Cada permiso vale para una operación exacta y caduca tras 10 minutos.</p><p>Con xAI, el contenido de la tarea y el contexto necesario se envían al proveedor. Con Ollama, la inferencia se realiza en el servidor local que configures.</p></article><article class="card"><h3>Trabajo en segundo plano</h3><p>Puedes cerrar la APK: las tareas y rutinas siguen en el motor mientras esté encendido.</p><p>Apagar o suspender el equipo que ejecuta el motor detiene sus tareas. Un reinicio marca las tareas pendientes como interrumpidas, sin repetir efectos.</p></article><article class="card"><h3>Atajos</h3><p><span class="keyboard">Ctrl / ⌘ N</span> Crear bot<br><span class="keyboard">Ctrl / ⌘ K</span> Buscar bot<br><span class="keyboard">Enter</span> Enviar tarea<br><span class="keyboard">Shift Enter</span> Nueva línea</p></article></div>`;
  if(view==='computer')html=heading('Ordenador del bot','Navegador dedicado y terminal aislado.',btn('refresh-computer','Actualizar vista','computer'))+`<div class="settings-grid"><article class="card"><h3>Navegador</h3><p>Los bots pueden navegar, leer páginas, hacer clic y rellenar campos con tu aprobación. El perfil está separado de tu navegador personal.</p><p>Dominios permitidos: <strong>${escape(config.browserHosts?.join(', ')||'Ninguno configurado')}</strong></p><p>Requiere Playwright y Chromium. Configura <code>BROWSER_ALLOWED_HOSTS</code> en <code>.env</code>.</p></article><article class="card"><h3>Terminal Docker</h3><p>Los comandos se ejecutan en un contenedor sin red, con tiempo y memoria limitados. Los bots comparten un volumen de trabajo dedicado.</p><p>Requiere Docker y construir la imagen:</p><pre>npm run computer:build</pre><p>El volumen del terminal y los adjuntos de conversación son almacenes separados.</p></article></div><div id="computer-preview" class="notice">Selecciona un bot y actualiza la vista para consultar la última pantalla de su navegador.</div>`;
  return `<div class="page">${html}</div>`;
}
async function refresh(force=false){
  if(refreshing){if(force){await refreshing;return refresh(true);}return;}
  refreshing=(async()=>{
    try{
      const snapshot=client;const next=await snapshot.request('state');if(snapshot!==client||!connected)return;state=next;
      if(!state.bots.some(b=>b.id===active))active=state.bots[0]?.id??null;
      const current=active;const nextMessages=current?await snapshot.request(`bots/${current}/messages`):[];
      if(current!==active||snapshot!==client||!connected)return;messages=nextMessages;
      const wasOffline=Boolean(connectionIssue);connectionIssue='';
      const sig=JSON.stringify([state,messages,view,active]);
      if(force||wasOffline||sig!==signature){signature=sig;render();}
    }catch(error){
      connectionIssue=error.status===401?'La sesión necesita una nueva clave de conexión.':'Sin conexión al motor. Tu borrador se conserva.';
      if(force)throw error;
      if(connected)render();
    }
  })();
  try{await refreshing;}finally{refreshing=false;}
}
function field(name,label,value='',type='text',max=6000,required=true){return `<label class="field"><span>${label}</span>${type==='textarea'?`<textarea name="${name}" maxlength="${max}" ${required?'required':''}>${escape(value)}</textarea>`:`<input name="${name}" type="${type}" value="${escape(value)}" maxlength="${max}" ${required?'required':''}>`}</label>`;}
function botSelect(){return `<label class="field"><span>Bot responsable</span><select name="bot_id" required>${state.bots.map(b=>`<option value="${b.id}" ${b.id===active?'selected':''}>${escape(b.name)}</option>`).join('')}</select></label>`;}
function openForm(title,content,submit,label='Guardar') {
  $('#dialog-content').innerHTML=`<div class="dialog-head"><h2>${title}</h2>${ib('close-dialog','Cerrar','close')}</div><form id="modal-form">${content}<p class="form-error" role="alert"></p><div class="form-actions"><button class="btn" type="button" data-action="close-dialog">Cancelar</button><button class="btn primary" type="submit">${label}</button></div></form>`;
  $('#modal-form').onsubmit=async e=>{e.preventDefault();const button=$('button[type="submit"]',e.target);button.disabled=true;try{await submit(Object.fromEntries(new FormData(e.target)));dialog.close();await refresh(true);}catch(error){$('.form-error',e.target).textContent=error.message;}finally{button.disabled=false;}};
  dialog.showModal();
}
function botForm(edit=false) {
  const b=edit?selected():{}; if(!b)return;
  openForm(edit?'Editar bot':'Un nuevo compañero',field('name','Nombre',b.name??'','text',60)+field('role','Responsabilidad',b.role??'','text',160)+field('instructions','Cómo debe trabajar',b.instructions??'','textarea',6000,false)+field('memory','Preferencias que debe recordar',b.memory??'','textarea',6000,false)+`<label class="field"><span>Identidad</span><select name="color">${[['sage','Salvia'],['clay','Arcilla'],['lavender','Lavanda'],['blue','Azul']].map(([v,n])=>`<option value="${v}" ${b.color===v?'selected':''}>${n}</option>`).join('')}</select></label>`+(edit?`<button class="btn danger" type="button" data-action="delete-bot" data-id="${b.id}">Eliminar bot y conversaciones</button>`:''),async data=>{const result=await api(edit?`bots/${b.id}`:'bots',edit?'PATCH':'POST',data);if(!edit){active=result.id;view='chat';} });
}
function confirm(title,description,action) {openForm(title,`<p>${escape(description)}</p>`,action,'Confirmar');}
async function download(name,text){await saveText(name,text);}
async function submitPrompt(prompt){
  if(!active||!prompt.trim()||sending)return false;
  if(connectionIssue)throw new Error('Reconecta el motor antes de enviar. Tu borrador está guardado.');
  if(modelStatus&&!modelStatus.ready)throw new Error(modelStatus.message);
  sending=true;const botId=active;
  try{await api(`bots/${botId}/tasks`,'POST',{prompt});drafts.delete(botId);return true;}
  finally{sending=false;await refresh(true);}
}
document.addEventListener('submit',async e=>{
  if(e.target.id!=='composer')return;e.preventDefault();const prompt=$('#prompt').value;
  if(!prompt.trim()||sending)return;
  const button=$('.send');button.disabled=true;
  try{await submitPrompt(prompt);}catch(error){toast(error.message);}finally{if(button.isConnected)button.disabled=false;}
});
document.addEventListener('input',e=>{
  if(e.target.id==='prompt')drafts.set(active,e.target.value);
  if(e.target.id==='search'){query=e.target.value;$('.bots-list').innerHTML=botList();}
});
document.addEventListener('keydown',e=>{
  if(connected&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();mobile=true;render();$('#search')?.focus();}
  if(connected&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='n'&&!dialog.open){e.preventDefault();botForm();}
  if(e.target.id==='prompt'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!isNative&&matchMedia('(pointer:fine)').matches){e.preventDefault();$('#composer').requestSubmit();}
  if(e.key==='Escape'&&mobile){mobile=false;render();}
});
document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action,id=button.dataset.id;
  try {
    if(action==='connection'){connectionScreen();return;}
    if(action==='reconnect'){await boot();return;}
    if(action==='check-model'){button.disabled=true;await checkModel();return;}
    if(action==='menu'){mobile=!mobile;render();}
    if(action==='bot'){active=id;view='chat';mobile=false;messages=[];await refresh(true);}
    if(action==='view'){view=button.dataset.view;mobile=false;render();}
    if(action==='computer'){view='computer';render();}
    if(action==='new-bot')botForm();
    if(action==='edit-bot')botForm(true);
    if(action==='close-dialog')dialog.close();
    if(action==='suggest'){drafts.set(active,button.dataset.prompt);$('#prompt').value=button.dataset.prompt;$('#prompt').focus();}
    if(action==='delete-bot'){dialog.close();confirm('Eliminar bot','Se borrarán su perfil, mensajes y rutinas. Los archivos compartidos se conservan. Esta acción no se puede deshacer.',async()=>{await api(`bots/${id}`,'DELETE');active=null;});}
    if(action==='approve'||action==='deny'){button.disabled=true;await api(`approvals/${id}`,'POST',{allow:action==='approve'});await refresh(true);}
    if(action==='stop'){await api(`jobs/${id}/cancel`,'POST',{});await refresh(true);}
    if(action==='retry'){button.disabled=true;await submitPrompt(state.jobs.find(j=>j.id===id).prompt);}
    if(action==='copy'){await copyText(messages.find(m=>m.id===id).content);toast('Respuesta copiada.');}
    if(action==='export-chat'){await download(`${selected().name}-conversacion.md`,messages.map(m=>`## ${m.role==='user'?'Tú':selected().name}\n\n${m.content}\n`).join('\n'));}
    if(action==='new-routine'){
      if(!state.bots.length)return toast('Crea un bot antes de programar una rutina.');
      const t=new Date(Date.now()+3600000);const local=new Date(t.getTime()-t.getTimezoneOffset()*60000).toISOString().slice(0,16);
      openForm('Nueva rutina',field('name','Nombre','','text',80)+botSelect()+field('prompt','Tarea que debe ejecutar','','textarea',12000)+`<label class="field"><span>Frecuencia</span><select name="interval_hours"><option value="24">Cada 24 horas</option><option value="1">Cada hora</option><option value="168">Cada 7 días</option></select></label>`+field('next_run','Primera ejecución · hora local',local,'datetime-local')+`<p class="muted">Las ejecuciones usan tu modelo y pueden consumir recursos o saldo del proveedor.</p>`,data=>api('routines','POST',{...data,interval_hours:Number(data.interval_hours),next_run:new Date(data.next_run).getTime()}));
    }
    if(action==='toggle-routine'){const r=state.routines.find(x=>x.id===id);await api(`routines/${id}`,'PATCH',{enabled:!r.enabled});await refresh(true);}
    if(action==='run-routine'){await api(`routines/${id}/run`,'POST',{});active=state.routines.find(x=>x.id===id).bot_id;view='chat';await refresh(true);}
    if(action==='delete-routine')confirm('Eliminar rutina','La rutina dejará de ejecutarse. Los resultados anteriores se conservan.',()=>api(`routines/${id}`,'DELETE'));
    if(action==='new-skill')openForm('Nueva skill',field('name','Nombre del proceso','','text',80)+field('instructions','Pasos, resultado esperado y límites','','textarea',6000),data=>api('skills','POST',data));
    if(action==='delete-skill')confirm('Eliminar skill','Los bots dejarán de recibir estas instrucciones en sus nuevas tareas.',()=>api(`skills/${id}`,'DELETE'));
    if(action==='upload'){
      if(!state.bots.length)return toast('Crea un bot antes de añadir contexto.');
      openForm('Añadir contexto',botSelect()+`<label class="field"><span>Archivo TXT, MD, CSV o JSON · hasta 45 KB</span><input type="file" name="file" accept=".txt,.md,.csv,.json" required></label><p class="muted">Este archivo será accesible para todos los bots del espacio.</p>`,async data=>{if(data.file.size>45000)throw new Error('El archivo supera 45 KB.');await api('files','POST',{bot_id:data.bot_id,name:data.file.name,content:await data.file.text()});toast('Archivo guardado.');},'Añadir');
    }
    if(action==='download-file'){const f=await api(`files/${id}`);await download(f.name,f.content);}
    if(action==='delete-file')confirm('Eliminar archivo','El archivo dejará de estar disponible para todos los bots.',()=>api(`files/${id}`,'DELETE'));
    if(action==='refresh-computer'){
      button.disabled=true;const result=await api(`computer/${active??''}`);$('#computer-preview').innerHTML=result.screenshot?`<p>Última pantalla de ${escape(selected()?.name)}</p><img class="screenshot" alt="Captura del navegador del bot" src="data:image/png;base64,${result.screenshot}">`:'Este bot todavía no tiene una página abierta en su navegador.';button.disabled=false;
    }
  }catch(error){toast(error.message);button.disabled=false;}
});
setupLifecycle({onResume:()=>{if(connected){void refresh();void checkModel();}},onBack:()=>{if(dialog.open){dialog.close();return true;}if(mobile){mobile=false;render();return true;}if(connected&&view!=='chat'){view='chat';render();return true;}return false;}});
const resize=()=>document.documentElement.style.setProperty('--app-height',`${window.visualViewport?.height??window.innerHeight}px`);
window.visualViewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);resize();
window.addEventListener('online',()=>{if(connected)void refresh();});
await boot();
