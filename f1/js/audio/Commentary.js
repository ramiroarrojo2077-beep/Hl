// Relato en vivo: relator principal (emoción) + comentarista técnico (análisis) + ingeniero de radio.
// Motor de eventos conectado a la sesión: cada frase se elige según lo que realmente pasa en pista,
// con prioridades, enfriamientos y anti-repetición. Voz por síntesis del navegador (es-AR si existe)
// y subtítulos siempre.

import { RELATOR, COMENTARISTA, INGENIERO, ORDINAL, COMPOUND_SPOKEN } from '../data/phrases.js';
import { COMPOUNDS } from '../data/teams.js';

// ---------- voces ----------
export class Voices {
  constructor(settings, ui) {
    this.settings = settings;
    this.ui = ui;
    this.queue = [];
    this.current = null;
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.voices = {};
    this.pick();
    if (this.synth) this.synth.onvoiceschanged = () => this.pick();
    this.audio = null;
  }

  pick() {
    if (!this.synth) return;
    const all = this.synth.getVoices();
    const es = all.filter(v => /^es/i.test(v.lang));
    const rank = v => (/es[-_]AR/i.test(v.lang) ? 0 : /es[-_](US|MX|419|CO|CL|UY)/i.test(v.lang) ? 1 : /es[-_]ES/i.test(v.lang) ? 2 : 3) + (/google|natural|neural|online/i.test(v.name) ? -0.5 : 0);
    es.sort((a, b) => rank(a) - rank(b));
    const male = es.filter(v => /(male|hombre|jorge|diego|pablo|juan|carlos|enrique|tom[aá]s|alvaro|raul)/i.test(v.name) && !/female/i.test(v.name));
    this.voices.relator = male[0] || es[0] || null;
    this.voices.comentarista = es.find(v => v !== this.voices.relator && /(male|hombre|jorge|diego|pablo|juan|carlos|enrique)/i.test(v.name)) || es[1] || es[0] || null;
    this.voices.ingeniero = es.find(v => v !== this.voices.relator && v !== this.voices.comentarista) || es[0] || null;
    this.hasSpanish = es.length > 0;
  }

  params(role) {
    if (role === 'relator') return { rate: 1.16, pitch: 1.05 };
    if (role === 'comentarista') return { rate: 1.02, pitch: 0.82 };
    return { rate: 1.1, pitch: 0.92 };
  }

  say(role, text, prio = 3, maxAge = 6) {
    const enabled = role === 'ingeniero' ? this.settings.radio !== false : this.settings.commentary !== false;
    if (!enabled) return;
    const item = { role, text, prio, t: performance.now(), maxAge: maxAge * 1000 };
    // interrumpir si lo nuevo es mucho más importante
    if (this.current && prio >= this.current.prio + 4) {
      this.queue = this.queue.filter(q => q.prio >= prio - 1);
      this.stopCurrent();
    }
    this.queue.push(item);
    this.queue.sort((a, b) => b.prio - a.prio || a.t - b.t);
    if (this.queue.length > 4) this.queue.length = 4;
    this.next();
  }

  stopCurrent() {
    if (this.synth) this.synth.cancel();
    if (this.current?.timer) clearTimeout(this.current.timer);
    this.current = null;
  }

