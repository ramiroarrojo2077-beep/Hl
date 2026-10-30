// Servidor de IA SIMULADO para pruebas funcionales (compatible con
// /v1/chat/completions de OpenAI). Devuelve respuestas fijas según el agente
// que hace la consulta, para verificar los flujos de la app sin una clave real.
// No es parte de la app.
import http from 'node:http';

// Generador de consignas distintas para que cada llamada devuelva ejercicios
// nuevos (la app descarta los que se parecen demasiado a otros ya hechos).
const CTX = ['En el laboratorio escolar', 'Durante una clase práctica de cocina', 'En una planta potabilizadora de la ciudad', 'Mientras preparás un experimento para la feria de ciencias', 'En una fábrica de fertilizantes', 'Al analizar una muestra de suelo del jardín', 'En un hospital, el farmacéutico', 'Un grupo de estudiantes de quinto año', 'Para controlar la calidad de un yogur', 'En una estación espacial ficticia'];
const ASK = [['calculá cuántos moles hay en 36 gramos de agua', 2], ['determiná la masa de 3 moles de metano', 48], ['averiguá cuántos gramos pesa medio mol de glucosa', 90], ['obtené la masa molar del amoníaco', 17], ['estimá los moles de oxígeno necesarios para quemar 2 moles de propano', 10], ['encontrá el rendimiento si se obtienen 8 g sobre 10 g teóricos', 80], ['indicá cuántos moles de cloruro de sodio hay en 117 g', 2], ['calculá la masa de dióxido de carbono que forman 2 moles de carbono', 88]];
const END = ['Redondeá a dos decimales.', 'Explicá cada paso del razonamiento.', 'Indicá siempre la unidad del resultado.', 'Justificá con la ecuación química.', 'Compará el resultado con tu estimación inicial.'];
const EXTRA = [];
for (let i = 0; i < 80; i++) {
  const [q, v] = ASK[(i * 3) % ASK.length];
  EXTRA.push([`${CTX[(i * 7) % CTX.length]}, ${q}. ${END[(i * 5) % END.length]}`, v]);
}
let seq = 0;
const items = (n, withSource = false) => {
  const base = [
    { type: 'mcq', prompt: '¿Cuántas partículas hay en un mol?', options: ['6,022 × 10²³', '3,14 × 10⁸', '1000', '12'], correctIndex: 0, concept: 'Mol', difficulty: 2, hints: ['Es el número de Avogadro'], solutionSteps: ['Un mol contiene el número de Avogadro de partículas.'], explanation: 'Definición de mol.', sourcePage: 1 },
    { type: 'tf', prompt: 'El enlace iónico ocurre entre metales y no metales.', correctBool: true, concept: 'Enlace iónico', difficulty: 1, hints: ['Pensá en NaCl'], solutionSteps: ['Na es metal y Cl no metal.'], explanation: 'Transferencia de electrones.', sourcePage: 2 },
    { type: 'short', prompt: '¿Qué estudia la estequiometría?', acceptedAnswers: ['las proporciones de las reacciones', 'proporciones en que reaccionan las sustancias'], rubric: [{ description: 'Menciona proporciones entre sustancias', points: 1 }], concept: 'Estequiometría', difficulty: 2, hints: ['Proporciones'], solutionSteps: ['Estudia las proporciones de reacción.'], explanation: '', sourcePage: 1 },
    { type: 'fill', prompt: 'Los enlaces ___ se forman al compartir ___.', blanks: [['covalentes'], ['electrones']], concept: 'Enlace covalente', difficulty: 2, hints: ['No es iónico'], solutionSteps: ['Covalente = compartir electrones'], explanation: '', sourcePage: 2 },
    { type: 'problem', prompt: '¿Cuántos moles hay en 36 g de agua (M = 18 g/mol)?', finalAnswer: '2 mol', correctNumber: 2, tolerance: 0.01, unit: 'mol', solutionSteps: ['n = m / M', 'n = 36 / 18 = 2 mol'], rubric: [{ description: 'Usa n = m/M', points: 1 }, { description: 'Calcula bien', points: 1 }], concept: 'Mol', difficulty: 3, hints: ['n = m/M'], explanation: '', sourcePage: 1 },
    { type: 'numeric', prompt: 'Masa molar del agua en g/mol', correctNumber: 18, tolerance: 0.1, unit: 'g/mol', concept: 'Masa molar', difficulty: 2, hints: ['H = 1, O = 16'], solutionSteps: ['2·1 + 16 = 18'], explanation: '', sourcePage: 1 },
    { type: 'match', prompt: 'Relacioná', pairs: [{ left: 'NaCl', right: 'Iónico' }, { left: 'H₂O', right: 'Covalente polar' }, { left: 'O₂', right: 'Covalente no polar' }], concept: 'Tipos de enlace', difficulty: 3, hints: ['Electronegatividad'], solutionSteps: ['…'], explanation: '' },
    { type: 'order', prompt: 'Ordená los pasos para calcular moles', sequence: ['Escribir la masa', 'Buscar la masa molar', 'Dividir masa por masa molar'], concept: 'Mol', difficulty: 2, hints: ['Primero los datos'], solutionSteps: ['…'], explanation: '' },
    { type: 'essay', prompt: 'Explicá la diferencia entre enlace iónico y covalente.', rubric: [{ description: 'Define enlace iónico', points: 1 }, { description: 'Define covalente', points: 1 }, { description: 'Compara', points: 1 }], concept: 'Tipos de enlace', difficulty: 3, hints: ['Electrones'], solutionSteps: ['Iónico: transferencia; covalente: compartición.'], explanation: '' },
    { type: 'mcq', prompt: '¿Qué tipo de enlace tiene el O₂?', options: ['Iónico', 'Covalente', 'Metálico'], correctIndex: 1, concept: 'Enlace covalente', difficulty: 2, hints: ['Dos no metales'], solutionSteps: ['Comparte electrones'], explanation: '', media: { kind: 'chart', expression: 'x^2', xMin: -2, xMax: 2, title: 'Gráfico de ejemplo' } },
  ];
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = seq++;
    if (k < base.length) out.push(base[k]);
    else {
      const [prompt, ans] = EXTRA[(k - base.length) % EXTRA.length];
      const round = Math.floor((k - base.length) / EXTRA.length);
      out.push({ type: 'numeric', sourcePage: withSource ? 1 + (k % 2) : null, prompt: round ? `Problema ${['de laboratorio', 'industrial', 'de repaso', 'contextualizado', 'integrador'][round % 5]}: ${prompt}` : prompt, correctNumber: ans, tolerance: Math.abs(ans) * 0.01, unit: null, concept: 'Estequiometría', difficulty: 3, hints: ['Usá n = m/M o la proporción de la ecuación'], solutionSteps: ['Plantear la relación', 'Calcular'], explanation: '' });
    }
  }
  return out;
};

