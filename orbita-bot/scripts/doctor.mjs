import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const exec=promisify(execFile), require=createRequire(import.meta.url);
let warnings=0;
function report(name,ok,detail){console.log(`${ok?'OK':'PENDIENTE'} · ${name}: ${detail}`);if(!ok)warnings++;}
report('Node',Number(process.versions.node.split('.')[0])>=24,process.versions.node);
for(const dependency of ['electron','playwright']){
  try{createRequire(new URL(dependency==='electron'?'../desktop/package.json':'../runtime/package.json',import.meta.url)).resolve(dependency);report(dependency,true,'paquete instalado; arranque no comprobado');}
  catch{report(dependency,false,dependency==='electron'?'ejecuta npm run desktop:install':'ejecuta npm run browser:install');}
}
const provider=process.env.MODEL_PROVIDER??(process.env.XAI_API_KEY?'xai':'ollama');
if(provider==='ollama'){
  const model=process.env.OLLAMA_MODEL??'qwen3:8b';
  try{const result=await fetch(`${(process.env.OLLAMA_URL??'http://127.0.0.1:11434').replace(/\/$/,'')}/api/tags`,{signal:AbortSignal.timeout(5000)});if(!result.ok)throw new Error('http');const data=await result.json();const found=data.models?.some(m=>m.name===model||m.model===model);report('Ollama',Boolean(found),found?`modelo ${model} instalado; inferencia no comprobada`:`descarga ${model} con ollama pull`);}
  catch{report('Ollama',false,'no se pudo acceder al servidor local; comprueba que está iniciado');}
}else report('xAI',Boolean(process.env.XAI_API_KEY),'presencia de clave comprobada sin imprimirla; autorización e inferencia no verificadas');
try{await exec('docker',['image','inspect',process.env.ORBITA_TERMINAL_IMAGE??'orbita-computer:local'],{timeout:5000});report('Terminal Docker',true,'imagen disponible; ejecución no comprobada');}
catch{report('Terminal Docker',false,'instala/inicia Docker y ejecuta npm run computer:build');}
report('Dominios del navegador',Boolean(process.env.BROWSER_ALLOWED_HOSTS?.trim()),process.env.BROWSER_ALLOWED_HOSTS?.trim()?'allowlist configurada':'edita BROWSER_ALLOWED_HOSTS; el navegador está bloqueado por defecto');
console.log(`\n${warnings} comprobaciones pendientes. No se han realizado llamadas de inferencia ni acciones de bots.`);