  next() {
    if (this.current) return;
    const now = performance.now();
    this.queue = this.queue.filter(q => now - q.t < q.maxAge);
    const item = this.queue.shift();
    if (!item) return;
    this.current = item;
    const done = () => {
      if (this.current !== item) return;
      if (item.role === 'ingeniero' && this.audio) { this.audio.radioOn(false); this.audio.radioBeep(true); }
      this.ui?.subtitle(item.role, null);
      this.current = null;
      setTimeout(() => this.next(), item.role === 'relator' ? 250 : 400);
    };
    this.ui?.subtitle(item.role, item.text);
    if (item.role === 'ingeniero' && this.audio) { this.audio.radioBeep(false); this.audio.radioOn(true); }
    const vol = this.settings.volVoice ?? 0.9;
    const useVoice = this.synth && this.settings.voice !== false && vol > 0 && (this.hasSpanish || this.settings.voiceAny);
    const est = 900 + item.text.length * 62;
    if (useVoice) {
      const u = new SpeechSynthesisUtterance(item.text.replace(/[¡¿]/g, ''));
      const v = this.voices[item.role];
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'es-AR';
      const p = this.params(item.role);
      u.rate = p.rate * (item.prio >= 8 && item.role === 'relator' ? 1.08 : 1);
      u.pitch = p.pitch * (item.prio >= 8 && item.role === 'relator' ? 1.08 : 1);
      u.volume = vol;
      u.onend = done; u.onerror = done;
      this.synth.speak(u);
      item.timer = setTimeout(done, est * 1.8 + 1500);
    } else {
      item.timer = setTimeout(done, est);
    }
  }

  clear() { this.queue = []; this.stopCurrent(); this.ui?.subtitle(null, null); }
}

// ---------- utilidades ----------
function pickFrom(bank, key, memory) {
  const list = bank[key];
  if (!list || !list.length) return null;
  const used = memory.get(key) || [];
  let options = list.map((_, i) => i).filter(i => !used.includes(i));
  if (!options.length) { options = list.map((_, i) => i).filter(i => i !== used[used.length - 1]); used.length = 0; }
  const i = options[Math.floor(Math.random() * options.length)];
  used.push(i);
  memory.set(key, used);
  return list[i];
}

export function spokenGap(g) {
  if (!isFinite(g) || g <= 0) return 'muy poco';
  if (g < 0.15) return 'nada, están pegados';
  if (g < 0.95) { const d = Math.round(g * 10); return d === 5 ? 'medio segundo' : `${['', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'][d]} décima${d > 1 ? 's' : ''}`; }
  if (g < 10) return `${g.toFixed(1).replace('.', ',')} segundos`;
  return `${Math.round(g)} segundos`;
}

export function spokenTime(t) {
  if (!isFinite(t)) return '';
  const m = Math.floor(t / 60), s = Math.floor(t - m * 60), ms = Math.round((t - Math.floor(t)) * 1000);
  return `${m} minuto${m !== 1 ? 's' : ''} ${s} con ${String(ms).padStart(3, '0')}`;
}

function fill(text, ctx) {
  return text.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] !== undefined && ctx[k] !== null ? ctx[k] : ''));
}

// ---------- relatores ----------
export class Commentary {
  constructor(session, voices, settings) {
    this.s = session;
    this.v = voices;
    this.settings = settings;
    this.mem = new Map();
    this.cool = new Map();
    this.lastAnalysis = performance.now() + 8000;
    this.trackSaid = false;
    this.gp = session.track.meta.gp.toUpperCase();
    session.on((type, d) => this.onEvent(type, d));
  }

  ctx(d = {}) {
    const s = this.s;
    const a = d.car || d.a || d.winner || d.leader;
    const b = d.victim || d.b || d.target || d.attacker || d.prev;
    return {
      a: a ? a.name : '', b: b ? b.name : '', team: a ? a.team.name : '',
      pos: a ? ORDINAL[a.position] || `puesto ${a.position}` : '', n: a ? a.position : '',
      corner: d.corner ? `la ${d.corner.name}` : 'la curva', gp: this.gp, track: s.track.meta.name,
      lap: d.lap ?? '', laps: s.laps, left: s.leader() ? Math.max(0, s.laps - s.leader().lap) : '',
      sector: d.sector ?? '', reason: d.reason || d.label || '', sec: d.sec ?? '',
      time: d.time !== undefined ? (d.time < 30 ? d.time.toFixed(1).replace('.', ',') : spokenTime(d.time)) : '',
      comp: a ? COMPOUND_SPOKEN[a.compound] || '' : '',
      ...d.extra,
    };
  }

