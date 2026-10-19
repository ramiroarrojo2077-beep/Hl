'use strict';
/* NEXO connectors. No credentials are sent to the browser or kept in state.json. */
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const dns=require('node:dns/promises');
const net=require('node:net');

const definitions=[
 {id:'gmail',name:'Gmail',icon:'✉',category:'Productividad',ability:'Leer los últimos correos y pedir un resumen a un agente.',kind:'google',mode:'lectura',help:'Habilitá Gmail API y configurá Google OAuth; solo se solicita gmail.readonly.'},
 {id:'calendar',name:'Google Calendar',icon:'▦',category:'Productividad',ability:'Consultar los próximos eventos del calendario principal.',kind:'google',mode:'lectura',help:'Se autoriza junto con Google usando calendar.events.readonly.'},
 {id:'drive',name:'Google Drive',icon:'△',category:'Productividad',ability:'Enumerar archivos recientes de Drive; no descarga documentos.',kind:'google',mode:'lectura',help:'Se autoriza junto con Google usando drive.metadata.readonly.'},
 {id:'github',name:'GitHub',icon:'⌘',category:'Desarrollo',ability:'Consultar los repositorios de tu cuenta y colaboraciones.',kind:'token',mode:'lectura',help:'Creá un token de acceso de alcance mínimo en GitHub (solo lectura).',fields:[{key:'token',label:'Token personal de lectura',secret:true}]},
 {id:'notion',name:'Notion',icon:'▤',category:'Productividad',ability:'Buscar títulos de páginas compartidas con una integración.',kind:'token',mode:'lectura',help:'Creá una integración de Notion, habilitá lectura y compartí las páginas que correspondan.',fields:[{key:'token',label:'Token de la integración',secret:true}]},
 {id:'discord',name:'Discord',icon:'◈',category:'Comunicación',ability:'Enviar mensajes a un canal mediante webhook, con confirmación humana.',kind:'outbound',mode:'envío manual',help:'Creá un webhook en un canal de tu servidor, con permiso de sus miembros.',fields:[{key:'url',label:'URL del webhook',secret:true}]},
 {id:'slack',name:'Slack',icon:'✣',category:'Comunicación',ability:'Enviar mensajes a un canal con webhook y confirmación.',kind:'outbound',mode:'envío manual',help:'Creá un Incoming Webhook de una app autorizada en Slack.',fields:[{key:'url',label:'URL del webhook',secret:true}]},
 {id:'telegram',name:'Telegram',icon:'➤',category:'Comunicación',ability:'Enviar a un chat de Telegram por un bot explícito.',kind:'outbound',mode:'envío manual',help:'Creá tu bot mediante el servicio oficial de bots. Agregalo al chat consentido y conseguí su ID.',fields:[{key:'token',label:'Token del bot',secret:true},{key:'chatId',label:'ID del chat'}]},
 {id:'rss',name:'RSS / blogs',icon:'◉',category:'Contenido',ability:'Leer títulos recientes de un feed HTTPS público.',kind:'public',mode:'lectura',help:'Copiá la URL HTTPS de un RSS público de confianza.',fields:[{key:'url',label:'URL HTTPS del feed'}]},
 {id:'bluesky',name:'Bluesky',icon:'☁',category:'Redes sociales',ability:'Leer publicaciones públicas de un perfil.',kind:'public',mode:'lectura pública',help:'Ingresá un usuario público, por ejemplo ejemplo.bsky.social.',fields:[{key:'handle',label:'Usuario público'}]},
 {id:'youtube',name:'YouTube',icon:'▶',category:'Redes sociales',ability:'Leer videos públicos recientes mediante un feed de canal.',kind:'public',mode:'lectura pública',help:'Pegá el ID del canal de YouTube, que empieza por UC.',fields:[{key:'channelId',label:'ID público del canal'}]},
 {id:'whatsapp',name:'WhatsApp',icon:'◌',category:'Comunicación',ability:'Módulo experimental de grupos; requiere instalación y consentimiento.',kind:'separate',mode:'experimental',help:'El conector opcional se configura abajo. Usa una biblioteca no oficial y puede dejar de funcionar.'},
 {id:'instagram',name:'Instagram',icon:'◎',category:'Redes sociales',ability:'Integración de cuentas profesionales mediante Meta Graph API.',kind:'planned',mode:'pendiente',help:'Requiere una cuenta profesional y permisos aprobados de Meta; todavía no se implementó.'},
 {id:'facebook',name:'Facebook',icon:'f',category:'Redes sociales',ability:'Integración de páginas con Graph API.',kind:'planned',mode:'pendiente',help:'Necesita Meta App Review y permisos según la cuenta; todavía no se implementó.'},
 {id:'x',name:'X',icon:'𝕏',category:'Redes sociales',ability:'Lectura/publicación según el nivel de API de X.',kind:'planned',mode:'pendiente',help:'API de X puede tener costos y restricciones. Todavía no se implementó.'},
 {id:'tiktok',name:'TikTok',icon:'♪',category:'Redes sociales',ability:'Integración futura sujeta a productos y permisos de TikTok.',kind:'planned',mode:'pendiente',help:'Los permisos y posibilidades dependen del tipo de cuenta. Todavía no se implementó.'},
];
const googleScopes=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.events.readonly','https://www.googleapis.com/auth/drive.metadata.readonly'];
const googleClientId=process.env.GOOGLE_CLIENT_ID||'';
const googleClientSecret=process.env.GOOGLE_CLIENT_SECRET||'';
let secrets={};let key;
let secretFile, keyFile;
const pending=new Map();
const max=(value,n=250)=>String(value??'').trim().slice(0,n);
function error(message,status=400){const e=new Error(message);e.status=status;return e;}
async function writePrivate(file,data){const tmp=file+'.tmp';await fs.writeFile(tmp,data,{mode:0o600});await fs.rename(tmp,file);}
async function init(dir){
 const dest=path.join(dir,'.secrets');await fs.mkdir(dest,{recursive:true,mode:0o700});
 secretFile=path.join(dest,'connectors.enc');keyFile=path.join(dest,'key');
 try{key=Buffer.from(await fs.readFile(keyFile));if(key.length!==32)throw Error('clave dañada');}
 catch(e){if(e.code!=='ENOENT')throw e;key=crypto.randomBytes(32);await writePrivate(keyFile,key);}
 try{const envelope=JSON.parse(await fs.readFile(secretFile,'utf8'));const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));secrets=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.payload,'base64')),decipher.final()]).toString('utf8'));}
 catch(e){if(e.code!=='ENOENT')throw new Error('No se puede desencriptar la caja de credenciales: '+e.message);secrets={};}
}
async function persist(){const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const payload=Buffer.concat([cipher.update(JSON.stringify(secrets),'utf8'),cipher.final()]);await writePrivate(secretFile,JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),payload:payload.toString('base64')}));}
const connected=id=>id==='gmail'||id==='calendar'||id==='drive'?!!secrets.google?.refresh_token:!!secrets[id];
function catalog(){return definitions.map(x=>({...x,connected:connected(x.id),available:x.kind==='google'?!!(googleClientId&&googleClientSecret):!['planned'].includes(x.kind)}));}
const definition=id=>definitions.find(x=>x.id===id);
function validate(id,b){
 const d=definition(id);if(!d)throw error('Conector desconocido',404);
 if(!['token','outbound','public'].includes(d.kind))throw error('Este conector utiliza otro procedimiento.');
 const cfg={};for(const f of d.fields||[]){const v=max(b[f.key],2048);if(!v)throw error('Falta '+f.label+'.');cfg[f.key]=v;}
 if(id==='discord'){let u;try{u=new URL(cfg.url);}catch{throw error('URL de Discord inválida.');}if(u.hostname!=='discord.com'&&u.hostname!=='discordapp.com'||!u.pathname.startsWith('/api/webhooks/')||u.protocol!=='https:')throw error('Webhook de Discord inválido.');}
 if(id==='slack'){let u;try{u=new URL(cfg.url);}catch{throw error('URL de Slack inválida.');}if(u.hostname!=='hooks.slack.com'||!u.pathname.startsWith('/services/')||u.protocol!=='https:')throw error('Webhook de Slack inválido.');}
 if(id==='telegram'){if(!/^\d{5,16}:[\w-]{25,}$/.test(cfg.token)|| !/^-?\d{3,20}$/.test(cfg.chatId))throw error('Token o ID de Telegram inválido.');}
 if(id==='rss'){let u;try{u=new URL(cfg.url);}catch{throw error('URL RSS inválida.');}if(u.protocol!=='https:'||u.username||u.password)throw error('RSS requiere HTTPS público.');}
 if(id==='github'&&!/^[a-zA-Z0-9_-]{15,256}$/.test(cfg.token))throw error('Token de GitHub inválido.');
 if(id==='notion'&&!/^[a-zA-Z0-9_-]{15,256}$/.test(cfg.token))throw error('Token de Notion inválido.');
 if(id==='bluesky'&&!/^[a-z0-9.-]{3,180}$/i.test(cfg.handle))throw error('Usuario Bluesky inválido.');
 if(id==='youtube'&&!/^UC[\w-]{22}$/.test(cfg.channelId))throw error('ID de canal de YouTube inválido.');
 return cfg;
}
async function configure(id,b){const cfg=validate(id,b);secrets[id]=cfg;await persist();return {ok:true,id};}
async function disconnect(id){if(['gmail','calendar','drive'].includes(id))delete secrets.google;else delete secrets[id];await persist();return {ok:true};}
function oauthRedirect(){return `http://127.0.0.1:${process.env.PORT||3377}/api/connectors/google/callback`;}
function startGoogle(){
 if(!googleClientId||!googleClientSecret)throw error('Configurá GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor.');
 const state=crypto.randomBytes(24).toString('hex');pending.set(state,Date.now());
 const p=new URLSearchParams({client_id:googleClientId,redirect_uri:oauthRedirect(),response_type:'code',scope:googleScopes.join(' '),access_type:'offline',prompt:'consent',state});
 return 'https://accounts.google.com/o/oauth2/v2/auth?'+p;
}
async function finishGoogle(code,state){
 const ts=pending.get(state);pending.delete(state);if(!ts||Date.now()-ts>10*60*1000||!code)throw error('Autorización caducada o no solicitada.',403);
 const body=new URLSearchParams({client_id:googleClientId,client_secret:googleClientSecret,code,grant_type:'authorization_code',redirect_uri:oauthRedirect()});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw error('Google rechazó la autorización ('+r.status+').',502);
 const j=await r.json();if(!j.refresh_token&&!secrets.google?.refresh_token)throw error('Google no proporcionó permiso offline. Reintentá concediendo acceso.',400);
 secrets.google={refresh_token:j.refresh_token||secrets.google.refresh_token,access_token:j.access_token,expires:Date.now()+(j.expires_in||3600)*1000};await persist();
}
async function googleAccess(){let g=secrets.google;if(!g?.refresh_token)throw error('Primero conectá Google.',409);
 if(g.access_token&&g.expires>Date.now()+90000)return g.access_token;
 const body=new URLSearchParams({client_id:googleClientId,client_secret:googleClientSecret,refresh_token:g.refresh_token,grant_type:'refresh_token'});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw error('Google requiere reconectar tu cuenta.',502);
 const j=await r.json();g.access_token=j.access_token;g.expires=Date.now()+(j.expires_in||3600)*1000;await persist();return j.access_token;
}
async function getJson(url,headers={}){const r=await fetch(url,{headers:{'User-Agent':'NEXO-Studio/2.1',...headers},signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw error('El servicio respondió HTTP '+r.status,502);return r.json();}
function isPublicIp(ip){if(net.isIP(ip)===4){const p=ip.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===192&&p[1]===0||p[0]===198&&[18,19].includes(p[1]));}
 if(net.isIP(ip)===6){const n=ip.toLowerCase();return !(n==='::1'||n==='::'||n.startsWith('fc')||n.startsWith('fd')||n.startsWith('fe8')||n.startsWith('fe9')||n.startsWith('fea')||n.startsWith('feb')||n.startsWith('::ffff:'));}return false;}
async function validatePublicHost(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw error('Solo se permite HTTPS público.');const addresses=await dns.lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!isPublicIp(a.address)))throw error('Dirección de red privada bloqueada.');return u;}
function scrubXml(s){return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]+>/g,'').replace(/&(?:amp|lt|gt|quot|apos);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[x])).trim().slice(0,300);}
function feedTitles(xml){const entries=[...xml.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)].slice(0,10);return entries.map((match,i)=>({title:scrubXml(match[1].match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]||'Entrada '+(i+1)),date:scrubXml(match[1].match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/i)?.[1]||'')}));}
async function read(id){if(!definition(id))throw error('Conector desconocido',404);
 if(!connected(id))throw error('Primero configurá el conector.',409);
 const cfg=secrets[id];
 if(id==='gmail'){
  const h={Authorization:'Bearer '+await googleAccess()};const result=await getJson('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8&q=in%3Ainbox',h);
  const rows=await Promise.all((result.messages||[]).map(async m=>{const detail=await getJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(m.id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date',h);const find=n=>detail.payload?.headers?.find(x=>x.name.toLowerCase()===n)?.value||'';return {id:m.id,from:find('from'),subject:find('subject'),date:find('date'),snippet:max(detail.snippet,350)};}));return {items:rows};
 }
 if(id==='calendar'){const begin=new Date().toISOString();const j=await getJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=12&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(begin)}`,{Authorization:'Bearer '+await googleAccess()});return {items:(j.items||[]).map(x=>({title:x.summary||'Sin título',start:x.start?.dateTime||x.start?.date||'',location:max(x.location,120)}))};}
 if(id==='drive'){const j=await getJson('https://www.googleapis.com/drive/v3/files?page_size=15&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime),nextPageToken',{Authorization:'Bearer '+await googleAccess()});return {items:(j.files||[]).map(x=>({name:x.name,type:x.mimeType,modified:x.modifiedTime}))};}
 if(id==='github'){const h={Authorization:'Bearer '+cfg.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};const j=await getJson('https://api.github.com/user/repos?per_page=12&sort=pushed&affiliation=owner,collaborator',h);return {items:j.map(x=>({name:x.full_name,description:max(x.description,230),visibility:x.private?'privado':'público',updated:x.pushed_at}))};}
 if(id==='notion'){const r=await fetch('https://api.notion.com/v1/search',{method:'POST',headers:{Authorization:'Bearer '+cfg.token,'Notion-Version':'2022-06-28','Content-Type':'application/json'},body:JSON.stringify({page_size:15}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw error('Notion respondió HTTP '+r.status,502);const j=await r.json();return {items:(j.results||[]).map(x=>({name:(x.properties?.title?.title||x.title||[]).map(t=>t.plain_text).join('')||x.id,type:x.object,updated:x.last_edited_time}))};}
 if(id==='rss'){await validatePublicHost(cfg.url);const r=await fetch(cfg.url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/rss+xml, application/atom+xml, application/xml'}});if(!r.ok)throw error('RSS respondió HTTP '+r.status,502);const length=Number(r.headers.get('content-length')||0);if(length>1e6)throw error('Feed demasiado grande.',413);const xml=(await r.text()).slice(0,1e6);return {items:feedTitles(xml)};}
 if(id==='bluesky'){const j=await getJson('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor='+encodeURIComponent(cfg.handle)+'&limit=12');return {items:(j.feed||[]).map(x=>({text:max(x.post?.record?.text,400),date:x.post?.record?.createdAt||'',likes:x.post?.likeCount||0}))};}
 if(id==='youtube'){const url='https://www.youtube.com/feeds/videos.xml?channel_id='+encodeURIComponent(cfg.channelId);const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok)throw error('YouTube respondió HTTP '+r.status,502);return {items:feedTitles((await r.text()).slice(0,1e6))};}
 throw error('Este conector no ofrece consulta de datos.',409);
}
async function sendMessage(id,message){const cfg=secrets[id],content=max(message,1900);if(!cfg)throw error('Conector sin configurar.',409);if(!['discord','slack','telegram'].includes(id))throw error('Este conector no permite envíos.',400);if(!content)throw error('Escribí un mensaje.');
 let url,body;
 if(id==='discord'){url=cfg.url;body={content:'[NEXO · asistente IA] '+content};}
 if(id==='slack'){url=cfg.url;body={text:'[NEXO · asistente IA] '+content};}
 if(id==='telegram'){url='https://api.telegram.org/bot'+cfg.token+'/sendMessage';body={chat_id:cfg.chatId,text:'[NEXO · asistente IA]\n'+content};}
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(14000)});
 if(!r.ok)throw error('No se pudo enviar: HTTP '+r.status,502);return {ok:true};
}
module.exports={init,catalog,configure,disconnect,read,sendMessage,startGoogle,finishGoogle,definition,feedTitles,isPublicIp};
