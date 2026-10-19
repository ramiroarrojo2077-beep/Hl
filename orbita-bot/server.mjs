import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createProvider, ProviderError } from './runtime/provider.mjs';
import { createAgentRuntime } from './runtime/agent.mjs';
import { accessPolicy } from './runtime/access.mjs';
import { modelHealth } from './runtime/health.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const now = () => new Date().toISOString();
const colors = ['sage', 'clay', 'lavender', 'blue'];
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function string(value, label, max, optional = false) {
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max)
    throw new HttpError(400, `${label}: introduce ${optional ? 'hasta' : 'entre 1 y'} ${max} caracteres.`);
  return value.trim();
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Se requiere JSON.');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128_000) throw new HttpError(413, 'El contenido supera el límite de 128 KB.');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed;
  } catch { throw new HttpError(400, 'Se requiere un objeto JSON válido.'); }
}

export function createApp(options = {}) {
  const accessToken=options.accessToken??process.env.ORBITA_ACCESS_TOKEN??'';
  const list=value=>(value??'').split(',').map(x=>x.trim()).filter(Boolean);
  const authorize=accessPolicy({accessToken,allowedHosts:options.allowedHosts??list(process.env.ALLOWED_HOSTS),appOrigins:options.appOrigins??list(process.env.APP_ORIGINS??'https://localhost,capacitor://localhost')});
  const dataDir = options.dataDir ?? process.env.DATA_DIR ?? join(ROOT, 'data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'orbita.sqlite'));
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec(readFileSync(join(ROOT, 'replica/schema.sql'), 'utf8'));
  db.prepare("UPDATE jobs SET status='error', error='El servidor se reinició. Puedes volver a intentar la tarea.', finished_at=? WHERE status='running'").run(now());
  const key = options.apiKey ?? process.env.XAI_API_KEY ?? '';
  const providerName = options.providerName ?? process.env.MODEL_PROVIDER ?? (key ? 'xai' : 'ollama');
  const model = options.model ?? (providerName === 'ollama' ? process.env.OLLAMA_MODEL ?? 'qwen3:8b' : process.env.XAI_MODEL ?? 'grok-4.7');
  const endpoint = options.endpoint ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
  const demo = false;
  const fetcher = options.fetcher ?? fetch;
  const token = randomBytes(32).toString('hex');
  const running = new Map();
  const completions = new Set();
  let closing = false;
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const requireBot = id => { const bot = get('SELECT * FROM bots WHERE id=?', id); if (!bot) throw new HttpError(404, 'No se encontró el bot.'); return bot; };
  if (options.seed !== false && !get('SELECT id FROM bots LIMIT 1')) {
    for (const [name, role, instructions, color] of [
      ['Atlas', 'Investigación y análisis', 'Ordena la información proporcionada, separa hechos de hipótesis y señala las fuentes que faltan.', 'sage'],
      ['Lira', 'Escritura y comunicación', 'Ayuda a escribir textos claros y precisos en español. Entrega borradores listos para revisar.', 'clay'],
      ['Prisma', 'Ideas y planificación', 'Convierte objetivos en pasos concretos, identifica dependencias y propone un siguiente paso útil.', 'lavender']
    ]) run('INSERT INTO bots VALUES (?,?,?,?,?,?,?)', randomUUID(), name, role, instructions, '', color, now());
  }
  function state() {
    return { bots: all('SELECT * FROM bots ORDER BY created_at, name'),
      jobs: all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100'),
      routines: all('SELECT * FROM routines ORDER BY created_at DESC'),
      files: all('SELECT id,bot_id,name,length(content) AS size,created_at FROM files ORDER BY created_at DESC'),
      skills: all('SELECT * FROM skills ORDER BY created_at DESC'),
      calls: all('SELECT * FROM tool_calls ORDER BY rowid DESC LIMIT 150') };
  }
  const runtime = createAgentRuntime({ db, dataDir, startJob,
    provider: options.provider ?? createProvider({provider:providerName,model,key,endpoint,fetcher}),
    ...(options.computer ? {computer:options.computer} : {}),
    ...(options.approvalMs ? {approvalMs:options.approvalMs} : {})
  });
  async function execute(id, botId, prompt, controller, depth) {
    try {
      const answer = await runtime.execute(id,botId,controller.signal,depth);
      if (controller.signal.aborted || closing) return;
      db.exec('BEGIN');
      try {
        run('INSERT INTO messages VALUES (?,?,?,?,?,?)',randomUUID(),botId,'assistant',answer,now(),0);
        run("UPDATE jobs SET status='done',finished_at=? WHERE id=?",now(),id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (error) {
      if (!closing && !controller.signal.aborted) run("UPDATE jobs SET status='error',error=?,finished_at=? WHERE id=?",error instanceof ProviderError ? error.message : 'No se pudo completar la tarea. Revisa la actividad y vuelve a intentarlo.',now(),id);
    } finally { running.delete(id); }
  }
  function startJob(botId, prompt, routineId = null, depth = 0) {
    requireBot(botId);
    if (running.size >= 3) throw new HttpError(429, 'Hay tres tareas en curso. Espera a que termine una.');
    if (get("SELECT id FROM jobs WHERE bot_id=? AND status='running'", botId)) throw new HttpError(409, 'Este bot ya está trabajando.');
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      run('INSERT INTO messages VALUES (?,?,?,?,?,?)', randomUUID(), botId, 'user', prompt, now(), Number(demo));
      run('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)', id, botId, prompt, 'running', null, now(), null, Number(demo));
      if (routineId) run('UPDATE routines SET next_run=? + interval_hours*3600000 WHERE id=?', Date.now(), routineId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const controller = new AbortController();
    running.set(id, controller);
    const completion = execute(id, botId, prompt, controller, depth);
    completions.add(completion); completion.finally(()=>completions.delete(completion));
    return { id };
  }
  function tick() {
    if (closing) return;
    for (const routine of all('SELECT * FROM routines WHERE enabled=1 AND next_run<=? ORDER BY next_run', Date.now())) {
      try { startJob(routine.bot_id, routine.prompt, routine.id); } catch (error) { if (!(error instanceof HttpError)) throw error; }
    }
  }
  const timer = options.scheduler === false ? null : setInterval(tick, 10_000);
  timer?.unref();
  const assets = { '/': ['index.html','text/html; charset=utf-8'], '/index.html': ['index.html','text/html; charset=utf-8'], '/app.js': ['app.js','text/javascript; charset=utf-8'], '/connection.js': ['connection.js','text/javascript; charset=utf-8'], '/platform.js': ['platform.js','text/javascript; charset=utf-8'], '/styles.css': ['styles.css','text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg','image/svg+xml'], '/tray.png': ['tray.png','image/png'] };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https: http:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const host = req.headers.host ?? '';
      const url = new URL(req.url, `http://${host}`), path = url.pathname;
      const access=authorize(req,res,path);
      if(access?.[0]===204){res.writeHead(204);res.end();return;}
      if(access)throw new HttpError(...access);
      if (!path.startsWith('/api/')) {
        const asset = assets[path];
        if (!asset || !['GET','HEAD'].includes(req.method)) throw new HttpError(404, 'Página no encontrada.');
        res.writeHead(200, { 'Content-Type': asset[1] }); res.end(req.method === 'HEAD' ? undefined : readFileSync(join(ROOT,'public',asset[0]))); return;
      }
      if (req.method === 'GET' && path === '/api/config') return send(200, { provider:providerName, model, configured:providerName==='ollama' || Boolean(key), csrf:token, browserHosts:runtime.computer.allowedHosts ?? [], local:!accessToken, version:'0.2.0' });
      if (req.method === 'GET' && path === '/api/health') return send(200,{server:'ready',model:await modelHealth({provider:providerName,model,key,endpoint,fetcher})});
      if (!['GET','HEAD'].includes(req.method) && req.headers['x-orbita-token'] !== token) throw new HttpError(403, 'Recarga la página para renovar tu sesión local.');
      if (req.method === 'GET' && path === '/api/state') return send(200,state());
      const parts = path.split('/').filter(Boolean), resource = parts[1], id = parts[2], action = parts[3];
      if (resource === 'approvals' && id && req.method === 'POST') {
        const b = await body(req); if (typeof b.allow !== 'boolean') throw new HttpError(400,'Decisión no válida.');
        try { runtime.decide(id,b.allow); } catch (error) { throw new HttpError(409,error.message); }
        return send(200,{ok:true});
      }
      if (resource === 'computer' && req.method === 'GET') {
        return send(200,{screenshot:id ? await runtime.computer.screenshot(id) : null, browserHosts:runtime.computer.allowedHosts ?? []});
      }
      if (resource === 'skills') {
        if (req.method === 'POST' && !id) {
          if (get('SELECT COUNT(*) AS n FROM skills').n >= 100) throw new HttpError(400,'Límite de 100 skills.');
          const b=await body(req), name=string(b.name,'Nombre',80), instructions=string(b.instructions,'Instrucciones',6000);
          if(get('SELECT id FROM skills WHERE name=?',name)) throw new HttpError(409,'Ya existe una skill con ese nombre.');
          const skillId=randomUUID(); run('INSERT INTO skills VALUES (?,?,?,?)',skillId,name,instructions,now()); return send(201,{id:skillId});
        }
        if(req.method === 'DELETE' && id) { run('DELETE FROM skills WHERE id=?',id); return send(200,{ok:true}); }
      }

      if (resource === 'bots') {
        if (req.method === 'POST' && !id) {
          if (get('SELECT COUNT(*) AS n FROM bots').n >= 30) throw new HttpError(400, 'Puedes tener hasta 30 bots.');
          const b = await body(req), botId = randomUUID();
          run('INSERT INTO bots VALUES (?,?,?,?,?,?,?)', botId, string(b.name,'Nombre',60), string(b.role,'Rol',160), string(b.instructions ?? '', 'Instrucciones',6000,true), string(b.memory ?? '', 'Memoria',6000,true), colors.includes(b.color) ? b.color : 'sage', now());
          return send(201,{id:botId});
        }
        const bot = requireBot(id);
        if (req.method === 'GET' && action === 'messages') return send(200, all('SELECT * FROM messages WHERE bot_id=? ORDER BY rowid',id));
        if (req.method === 'PATCH' && !action) {
          const b = await body(req);
          run('UPDATE bots SET name=?,role=?,instructions=?,memory=?,color=? WHERE id=?',string(b.name ?? bot.name,'Nombre',60),string(b.role ?? bot.role,'Rol',160),string(b.instructions ?? bot.instructions,'Instrucciones',6000,true),string(b.memory ?? bot.memory,'Memoria',6000,true),colors.includes(b.color) ? b.color : bot.color,id);
          return send(200,{ok:true});
        }
        if (req.method === 'DELETE' && !action) {
          if (get("SELECT id FROM jobs WHERE bot_id=? AND status='running'",id)) throw new HttpError(409,'Detén la tarea antes de eliminar el bot.');
          run('DELETE FROM bots WHERE id=?',id); return send(200,{ok:true});
        }
        if (req.method === 'POST' && action === 'tasks') {
          const b = await body(req); return send(202,startJob(id,string(b.prompt,'Mensaje',12000)));
        }
      }
      if (resource === 'jobs' && id && action === 'cancel' && req.method === 'POST') {
        const job = get('SELECT * FROM jobs WHERE id=?',id);
        if (!job) throw new HttpError(404,'Tarea no encontrada.');
        running.get(id)?.abort();
        run("UPDATE jobs SET status='cancelled',finished_at=? WHERE id=? AND status='running'",now(),id);
        return send(200,{ok:true});
      }
      if (resource === 'routines') {
        if (req.method === 'POST' && !id) {
          if (get('SELECT COUNT(*) AS n FROM routines').n >= 50) throw new HttpError(400,'Límite de 50 rutinas.');
          const b = await body(req); requireBot(b.bot_id);
          if (![1,24,168].includes(b.interval_hours) || !Number.isSafeInteger(b.next_run) || b.next_run < Date.now()-60_000 || b.next_run > Date.now()+366*86400000) throw new HttpError(400,'Elige una frecuencia y una fecha futura dentro del próximo año.');
          const routineId = randomUUID();
          run('INSERT INTO routines VALUES (?,?,?,?,?,?,?,?)',routineId,b.bot_id,string(b.name,'Nombre',80),string(b.prompt,'Tarea',12000),b.interval_hours,b.next_run,1,now());
          return send(201,{id:routineId});
        }
        const routine = get('SELECT * FROM routines WHERE id=?',id);
        if (!routine) throw new HttpError(404,'Rutina no encontrada.');
        if (req.method === 'POST' && action === 'run') return send(202,startJob(routine.bot_id,routine.prompt));
        if (req.method === 'PATCH') { const b = await body(req); if (typeof b.enabled !== 'boolean') throw new HttpError(400,'Estado no válido.'); run('UPDATE routines SET enabled=? WHERE id=?',Number(b.enabled),id); return send(200,{ok:true}); }
        if (req.method === 'DELETE') { run('DELETE FROM routines WHERE id=?',id); return send(200,{ok:true}); }
      }
      if (resource === 'files') {
        if (req.method === 'POST' && !id) {
          const b = await body(req); requireBot(b.bot_id);
          const name = string(b.name,'Nombre del archivo',120), content = string(b.content,'Contenido',50000);
          if (!/\.(txt|md|csv|json)$/i.test(name) || /[\/\\\x00-\x1f]/.test(name) || content.includes('\0')) throw new HttpError(400,'Usa archivos de texto TXT, MD, CSV o JSON.');
          if (get('SELECT COUNT(*) AS n FROM files WHERE bot_id=?',b.bot_id).n >= 20 || get('SELECT COALESCE(SUM(length(content)),0) AS n FROM files WHERE bot_id=?',b.bot_id).n + content.length > 45000) throw new HttpError(400,'Límite de contexto: 20 archivos o 45.000 caracteres por bot.');
          const fileId = randomUUID(); run('INSERT INTO files VALUES (?,?,?,?,?)',fileId,b.bot_id,name,content,now()); return send(201,{id:fileId});
        }
        const file = get('SELECT * FROM files WHERE id=?',id);
        if (!file) throw new HttpError(404,'Archivo no encontrado.');
        if (req.method === 'GET') return send(200,file);
        if (req.method === 'DELETE') { run('DELETE FROM files WHERE id=?',id); return send(200,{ok:true}); }
      }
      throw new HttpError(404,'Ruta no encontrada.');
    } catch (error) { if (!res.headersSent) send(error instanceof HttpError ? error.status : 500, {error: error instanceof HttpError ? error.message : 'No se pudo completar la operación.'}); else res.end(); }
  });
  return { server, db, tick, startJob, runtime, state, token, async close() {
    closing = true; if (timer) clearInterval(timer);
    for (const [id, controller] of running) { controller.abort(); run("UPDATE jobs SET status='error',error='Servidor detenido. Vuelve a intentar la tarea.',finished_at=? WHERE id=? AND status='running'",now(),id); }
    await Promise.allSettled([...completions]);
    await runtime.close();
    await new Promise(resolve => server.close(resolve)); db.close();
  } };
}

export function validateListenConfig(env=process.env){
  const host=env.HOST??'127.0.0.1';
  const port=Number(env.PORT??3000);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT debe ser un número entre 0 y 65535.');
  if(!['127.0.0.1','localhost'].includes(host)&&(!(env.ORBITA_ACCESS_TOKEN?.length>=32)||!env.ALLOWED_HOSTS?.trim()))throw new Error('Para escuchar fuera del equipo configura ORBITA_ACCESS_TOKEN (32 caracteres o más) y ALLOWED_HOSTS.');
  return {host,port};
}
export async function startServer() {
  const {host,port}=validateListenConfig();
  const app = createApp();
  try{await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,host,resolve);});}
  catch(error){await app.close();throw error;}
  console.log(`Órbita ${'0.2.0'}: motor iniciado en ${host}:${app.server.address().port}`);
  console.log('Abre la interfaz en el equipo del servidor o conecta la APK desde su pantalla de conexión.');
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => app.close().then(() => process.exit(0)));
  return app;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  startServer().catch(error=>{console.error(`No se pudo iniciar Órbita: ${error.code??''} ${error.message}`);process.exitCode=1;});
}