  cooled(key, sec) {
    const now = performance.now();
    if ((this.cool.get(key) || 0) > now) return false;
    this.cool.set(key, now + sec * 1000);
    return true;
  }

  rel(key, d, prio, maxAge = 5) {
    const t = pickFrom(RELATOR, key, this.mem);
    if (t) this.v.say('relator', fill(t, this.ctx(d)), prio, maxAge);
  }
  com(key, d, prio = 2, maxAge = 9) {
    const t = pickFrom(COMENTARISTA, key, this.mem);
    if (t) this.v.say('comentarista', fill(t, this.ctx(d)), prio, maxAge);
    this.lastAnalysis = performance.now();
  }

  important(e) { return e && (e.isPlayer || e.position <= 3); }

  onEvent(type, d) {
    const s = this.s;
    const race = s.type === 'race';
    switch (type) {
      case 'formation': this.rel('formation', d, 6, 10); break;
      case 'grid_formed': this.rel('grid', d, 6, 8); break;
      case 'lights_out': this.rel('lights', d, 10, 4); setTimeout(() => this.startReport(), 9000); break;
      case 'restart_go': this.rel('restart', d, 9, 4); break;
      case 'overtake': {
        if (!race) break;
        const a = d.car, b = d.victim;
        if (b.isPlayer) { if (this.cooled('plost', 6)) this.rel('player_lost', { car: b, victim: a, extra: { a: b.name, b: a.name, pos: ORDINAL[b.position] } }, 7); break; }
        if (a.isPlayer) { if (this.cooled('pover', 3)) this.rel('player_overtake', d, 8); if (Math.random() < 0.3) setTimeout(() => this.com('after_overtake', d, 2), 2500); break; }
        if (a.position === 1) { this.rel('overtake_first', d, 8); break; }
        if (s.raceTime < 40 && a.position <= 10 && this.cooled('t1', 5)) { this.rel('overtake_turn1', d, 6); break; }
        if (a.position <= 5 && this.cooled('over', 5)) {
          this.rel(d.inside === false ? 'overtake_outside' : 'overtake', d, 6);
          if (Math.random() < 0.3) setTimeout(() => this.com('after_overtake', d, 2), 2500);
        } else if (a.position <= 12 && this.cooled('over', 9) && Math.random() < 0.35) this.rel('overtake', d, 3, 3);
        break;
      }
      case 'lockup':
        if (d.car.isPlayer || d.car.position <= 5 ? this.cooled('lock', 8) : this.cooled('lock', 20) && Math.random() < 0.3) {
          this.rel('lockup', d, d.car.isPlayer ? 5 : 4, 3);
          if (Math.random() < 0.35) setTimeout(() => this.com('after_lockup', d, 2), 2600);
        }
        break;
      case 'off_track': if ((d.car.isPlayer || d.car.position <= 8) && this.cooled('off', 8)) this.rel('off_track', d, 5, 3); break;
      case 'spin': this.rel('spin', d, 8, 4); break;
      case 'crash': this.rel('crash', d, 9, 5); setTimeout(() => this.com('after_crash', d, 3), 3500); break;
      case 'contact': if ((this.important(d.a) || this.important(d.b) || d.a.position <= 10) && this.cooled('contact', 10)) this.rel('contact', d, 6, 3); break;
      case 'retire': if (d.reason !== 'accidente') this.rel('retire', { ...d, reason: d.reason }, 6, 8); break;
      case 'mechanical': this.rel('mechanical', d, 7, 6); break;
      case 'yellow': if (this.cooled('yellow', 25)) this.rel('yellow', d, 4, 6); break;
      case 'sc_deployed': this.rel('sc', d, 9, 6); setTimeout(() => this.com('after_sc', d, 3), 4000); break;
      case 'sc_in': this.rel('sc_in', d, 7, 8); break;
      case 'restart': this.rel('restart', d, 8, 4); break;
      case 'vsc': this.rel('vsc', d, 8, 6); break;
      case 'vsc_end': this.rel('vsc_end', d, 6, 5); break;
      case 'red_flag': this.rel('red', d, 10, 8); break;
      case 'red_restart': this.rel('red_restart', d, 7, 10); break;
      case 'pit_in': if (race && (d.car.isPlayer || d.car.position <= 5) && this.cooled('pitin', 6)) this.rel('pit_in', d, 4, 5); break;
      case 'pit_done': {
        if (!race) break;
        const e = d.car;
        if (d.problem && (e.isPlayer || e.position <= 12)) this.rel('pit_stop_slow', { ...d, reason: d.problem.name }, 6, 6);
        else if (d.time < 2.35 && (e.isPlayer || e.position <= 10) && this.cooled('fastpit', 15)) this.rel('pit_stop_fast', d, 4, 6);
        if ((e.isPlayer || e.position <= 3) && Math.random() < 0.5) setTimeout(() => this.com('after_pit', d, 2), 3000);
        break;
      }
      case 'fastest_lap': if (race && d.car && (d.car.isPlayer || d.car.position <= 8 || this.cooled('fl', 60)) && s.raceTime > 120 && this.cooled('flany', 20)) this.rel('fastest_lap', d, 5, 6); break;
      case 'lap': {
        const left = s.laps - d.lap + 1;
        if (s.laps >= 8 && left <= 5 && left > 1 && this.cooled('lastlaps', 40)) this.com('last_laps', { extra: { left } }, 3);
        else if (d.lap % 3 === 0 && this.cooled('lapcall', 60)) this.rel('lap', { ...d, car: d.leader }, 2, 6);
        break;
      }
      case 'final_lap': this.rel('final_lap', d, 9, 6); break;
      case 'checkered': {
        if (d.winner.isPlayer) this.rel('player_win', { car: d.winner }, 10, 8);
        else this.rel('checkered', { car: d.winner }, 10, 8);
        break;
      }
      case 'finish': {
        const e = d.car;
        if (e.isPlayer && d.position > 1) this.rel(d.position <= 3 ? 'player_podium' : 'player_finish', { car: e, extra: { pos: ORDINAL[d.position] } }, 8, 10);
        break;
      }
      case 'rain_start': this.rel('rain_start', d, 7, 8); setTimeout(() => this.com('after_rain', d, 3), 4000); break;
      case 'rain_heavy': this.rel('rain_heavy', d, 6, 8); break;
      case 'rain_stop': this.rel('rain_stop', d, 5, 10); break;
      case 'defend': if (race && (d.car.isPlayer || d.attacker.isPlayer || d.car.position <= 3) && this.cooled('defend', 15)) this.rel('defend', { car: d.car, b: d.attacker, extra: { b: d.attacker.name } }, 4, 3); break;
      case 'penalty': if (d.car.isPlayer || d.car.position <= 10) { this.rel('penalty', d, 6, 8); if (Math.random() < 0.4) setTimeout(() => this.com('penalty', d, 2), 3000); } break;
      case 'puncture': if (d.car.isPlayer || d.car.position <= 10) this.rel('puncture', d, 7, 5); break;
      case 'drs_range': if (d.car.isPlayer || d.target.isPlayer) { if (this.cooled('drs', 25)) this.com('drs', { car: d.car }, 3, 5); } break;
      case 'lap_complete': {
        if (s.type === 'quali' && d.valid && d.car.bestLap === d.time) {
          const order = s.standings();
          const pos = order.indexOf(d.car) + 1;
          if (pos === 1 && this.cooled('pole', 8)) this.rel('quali_pole', d, 7, 6);
          else if ((pos <= 3 || d.car.isPlayer) && this.cooled('qlap', 8)) this.rel('quali_lap', { ...d, extra: { pos: ORDINAL[pos] } }, 5, 6);
        }
        break;
      }
      case 'session_flag': this.rel('session_end', d, 6, 8); break;
      case 'sector': {
        const e = d.car;
        if (e.isPlayer && d.pb && d.ob && this.cooled('secfast', 45)) this.com('sector_fast', { car: e, sector: d.sector }, 2, 5);
        break;
      }
    }
  }

