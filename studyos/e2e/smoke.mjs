// Pruebas funcionales de StudyOS en Chromium (Playwright).
// Uso: npm run build && npm run test:e2e
// Levanta la app compilada (vite preview) y un servidor de IA simulado
// (e2e/mock-ai.mjs) para recorrer los flujos completos sin una clave real.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(join(process.env.NODE_PATH ?? '', 'playwright')));
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'http://127.0.0.1:4174/';
const MOCK = 'http://127.0.0.1:8787/v1';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const results = [];
const procs = [];
let currentPage = null;

function start(cmd, args, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    const onData = (d) => d.toString().includes(ready) && resolve(p);
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('exit', (c) => reject(new Error(`${cmd} terminó (${c})`)));
    setTimeout(() => resolve(p), 8000);
  });
}

async function test(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, note });
    console.log(`✔ ${name}${note ? ` — ${note}` : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, note: e.message });
    console.log(`✘ ${name}: ${e.message.split('\n')[0]}`);
    if (process.env.E2E_SHOTS && currentPage) await currentPage.screenshot({ path: join(process.env.E2E_SHOTS, `${results.length}.png`) }).catch(() => {});
  }
}

function assert(c, msg) {
  if (!c) throw new Error(msg);
}

async function onboard(page, name = 'Alex') {
  await page.goto(APP);
  await page.getByText('Bienvenido a StudyOS AI').waitFor({ timeout: 30000 });
  await page.getByPlaceholder('Tu nombre').fill(name);
  await page.getByRole('button', { name: 'Empezar sin IA' }).click();
  await page.getByText(`¡Hola, ${name}!`).waitFor();
}

async function go(page, hash) {
  await page.goto(`${APP}#${hash}`);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function main() {
  await start('node', ['e2e/mock-ai.mjs'], 'mock-ai en');
  await start('npx', ['vite', 'preview', '--port', '4174', '--strictPort', '--host', '127.0.0.1'], 'Local');
  const userDir = mkdtempSync(join(tmpdir(), 'studyos-e2e-'));
  let ctx = await chromium.launchPersistentContext(userDir, { viewport: { width: 1440, height: 900 }, acceptDownloads: true, args: ARGS });
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  const pageErrors = [];
  const watch = (p) => {
    currentPage = p;
    p.on('pageerror', (e) => pageErrors.push(`${e.message} @ ${p.url()}`));
    p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'enlace' : undefined));
  };
  watch(page);
  let docId = '';

  await test('Onboarding y dashboard', async () => {
    await onboard(page);
    await page.getByText('Mis materias').waitFor();
    await page.getByText('Química').first().waitFor();
  });

  await test('Prueba 6: guardar una materia, cerrar la app y comprobar que persiste', async () => {
    await go(page, '/subjects');
    await page.getByRole('button', { name: 'Nueva materia' }).click();
    await page.getByPlaceholder('Ej.: Química orgánica').fill('Astronomía E2E');
    await page.getByRole('button', { name: 'Crear materia' }).click();
    await page.getByRole('heading', { name: 'Astronomía E2E' }).waitFor();
    await ctx.close();
    ctx = await chromium.launchPersistentContext(userDir, { viewport: { width: 1440, height: 900 }, acceptDownloads: true, args: ARGS });
    page = ctx.pages()[0] ?? (await ctx.newPage());
    watch(page);
    await go(page, '/subjects');
    await page.getByText('Astronomía E2E').waitFor({ timeout: 15000 });
    assert(!(await page.getByText('Bienvenido a StudyOS AI').isVisible()), 'el onboarding volvió a aparecer');
  });

  await test('Configurar proveedor de IA (servidor simulado compatible con OpenAI)', async () => {
    await go(page, '/settings');
    await page.locator('#ia select').first().selectOption('openai');
    await page.locator('#ia input[type=password]').fill('clave-de-prueba');
    await page.locator('#ia input[value="https://api.openai.com/v1"]').fill(MOCK);
    await page.locator('#ia input[value="gpt-5-mini"]').fill('mock-model');
    await page.getByRole('button', { name: 'Probar conexión y cargar modelos' }).click();
    await page.getByText(/Conexión correcta/).waitFor({ timeout: 20000 });
  });

  await test('Prueba 1: subir un PDF de química y generar un resumen con citas', async () => {
    await go(page, '/library');
    await page.getByRole('button', { name: 'Subir documento' }).first().click();
    await page.locator('input[type=file][multiple]').setInputFiles(join(root, 'e2e/fixtures/quimica.pdf'));
    await page.getByRole('button', { name: /^Importar/ }).click();
    await page.getByText('quimica').first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Procesando…'), null, { timeout: 60000 });
    await page.getByText('quimica').first().click();
    await page.waitForURL(/library\/[^?]+/);
    docId = page.url().split('/library/')[1].split('?')[0];
    await page.getByRole('button', { name: 'Texto extraído' }).click();
    await page.getByText(/estudia las proporciones/).first().waitFor();
    await page.getByRole('button', { name: 'Resúmenes' }).click();
    await page.getByRole('button', { name: 'Generar resumen' }).click();
    await page.waitForURL(/summaries\//, { timeout: 60000 });
    await page.getByRole('heading', { name: 'Estequiometría' }).waitFor();
    await page.getByText(/citó páginas que no existen/).waitFor();
    await page.getByRole('button', { name: 'p. 1' }).first().click();
    await page.waitForURL(/page=1/);
    await page.locator('canvas').first().waitFor();
    return 'cita [p. 9] inexistente marcada como no verificada; la cita p. 1 abre la página original';
  });

  await test('OCR local de una foto (Tesseract sin conexión)', async () => {
    const png = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 260;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 900, 260);
      g.fillStyle = '#000';
      g.font = 'bold 64px Arial';
      g.fillText('La fotosintesis produce', 30, 110);
      g.fillText('oxigeno y glucosa', 30, 200);
      const b = await new Promise((r) => c.toBlob(r, 'image/png'));
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    await go(page, '/library');
    await page.getByRole('button', { name: 'Subir documento' }).first().click();
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'foto-pizarra.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await page.getByRole('button', { name: /^Importar/ }).click();
    await page.getByText('foto-pizarra').first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Procesando…'), null, { timeout: 120000 });
    await page.getByText('foto-pizarra').first().click();
    await page.getByRole('button', { name: 'Texto extraído' }).click();
    await page.getByText(/glucosa/i).first().waitFor({ timeout: 15000 });
    const txt = (await page.locator('main').innerText()).toLowerCase();
    assert(/fotosintesis|fotosíntesis/.test(txt) && /glucosa/.test(txt), 'el OCR no reconoció el texto');
    return 'texto reconocido en el dispositivo';
  });

  await test('Prueba 2: crear 10 preguntas desde el documento y corregir las respuestas', async () => {
    await go(page, `/exams?new=1&doc=${docId}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Crear examen' }).click();
    await page.waitForURL(/exams\/[^?]+$/, { timeout: 60000 });
    await page.getByRole('button', { name: 'Empezar examen' }).click();
    const total = Number((await page.getByText(/Pregunta 1 de \d+/).innerText()).match(/de (\d+)/)[1]);
    assert(total === 10, `se esperaban 10 preguntas y hay ${total}`);
    for (let i = 0; i < total; i++) {
      const radio = page.getByRole('radio').first();
      if (await radio.count()) await radio.click();
      else if (await page.getByRole('button', { name: 'Verdadero' }).count()) await page.getByRole('button', { name: 'Verdadero' }).click();
      else {
        const inputs = page.locator('main input:not([type=range]):not([type=checkbox]), main textarea');
        const n = await inputs.count();
        for (let k = 0; k < n; k++) await inputs.nth(k).fill(k === 0 ? 'covalentes' : 'electrones');
        const sel = page.locator('main select');
        for (let k = 0; k < (await sel.count()); k++) await sel.nth(k).selectOption({ index: 1 });
      }
      if (await page.getByRole('button', { name: 'Comprobar' }).isEnabled().catch(() => false)) await page.getByRole('button', { name: 'Comprobar' }).click();
      if (i < total - 1) await page.getByRole('button', { name: 'Siguiente' }).click();
    }
    await page.getByRole('button', { name: 'Entregar' }).click();
    await page.getByText(/Resultado: /).waitFor({ timeout: 60000 });
    await page.getByText('Corrección automática').first().waitFor();
    await page.getByText(/Corregido por IA/).first().waitFor();
    await page.getByText('Errores frecuentes y temas para repasar').waitFor();
    return 'objetivas corregidas en el dispositivo; abiertas con criterios por IA y revisables';
  });

  await test('Prueba 3: pedir una explicación al profesor y continuar con preguntas', async () => {
    await go(page, `/tutor?doc=${docId}`);
    await page.getByPlaceholder(/Escribí tu pregunta/).fill('¿Qué es la estequiometría?');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await page.getByText(/estudia proporciones/).first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Dame un ejemplo' }).click();
    await page.getByText(/Claro, sigamos/).first().waitFor({ timeout: 30000 });
  });

  await test('Prueba 4: abrir una simulación 3D y modificar sus parámetros', async () => {
    await go(page, '/lab?sim=projectile');
    const readout = page.getByText('Alcance', { exact: true }).locator('..');
    await readout.waitFor({ timeout: 30000 });
    const before = await readout.innerText();
    const slider = page.getByRole('slider', { name: 'Velocidad inicial v₀' });
    await slider.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    const after = await readout.innerText();
    assert(before !== after, 'el alcance no cambió al modificar la velocidad');
    await page.getByRole('button', { name: 'Iniciar', exact: true }).first().click();
    await page.waitForTimeout(1500);
    for (const sim of ['pendulum', 'molecules', 'separation', 'cell', 'solar', 'surface', 'solids']) {
      await go(page, `/lab?sim=${sim}`);
      await page.locator('canvas').first().waitFor({ timeout: 30000 });
    }
    return `${before.replace(/\s+/g, ' ')} → ${after.replace(/\s+/g, ' ')}; las 8 simulaciones cargan`;
  });

  await test('Prueba 5: generar una animación educativa, verla y exportarla', async () => {
    await go(page, '/video');
    await page.getByRole('button', { name: 'Generar guion y escenas' }).click();
    await page.getByLabel('Título del video').waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: 'Reproducir' }).click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Pausar' }).click();
    const dl = page.waitForEvent('download', { timeout: 180000 });
    await page.getByRole('button', { name: 'Exportar' }).click();
    const d = await dl;
    const path = await d.path();
    const size = statSync(path).size;
    assert(size > 20000, `video demasiado chico (${size} bytes)`);
    return `${d.suggestedFilename()} (${(size / 1024).toFixed(0)} KB)`;
  });

  await test('SmartTasks 1: generar una tarea desde una instrucción escrita', async () => {
    await go(page, '/tasks?new=1');
    await page.getByPlaceholder(/Haceme 15 ejercicios/).fill('Haceme 8 ejercicios de química sobre el mol, de menor a mayor dificultad');
    await page.getByRole('dialog').getByRole('button', { name: 'Generar tarea' }).click();
    await page.waitForURL(/tasks\/[^?]+$/, { timeout: 60000 });
    await page.getByText('Tarea de química: mol y enlaces').waitFor();
    await page.getByRole('button', { name: 'Leer consigna' }).first().waitFor({ timeout: 15000 });
    const n = await page.getByRole('button', { name: 'Leer consigna' }).count();
    assert(n >= 5, `pocos ejercicios (${n})`);
    return `${n} ejercicios`;
  });

  let taskUrl = '';
  await test('SmartTasks 2: crear una actividad a partir de un PDF', async () => {
    await go(page, `/tasks?new=1&doc=${docId}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Generar tarea' }).click();
    await page.waitForURL(/tasks\/[^?]+$/, { timeout: 60000 });
    taskUrl = page.url();
    await page.getByRole('button', { name: 'p. 1' }).first().waitFor();
    return 'los ejercicios enlazan a la página del PDF';
  });

  await test('SmartTasks 3: responder y guardar avances (persisten al recargar)', async () => {
    const field = page.getByLabel('Respuesta numérica').first();
    await field.fill('2');
    await page.getByText(/1\/\d+ · Guardado/).waitFor({ timeout: 10000 });
    await page.reload();
    await page.getByLabel('Respuesta numérica').first().waitFor({ timeout: 15000 });
    const v = await page.getByLabel('Respuesta numérica').first().inputValue();
    assert(v === '2', `la respuesta no se conservó (valor: «${v}»)`);
  });

  await test('SmartTasks 4: la IA corrige y explica los resultados', async () => {
    await page.getByRole('button', { name: 'Entregar para corregir' }).click();
    await page.getByRole('button', { name: 'Generar ejercicios de refuerzo' }).waitFor({ timeout: 60000 });
    await page.getByText(/repasá los tipos de enlace/).waitFor();
    await page.getByText('Respuesta esperada').first().waitFor();
  });

  await test('SmartTasks 7: exportar la tarea a PDF', async () => {
    await page.getByRole('button', { name: 'Exportar o imprimir' }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PDF con soluciones' }).click();
    const d = await dl;
    const size = statSync(await d.path()).size;
    assert(readFileSync(await d.path()).subarray(0, 4).toString() === '%PDF', 'no es un PDF');
    return `${d.suggestedFilename()} (${(size / 1024).toFixed(0)} KB)`;
  });

  await test('SmartTasks 5: generar ejercicios nuevos a partir de los errores', async () => {
    await page.goto(taskUrl);
    await page.getByRole('button', { name: 'Generar ejercicios de refuerzo' }).click();
    await page.waitForURL((u) => u.href !== taskUrl && /tasks\/[^?]+$/.test(u.href), { timeout: 60000 });
    await page.getByText(/Refuerzo de «/).waitFor();
  });

  await test('Flashcards sin IA: crear tarjeta y repasar con SM-2', async () => {
    await go(page, '/flashcards?new=1');
    await page.getByPlaceholder('Ej.: Tabla periódica').fill('Mazo E2E');
    await page.getByRole('dialog').getByRole('button', { name: 'Crear mazo' }).click();
    await page.getByPlaceholder(/Admite Markdown/).fill('¿Símbolo del sodio?');
    await page.locator('textarea').nth(1).fill('Na');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: /Repasar \(1\)/ }).click();
    await page.getByRole('button', { name: 'Ver respuesta' }).click();
    await page.getByRole('button', { name: /Bien/ }).click();
    await page.getByText('¡Sesión terminada!').waitFor();
  });

  await test('Planificador: examen en 7 días con 5 temas (con IA para interpretar el pedido)', async () => {
    await go(page, '/calendar');
    await page.getByRole('button', { name: 'Planificar estudio' }).click();
    await page.getByPlaceholder(/Tengo un examen de química/).fill('Tengo un examen de química dentro de siete días y necesito estudiar cinco temas');
    await page.getByRole('button', { name: 'Interpretar' }).click();
    await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('Tema 5'), null, { timeout: 20000 });
    await page.getByRole('button', { name: 'Armar plan' }).click();
    const sessions = await page.getByText(/^Estudiar: Tema/).count();
    assert(sessions === 5, `se esperaban 5 sesiones de estudio, hay ${sessions}`);
    await page.getByRole('button', { name: 'Guardar en el calendario' }).click();
    await page.getByText(/Plan guardado/).waitFor();
    return '5 temas con repasos y repaso final, editable antes de guardar';
  });

  await ctx.close();

  // Prueba 7: celular
  const browser = await chromium.launch({ args: ARGS });
  await test('Prueba 7: interfaz y controles en un celular', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await m.newPage();
    watch(p);
    await onboard(p, 'Sofi');
    const bad = [];
    for (const r of ['/', '/subjects', '/library', '/tutor', '/tasks', '/exams', '/flashcards', '/calendar', '/stats', '/lab', '/video', '/board', '/maps', '/focus', '/settings']) {
      await go(p, r);
      await p.waitForTimeout(400);
      // En celulares el viewport se agranda si algo no entra: se compara con el ancho real (390 px).
      const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      if (sw > 391 || iw > 391) bad.push(`${r} (${Math.max(sw, iw)}px)`);
    }
    assert(!bad.length, `desborde horizontal en: ${bad.join(', ')}`);
    await go(p, '/');
    await p.getByRole('navigation', { name: 'Navegación inferior' }).getByText('Tareas').tap();
    await p.getByRole('heading', { name: 'Mis tareas' }).waitFor();
    await p.getByRole('button', { name: 'Más secciones' }).tap();
    await p.getByRole('link', { name: 'Laboratorio 3D' }).tap();
    await p.getByRole('heading', { name: 'Laboratorio 3D' }).waitFor();
    await m.close();
    return '15 pantallas sin desborde; navegación inferior y menú «Más» funcionan';
  });

  await test('Prueba 8: micrófono denegado muestra un error comprensible', async () => {
    // Micrófono simulado presente, pero sin permiso concedido.
    // Simula que el usuario rechaza el permiso: getUserMedia falla con NotAllowedError,
    // igual que cuando se toca «Bloquear» en el aviso del navegador o de Android.
    const micBrowser = await chromium.launch({ args: ARGS });
    const m = await micBrowser.newContext({ viewport: { width: 1280, height: 860 }, permissions: [] });
    await m.addInitScript(() => {
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    const p = await m.newPage();
    watch(p);
    await onboard(p, 'Leo');
    await go(p, '/settings');
    const btn = p.getByRole('button', { name: 'Probar micrófono' });
    if (await btn.isDisabled()) {
      await p.getByText(/no tiene reconocimiento de voz/).waitFor();
      await m.close();
      return 'el navegador no ofrece reconocimiento de voz: se muestra la alternativa (escribir)';
    }
    await btn.click();
    const msg = p.getByText(/no tiene permiso para usar el micrófono/).first();
    await msg.waitFor({ timeout: 20000 });
    const text = await msg.innerText();
    await micBrowser.close();
    return `mensaje: «${text.slice(0, 90)}»`;
  });
  await browser.close();

  rmSync(userDir, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
  if (pageErrors.length) console.log(`Errores de página registrados:\n- ${[...new Set(pageErrors)].slice(0, 10).join('\n- ')}`);
  procs.forEach((p) => p.kill());
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  procs.forEach((p) => p.kill());
  process.exit(1);
});
