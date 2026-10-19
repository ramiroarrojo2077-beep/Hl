import { existsSync } from 'node:fs';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
function run(script,args=[]){const r=spawnSync(process.execPath,[script,...args],{cwd:here,stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
run(join(here,'build.mjs'));
const cli=join(here,'node_modules/@capacitor/cli/bin/capacitor');
if(!existsSync(join(here,'android')))run(cli,['add','android']);
run(cli,['sync','android']);
const manifestPath=join(here,'android/app/src/main/AndroidManifest.xml');
let manifest=await readFile(manifestPath,'utf8');
if(!manifest.includes('android:usesCleartextTraffic'))manifest=manifest.replace('<application','<application android:usesCleartextTraffic="false"');
manifest=manifest.replace(/android:allowBackup="true"/,'android:allowBackup="false"');
await writeFile(manifestPath,manifest);
const debug=join(here,'android/app/src/debug');await mkdir(debug,{recursive:true});
await writeFile(join(debug,'AndroidManifest.xml'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools"><application android:usesCleartextTraffic="true" tools:replace="android:usesCleartextTraffic" /></manifest>\n');
console.log('Proyecto Android preparado. Release exige HTTPS; solo debug permite HTTP de desarrollo.');
