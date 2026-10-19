export function normalizeServerURL(value,{allowInsecureDevelopment=false}={}){
  if(!value.trim())return '';
  let url;try{url=new URL(value.trim());}catch{throw new Error('Introduce una URL completa, por ejemplo https://bots.tudominio.com.');}
  if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('Usa solo la dirección del servidor, sin rutas, credenciales ni parámetros.');
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&(loopback||allowInsecureDevelopment)))throw new Error('Usa HTTPS. HTTP solo está permitido en localhost o en el modo de desarrollo explícito.');
  return url.origin;
}
export class ApiClient{
  constructor({baseURL='',accessToken='',fetcher=fetch,timeout=12000}={}){this.baseURL=baseURL;this.accessToken=accessToken;this.fetcher=fetcher;this.timeout=timeout;this.csrf='';}
  async request(path,method='GET',data,retry=true){
    let response;
    try{response=await this.fetcher(`${this.baseURL}/api/${path}`,{method,cache:'no-store',signal:AbortSignal.timeout(this.timeout),headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(this.accessToken?{Authorization:`Bearer ${this.accessToken}`} : {}),...(this.csrf?{'X-Orbita-Token':this.csrf}: {})},...(data===undefined?{}:{body:JSON.stringify(data)})});}
    catch{const error=new Error('No se pudo conectar al motor. Comprueba la dirección, la red y que el servidor esté encendido.');error.status=0;throw error;}
    let result;try{result=await response.json();}catch{throw new Error('La dirección respondió sin una API válida. Comprueba que apunta al motor de Órbita.');}
    if(response.status===403&&method!=='GET'&&retry&&result.error?.includes('renovar')){await this.request('config');return this.request(path,method,data,false);}
    if(!response.ok){const error=new Error(result.error??`Error HTTP ${response.status}.`);error.status=response.status;throw error;}
    if(path==='config')this.csrf=result.csrf??'';
    return result;
  }
}
