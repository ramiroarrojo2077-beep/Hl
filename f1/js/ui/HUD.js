// HUD estilo transmisión: torre de tiempos, posición, vuelta, banderas, semáforo,
// cronómetro con sectores y delta, minimapa, tablero (velocidad/marcha/rpm/ERS/DRS),
// neumáticos y frenos, radio, subtítulos del relato, avisos y MFD.

import { fmtTime } from '../core/Session.js';
import { COMPOUNDS } from '../data/teams.js';

const $ = id => document.getElementById(id);
const hex = n => '#' + n.toString(16).padStart(6, '0');

export class HUD {
  constructor(settings) {
    this.settings = settings;
    this.el = {
      tower: $('tower'), pos: $('hudPos'), lap: $('hudLap'), flag: $('flag'), lights: $('lights'), timing: $('timing'),
      map: $('minimap'), radio: $('radio'), radioText: $('radioText'), subs: $('subs'), notice: $('notice'),
      spd: $('spd'), gear: $('gear'), rpm: $('rpmBar'), drs: $('drsInd'), ers: $('ersInd'), lim: $('limInd'), box: $('boxInd'),
      thr: $('thrBar'), brk: $('brkBar'), bat: $('batBar'), tyres: $('tyres'), mfd: $('mfd'), fps: $('fps'), cam: $('camLabel'), unit: $('spdUnit'),
    };
    this.slow = 0;
    this.subsMap = new Map();
    this.noticeT = 0;
    this.radioT = 0;
    this.camT = 0;
    this.mfdPage = -1;
  }

  attach(session, track) {
    this.s = session;
    this.track = track;
    this.mapBg = null;
    this.prepareMap();
    this.boxCall(false);
    this.el.flag.classList.add('hidden');
    this.el.lights.classList.add('hidden');
    this.el.unit.textContent = this.settings.units === 'mph' ? 'MPH' : 'KM/H';
    this.lastBest = Infinity;
    this.secState = ['', '', ''];
    this.mfdPage = -1;
    this.el.mfd.classList.add('hidden');
    this.el.subs.innerHTML = '';
    this.subsMap.clear();
  }

  prepareMap() {
    const tr = this.track, c = this.el.map;
    const W = c.width, H = c.height;
    const b = tr.bounds, sx = (b.maxX - b.minX), sz = (b.maxZ - b.minZ);
    const sc = (Math.min(W, H) - 24) / Math.max(sx, sz);
    this.mapTf = (x, z) => [W / 2 + (x - (b.minX + b.maxX) / 2) * sc, H / 2 + (z - (b.minZ + b.maxZ) / 2) * sc];
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const ctx = off.getContext('2d');
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, col] of [[9, 'rgba(0,0,0,0.65)'], [5, '#e9edf2']]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      for (let i = 0; i <= tr.n; i += 3) { const [x, y] = this.mapTf(tr.x[i % tr.n], tr.z[i % tr.n]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.stroke();
    }
    // sectores
    const secCol = ['#ff3b3b', '#1f9bff', '#ffd400'];
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = secCol[k]; ctx.lineWidth = 2.5; ctx.beginPath();
      const a = Math.round(tr.sectors[k] / tr.ds), bEnd = Math.round((k < 2 ? tr.sectors[k + 1] : tr.length) / tr.ds);
      for (let i = a; i <= bEnd; i += 3) { const [x, y] = this.mapTf(tr.x[i % tr.n], tr.z[i % tr.n]); i === a ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }
    const [sx0, sy0] = this.mapTf(tr.x[0], tr.z[0]);
    ctx.fillStyle = '#fff'; ctx.fillRect(sx0 - 4, sy0 - 4, 8, 8);
    this.mapBg = off;
  }

  speedText(ms) { return Math.round(this.settings.units === 'mph' ? ms * 2.23694 : ms * 3.6); }

