// Transporte de QA en memoria. No abre sockets ni contacta proveedores.
import { createApp } from '../server.mjs';
import { Readable } from 'node:stream';
import readline from 'node:readline';
let app;
const provider=async messages=>{
  const last=messages.at(-1);
  if(last.role==='tool')return {text:'El archivo se ha creado y está disponible en Archivos.',calls:[],continuation:[],toolResult:()=>null};
  const prompt=last.content;
  if(prompt.includes('crear archivo'))return {text:'',calls:[{id:'qa-call',name:'write_file',args:{name:'resultado.md',content:'# Resultado\nArchivo creado por la herramienta real durante QA.'}}],continuation:[{role:'assistant',content:''}],toolResult:(_,r)=>({role:'tool',content:JSON.stringify(r)})};
  return {text:`Respuesta del proveedor de QA a: ${prompt}`,calls:[],continuation:[],toolResult:()=>null};
};
app=createApp({dataDir:process.argv[2],scheduler:false,provider,fetcher:async()=>({ok:true,json:async()=>({models:[{name:'qwen3:8b'}]})})});
const lines=readline.createInterface({input:process.stdin});
for await(const line of lines){
  const input=JSON.parse(line);
  if(input.close){await app.close();process.exit(0);}
  const req=Readable.from(input.body?[Buffer.from(input.body)]:[]);req.method=input.method;req.url=input.path;req.headers={host:'localhost:3000',...input.headers};
  const headers={};
  await new Promise(resolve=>{
    const res={headersSent:false,setHeader(k,v){headers[k]=v;},writeHead(status,extra){this.status=status;Object.assign(headers,extra);this.headersSent=true;},end(content){const bytes=Buffer.isBuffer(content)?content:Buffer.from(content??'');process.stdout.write(JSON.stringify({status:this.status,headers,body:bytes.toString('base64')})+'\n');resolve();}};
    app.server.emit('request',req,res);
  });
}
await app.close();