  startReport() {
    if (this.s.type !== 'race') return;
    const p = this.s.player;
    if (!p) return;
    const gained = p.gridPosition - p.position;
    if (gained >= 2) this.rel('start_good', { car: p }, 5, 6);
    else if (gained <= -2) this.rel('start_bad', { car: p }, 5, 6);
  }

  // análisis periódico del comentarista técnico
  update() {
    const s = this.s;
    const now = performance.now();
    if (now - this.lastAnalysis < 22000 + Math.random() * 8000) return;
    if (this.v.current || this.v.queue.length) return;
    if (s.phase !== 'race' && s.phase !== 'session') return;
    const order = s.order || [];
    const topics = [];
    const p = s.player;
    if (s.type === 'race' && order.length > 1) {
      const lead = order[0], second = order[1];
      if (second.interval > 0.3) topics.push(() => this.com('gap_leader', { car: lead, b: second, extra: { gap: spokenGap(second.interval) } }, 2));
      // duelos
      for (let i = 1; i < Math.min(order.length, 10); i++) {
        const e = order[i];
        if (e.interval > 0 && e.interval < 0.7 && !e.inPit && !order[i - 1].inPit && (e.isPlayer || order[i - 1].isPlayer || i < 5)) {
          topics.push(() => { this.rel('battle', { car: e, b: order[i - 1], extra: { b: order[i - 1].name } }, 3, 4); this.lastAnalysis = now; });
          break;
        }
      }
      const left = s.laps - (lead.lap || 0);
      if (s.laps >= 8 && left <= 5 && left > 1) topics.push(() => this.com('last_laps', { extra: { left } }, 2));
      if (!this.stratSaid && lead.lap > 1) topics.push(() => { this.stratSaid = true; this.com('strategy', {}, 2); });
    }
    if (p) {
      if (p.wear > 0.45 && !COMPOUNDS[p.compound].wetTyre) topics.push(() => this.com('tyres_old', { car: p, extra: { age: p.tyreAge } }, 2));
      const ph = s.phys;
      if (ph && Math.max(...ph.brakeT) > 1000) topics.push(() => this.com('brakes_hot', { car: p }, 3));
      if (this.slowSector) { const sec = this.slowSector; this.slowSector = null; topics.push(() => this.com('sector_slow', { car: p, sector: sec }, 2)); }
    }
    if (s.nextRainIn() < 240 && s.rain < 0.05 && !this.rainWarned) topics.push(() => { this.rainWarned = true; this.com('weather_coming', {}, 3); });
    if (!this.trackSaid) topics.push(() => { this.trackSaid = true; this.com('track', {}, 2); });
    if (topics.length) topics[Math.floor(Math.random() * topics.length)]();
    else this.lastAnalysis = now;
  }
}

