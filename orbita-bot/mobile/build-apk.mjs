import { spawnSync } from 'node:child_process';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const here=dirname(fileURLToPath(import.meta.url));
const prepare=spawnSync(process.execPath,[join(here,'prepare-android.mjs')],{cwd:here,stdio:'inherit'});if(prepare.status!==0)process.exit(prepare.status??1);
const windows=process.platform==='win32';
const result=windows?spawnSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c','gradlew.bat assembleDebug'],{cwd:join(here,'android'),stdio:'inherit'}):spawnSync('./gradlew',['assembleDebug'],{cwd:join(here,'android'),stdio:'inherit'});
if(result.status!==0){console.error('No se pudo construir el APK. Abre mobile/android en Android Studio y comprueba el SDK/JDK.');process.exit(result.status??1);}
const apk=join(here,'android/app/build/outputs/apk/debug/app-debug.apk');
if(!existsSync(apk))throw new Error('Gradle terminó sin producir el APK esperado.');
console.log(`APK debug generado: ${apk}`);