function answerFor(system, user, sent) {
  const s = system + '\n' + user;
  if (/Respondé solo: OK/.test(s)) return 'OK';
  if (/revisor de calidad de material/.test(s)) return JSON.stringify({ ok: true, issues: [] });
  if (/revisor de calidad de evaluaciones/.test(s)) return JSON.stringify({ problems: [] });
  if (/docente que corrige con criterios/.test(s)) {
    const ids = [...user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
    return JSON.stringify({ results: ids.map((id) => ({ id, criteria: [{ index: 0, awarded: 1, comment: 'Correcto' }, { index: 1, awarded: 0, comment: 'Falta desarrollar' }, { index: 2, awarded: 0, comment: '' }], feedback: 'Bien planteado; falta completar el desarrollo.', confidence: 'media' })) });
  }
  if (/devoluciones constructivas/.test(s)) return JSON.stringify({ comment: 'Buen trabajo con el concepto de mol; repasá los tipos de enlace.', recommendations: ['Practicar diferencias entre enlaces'] });
  if (/Task Generator Agent/.test(s)) {
    const n = Number(user.match(/Cantidad de ejercicios: (\d+)/)?.[1] ?? 8);
    return JSON.stringify({ title: /reforzar|respondí mal/i.test(user) ? 'Refuerzo: tipos de enlace' : 'Tarea de química: mol y enlaces', description: 'Ejercicios progresivos.', objectives: ['Calcular moles', 'Distinguir enlaces'], topic: 'Química', level: 'Secundario', estimatedMinutes: 30, focusConcepts: ['Mol', 'Tipos de enlace'], items: items(n, /MATERIAL DE REFERENCIA/.test(user)) });
  }
  if (/agente de exámenes/.test(s)) {
    const n = [...user.matchAll(/(\d+) de /g)].reduce((a, m) => a + Number(m[1]), 0) || 10;
    return JSON.stringify({ title: 'Examen de química', items: items(n) });
  }
  if (/agente de resúmenes/.test(s)) return '## Estequiometría\nLa **estequiometría** estudia las proporciones en que reaccionan las sustancias [p. 1]. Un mol contiene $6{,}022 \\times 10^{23}$ partículas [p. 1].\n\n## Enlaces\n- Covalente: se comparten electrones [p. 2].\n- Iónico: entre metales y no metales [p. 2].\n- Dato inventado de prueba [p. 9].';
  if (/Tomá notas exhaustivas/.test(s)) return 'Notas: proporciones [p. 1]; enlaces [p. 2].';
  if (/Video Director/.test(s))
    return JSON.stringify({ title: 'Separación magnética', scenes: [
      { template: 'title', heading: 'Separación magnética', narration: 'Veamos cómo se separan los metales.' },
      { template: 'bullets', heading: 'Ideas clave', bullets: ['El imán atrae el hierro', 'El plástico sigue de largo'], narration: 'El imán atrae solo materiales ferromagnéticos.' },
      { template: 'scene3d', heading: 'En la planta', preset3d: 'magnetic-separation', labels3d: ['Polea magnética'], narration: 'La polea magnética desvía el hierro.', camera: 'orbit' },
      { template: 'quiz', question: '¿Qué material atrae el imán?', options: ['Hierro', 'Plástico', 'Vidrio'], answerIndex: 0, narration: 'Pensá la respuesta.' },
    ] });
  if (/profesor de StudyOS explicando en una pizarra/.test(s)) return JSON.stringify({ title: 'Ecuación cuadrática', steps: [{ title: 'Identificar coeficientes', latex: 'a=1,\\ b=-5,\\ c=6', explanation: 'Leemos a, b y c.' }, { title: 'Discriminante', latex: '\\Delta = b^2-4ac = 1', explanation: 'Calculamos el discriminante.', check: { kind: 'numeric', expected: '1', prompt: 'Calculá el discriminante' } }, { title: 'Raíces', latex: 'x_1=3,\\ x_2=2', explanation: 'Aplicamos la fórmula.' }] });
  if (/Study Planner/.test(s)) {
    const d = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return JSON.stringify({ subjectName: 'Química', examDate: d, topics: ['Tema 1', 'Tema 2', 'Tema 3', 'Tema 4', 'Tema 5'], topicsUnnamed: true, minutesPerDay: null, notes: '' });
  }
  if (/Visual Agent/.test(s)) return JSON.stringify({ title: 'Química', nodes: [{ id: '1', label: 'Química' }, { id: '2', label: 'Enlaces', page: 2 }, { id: '3', label: 'Mol', page: 1 }], edges: [{ source: '1', target: '2', label: 'estudia' }, { source: '1', target: '3', label: 'mide con' }] });
  if (/agente de flashcards/.test(s)) return JSON.stringify({ cards: [{ front: '¿Qué es un mol?', back: '6,022 × 10²³ partículas', concept: 'Mol', sourcePage: 1 }, { front: 'Enlace covalente', back: 'Compartición de electrones', concept: 'Enlace covalente', sourcePage: 2 }] });
  if (/Document Agent/.test(s)) return JSON.stringify({ concepts: [{ name: 'Mol', page: 1, definition: 'Cantidad de sustancia' }] });
  if (/profesor virtual de StudyOS/.test(s)) return sent > 1 ? 'Claro, sigamos. El **enlace covalente** comparte electrones [p. 2]. ¿Querés un ejemplo?' : 'La **estequiometría** estudia proporciones [p. 1]. Por ejemplo, 2 H₂ + O₂ → 2 H₂O. ¿Te quedó claro?';
  return 'OK';
}

let calls = 0;
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-model-2' }] }));
  if (req.url.endsWith('/stats')) return res.end(JSON.stringify({ calls }));
  let body = '';
  for await (const ch of req) body += ch;
  const j = JSON.parse(body || '{}');
  calls++;
  // Igual que las APIs reales cuando un modelo se retira
  if (j.model && !['mock-model', 'mock-model-2'].includes(j.model)) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: { message: `The model \`${j.model}\` does not exist or you do not have access to it.`, code: 'model_not_found' } }));
  }
  const system = j.messages?.find((m) => m.role === 'system')?.content ?? '';
  const userMsgs = (j.messages ?? []).filter((m) => m.role === 'user');
  const user = userMsgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const text = answerFor(system, user, userMsgs.length);
  if (j.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    for (const part of text.match(/.{1,12}/gs) ?? []) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 15));
    }
    res.end('data: [DONE]\n\n');
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
});
const port = Number(process.env.MOCK_PORT ?? 8787);
server.listen(port, '127.0.0.1', () => console.log(`mock-ai en http://127.0.0.1:${port}/v1`));