// ---------- ingeniero de carrera ----------
export class Radio {
  constructor(session, voices, ui) {
    this.s = session;
    this.v = voices;
    this.ui = ui;
    this.mem = new Map();
    this.cool = new Map();
    this.t = 0;
    this.lastLapRadio = -1;
    this.boxCalled = false;
    session.on((type, d) => this.onEvent(type, d));
  }

  cooled(key, sec) {
    const now = this.t;
    if ((this.cool.get(key) ?? -1e9) > now) return false;
    this.cool.set(key, now + sec);
    return true;
  }

  say(key, ctx = {}, prio = 6, maxAge = 10) {
    const t = pickFrom(INGENIERO, key, this.mem);
    if (!t) return;
    const text = fill(t, ctx);
    this.v.say('ingeniero', text, prio, maxAge);
    this.ui?.radio(text);
  }

  onEvent(type, d) {
    const s = this.s, p = s.player;
    if (!p) return;
    const mine = d.car === p;
    switch (type) {
      case 'formation': this.say('formation', {}, 6); break;
      case 'grid_formed': this.say('lights', {}, 5); break;
      case 'yellow': if (!mine && this.cooled('yellow', 15)) this.say('yellow', { sector: d.sector }, 6); break;
      case 'sc_deployed': {
        const plan = this.planNeedsStop();
        if (plan && p.lap < s.laps - 2) { this.say('sc_box', {}, 8); this.boxCalled = true; p.pitCompound = p.pitCompound || s.suggestCompound(p); }
        else this.say('sc', {}, 8);
        break;
      }
      case 'vsc': this.say('vsc', {}, 8); break;
      case 'restart': case 'vsc_end': this.say('restart', {}, 6); break;
      case 'rain_start': this.say('rain_now', { sector: 1 + Math.floor(Math.random() * 3) }, 7); break;
      case 'pit_done': if (mine) this.say('pit_done', { time: d.time.toFixed(1).replace('.', ','), comp: COMPOUND_SPOKEN[d.compound] }, 7); this.boxCalled = false; break;
      case 'fastest_lap': if (mine && s.type === 'race') this.say('fastest', {}, 6); break;
      case 'lap_complete':
        if (mine) {
          if (!d.valid && s.type !== 'race') this.say('invalid', {}, 6);
          else if (d.valid && p.bestLap === d.time && p.lapTimes.length > 1 && s.type !== 'race') this.say('improving', {}, 5);
        }
        break;
      case 'final_lap': if (s.type === 'race') this.say('last_lap', {}, 7); break;
      case 'finish': if (mine) {
        const n = d.position;
        this.say(n === 1 ? 'win' : n <= 3 ? 'podium' : n <= 10 ? 'points' : 'noPoints', { n }, 9, 15);
      } break;
      case 'penalty': if (mine) this.say('penalty', { sec: d.sec, reason: d.reason }, 8); break;
      case 'track_limits': if (mine) this.say('track_limits', { n: d.count }, 6); break;
      case 'puncture': if (mine) this.say('puncture', {}, 9); break;
      case 'mechanical': if (mine) this.say('mechanical', { reason: d.label }, 9); break;
      case 'retire': if (mine) this.say('retire', {}, 9); break;
      case 'crash': if (mine && this.s.phys && this.s.phys.damage.frontWing > 0.3) setTimeout(() => this.say('damage', {}, 8), 1500); break;
      case 'drs_range': if (mine && this.cooled('drs', 30)) this.say('drs', {}, 4, 4); break;
      case 'garage_out': if (mine) this.say('quali_out', {}, 5); break;
      case 'session_end':
        if (s.type === 'quali' && p) { const n = s.results.findIndex(r => r.isPlayer) + 1; this.say('quali_result', { n }, 8, 15); }
        break;
      case 'sector':
        if (mine && s.type === 'race' && !d.pb && p.bestSectors[d.sector - 1] && d.time > p.bestSectors[d.sector - 1] + 0.5 && this.cooled('slowsec', 90)) this.say('slow_sector', { sector: d.sector }, 4);
        break;
    }
  }

