import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { Filesystem,Directory,Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
export const isNative=Capacitor.isNativePlatform();
export async function copyText(text){await Clipboard.write({string:text});}
export async function saveText(name,text){
  const safe=name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)||'archivo.txt';
  const path=`exports/${Date.now()}-${safe}`;
  const {uri}=await Filesystem.writeFile({path,data:text,directory:Directory.Cache,encoding:Encoding.UTF8,recursive:true});
  await Share.share({title:name,files:[uri],dialogTitle:'Guardar o compartir archivo'});
}
export function setupLifecycle({onResume,onBack}){
  App.addListener('appStateChange',({isActive})=>{if(isActive)onResume();});
  App.addListener('backButton',async()=>{if(!onBack())await App.minimizeApp();});
}
