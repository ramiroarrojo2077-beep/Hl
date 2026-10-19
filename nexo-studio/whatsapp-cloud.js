'use strict';
// Official WhatsApp Cloud API. No WhatsApp Web scraping or personal-account hijacking.
const crypto=require('node:crypto');
const config=()=>({token:process.env.WA_ACCESS_TOKEN||'',phoneId:process.env.WA_PHONE_NUMBER_ID||'',verifyToken:process.env.WA_VERIFY_TOKEN||'',appSecret:process.env.WA_APP_SECRET||'',version:process.env.WA_API_VERSION||'v23.0'});
const cleanPhone=s=>String(s||'').replace(/[^0-9]/g,'');
function validatePhone(s) {const p=cleanPhone(s);if(!/^\d{8,16}$/.test(p))throw Error('Número internacional inválido: escribí código de país y número sin +.');return p;}
function equalText(a,b) {const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function validateWebhook(query) {const c=config();return !!c.verifyToken&&query.get('hub.mode')==='subscribe'&&equalText(query.get('hub.verify_token'),c.verifyToken);}
function verifySignature(raw,signature) {const c=config();if(!c.appSecret||!/^sha256=[a-f0-9]{64}$/i.test(String(signature||'')))return false;const expected='sha256='+crypto.createHmac('sha256',c.appSecret).update(raw).digest('hex');return equalText(expected,signature);}
async function sendText(to,body) {
 const c=config();if(!c.token||!c.phoneId||!c.appSecret||!c.verifyToken)throw Error('WhatsApp Cloud no configurado: revisá WA_* en el servidor.');
 const phone=validatePhone(to);const message=String(body||'').slice(0,3900);
 if(!message.trim())throw Error('Mensaje vacío');
 const abort=AbortSignal.timeout(15000);
 const url=`https://graph.facebook.com/${encodeURIComponent(c.version)}/${encodeURIComponent(c.phoneId)}/messages`;
 const res=await fetch(url,{method:'POST',signal:abort,headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:phone,type:'text',text:{preview_url:false,body:message}})});
 const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(`Meta rechazó el mensaje (HTTP ${res.status}): ${String(data?.error?.message||'sin detalles').slice(0,240)}`);
 return {id:data.messages?.[0]?.id||null,to:phone};
}
function status(){const c=config();const missing=['WA_ACCESS_TOKEN','WA_PHONE_NUMBER_ID','WA_VERIFY_TOKEN','WA_APP_SECRET'].filter((n,i)=>![c.token,c.phoneId,c.verifyToken,c.appSecret][i]);return {provider:'Meta WhatsApp Cloud API',configured:missing.length===0,missing,webhookPath:'/api/whatsapp/webhook',groups:'Requiere autorización específica de Meta para Groups API; este conector implementa chats individuales.'};}
function inboundMessages(payload) {
 if(payload?.object!=='whatsapp_business_account')return [];
 const result=[];
 for(const entry of (Array.isArray(payload.entry)?payload.entry:[]).slice(0,20))for(const change of (Array.isArray(entry.changes)?entry.changes:[]).slice(0,20)) {
 const value=change.value||{};if(change.field!=='messages'||value.metadata?.phone_number_id!==config().phoneId)continue;
 for(const msg of (Array.isArray(value.messages)?value.messages:[]).slice(0,40)){
 if(msg?.type!=='text'||!msg.text?.body||!msg.id||!msg.from)continue;
 // Only process 1:1 messages. Group delivery format and eligibility differ.
 if(msg.group_id||msg.context?.group_id||msg.recipient_type==='group')continue;
 result.push({id:String(msg.id).slice(0,200),from:cleanPhone(msg.from),body:String(msg.text.body).slice(0,2500),timestamp:Number(msg.timestamp||0)});
 }
 }
 return result;
}
module.exports={config,status,validateWebhook,verifySignature,sendText,inboundMessages,validatePhone,cleanPhone};
