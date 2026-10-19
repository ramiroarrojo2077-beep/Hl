import { createHash, timingSafeEqual } from 'node:crypto';

export function accessPolicy({ accessToken='', allowedHosts=[], appOrigins=[] }={}) {
  if(accessToken && accessToken.length<32)throw new Error('ORBITA_ACCESS_TOKEN debe tener al menos 32 caracteres.');
  const hosts=new Set(allowedHosts), origins=new Set(appOrigins);
  const digest=value=>createHash('sha256').update(value).digest();
  const expected=accessToken?digest(accessToken):null;
  return function authorize(req,res,path) {
    const host=req.headers.host??'',origin=req.headers.origin;
    if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)&&!hosts.has(host))return [403,'Servidor no autorizado. Configura ALLOWED_HOSTS con host y puerto.'];
    const sameOrigin=origin===`http://${host}`||origin===`https://${host}`;
    const allowedApp=Boolean(origin&&origins.has(origin));
    if(origin&&!sameOrigin&&!allowedApp)return [403,'Origen no permitido.'];
    if(req.headers['sec-fetch-site']==='cross-site'&&!allowedApp)return [403,'Origen no permitido.'];
    if(allowedApp){
      if(!accessToken)return [403,'La conexión desde una app requiere ORBITA_ACCESS_TOKEN.'];
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Orbita-Token');
      res.setHeader('Access-Control-Max-Age','600');
    }
    if(req.method==='OPTIONS')return allowedApp||sameOrigin?[204,null]:[403,'Origen no permitido.'];
    if(path.startsWith('/api/')&&accessToken){
      const bearer=req.headers.authorization??'';
      if(!bearer.startsWith('Bearer ')||!timingSafeEqual(digest(bearer.slice(7)),expected))return [401,'La clave de conexión falta o es incorrecta.'];
    }
    return null;
  };
}
