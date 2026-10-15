// Pantallas de menú: configuración de cada modo, garaje, ajustes, repeticiones,
// campeonato, trayectoria, pausa y resultados. Todas las opciones están conectadas.

import { TRACKS, TRACK_BY_ID } from '../data/tracks.js';
import { CIRCUIT_GEO } from '../data/circuitGeo.js';
import { TEAMS, DRIVERS, TEAM_BY_ID, DRIVER_BY_ID, COMPOUNDS } from '../data/teams.js';
import { DIFFICULTY } from '../core/AIDriver.js';
import { DEFAULT_SETUP } from '../core/CarPhysics.js';
import { fmtTime } from '../core/Session.js';
import { DEFAULT_KEYS } from '../input/Input.js';
import * as Store from '../core/Storage.js';
import * as Season from '../modes/Season.js';

const $ = id => document.getElementById(id);
const hex = n => '#' + n.toString(16).padStart(6, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function drawTrackThumb(canvas, id, color = '#fff') {
  const geo = CIRCUIT_GEO[id];
  if (!geo) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth * 2 || 300, H = canvas.height = canvas.clientHeight * 2 || 170;
  const pts = geo.pts;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minZ = Math.min(minZ, pts[i + 1]); maxZ = Math.max(maxZ, pts[i + 1]); }
  const sc = Math.min((W - 20) / (maxX - minX), (H - 20) / (maxZ - minZ));
  const tx = x => W / 2 + (x - (minX + maxX) / 2) * sc, tz = z => H / 2 + (z - (minZ + maxZ) / 2) * sc;
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = color;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) i ? ctx.lineTo(tx(pts[i]), tz(pts[i + 1])) : ctx.moveTo(tx(pts[i]), tz(pts[i + 1]));
  ctx.closePath(); ctx.stroke();
  ctx.fillStyle = '#e10600'; ctx.fillRect(tx(pts[0]) - 5, tz(pts[1]) - 5, 10, 10);
}

const TIPS = [
  'Frená en línea recta y soltá el freno de a poco al entrar a la curva.',
  'Con lluvia, los intermedios rinden mejor que los lisos cuando la pista está húmeda.',
  'Usá el DRS (barra espaciadora) cuando estés a menos de un segundo del auto de adelante.',
  'Bajá a 80 km/h antes de la línea del limitador o te sancionan 5 segundos.',
  'El modo ERS de ataque (X) te da más potencia, pero vacía la batería.',
  'Presioná M para abrir el menú de estrategia y elegir neumáticos para la próxima parada.',
  'Cambiá de cámara con C. Con V mirás hacia atrás.',
  'Los neumáticos fríos tienen menos agarre: cuidado en la primera vuelta y al salir de boxes.',
  'Si te vas a la grava, levantá el pie: la piedra frena muchísimo y ensucia las gomas.',
  'R te devuelve a la pista si quedaste atascado.',
];
export const tip = () => TIPS[Math.floor(Math.random() * TIPS.length)];

export class Screens {
  constructor(game) {
    this.g = game;
    this.body = $('panelBody');
    this.body.addEventListener('click', e => this.onClick(e));
    this.body.addEventListener('input', e => this.onInput(e));
    this.body.addEventListener('change', e => this.onInput(e));
    this.cfg = {};
    this.handlers = {};
  }

  show(html, handlers = {}) {
    this.body.classList.remove('narrow');
    this.body.innerHTML = html;
    this.handlers = handlers;
    this.g.showScreen('panel');
    $('panel').scrollTop = 0;
    for (const c of this.body.querySelectorAll('canvas[data-thumb]')) drawTrackThumb(c, c.dataset.thumb);
  }

  onClick(e) {
    const t = e.target.closest('[data-act],[data-seg],[data-track],[data-team],[data-drv],[data-tab]');
    if (!t) return;
    if (t.dataset.seg) {
      const [key, val] = t.dataset.seg.split('=');
      this.cfg[key] = isNaN(+val) || val === '' ? (val === 'true' ? true : val === 'false' ? false : val) : +val;
      for (const b of t.parentElement.querySelectorAll('button')) b.classList.toggle('on', b === t);
      this.handlers.change?.(key);
      return;
    }
    if (t.dataset.track) {
      this.cfg.trackId = t.dataset.track;
      for (const c of this.body.querySelectorAll('[data-track]')) c.classList.toggle('sel', c === t);
      const info = this.body.querySelector('#trackInfo');
      if (info) info.innerHTML = this.trackInfo(this.cfg.trackId);
      this.handlers.change?.('track');
      return;
    }
    if (t.dataset.drv) {
      this.cfg.driverId = t.dataset.drv;
      this.cfg.teamId = DRIVER_BY_ID[t.dataset.drv].team;
      for (const c of this.body.querySelectorAll('[data-drv]')) c.classList.toggle('sel', c === t);
      this.handlers.change?.('driver');
      return;
    }
    if (t.dataset.team) {
      this.cfg.teamId = t.dataset.team;
      for (const c of this.body.querySelectorAll('[data-team]')) c.classList.toggle('sel', c === t);
      this.handlers.change?.('team');
      return;
    }
    if (t.dataset.tab) { this.handlers.tab?.(t.dataset.tab); return; }
    if (t.dataset.act) this.handlers[t.dataset.act]?.(t);
  }

