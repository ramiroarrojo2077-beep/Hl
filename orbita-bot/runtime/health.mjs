export async function modelHealth({provider,model,key,endpoint,fetcher=fetch}){
  if(provider==='xai'&&!key)return {ready:false,status:'missing_key',message:'Configura XAI_API_KEY en el servidor para utilizar xAI.'};
  try{
    const url=provider==='ollama'?`${endpoint.replace(/\/$/,'')}/api/tags`:'https://api.x.ai/v1/models';
    const response=await fetcher(url,{signal:AbortSignal.timeout(5000),headers:provider==='xai'?{Authorization:`Bearer ${key}`}:{}});
    if(!response.ok)return {ready:false,status:'provider_error',message:`El proveedor respondió HTTP ${response.status}. Revisa el modelo y sus credenciales.`};
    const json=await response.json();
    const available=provider==='ollama'?json.models?.map(m=>m.name??m.model):json.data?.map(m=>m.id);
    const found=available?.includes(model)||available?.includes(`${model}:latest`);
    return found?{ready:true,status:'ready',message:'Proveedor disponible y modelo encontrado. La inferencia se comprueba al enviar una tarea.'}:{ready:false,status:'missing_model',message:provider==='ollama'?`El modelo ${model} no está instalado. En el servidor ejecuta: ollama pull ${model}`:`El modelo ${model} no está disponible para esta cuenta.`};
  }catch{return {ready:false,status:'offline',message:provider==='ollama'?'Ollama no está disponible. Abre Ollama en el equipo del servidor.':'No se pudo conectar con xAI. Revisa la red del servidor.'};}
}
