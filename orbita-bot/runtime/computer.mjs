import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const exec = promisify(execFile);

export class Computer {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.volume = `orbita-${createHash('sha256').update(dataDir).digest('hex').slice(0,16)}`;
    this.image = options.image ?? process.env.ORBITA_TERMINAL_IMAGE ?? 'orbita-computer:local';
    this.context = null; this.pages = new Map(); this.browserStarting = null;
    this.allowedHosts = (options.allowedHosts ?? process.env.BROWSER_ALLOWED_HOSTS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  }
  async terminal(command, signal) {
    const name = `orbita-task-${createHash('sha256').update(crypto.randomUUID()).digest('hex').slice(0,12)}`;
    const args = ['run','--rm','--pull=never','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','512m','--cpus','1','--tmpfs','/tmp:rw,nosuid,size=64m','--mount',`type=volume,src=${this.volume},dst=/workspace`,'--workdir','/workspace',this.image,'sh','-lc',command];
    try {
      const { stdout, stderr } = await exec('docker', args, { signal, timeout: 30_000, maxBuffer: 128_000 });
      return { stdout, stderr, exitCode: 0, storage: 'Volumen Docker compartido; separado de los adjuntos del chat.' };
    } catch (error) {
      await exec('docker',['rm','-f',name],{ timeout:5000 }).catch(() => {});
      if (signal.aborted) throw error;
      if (error.code === 'ENOENT' || /daemon|permission denied|No such image|unable to find image|pull access denied/i.test(error.stderr ?? '')) throw new Error('Terminal no disponible. Instala Docker y construye la imagen con npm run computer:build.');
      return { stdout: error.stdout ?? '', stderr: (error.stderr ?? 'La operación superó 30 segundos.').slice(0,8000), exitCode: typeof error.code === 'number' ? error.code : -1 };
    }
  }
  allowed(url) {
    try { const u = new URL(url); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password && this.allowedHosts.includes(u.hostname.toLowerCase()); } catch { return false; }
  }
  async browser(botId, action, signal) {
    if (!this.allowedHosts.length) throw new Error('Configura BROWSER_ALLOWED_HOSTS con los dominios que puede visitar el navegador.');
    if (!this.context) {
      this.browserStarting ??= (async () => {
        let chromium;
        try { ({ chromium } = await import('playwright')); } catch { throw new Error('Falta Playwright. Ejecuta npm install y npx playwright install chromium.'); }
        const context = await chromium.launchPersistentContext(join(this.dataDir,'browser-profile'), { headless: true, chromiumSandbox: true, acceptDownloads:false, serviceWorkers:'block', viewport:{width:1280,height:800} });
        await context.route('**/*', route => this.allowed(route.request().url()) ? route.continue() : route.abort('blockedbyclient'));
        await context.routeWebSocket(/.*/, socket => socket.close());
        context.on('page', p => p.on('popup', popup => popup.close()));
        return context;
      })().finally(() => { this.browserStarting = null; });
      this.context = await this.browserStarting;
    }
    let page = this.pages.get(botId);
    if (!page || page.isClosed()) { page = await this.context.newPage(); this.pages.set(botId,page); }
    const abort = () => { void page.close().catch(() => {}); };
    signal.addEventListener('abort',abort,{once:true});
    try {
      signal.throwIfAborted();
      if (action.action === 'navigate') {
        if (!this.allowed(action.url)) throw new Error('El dominio no está en BROWSER_ALLOWED_HOSTS.');
        await page.goto(action.url,{waitUntil:'domcontentloaded',timeout:20000});
      } else if (action.action === 'click') await page.locator(action.selector).first().click({timeout:10000});
      else if (action.action === 'fill') await page.locator(action.selector).first().fill(action.text,{timeout:10000});
      const text = await page.locator('body').innerText({timeout:10000});
      const elements = await page.locator('a,button,input,textarea,select').evaluateAll(nodes => nodes.slice(0,60).map(el => ({tag:el.tagName,text:el.innerText?.slice(0,100),id:el.id,name:el.getAttribute('name'),type:el.getAttribute('type')})));
      return { url:page.url(), title:await page.title(), text:text.slice(0,16000), elements };
    } finally { signal.removeEventListener('abort',abort); }
  }
  async screenshot(botId) {
    const page = this.pages.get(botId);
    if (!page || page.isClosed()) return null;
    return (await page.screenshot({type:'png'})).toString('base64');
  }
  async close() { await this.context?.close(); }
}