  onInput(e) {
    const t = e.target;
    if (!t.dataset.key) return;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.type === 'range' || t.type === 'number') v = +v;
    this.cfg[t.dataset.key] = v;
    const out = this.body.querySelector(`[data-out="${t.dataset.key}"]`);
    if (out) out.textContent = t.dataset.fmt === 'pct' ? Math.round(v * 100) + '%' : v;
    this.handlers.input?.(t.dataset.key, v);
  }

  // ---------- piezas ----------
  seg(key, options, value) {
    return `<div class="seg">${options.map(([v, l]) => `<button data-seg="${key}=${v}" class="${String(v) === String(value) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }

  trackGrid(sel) {
    return `<div class="grid-tracks">${TRACKS.map(t => `<button class="tcard${t.id === sel ? ' sel' : ''}" data-track="${t.id}"><canvas data-thumb="${t.id}"></canvas><b>${t.flag} ${t.name}</b><span>${t.country} · ${(t.length / 1000).toFixed(3)} km</span></button>`).join('')}</div>`;
  }

  trackInfo(id) {
    const t = TRACK_BY_ID[id];
    return `<b>${t.fullName}</b> — ${t.gp}<p class="blurb">${t.blurb}</p><p class="info">${(t.length / 1000).toFixed(3)} km · ${t.laps} vueltas reales · altitud ${t.altitude} m · ${t.street ? 'semiurbano/callejero' : 'permanente'}</p>`;
  }

  driverGrid(sel) {
    return `<div class="grid-teams">${TEAMS.map(t => {
      const ds = DRIVERS.filter(d => d.team === t.id);
      return `<div class="team" style="flex-direction:column;align-items:stretch"><div style="display:flex;gap:8px;align-items:center"><span class="sw" style="background:${hex(t.colors.primary)};height:22px"></span><b>${t.name}</b></div>
        ${ds.map(d => `<button class="team${d.id === sel ? ' sel' : ''}" data-drv="${d.id}" style="padding:6px 8px"><span><b>#${d.num} ${d.first} ${d.last}</b><span> ${d.nat} · ritmo ${Math.round(d.skill.pace * 100)}</span></span></button>`).join('')}</div>`;
    }).join('')}</div>`;
  }

  common(cfg, opts = {}) {
    const diffs = Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]);
    return `<div class="rowf">
      ${opts.laps !== false ? `<div class="field"><label>Vueltas</label>${this.seg('laps', [[3, '3'], [5, '5'], [10, '10'], [15, '15'], [25, '25%'], [50, '50%'], [100, '100%']], cfg.laps)}</div>` : ''}
      ${opts.minutes ? `<div class="field"><label>Duración</label>${this.seg('minutes', opts.minutes, cfg.minutes)}</div>` : ''}
      <div class="field"><label>Dificultad IA</label>${this.seg('difficulty', diffs, cfg.difficulty)}</div>
      <div class="field"><label>Clima</label>${this.seg('weather', [['seco', 'Seco'], ['variable', 'Variable'], ['lluvia', 'Lluvia'], ['aleatorio', 'Real']], cfg.weather)}</div>
      ${opts.formation !== false ? `<div class="field"><label>Vuelta de formación</label>${this.seg('formationLap', [[false, 'No'], [true, 'Sí']], cfg.formationLap)}</div>` : ''}
      ${opts.ai ? `<div class="field"><label>Rivales en pista</label>${this.seg('aiCount', [[0, '0'], [5, '5'], [10, '10'], [19, '19']], cfg.aiCount)}</div>` : ''}
    </div>`;
  }

  defaults() {
    const s = this.g.settings;
    return { trackId: s.lastTrack || 'monza', driverId: s.lastDriver || 'ibarra', teamId: DRIVER_BY_ID[s.lastDriver || 'ibarra'].team, laps: 5, difficulty: s.difficulty, weather: 'seco', formationLap: false, minutes: 10, aiCount: 19 };
  }

  lapsFor(cfg) {
    const real = TRACK_BY_ID[cfg.trackId].laps;
    if (cfg.laps === 25 || cfg.laps === 50 || cfg.laps === 100) return Math.max(3, Math.round(real * cfg.laps / 100));
    return cfg.laps;
  }

  remember(cfg) {
    this.g.settings.lastTrack = cfg.trackId; this.g.settings.lastDriver = cfg.driverId;
    Store.save('settings', this.g.settings);
  }

  // ---------- modos ----------
  quick() {
    const cfg = this.cfg = this.defaults();
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Carrera rápida</small>Elegí el circuito</h2>
      ${this.trackGrid(cfg.trackId)}<div id="trackInfo" class="info" style="margin-top:10px">${this.trackInfo(cfg.trackId)}</div>
      <h3>Piloto y equipo</h3>${this.driverGrid(cfg.driverId)}
      <h3>Carrera</h3>${this.common(cfg)}
      <div class="actions"><button class="cta" data-act="go">Largar</button><button class="cta ghost" data-act="back">Cancelar</button></div>`, {
      back: () => this.g.showMenu(),
      go: () => { this.remember(cfg); this.g.startSession({ mode: 'quick', type: 'race', trackId: cfg.trackId, driverId: cfg.driverId, laps: this.lapsFor(cfg), difficulty: cfg.difficulty, weather: cfg.weather, formationLap: cfg.formationLap }); },
    });
  }

  gp() {
    const cfg = this.cfg = { ...this.defaults(), practice: false, qualiMin: 8 };
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Gran Premio</small>Fin de semana completo</h2>
      <p class="info">Prácticas → Clasificación → Carrera → Podio</p>
      ${this.trackGrid(cfg.trackId)}<div id="trackInfo" class="info" style="margin-top:10px">${this.trackInfo(cfg.trackId)}</div>
      <h3>Piloto y equipo</h3>${this.driverGrid(cfg.driverId)}
      <h3>Fin de semana</h3>
      <div class="rowf"><div class="field"><label>Prácticas libres</label>${this.seg('practice', [[false, 'No'], [true, '10 min']], cfg.practice)}</div>
      <div class="field"><label>Clasificación</label>${this.seg('qualiMin', [[5, '5 min'], [8, '8 min'], [12, '12 min'], [18, '18 min']], cfg.qualiMin)}</div></div>
      ${this.common(cfg)}
      <div class="actions"><button class="cta" data-act="go">Comenzar fin de semana</button></div>`, {
      back: () => this.g.showMenu(),
      go: () => { this.remember(cfg); this.g.startWeekend({ trackId: cfg.trackId, driverId: cfg.driverId, laps: this.lapsFor(cfg), difficulty: cfg.difficulty, weather: cfg.weather, formationLap: cfg.formationLap, practice: cfg.practice, qualiMin: cfg.qualiMin, mode: 'gp' }); },
    });
  }

  timetrial() {
    const cfg = this.cfg = this.defaults();
    const recs = Store.load('records', {});
    const recRows = TRACKS.map(t => `<tr><td>${t.flag} ${t.name}</td><td>${recs[t.id] ? fmtTime(recs[t.id].time) : '—'}</td><td>${recs[t.id] ? esc(recs[t.id].driver) : ''}</td></tr>`).join('');
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Contrarreloj</small>Contra el fantasma de tu mejor vuelta</h2>
      ${this.trackGrid(cfg.trackId)}<div id="trackInfo" class="info" style="margin-top:10px">${this.trackInfo(cfg.trackId)}</div>
      <h3>Auto</h3>${this.driverGrid(cfg.driverId)}
      <div class="rowf" style="margin-top:14px"><div class="field"><label>Fantasma</label>${this.seg('ghost', [[true, 'Sí'], [false, 'No']], true)}</div>
      <div class="field"><label>Neumático</label>${this.seg('compound', [['soft', 'Blando'], ['medium', 'Medio'], ['hard', 'Duro']], 'soft')}</div></div>
      <h3>Récords locales</h3><table class="res"><tr><th>Circuito</th><th>Mejor vuelta</th><th>Piloto</th></tr>${recRows}</table>
      <div class="actions"><button class="cta" data-act="go">Salir a pista</button></div>`, {
      back: () => this.g.showMenu(),
      go: () => { this.remember(cfg); this.g.startSession({ mode: 'timetrial', type: 'timetrial', trackId: cfg.trackId, driverId: cfg.driverId, ghost: cfg.ghost !== false, startCompound: cfg.compound || 'soft', minutes: 100000, weather: 'seco' }); },
    });
    this.cfg.ghost = true; this.cfg.compound = 'soft';
  }

  practice() {
    const cfg = this.cfg = { ...this.defaults(), minutes: 15, aiCount: 10 };
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Entrenamientos</small>Sesión libre</h2>
      ${this.trackGrid(cfg.trackId)}<div id="trackInfo" class="info" style="margin-top:10px">${this.trackInfo(cfg.trackId)}</div>
      <h3>Piloto</h3>${this.driverGrid(cfg.driverId)}
      <h3>Sesión</h3>${this.common(cfg, { laps: false, formation: false, ai: true, minutes: [[10, '10 min'], [15, '15 min'], [30, '30 min'], [0, 'Sin límite']] })}
      <div class="actions"><button class="cta" data-act="go">Salir a pista</button></div>`, {
      back: () => this.g.showMenu(),
      go: () => { this.remember(cfg); this.g.startSession({ mode: 'practice', type: 'practice', trackId: cfg.trackId, driverId: cfg.driverId, minutes: cfg.minutes || 100000, aiCount: cfg.aiCount, difficulty: cfg.difficulty, weather: cfg.weather }); },
    });
  }

  quali() {
    const cfg = this.cfg = { ...this.defaults(), minutes: 8 };
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Clasificación</small>Buscá la pole position</h2>
      ${this.trackGrid(cfg.trackId)}<div id="trackInfo" class="info" style="margin-top:10px">${this.trackInfo(cfg.trackId)}</div>
      <h3>Piloto</h3>${this.driverGrid(cfg.driverId)}
      <h3>Sesión</h3>${this.common(cfg, { laps: false, formation: false, minutes: [[5, '5 min'], [8, '8 min'], [12, '12 min'], [18, '18 min']] })}
      <div class="actions"><button class="cta" data-act="go">Salir a clasificar</button></div>`, {
      back: () => this.g.showMenu(),
      go: () => { this.remember(cfg); this.g.startSession({ mode: 'quali', type: 'quali', trackId: cfg.trackId, driverId: cfg.driverId, minutes: cfg.minutes, difficulty: cfg.difficulty, weather: cfg.weather }); },
    });
  }

  // ---------- campeonato ----------
  championship() {
    const st = Season.loadChamp('championship');
    if (st && !Season.finished(st)) return this.champHub(st);
    const cfg = this.cfg = { ...this.defaults(), cal: 'all' };
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Campeonato</small>Nueva temporada</h2>
      ${st ? `<p class="info">Temporada anterior terminada: campeón ${esc(Season.driverTable(st)[0].name)}.</p>` : ''}
      <h3>Piloto</h3>${this.driverGrid(cfg.driverId)}
      <h3>Calendario</h3>
      <div class="rowf"><div class="field"><label>Carreras</label>${this.seg('cal', [['all', 'Las 15'], ['half', '8 carreras'], ['short', '4 carreras']], 'all')}</div></div>
      ${this.common(cfg, { formation: true })}
      <div class="actions"><button class="cta" data-act="go">Comenzar campeonato</button></div>`, {
      back: () => this.g.showMenu(),
      go: () => {
        let ids = TRACKS.map(t => t.id);
        if (cfg.cal === 'half') ids = ids.filter((_, i) => i % 2 === 0);
        if (cfg.cal === 'short') ids = ids.filter((_, i) => i % 4 === 0);
        const s2 = Season.newChampionship({ trackIds: ids, laps: cfg.laps, difficulty: cfg.difficulty, weather: cfg.weather, teamId: cfg.teamId, driverId: cfg.driverId });
        s2.formationLap = cfg.formationLap;
        Season.saveChamp(s2);
        this.champHub(s2);
      },
    });
  }

  standingsHtml(st, playerName) {
    const dt = Season.driverTable(st, playerName), tt = Season.teamTable(st);
    return `<div class="cols"><div><h3>Pilotos</h3><table class="res"><tr><th>#</th><th>Piloto</th><th>Equipo</th><th>Pts</th></tr>
      ${dt.map((r, i) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span class="bar" style="background:${hex(r.color)}"></span>${esc(r.name)}</td><td>${r.team}</td><td><b>${r.pts}</b></td></tr>`).join('')}</table></div>
      <div><h3>Constructores</h3><table class="res"><tr><th>#</th><th>Equipo</th><th>Pts</th></tr>
      ${tt.map((r, i) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span class="bar" style="background:${hex(r.color)}"></span>${r.name}</td><td><b>${r.pts}</b></td></tr>`).join('')}</table></div></div>`;
  }

  calendarHtml(st) {
    return `<div class="grid-tracks">${st.calendar.map((id, i) => {
      const t = TRACK_BY_ID[id], r = st.results[i];
      return `<div class="tcard${i === st.round ? ' sel' : ''}" style="opacity:${i < st.round ? 0.6 : 1}"><canvas data-thumb="${id}"></canvas><b>R${i + 1} ${t.flag} ${t.name}</b><span>${r ? `Ganó ${esc(r.podium[0])}${r.player ? ` · vos P${r.player}` : ''}` : i === st.round ? 'PRÓXIMA' : ''}</span></div>`;
    }).join('')}</div>`;
  }

  champHub(st) {
    const next = TRACK_BY_ID[st.calendar[st.round]];
    const drv = DRIVER_BY_ID[st.driverId];
    this.show(`<button class="back" data-act="back">← Menú</button>
      <h2><small>Campeonato · Carrera ${st.round + 1} de ${st.calendar.length}</small>${next.flag} ${next.gp}</h2>
      <p class="info">Piloto: ${drv.first} ${drv.last} (${TEAM_BY_ID[st.teamId].name}) · ${st.laps} vueltas · IA ${DIFFICULTY[st.difficulty].label}</p>
      <div class="actions"><button class="cta" data-act="race">Ir al Gran Premio</button><button class="cta ghost" data-act="quick">Carrera directa (sin clasificación)</button><button class="cta ghost" data-act="abandon">Abandonar campeonato</button></div>
      <h3>Calendario</h3>${this.calendarHtml(st)}
      ${this.standingsHtml(st)}`, {
      back: () => this.g.showMenu(),
      race: () => this.g.startWeekend({ trackId: next.id, driverId: st.driverId, laps: this.lapsFor({ ...st, trackId: next.id }), difficulty: st.difficulty, weather: st.weather, formationLap: st.formationLap, practice: false, qualiMin: 6, mode: 'championship' }),
      quick: () => this.g.startSession({ mode: 'championship', type: 'race', trackId: next.id, driverId: st.driverId, laps: this.lapsFor({ ...st, trackId: next.id }), difficulty: st.difficulty, weather: st.weather, formationLap: st.formationLap }),
      abandon: () => { if (confirm('¿Abandonar el campeonato actual?')) { Season.clearChamp('championship'); this.g.showMenu(); } },
    });
  }

  // ---------- trayectoria ----------
  career() {
    const st = Season.loadChamp('career');
    if (st) return this.careerHub(st);
    const cfg = this.cfg = { first: 'Juan', last: 'Pérez', num: 27, nat: 'ARG', teamId: null };
    const offers = Season.careerOffers(0.1);
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Modo trayectoria</small>Creá tu piloto</h2>
      <div class="rowf"><div class="field"><label>Nombre</label><input type="text" data-key="first" value="${cfg.first}" maxlength="16"></div>
      <div class="field"><label>Apellido</label><input type="text" data-key="last" value="${cfg.last}" maxlength="18"></div>
      <div class="field"><label>Número</label><input type="number" data-key="num" value="${cfg.num}" min="2" max="99"></div>
      <div class="field"><label>Nacionalidad</label><input type="text" data-key="nat" value="${cfg.nat}" maxlength="3"></div></div>
      <h3>Ofertas para tu primera temporada</h3>
      <div class="grid-teams">${offers.map(o => { const t = TEAM_BY_ID[o.teamId]; return `<button class="team" data-team="${t.id}"><span class="sw" style="background:${hex(t.colors.primary)}"></span><span><b>${t.name}</b><span>Objetivo: ${o.goal.text} · ${o.salary} M/año</span></span></button>`; }).join('')}</div>
      <div class="actions"><button class="cta" data-act="go">Firmar contrato</button></div>`, {
      back: () => this.g.showMenu(),
      go: () => {
        if (!cfg.teamId) { alert('Elegí un equipo.'); return; }
        const s2 = Season.newCareer({ first: cfg.first.trim() || 'Juan', last: cfg.last.trim() || 'Pérez', num: cfg.num || 27, nat: (cfg.nat || 'ARG').toUpperCase(), teamId: cfg.teamId });
        Season.saveChamp(s2);
        this.careerHub(s2);
      },
    });
  }

  careerHub(st) {
    if (Season.finished(st)) return this.careerSeasonEnd(st);
    const next = TRACK_BY_ID[st.calendar[st.round]];
    const pname = `${st.player.first} ${st.player.last}`;
    const team = TEAM_BY_ID[st.teamId];
    this.show(`<button class="back" data-act="back">← Menú</button>
      <h2><small>Trayectoria · Temporada ${st.season} · Carrera ${st.round + 1}/${st.calendar.length}</small>${esc(pname)} <span style="color:${hex(team.colors.primary)}">#${st.player.num}</span></h2>
      <p class="info">${team.name} · Objetivo: ${st.contract.goal.text} · Reputación ${Math.round(st.reputation * 100)} · Victorias ${st.wins} · Podios ${st.podiums} · Títulos ${st.titles}</p>
      <div class="actions"><button class="cta" data-act="race">${next.flag} Ir al ${next.gp}</button><button class="cta ghost" data-act="abandon">Retirarse (borrar trayectoria)</button></div>
      <h3>Calendario</h3>${this.calendarHtml(st)}
      ${this.standingsHtml(st, pname)}
      ${st.history.length ? `<h3>Historial</h3><table class="res"><tr><th>Temporada</th><th>Equipo</th><th>Posición</th><th>Puntos</th></tr>${st.history.map(h => `<tr><td>${h.season}</td><td>${TEAM_BY_ID[h.teamId].name}</td><td>${h.pos}º</td><td>${h.points}</td></tr>`).join('')}</table>` : ''}`, {
      back: () => this.g.showMenu(),
      race: () => this.g.startWeekend({ trackId: next.id, driverId: st.driverId, laps: st.laps, difficulty: st.difficulty, weather: st.weather, formationLap: false, practice: false, qualiMin: 6, mode: 'career', playerName: st.player, teamOverrides: st.teamOverrides, teamPerf: st.teamPerf }),
      abandon: () => { if (confirm('¿Borrar la trayectoria?')) { Season.clearChamp('career'); this.g.showMenu(); } },
    });
  }

  careerSeasonEnd(st) {
    const table = Season.driverTable(st);
    const pos = table.findIndex(r => r.isPlayer) + 1;
    const offers = Season.careerOffers(st.reputation);
    this.cfg = { teamId: st.teamId };
    this.show(`<h2><small>Fin de la temporada ${st.season}</small>Terminaste ${pos}º en el campeonato</h2>
      ${this.standingsHtml(st, `${st.player.first} ${st.player.last}`)}
      <h3>Ofertas para la próxima temporada</h3>
      <div class="grid-teams">${[{ teamId: st.teamId, goal: { text: 'Renovar con tu equipo actual' } }, ...offers.filter(o => o.teamId !== st.teamId)].map(o => { const t = TEAM_BY_ID[o.teamId]; return `<button class="team${o.teamId === st.teamId ? ' sel' : ''}" data-team="${t.id}"><span class="sw" style="background:${hex(t.colors.primary)}"></span><span><b>${t.name}</b><span>${o.goal.text}</span></span></button>`; }).join('')}</div>
      <div class="actions"><button class="cta" data-act="go">Firmar y empezar la temporada ${st.season + 1}</button></div>`, {
      go: () => {
        Season.careerEndSeason(st);
        Season.careerNewSeason(st, { teamId: this.cfg.teamId || st.teamId });
        Season.saveChamp(st);
        this.careerHub(st);
      },
    });
  }

  // ---------- garaje ----------
  garage() {
    const s = this.g.settings;
    const cfg = this.cfg = { ...DEFAULT_SETUP, ...(s.setup || {}), driverId: s.lastDriver || 'ibarra' };
    cfg.teamId = DRIVER_BY_ID[cfg.driverId].team;
    this.g.garage.setTeam(TEAM_BY_ID[cfg.teamId], DRIVER_BY_ID[cfg.driverId]);
    const sl = (key, label, min, max, step, left, right) => `<div class="field"><label>${label}: <b data-out="${key}">${cfg[key]}</b></label><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${cfg[key]}"><span class="info">${left} ↔ ${right}</span></div>`;
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Garaje</small>Reglaje y equipo</h2>
      <h3>Auto</h3>${this.driverGrid(cfg.driverId)}
      <h3>Reglaje (se aplica a todas las sesiones)</h3>
      <div class="rowf sliders">
        ${sl('frontWing', 'Alerón delantero', 1, 11, 1, 'menos carga', 'más carga')}
        ${sl('rearWing', 'Alerón trasero', 1, 11, 1, 'más velocidad', 'más agarre')}
        ${sl('brakeBias', 'Reparto de frenada %', 50, 62, 1, 'atrás', 'adelante')}
        ${sl('diff', 'Diferencial %', 50, 100, 5, 'abierto', 'bloqueado')}
        ${sl('frontARB', 'Barra delantera', 1, 11, 1, 'blanda', 'dura')}
        ${sl('rearARB', 'Barra trasera', 1, 11, 1, 'blanda', 'dura')}
        ${sl('brakeDucts', 'Toma de frenos', 1, 5, 1, 'cerrada', 'abierta')}
        ${sl('pressure', 'Presión de gomas', -3, 3, 1, 'baja', 'alta')}
      </div>
      <p class="info">Más alerón = más agarre en curva pero menos velocidad punta. Reparto hacia adelante = más estable al frenar. Barra delantera dura = más subviraje.</p>
      <div class="actions"><button class="cta" data-act="save">Guardar reglaje</button><button class="cta ghost" data-act="reset">Valores por defecto</button></div>`, {
      back: () => this.g.showMenu(),
      change: (k) => { if (k === 'driver') { this.g.garage.setTeam(TEAM_BY_ID[cfg.teamId], DRIVER_BY_ID[cfg.driverId]); s.lastDriver = cfg.driverId; } },
      save: () => { const { driverId, teamId, ...setup } = cfg; s.setup = setup; Store.save('settings', s); this.g.toast('Reglaje guardado'); },
      reset: () => { s.setup = { ...DEFAULT_SETUP }; Store.save('settings', s); this.garage(); },
    });
    this.g.showScreen('panel');
    this.body.classList.add('narrow');
    document.getElementById('panel').style.background = 'linear-gradient(90deg, rgba(5,6,9,0.94) 0 48%, rgba(5,6,9,0) 62%)';
  }

  // ---------- configuración ----------
  settings(tab = 'graficos') {
    const s = this.g.settings;
    this.cfg = s;
    const chk = (key, label) => `<label class="field" style="flex-direction:row;gap:8px;align-items:center;min-width:220px"><input type="checkbox" data-key="${key}" ${s[key] !== false ? 'checked' : ''}> ${label}</label>`;
    const range = (key, label, min = 0, max = 1, step = 0.05) => `<div class="field"><label>${label}: <b data-out="${key}">${Math.round((s[key] ?? 0) * 100)}%</b></label><input type="range" data-key="${key}" data-fmt="pct" min="${min}" max="${max}" step="${step}" value="${s[key] ?? 0}"></div>`;
    let body = '';
    if (tab === 'graficos') {
      body = `<div class="rowf"><div class="field"><label>Calidad gráfica</label>${this.seg('quality', [['bajo', 'Baja'], ['medio', 'Media'], ['alto', 'Alta'], ['ultra', 'Ultra']], s.quality)}</div></div>
        <div class="rowf" style="margin-top:14px">${chk('dynamicRes', 'Resolución dinámica')}${chk('shadows', 'Sombras dinámicas')}${chk('post', 'Post-proceso (bloom, AO, SMAA)')}${chk('showFps', 'Mostrar FPS')}</div>
        <p class="info">Ultra activa oclusión ambiental y sombras 4K. El trazado de rayos no está disponible en WebGL; los reflejos usan mapas de entorno en tiempo real.</p>`;
    } else if (tab === 'audio') {
      body = `<div class="rowf sliders">${range('volMaster', 'General')}${range('volEngine', 'Motor')}${range('volSfx', 'Efectos')}${range('volAmb', 'Ambiente y público')}${range('volVoice', 'Voces (relato y radio)')}</div>
        <div class="rowf" style="margin-top:14px">${chk('commentary', 'Relatores')}${chk('radio', 'Radio del ingeniero')}${chk('voice', 'Voz sintetizada')}${chk('subtitles', 'Subtítulos del relato')}${chk('voiceAny', 'Usar voz aunque no haya voz en español')}</div>
        <p class="info">Voces disponibles en español: ${this.g.voices.hasSpanish ? 'sí' : 'no (se muestran los subtítulos)'}. Para mejor calidad instalá voces "es-AR" o "es-MX" en tu sistema.</p>
        <div class="actions"><button class="cta small ghost" data-act="testvoice">Probar relato</button></div>`;
    } else if (tab === 'controles') {
      const keys = { ...DEFAULT_KEYS, ...(s.keys || {}) };
      const names = { throttle: 'Acelerar', brake: 'Frenar', left: 'Izquierda', right: 'Derecha', gearUp: 'Subir marcha', gearDown: 'Bajar marcha', drs: 'DRS', limiter: 'Limitador', camera: 'Cámara', lookBack: 'Mirar atrás', box: 'Pedir box', mfd: 'Menú estrategia', ers: 'Modo ERS', reset: 'Volver a pista', pause: 'Pausa' };
      const w = s.wheel || {};
      body = `<div class="rowf"><div class="field"><label>Dispositivo</label>${this.seg('device', [['auto', 'Teclado / mando'], ['wheel', 'Volante']], s.device)}</div>
        <div class="field"><label>Sensibilidad dirección: <b data-out="steerSens">${s.steerSens}</b></label><input type="range" data-key="steerSens" min="0.5" max="1.8" step="0.1" value="${s.steerSens}"></div>
        <div class="field"><label>Curva del stick: <b data-out="padCurve">${s.padCurve}</b></label><input type="range" data-key="padCurve" min="1" max="2.5" step="0.1" value="${s.padCurve}"></div>
        ${chk('vibration', 'Vibración del mando')}</div>
        <h3>Volante (Gamepad API)</h3>
        <p class="info">Mové solo el control indicado después de tocar cada botón. Estado: ${navigator.getGamepads && [...navigator.getGamepads()].some(Boolean) ? 'dispositivo detectado' : 'conectá el volante y presioná un botón'}.</p>
        <div class="actions" style="margin-top:6px"><button class="cta small ghost" data-act="cal" data-w="steer">Calibrar dirección (eje ${w.steer ? w.steer.axis : '—'})</button>
        <button class="cta small ghost" data-act="cal" data-w="throttle">Calibrar acelerador (eje ${w.throttle ? w.throttle.axis : '—'})</button>
        <button class="cta small ghost" data-act="cal" data-w="brake">Calibrar freno (eje ${w.brake ? w.brake.axis : '—'})</button></div>
        <h3>Teclado (tocá una acción y después la tecla nueva)</h3>
        <table class="res">${Object.entries(names).map(([k, n]) => `<tr><td>${n}</td><td>${keys[k].map(c => `<span class="kbd">${c.replace('Key', '').replace('Arrow', '')}</span>`).join('')}</td><td><button class="cta small ghost" data-act="bind" data-k="${k}">Cambiar</button></td></tr>`).join('')}</table>
        <p class="info">Mando: gatillo derecho acelera, izquierdo frena, RB/LB cambios, A = DRS, X = limitador, Y = cámara, B = mirar atrás, Start = pausa, Back = estrategia.</p>
        <div class="actions"><button class="cta small ghost" data-act="resetkeys">Restaurar teclas</button></div>`;
    } else if (tab === 'ayudas') {
      body = `<div class="rowf">${chk('abs', 'ABS')}${chk('tc', 'Control de tracción')}${chk('stability', 'Ayuda de estabilidad')}${chk('autoGear', 'Cambios automáticos')}${chk('racingLine', 'Línea de trazada ideal')}${chk('pitAssist', 'Entrada a boxes asistida (B)')}</div>`;
    } else if (tab === 'juego') {
      const diffs = Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]);
      body = `<div class="rowf"><div class="field"><label>Dificultad por defecto</label>${this.seg('difficulty', diffs, s.difficulty)}</div>
        <div class="field"><label>Desgaste y consumo</label>${this.seg('wearMode', [['reducido', 'Reducido'], ['proporcional', 'Proporcional'], ['real', 'Real']], s.wearMode)}</div>
        <div class="field"><label>Unidades</label>${this.seg('units', [['kmh', 'km/h'], ['mph', 'mph']], s.units)}</div></div>
        <div class="rowf" style="margin-top:14px">${chk('failures', 'Fallas mecánicas')}</div>
        <p class="info">"Proporcional" escala desgaste y combustible al largo de la carrera para que la estrategia sea como en una carrera completa.</p>`;
    }
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Configuración</small>${{ graficos: 'Gráficos', audio: 'Audio', controles: 'Controles', ayudas: 'Ayudas', juego: 'Juego' }[tab]}</h2>
      <div class="tabs">${[['graficos', 'Gráficos'], ['audio', 'Audio'], ['controles', 'Controles'], ['ayudas', 'Ayudas'], ['juego', 'Juego']].map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>
      ${body}`, {
      back: () => { Store.save('settings', s); this.g.applySettings(); this.g.backFromSettings(); },
      tab: (t) => { Store.save('settings', s); this.g.applySettings(); this.settings(t); },
      change: () => { Store.save('settings', s); if (tab === 'graficos') this.g.applySettings(); },
      input: () => { Store.save('settings', s); this.g.audio.applyVolumes(); },
      testvoice: () => { this.g.voices.say('relator', '¡Se apagan los semáforos y arranca el Gran Premio!', 9); setTimeout(() => this.g.voices.say('comentarista', 'Los neumáticos medios ya están mostrando desgaste.', 5), 300); },
      cal: (btn) => {
        const which = btn.dataset.w;
        if (!this.g.input.startCalibration(which)) { alert('No se detecta ningún volante o mando. Conectalo y presioná un botón.'); return; }
        btn.textContent = 'Mové el control…';
        const poll = () => {
          const r = this.g.input.pollCalibration();
          if (r) { s.wheel = { ...(s.wheel || {}), [r.which]: { axis: r.axis, invert: r.invert } }; s.device = 'wheel'; Store.save('settings', s); this.settings('controles'); }
          else requestAnimationFrame(poll);
        };
        poll();
      },
      bind: (btn) => {
        const k = btn.dataset.k;
        btn.textContent = 'Presioná una tecla…';
        const h = (ev) => { ev.preventDefault(); window.removeEventListener('keydown', h, true); s.keys = { ...(s.keys || {}), [k]: [ev.code] }; Store.save('settings', s); this.settings('controles'); };
        window.addEventListener('keydown', h, true);
      },
      resetkeys: () => { s.keys = {}; Store.save('settings', s); this.settings('controles'); },
    });
  }

  // ---------- repeticiones ----------
  async replays() {
    const list = await Store.listReplays();
    const mem = this.g.lastReplay;
    this.show(`<button class="back" data-act="back">← Volver</button>
      <h2><small>Repeticiones</small>Volvé a ver tus sesiones</h2>
      ${mem ? `<h3>Última sesión</h3><div class="actions" style="margin-top:0"><button class="cta small" data-act="playmem">▶ ${esc(mem.title)}</button><button class="cta small ghost" data-act="savemem">Guardar</button></div>` : ''}
      <h3>Guardadas</h3>
      ${list.length ? `<table class="res"><tr><th>Sesión</th><th>Fecha</th><th>Duración</th><th></th></tr>${list.map(r => `<tr><td>${esc(r.title)}</td><td>${new Date(r.date).toLocaleString('es-AR')}</td><td>${Math.round(r.duration / 60)} min</td><td><button class="cta small" data-act="play" data-id="${r.id}">Ver</button> <button class="cta small ghost" data-act="del" data-id="${r.id}">Borrar</button></td></tr>`).join('')}</table>` : '<p class="info">Todavía no guardaste repeticiones. Al terminar una sesión podés verla o guardarla desde la pantalla de resultados.</p>'}`, {
      back: () => this.g.showMenu(),
      playmem: () => this.g.playReplay(mem),
      savemem: async () => { await Store.saveReplay(mem); this.g.toast('Repetición guardada'); this.replays(); },
      play: async (b) => { const r = await Store.getReplay(b.dataset.id); if (r) this.g.playReplay(r); },
      del: async (b) => { await Store.deleteReplay(b.dataset.id); this.replays(); },
    });
  }

  // ---------- pausa y resultados ----------
  pause(session) {
    const race = session.type === 'race';
    const p = session.player;
    this.show(`<div class="overlay-center"><div class="pause-box"><h2>Pausa</h2>
      <button data-act="resume">▶ Continuar</button>
      <button data-act="restart">↺ Reiniciar sesión</button>
      ${race && p && !p.retired && !p.finished ? '<button data-act="retire">⚑ Abandonar la carrera</button>' : ''}
      ${!race ? '<button data-act="end">⏹ Terminar sesión</button>' : ''}
      ${race && p && (p.retired || p.finished) ? '<button data-act="ff">⏩ Simular hasta el final</button>' : ''}
      <button data-act="settings">⚙ Configuración</button>
      <button data-act="menu">✕ Salir al menú</button>
      <p class="info" style="margin-top:10px">Teclas: <span class="kbd">C</span> cámara <span class="kbd">V</span> atrás <span class="kbd">M</span> estrategia <span class="kbd">X</span> ERS <span class="kbd">L</span> limitador <span class="kbd">R</span> volver a pista <span class="kbd">[ ]</span> otro auto</p>
      </div></div>`, {
      resume: () => this.g.resume(),
      restart: () => this.g.restart(),
      retire: () => { this.g.session.retire(this.g.session.player, 'abandono del piloto', false); this.g.resume(); },
      end: () => { this.g.resume(); this.g.endSessionNow(); },
      ff: () => { this.g.resume(); this.g.fastForward = true; },
      settings: () => { this.g.settingsFromPause = true; this.settings(); },
      menu: () => this.g.quitToMenu(),
    });
    $('panel').style.background = 'rgba(5,6,9,0.6)';
  }

  results(session, ctx) {
    const res = session.results;
    const race = session.type === 'race';
    const rows = res.map(r => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${r.pos}</td><td><span class="bar" style="background:${hex(r.color)}"></span>${esc(r.name)}${r.fastest && race ? ' <span class="pill fl">VR</span>' : ''}</td><td>${r.team}</td>
      ${race ? `<td>${r.grid}</td><td>${r.laps}</td><td>${r.stops}</td>` : ''}<td>${fmtTime(r.best)}</td><td>${r.gap}${r.penalty ? ` <span style="color:#ff6060">(+${r.penalty}s)</span>` : ''}</td>${race ? `<td><b>${r.points || ''}</b></td>` : ''}</tr>`).join('');
    const me = res.find(r => r.isPlayer);
    const title = race ? (me ? (me.retired ? 'Abandonaste' : `Terminaste ${me.pos}º`) : 'Resultados') : (me ? `Posición ${me.pos}` : 'Resultados');
    this.show(`<h2><small>${session.track.meta.gp} · ${race ? 'Carrera' : session.type === 'quali' ? 'Clasificación' : session.type === 'practice' ? 'Entrenamientos' : 'Contrarreloj'}</small>${title}</h2>
      ${race ? `<p class="info">Vuelta más rápida: <span class="fl">${session.fastestLap.car ? esc(session.fastestLap.car.fullName) + ' · ' + fmtTime(session.fastestLap.time) : '—'}</span></p>` : ''}
      <div class="actions" style="margin-top:6px">${ctx.next ? `<button class="cta" data-act="next">${ctx.nextLabel || 'Continuar'}</button>` : ''}
      ${race && res.length >= 3 ? '<button class="cta ghost" data-act="podium">Ver podio</button>' : ''}
      <button class="cta ghost" data-act="replay">Ver repetición</button><button class="cta ghost" data-act="save">Guardar repetición</button>
      <button class="cta ghost" data-act="restart">Repetir</button><button class="cta ghost" data-act="menu">Menú principal</button></div>
      <table class="res" style="margin-top:18px"><tr><th>Pos</th><th>Piloto</th><th>Equipo</th>${race ? '<th>Larg.</th><th>Vueltas</th><th>Paradas</th>' : ''}<th>Mejor vuelta</th><th>${race ? 'Tiempo/Dif.' : 'Diferencia'}</th>${race ? '<th>Pts</th>' : ''}</tr>${rows}</table>`, {
      next: () => ctx.next(),
      podium: () => this.g.showPodium(),
      replay: () => this.g.playReplay(this.g.lastReplay),
      save: async () => { const ok = await Store.saveReplay(this.g.lastReplay); this.g.toast(ok ? 'Repetición guardada' : 'No se pudo guardar (almacenamiento no disponible)'); },
      restart: () => this.g.restart(),
      menu: () => this.g.quitToMenu(),
    });
    $('panel').style.background = 'rgba(5,6,9,0.88)';
  }
}
