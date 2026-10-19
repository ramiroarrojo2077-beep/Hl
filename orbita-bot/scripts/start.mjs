import { existsSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
if(Number(process.versions.node.split('.')[0])<24){console.error('Órbita necesita Node.js 24 o superior. Instala Node 24 LTS y vuelve a ejecutar npm start.');process.exit(1);}
if(existsSync(join(root,'.env')))process.loadEnvFile(join(root,'.env'));
try{
  const {startServer}=await import('../server.mjs');
  await startServer();
}catch(error){
  const messages={EADDRINUSE:'El puerto está ocupado. Cierra la instancia anterior o cambia PORT en .env.',EPERM:'El sistema bloqueó la apertura del puerto local. Revisa los permisos de ejecución o el sandbox.',EACCES:'No hay permiso para acceder al puerto o al directorio de datos.'};
  console.error(`No se pudo iniciar Órbita: ${messages[error.code]??error.message}`);
  process.exitCode=1;
}
