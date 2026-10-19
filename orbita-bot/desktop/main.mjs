import { app, BrowserWindow, Menu, Tray, nativeImage, Notification } from 'electron';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const path of [join(root,'.env'),join(app.getPath('userData'),'.env')]) if (existsSync(path)) process.loadEnvFile(path);
let window, service, tray, quitting = false, activityTimer;
const notified = new Set();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=> { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    service = createApp({dataDir:join(app.getPath('userData'),'data')});
    await new Promise(resolve => service.server.listen(0,'127.0.0.1',resolve));
    const url = `http://127.0.0.1:${service.server.address().port}`;
    window = new BrowserWindow({width:1360,height:900,minWidth:850,minHeight:650,title:'Órbita',backgroundColor:'#101214',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',(event,target)=>{ if (!target.startsWith(`${url}/`) && target!==url) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    const menu = Menu.buildFromTemplate([{label:'Órbita',submenu:[{label:'Mostrar Órbita',click:()=>window.show()},{label:'Salir y detener tareas',click:()=>app.quit()}]},{label:'Editar',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'Vista',submenu:[{role:'reload'},{role:'togglefullscreen'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]}]);
    Menu.setApplicationMenu(menu);
    try {
      tray = new Tray(nativeImage.createFromPath(join(root,'public','tray.png')));
      tray.setToolTip('Órbita · agentes activos'); tray.setContextMenu(menu); tray.on('click',()=>window.show());
    } catch { tray = null; }
    window.on('close',event=> { if (!quitting && tray) {event.preventDefault();window.hide();} });
    window.on('closed',()=>{window=null;if(!tray)app.quit();});
    await window.loadURL(url);
    activityTimer = setInterval(()=>{
      const entries = service.db.prepare("SELECT id,name FROM tool_calls WHERE status='pending'").all();
      for (const entry of entries) if (!notified.has(entry.id)) {
        notified.add(entry.id);
        if(Notification.isSupported()) { const note=new Notification({title:'Órbita necesita tu aprobación',body:`Revisa la operación ${entry.name}.`}); note.on('click',()=>window?.show());note.show(); }
      }
    },2000);
  }).catch(error=> { console.error('No se pudo iniciar Órbita:',error.message); app.quit(); });
  app.on('activate',()=>window?.show());
  app.on('before-quit',event=> {
    if (quitting) return;
    event.preventDefault(); quitting=true; clearInterval(activityTimer);
    Promise.resolve(service?.close()).finally(()=>app.quit());
  });
}
