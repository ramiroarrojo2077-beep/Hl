export const isNative=false;
export async function copyText(text){
  if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(text);
  const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)throw new Error('El sistema no permitió copiar el texto.');
}
export async function saveText(name,text){
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function setupLifecycle({onResume}){
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)onResume();});
}