  planNeedsStop() {
    const s = this.s, p = s.player;
    if (s.type !== 'race' || s.laps < 5) return false;
    const dry = [...p.usedCompounds].filter(c => !COMPOUNDS[c].wetTyre);
    return p.pitStops === 0 && s.wetness < 0.1 && (dry.length < 2 || p.wear > 0.35);
  }

  // revisiones periódicas (1 vez por segundo)
  update(dt) {
    this.t += dt;
    if ((this._acc = (this._acc || 0) + dt) < 1) return;
    this._acc = 0;
    const s = this.s, p = s.player, ph = s.phys;
    if (!p || !ph || p.retired || p.finished || s.phase === 'cooldown') return;
    if (s.phase !== 'race' && s.phase !== 'session') return;
    const race = s.type === 'race';
    // neumáticos
    const avgT = ph.tyreT.reduce((a, b) => a + b) / 4;
    const comp = COMPOUNDS[ph.compound];
    if (avgT < comp.optTemp - 35 && ph.speed > 30 && this.cooled('cold', 90)) this.say('tyres_cold', {}, 4);
    if (avgT > comp.optTemp + 30 && this.cooled('hot', 60)) this.say('tyres_hot', {}, 4);
    const wear = Math.max(...ph.wear);
    if (wear > 0.85 && this.cooled('worn', 50)) this.say('tyres_worn', {}, 6);
    if (Math.max(...ph.brakeT) > 1050 && this.cooled('brakes', 60)) this.say('brakes_hot', {}, 5);
    if (ph.damage.frontWing > 0.35 && !p.inPit && this.cooled('dmg', 60)) { this.say('damage', {}, 7); p.pitCompound = p.pitCompound || s.suggestCompound(p); }
    // combustible
    if (race) {
      const lapsLeft = s.laps - p.lap - p.s / s.track.length;
      const perLap = 0.00034 * s.track.length * s.fuelScale * 0.95;
      if (ph.fuel < lapsLeft * perLap * 0.97 && lapsLeft > 0.5 && this.cooled('fuel', 80)) this.say('fuel_low', {}, 6);
    }
    // lluvia prevista
    const rin = s.nextRainIn();
    if (rin < 330 && rin > 50 && !this.rainSaid) { this.rainSaid = true; this.say('rain_soon', { min: Math.max(1, Math.round(rin / 60)) }, 6); }
    if (race && p.blue && this.cooled('blue', 20)) this.say('blue', {}, 6);
    // estrategia: llamado a boxes
    if (race && !p.inPit && !this.boxCalled) {
      const lapsLeft = s.laps - p.lap;
      const w = s.wetness;
      let call = null;
      if (w > 0.16 && !comp.wetTyre) call = w > 0.5 ? 'wet' : 'inter';
      else if (w < 0.08 && comp.wetTyre && s.rain < 0.1) call = lapsLeft < 8 ? 'soft' : 'medium';
      else if (lapsLeft > 1 && wear > 0.68 && !comp.wetTyre) call = s.suggestCompound(p);
      else if (lapsLeft >= 2 && lapsLeft <= 3 && this.planNeedsStop() && [...p.usedCompounds].filter(c => !COMPOUNDS[c].wetTyre).length < 2) call = s.suggestCompound(p);
      if (call) {
        this.boxCalled = true;
        p.pitCompound = p.pitCompound || call;
        this.ui?.boxCall(true);
        this.say('box_now', { comp: COMPOUND_SPOKEN[call] }, 8, 15);
      }
    }
    // distancias a la vuelta
    if (race && p.lap !== this.lastLapRadio && p.lap >= 1 && s.raceTime > 30) {
      this.lastLapRadio = p.lap;
      if (p.lap % 2 === 0) {
        const order = s.order;
        const i = order.indexOf(p);
        const ahead = order[i - 1], behind = order[i + 1];
        if (ahead && p.interval > 0 && p.interval < 1.6) this.say('push', { gap: spokenGap(p.interval) }, 5, 8);
        else if (behind && behind.interval > 0 && behind.interval < 1.0) this.say('defend', { gap: spokenGap(behind.interval), b: behind.name }, 5, 8);
        else if (ahead && p.interval > 0) this.say('gap_ahead', { gap: spokenGap(p.interval) }, 3, 8);
        else this.say('position', { n: p.position }, 3, 8);
      }
    }
  }
}