  update(dt, game) {
    const s = this.s, p = s.player, ph = s.phys, el = this.el;
    // ---- cada cuadro: tablero ----
    if (p && ph) {
      const v = s.playerAuto ? p.v : ph.speed;
      el.spd.textContent = this.speedText(v);
      el.gear.textContent = ph.vx < -0.5 ? 'R' : (s.phase === 'lights' && v < 0.1 ? 'N' : ph.gear);
      const r = Math.max(0, Math.min(1, (ph.rpm - 4000) / 8300));
      el.rpm.style.width = (r * 100).toFixed(1) + '%';
      el.thr.style.width = (ph.throttleOut * 100) + '%';
      el.brk.style.width = (ph.brakeOut * 100) + '%';
      el.bat.style.width = (ph.battery / 4e6 * 100) + '%';
      el.drs.className = 'ind' + (ph.drsOpen ? ' on' : p.drsAvailable ? ' avail' : '');
      el.ers.textContent = ['ERS OFF', 'ERS', 'ERS ⚡'][ph.ersMode];
      el.ers.className = 'ind small' + (ph.ersMode === 2 ? ' on' : '');
      el.lim.classList.toggle('hidden', !(ph.limiter || (s.playerAuto && p.inPit)));
      el.lim.className = 'ind small' + ((ph.limiter || s.playerAuto) && p.inPit ? ' on' : p.inPitLaneZone ? ' warn' : '');
    }
    // semáforo
    const lights = s.phase === 'lights' ? s.lightsOn : 0;
    const showLights = s.phase === 'lights' && s.lightsTimer > -1;
    el.lights.classList.toggle('hidden', !showLights && !(this.lightsOutT > 0));
    if (showLights) [...el.lights.children].forEach((d, i) => d.classList.toggle('on', i < lights));
    if (this.prevPhase === 'lights' && s.phase === 'race') { this.lightsOutT = 1.2; [...el.lights.children].forEach(d => d.classList.remove('on')); }
    if (this.lightsOutT > 0) this.lightsOutT -= dt;
    this.prevPhase = s.phase;
    // avisos temporales
    if (this.noticeT > 0) { this.noticeT -= dt; if (this.noticeT <= 0) el.notice.classList.add('hidden'); }
    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) el.radio.classList.add('hidden'); }
    if (this.camT > 0) { this.camT -= dt; if (this.camT <= 0) el.cam.classList.add('hidden'); }
    this.drawMap(game);
    // ---- 8 veces por segundo: el resto ----
    this.slow += dt;
    if (this.slow < 0.125) return;
    this.slow = 0;
    this.updateTower();
    this.updateTop();
    this.updateTiming();
    this.updateTyres();
    if (this.mfdPage >= 0) this.renderMfd(game);
    if (this.settings.showFps) { el.fps.classList.remove('hidden'); el.fps.textContent = `${Math.round(1 / Math.max(dt, 1e-3))} FPS · res ${(game.world.pixelScale * 100).toFixed(0)}%`; }
    else el.fps.classList.add('hidden');
  }

  updateTop() {
    const s = this.s, p = s.player, el = this.el;
    const n = s.entrants.length;
    if (p) el.pos.innerHTML = `P${p.position}<small>/${n}</small>`;
    if (s.type === 'race') {
      const lead = s.order ? s.order[0] : null;
      const lap = Math.max(1, Math.min(s.laps, (p && !p.finished ? p.lap + 1 : lead ? lead.lap + 1 : 1)));
      el.lap.innerHTML = `<small>VUELTA</small>${s.phase === 'formation' ? 'FORMACIÓN' : `${lap}/${s.laps}`}`;
    } else if (s.type === 'timetrial' || s.type === 'practice') {
      el.lap.innerHTML = s.type === 'practice' && isFinite(s.sessionLength) ? `<small>RESTA</small>${this.clock(Math.max(0, s.sessionLength - s.t))}` : `<small>VUELTAS</small>${Math.max(0, p ? p.lap : 0)}`;
    } else {
      el.lap.innerHTML = `<small>RESTA</small>${this.clock(Math.max(0, s.sessionLength - s.t))}`;
    }
    // bandera
    let flag = null, cls = '';
    if (s.scState === 'sc') { flag = 'SAFETY CAR'; cls = 'sc'; }
    else if (s.scState === 'vsc') { flag = 'VIRTUAL SAFETY CAR'; cls = 'sc'; }
    else if (s.scState === 'red') { flag = 'BANDERA ROJA'; cls = 'red'; }
    else if (s.phase === 'finish' || s.phase === 'cooldown' || s.phase === 'session-end') { flag = 'BANDERA A CUADROS'; cls = 'chk'; }
    else if (p && s.yellow[s.sectorOf(p.s)] > 0) { flag = s.yellow[s.sectorOf(p.s)] > 1 ? 'DOBLE AMARILLA' : 'AMARILLA S' + (s.sectorOf(p.s) + 1); cls = 'yellow'; }
    else if (s.yellow.some(y => y > 0)) { flag = 'AMARILLA S' + (s.yellow.findIndex(y => y > 0) + 1); cls = 'yellow'; }
    else if (p && p.blue) { flag = 'BANDERA AZUL'; cls = 'blue'; }
    else if (s.phase === 'formation') { flag = 'VUELTA DE FORMACIÓN'; cls = 'green'; }
    el.flag.classList.toggle('hidden', !flag);
    if (flag) { el.flag.textContent = flag; el.flag.className = 'flag ' + cls; }
  }

  clock(t) { const m = Math.floor(t / 60), ss = Math.floor(t % 60); return `${m}:${String(ss).padStart(2, '0')}`; }

  updateTower() {
    const s = this.s;
    const order = s.order || s.standings();
    const race = s.type === 'race';
    let html = `<div class="hd"><span>${race ? 'CARRERA' : s.type === 'quali' ? 'CLASIFICACIÓN' : s.type === 'practice' ? 'PRÁCTICA' : 'CONTRARRELOJ'}</span><span>${race ? 'INT' : 'MEJOR'}</span></div>`;
    const lead = order[0];
    for (const e of order) {
      let g;
      if (race) {
        if (e.retired) g = 'OUT';
        else if (e === lead) g = s.phase === 'formation' || s.phase === 'lights' ? '' : 'LÍDER';
        else if (e.lapsDown > 0 && !e.finished) g = `+${e.lapsDown}V`;
        else g = e.interval > 0 ? '+' + e.interval.toFixed(1) : (s.raceTime < 15 ? '' : '+0.0');
      } else g = isFinite(e.bestLap) ? (e === lead ? fmtTime(e.bestLap).slice(0, 8) : '+' + (e.bestLap - lead.bestLap).toFixed(3)) : (e.inGarage ? 'BOX' : '—');
      const tags = (e.inPit && !e.inGarage ? '<span class="tag pit">PIT</span>' : '') + (s.fastestLap.car === e && race ? '<span class="tag fl">VR</span>' : '');
      html += `<div class="row${e.isPlayer ? ' me' : ''}${e.retired ? ' out' : ''}"><span class="p">${e.position}</span><span class="c" style="background:${hex(e.team.colors.primary)}"></span><span class="n">${e.code}${tags}</span><span class="g">${g}</span></div>`;
    }
    this.el.tower.innerHTML = html;
  }

  updateTiming() {
    const s = this.s, p = s.player, el = this.el;
    if (!p) { el.timing.innerHTML = ''; return; }
    const cur = p.lap >= 0 && (s.phase === 'race' || s.phase === 'session' || s.phase === 'finish' || s.phase === 'session-end') ? s.t - p.lapStart : 0;
    // delta contra la mejor vuelta propia (por fracción de vuelta)
    let delta = '';
    if (isFinite(p.bestLap) && p.lap >= 1 && cur > 3) {
      const frac = p.s / s.track.length;
      const d = cur - p.bestLap * frac;
      delta = `<span class="delta ${d < 0 ? 'neg' : 'pos'}">${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}</span>`;
    }
    const secs = [0, 1, 2].map(k => {
      const t = p.sectorTimes[k];
      if (t === null || t === undefined) return '<i></i>';
      const cls = t <= s.bestSectors[k] + 1e-3 ? 'ob' : t <= p.bestSectors[k] + 1e-3 ? 'pb' : 'sl';
      return `<i class="${cls}"></i>`;
    }).join('');
    const valid = p.lapValid ? '' : ' <span style="color:#ff5050">INVÁLIDA</span>';
    el.timing.innerHTML = `<div class="cur">${fmtTime(cur)} ${delta}</div>
      <div class="ln">Última<b>${fmtTime(p.lastLap)}</b></div>
      <div class="ln">Mejor<b>${fmtTime(p.bestLap)}</b></div>
      <div class="ln">${s.type === 'race' ? 'Vuelta rápida' : 'Pole'}<b class="fl">${fmtTime(s.type === 'race' ? s.fastestLap.time : (s.order && s.order[0] ? s.order[0].bestLap : Infinity))}</b></div>
      <div class="secs">${secs}</div>${valid}
      ${s.type === 'race' && s.order ? this.gapLines(p) : ''}
      ${p.penaltySec ? `<div class="ln">Sanción<b style="color:#ff5050">+${p.penaltySec}s</b></div>` : ''}`;
  }

  gapLines(p) {
    const order = this.s.order, i = order.indexOf(p);
    const ahead = order[i - 1], behind = order[i + 1];
    let h = '';
    if (ahead && !ahead.retired) h += `<div class="ln">↑ ${ahead.code}<b>${p.interval > 0 ? '+' + p.interval.toFixed(1) : '—'}</b></div>`;
    if (behind && !behind.retired) h += `<div class="ln">↓ ${behind.code}<b>${behind.interval > 0 ? '−' + behind.interval.toFixed(1) : '—'}</b></div>`;
    return h;
  }

  updateTyres() {
    const s = this.s, ph = s.phys, el = this.el;
    if (!ph) { el.tyres.innerHTML = ''; return; }
    const c = COMPOUNDS[ph.compound];
    const tcol = t => t < c.optTemp - 25 ? '#3a8bff' : t > c.optTemp + 25 ? '#ff3b3b' : t > c.optTemp + 12 ? '#ffb020' : '#2ee86a';
    const cell = i => `<div class="t"><div class="blk" style="border-color:${tcol(ph.tyreT[i])};background:linear-gradient(0deg, ${tcol(ph.tyreT[i])}55 ${(1 - ph.wear[i]) * 100}%, #111 0)"></div><span>${Math.round(ph.tyreT[i])}°<br><small>${Math.round(ph.wear[i] * 100)}%</small></span></div>`;
    const b = Math.round(Math.max(ph.brakeT[0], ph.brakeT[1]));
    const p = s.player;
    el.tyres.innerHTML = `<div class="hd"><span><span class="comp" style="border-color:${c.color}">${c.letter}</span> ${c.name}</span><span>${p.tyreAge} v</span></div>
      <div class="tw">${cell(0)}${cell(1)}${cell(2)}${cell(3)}</div>
      <div class="ln">Frenos<b style="color:${b > 1000 ? '#ff3b3b' : b < 250 ? '#3a8bff' : '#fff'}">${b}°C</b></div>
      <div class="ln">Combustible<b>${ph.fuel.toFixed(1)} kg</b></div>
      <div class="ln">Daños<b style="color:${ph.damage.frontWing > 0.2 ? '#ffb020' : '#fff'}">${ph.damage.frontWing > 0.6 ? 'Alerón roto' : ph.damage.frontWing > 0.2 ? 'Alerón dañado' : ph.punctured.some(Boolean) ? 'Pinchazo' : 'OK'}</b></div>`;
  }

  drawMap(game) {
    const c = this.el.map, ctx = c.getContext('2d');
    if (!this.mapBg) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this.mapBg, 0, 0);
    const s = this.s;
    for (const e of s.entrants) {
      if ((e.retired && !e.retiredOnTrack) || e.inGarage) continue;
      const x = e.isPlayer && s.phys && !s.playerAuto ? s.phys.x : e.x;
      const z = e.isPlayer && s.phys && !s.playerAuto ? s.phys.z : e.z;
      const [px, py] = this.mapTf(x, z);
      ctx.fillStyle = hex(e.team.colors.primary);
      ctx.strokeStyle = e.isPlayer ? '#fff' : '#000';
      ctx.lineWidth = e.isPlayer ? 2.5 : 1;
      ctx.beginPath(); ctx.arc(px, py, e.isPlayer ? 6 : 4, 0, 7); ctx.fill(); ctx.stroke();
    }
    const sc = s.safetyCar;
    if (sc && sc.onTrack) { const [px, py] = this.mapTf(sc.x, sc.z); ctx.fillStyle = '#ffa000'; ctx.fillRect(px - 4, py - 4, 8, 8); }
  }

  // ---- mensajes ----
  subtitle(role, text) {
    if (this.settings.subtitles === false && role !== 'ingeniero') return;
    if (role === 'ingeniero') return;
    const key = role || 'all';
    if (!text) {
      if (!role) { this.el.subs.innerHTML = ''; this.subsMap.clear(); return; }
      const d = this.subsMap.get(role);
      if (d) { d.remove(); this.subsMap.delete(role); }
      return;
    }
    let d = this.subsMap.get(key);
    if (!d) { d = document.createElement('div'); d.className = role; this.el.subs.appendChild(d); this.subsMap.set(key, d); }
    d.innerHTML = `<b>${role === 'relator' ? 'RELATOR' : 'COMENTARISTA'}</b>${text}`;
  }

  radio(text) {
    this.el.radioText.textContent = text;
    this.el.radio.classList.remove('hidden');
    this.radioT = Math.max(4, text.length * 0.07);
  }

  notice(t1, t2 = '', dur = 2.5) {
    this.el.notice.innerHTML = `<div class="t1">${t1}</div><div class="t2">${t2}</div>`;
    this.el.notice.classList.remove('hidden');
    this.noticeT = dur;
  }

  camLabel(text) { this.el.cam.textContent = text; this.el.cam.classList.remove('hidden'); this.camT = 1.5; }

  boxCall(on) { this.el.box.classList.toggle('hidden', !on); this.el.box.className = 'ind small' + (on ? ' warn' : ' hidden'); }

  // ---- MFD (estrategia, ERS, mezcla, freno) ----
  toggleMfd() {
    this.mfdPage = this.mfdPage < 0 ? 0 : -1;
    this.el.mfd.classList.toggle('hidden', this.mfdPage < 0);
    if (this.mfdPage >= 0) this.renderMfd();
  }

  renderMfd() {
    const s = this.s, p = s.player, ph = s.phys;
    if (!p || !ph) return;
    const comps = ['soft', 'medium', 'hard', 'inter', 'wet'];
    const next = p.pitCompound || s.suggestCompound(p);
    const html = `<h5>Estrategia · próxima parada</h5>
      <div class="opt">${comps.map(c => `<button data-mfd="comp:${c}" class="${c === next ? 'on' : ''}" style="color:${COMPOUNDS[c].color}">${COMPOUNDS[c].letter}</button>`).join('')}</div>
      <h5>Modo ERS</h5>
      <div class="opt">${['Apagado', 'Balanceado', 'Ataque'].map((n, i) => `<button data-mfd="ers:${i}" class="${ph.ersMode === i ? 'on' : ''}">${n}</button>`).join('')}</div>
      <h5>Mezcla de combustible</h5>
      <div class="opt">${['Pobre', 'Estándar', 'Rica'].map((n, i) => `<button data-mfd="mix:${i}" class="${ph.fuelMix === i ? 'on' : ''}">${n}</button>`).join('')}</div>
      <h5>Reparto de frenada: ${Math.round(ph.spec.brakeBias * 100)}%</h5>
      <div class="opt"><button data-mfd="bias:-1">−</button><button data-mfd="bias:1">+</button><button data-mfd="lim:0" class="${ph.limiter ? 'on' : ''}">Limitador</button></div>`;
    if (html !== this._mfdHtml) { this.el.mfd.innerHTML = html; this._mfdHtml = html; }
  }
}
