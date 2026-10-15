// F1 Ultra Realistic — punto de entrada. Orquesta menús, carga de circuitos, sesiones
// (carrera, clasificación, prácticas, contrarreloj), fin de semana de GP, campeonato,
// trayectoria, repeticiones, podio y el bucle principal de render/simulación/audio.

import * as THREE from 'three';
import { World } from './render/World.js';
import { TrackScene } from './render/TrackScene.js';
import { CarViews } from './render/CarViews.js';
import { CarModel } from './render/CarModel.js';
import { CameraRig, CAM_LABEL } from './render/CameraRig.js';
import { GarageScene, PodiumScene } from './render/Scenes.js';
import { Track } from './core/Track.js';
import { Session, fmtTime } from './core/Session.js';
import { basePerf } from './core/AIDriver.js';
import { ReplayRecorder, ReplayPlayer } from './core/Replay.js';
import * as Store from './core/Storage.js';
import { TRACK_BY_ID } from './data/tracks.js';
import { TEAM_BY_ID, DRIVER_BY_ID, COMPOUNDS } from './data/teams.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Voices, Commentary, Radio } from './audio/Commentary.js';
import { Input } from './input/Input.js';
import { HUD } from './ui/HUD.js';
import { Screens, tip, drawTrackThumb } from './ui/Screens.js';
import * as Season from './modes/Season.js';
import { INGENIERO, COMPOUND_SPOKEN } from './data/phrases.js';

const $ = id => document.getElementById(id);
const GEAR_TOP = [92, 132, 168, 203, 238, 272, 306, 342].map(k => k / 3.6);

class Game {
  constructor() {
    this.settings = Store.loadSettings();
    this.world = new World($('gl'), this.settings);
    this.input = new Input(this.settings);
    this.audio = new AudioEngine(this.settings);
    this.hud = new HUD(this.settings);
    this.voices = new Voices(this.settings, this.hud);
    this.voices.audio = this.audio;
    this.rig = new CameraRig(this.world.camera, $('gl'));
    this.rig.mode = this.settings.camera || 'chase';
    this.screens = new Screens(this);
    this.garage = new GarageScene(this.world);
    this.podium = new PodiumScene(this.world);
    this.tracks = new Map();
    this.state = 'boot';
    this.t = 0;
    this.specIdx = 0;
    this.bindUI();
    this.garage.setTeam(TEAM_BY_ID[DRIVER_BY_ID[this.settings.lastDriver || 'ibarra'].team], DRIVER_BY_ID[this.settings.lastDriver || 'ibarra']);
    this.garage.enter();
    this.last = performance.now();
    requestAnimationFrame(t => this.loop(t));
  }

  // ---------- UI básica ----------
  bindUI() {
    $('bootStart').addEventListener('click', () => { this.audio.start(); this.voices.pick(); this.showMenu(); });
    $('menuList').addEventListener('click', e => {
      const b = e.target.closest('[data-go]');
      if (!b) return;
      this.audio.start();
      const go = b.dataset.go;
      if (this.screens[go]) this.screens[go]();
    });
    $('pauseBtn').addEventListener('click', () => this.pause());
    $('mfd').addEventListener('click', e => this.onMfd(e));
    window.addEventListener('keydown', e => {
      if (this.state !== 'session') return;
      if (e.code === 'BracketRight') this.spectate(1);
      if (e.code === 'BracketLeft') this.spectate(-1);
    });
    // controles táctiles
    const touch = $('touch');
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.touchOn = isTouch && this.settings.touch !== 'off';
    for (const b of touch.querySelectorAll('button')) {
      const k = b.dataset.t;
      const on = v => e => { e.preventDefault(); this.input.touch[k] = v; b.classList.toggle('down', v); };
      b.addEventListener('pointerdown', on(true)); b.addEventListener('pointerup', on(false));
      b.addEventListener('pointerleave', on(false)); b.addEventListener('pointercancel', on(false));
    }
    this.bindReplayUI();
  }

  showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
    if (id !== 'panel') $('panel').style.background = '';
    if (id === 'hud') $('panel').style.background = '';
  }

  toast(text) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = text; t.classList.add('show');
    clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  showMenu() {
    this.state = 'menu';
    this.leaveTrack();
    this.voices.clear();
    this.audio.silence();
    if (!this.garage.active) this.garage.enter();
    const drv = DRIVER_BY_ID[this.settings.lastDriver || 'ibarra'];
    this.garage.setTeam(TEAM_BY_ID[drv.team], drv);
    const champ = Season.loadChamp('championship'), career = Season.loadChamp('career');
    let card = `<h4>Equipo</h4><div class="big">${TEAM_BY_ID[drv.team].name}</div><div class="info">${drv.first} ${drv.last} · #${drv.num}</div>`;
    if (career) card += `<h4 style="margin-top:10px">Trayectoria</h4><div>${career.player.first} ${career.player.last} · temporada ${career.season}, carrera ${Math.min(career.round + 1, career.calendar.length)}</div>`;
    if (champ && !Season.finished(champ)) card += `<h4 style="margin-top:10px">Campeonato</h4><div>Carrera ${champ.round + 1} de ${champ.calendar.length}</div>`;
    $('menuCard').innerHTML = card;
    this.showScreen('menu');
  }

  applySettings() {
    const s = this.settings;
    if (s.quality !== this.world.quality || this._post !== s.post || this._shadows !== s.shadows) {
      this._post = s.post; this._shadows = s.shadows;
      this.world.applyQuality(s.quality);
    }
    this.audio.applyVolumes();
    if (this.session?.phys) {
      const ph = this.session.phys;
      ph.assists = { abs: s.abs, tc: s.tc, stability: s.stability };
      ph.autoGear = s.autoGear;
    }
    if (this.lineMesh) this.lineMesh.visible = !!s.racingLine;
  }

  backFromSettings() {
    if (this.settingsFromPause) { this.settingsFromPause = false; this.screens.pause(this.session); return; }
    this.showMenu();
  }

  // ---------- carga de circuitos ----------
  getTrack(id) {
    if (!this.tracks.has(id)) this.tracks.set(id, new Track(TRACK_BY_ID[id]));
    return this.tracks.get(id);
  }

  async loadTrackScene(trackId) {
    const meta = TRACK_BY_ID[trackId];
    if (this.trackScene && this.trackScene.track.id === trackId && this.trackScene.q === this.settings.quality) {
      if (!this.trackScene.group.parent) this.world.scene.add(this.trackScene.group);
      return this.trackScene;
    }
    this.showScreen('loading');
    $('loadTrack').textContent = `${meta.flag} ${meta.fullName}`;
    $('loadGp').textContent = meta.gp;
    $('loadTip').textContent = tip();
    drawTrackThumb($('loadMap'), trackId, '#ffffff');
    $('loadBar').style.width = '0%';
    await new Promise(r => setTimeout(r, 30));
    const track = this.getTrack(trackId);
    if (this.trackScene) this.disposeTrackScene();
    const ts = new TrackScene(track, this.settings.quality);
    await ts.build((f, label) => { $('loadBar').style.width = (f * 100).toFixed(0) + '%'; $('loadStep').textContent = label; });
    this.trackScene = ts;
    this.world.scene.add(ts.group);
    return ts;
  }

  disposeTrackScene() {
    const g = this.trackScene.group;
    this.world.scene.remove(g);
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) m.dispose();
    });
    this.trackScene = null;
  }

  leaveTrack() {
    if (this.carViews) { this.world.scene.remove(this.carViews.group); this.carViews = null; }
    if (this.trackScene && this.trackScene.group.parent) this.world.scene.remove(this.trackScene.group);
    if (this.lineMesh) { this.world.scene.remove(this.lineMesh); this.lineMesh = null; }
    if (this.ghost) { this.world.scene.remove(this.ghost.model.root); this.ghost = null; }
    if (this.replayCars) { for (const m of this.replayCars) this.world.scene.remove(m.root); this.replayCars = null; }
    this.podium.exit();
    this.session = null;
    this.world.rain.update(0, { x: 0, y: 0, z: 0 }, 0);
  }

  // ---------- sesiones ----------
  async startSession(cfg) {
    this.lastCfg = cfg;
    this.state = 'loading';
    this.voices.clear();
    this.audio.silence();
    this.garage.exit();
    if (this.carViews) { this.world.scene.remove(this.carViews.group); this.carViews = null; }
    if (this.lineMesh) { this.world.scene.remove(this.lineMesh); this.lineMesh = null; }
    if (this.ghost) { this.world.scene.remove(this.ghost.model.root); this.ghost = null; }
    this.podium.exit();
    const ts = await this.loadTrackScene(cfg.trackId);
    const track = ts.track;
    const s = this.settings;
    const champ = cfg.mode === 'championship' ? Season.loadChamp('championship') : cfg.mode === 'career' ? Season.loadChamp('career') : null;
    const session = new Session(track, {
      type: cfg.type, laps: cfg.laps, minutes: cfg.minutes, difficulty: cfg.difficulty || s.difficulty, weather: cfg.weather || 'seco',
      playerDriverId: cfg.driverId, playerName: cfg.playerName || (champ?.player) || null,
      formationLap: !!cfg.formationLap, grid: cfg.grid, aiCount: cfg.type === 'timetrial' ? 0 : cfg.aiCount,
      assists: { abs: s.abs, tc: s.tc, stability: s.stability, autoGear: s.autoGear },
      wearMode: s.wearMode, failures: s.failures, setup: s.setup, startCompound: cfg.startCompound,
      teamOverrides: cfg.teamOverrides || champ?.teamOverrides, teamPerf: cfg.teamPerf || champ?.teamPerf,
    });
    this.session = session;
    this.world.setAtmosphere(track.meta.env, session.rain, true);
    ts.setWetness(session.wetness);
    this.carViews = new CarViews(this.world, session, ts, s);
    this.rig.tvCams = ts.tvCams;
    this.rig.first = true;
    this.hud.attach(session, track);
    this.commentary = new Commentary(session, this.voices, s);
    this.radio = new Radio(session, this.voices, this.hud);
    this.recorder = new ReplayRecorder(session);
    this.resultsShown = false;
    this.fastForward = false;
    this.specIdx = 0;
    this.hookEvents(session);
    if (s.racingLine) this.buildRacingLine(track, session);
    if (cfg.type === 'timetrial' && cfg.ghost) this.setupGhost(track, session);
    this.t = 0;
    this.state = 'session';
    this.showScreen('hud');
    $('touch').classList.toggle('hidden', !this.touchOn);
    const meta = track.meta;
    this.hud.notice(meta.gp, `${meta.fullName} · ${{ race: `${session.laps} vueltas`, quali: 'Clasificación', practice: 'Entrenamientos', timetrial: 'Contrarreloj' }[cfg.type]}`, 3.5);
    if (cfg.type === 'race' && !cfg.formationLap) setTimeout(() => this.radio.say('lights', {}, 5), 800);
  }

  async startWeekend(cfg) {
    this.weekend = { cfg, steps: [...(cfg.practice ? ['practice'] : []), 'quali', 'race'], i: 0, grid: null };
    this.runWeekendStep();
  }

  runWeekendStep() {
    const w = this.weekend, c = w.cfg;
    const step = w.steps[w.i];
    const base = { mode: c.mode, trackId: c.trackId, driverId: c.driverId, difficulty: c.difficulty, weather: c.weather, playerName: c.playerName, teamOverrides: c.teamOverrides, teamPerf: c.teamPerf, weekend: true };
    if (step === 'practice') this.startSession({ ...base, type: 'practice', minutes: 10, aiCount: 19 });
    if (step === 'quali') this.startSession({ ...base, type: 'quali', minutes: c.qualiMin || 8 });
    if (step === 'race') this.startSession({ ...base, type: 'race', laps: c.laps, formationLap: c.formationLap, grid: w.grid });
  }

  hookEvents(session) {
    session.on((type, d) => {
      if (session !== this.session) return;
      const p = session.player;
      const mine = d.car && d.car === p;
      switch (type) {
        case 'light': this.audio.lightBeep(); break;
        case 'lights_out': this.audio.cheer(); this.audio.tone({ freq: 660, dur: 0.25, gain: 0.08 }); break;
        case 'overtake': if (d.car.position <= 3 || mine || d.victim === p) this.audio.cheer(); break;
        case 'penalty': if (mine) this.hud.notice('PENALIZACIÓN', `+${d.sec} s · ${d.reason}`, 3); break;
        case 'track_limits': if (mine) this.hud.notice('LÍMITES DE PISTA', `Advertencia ${d.count} de 3`, 2.2); break;
        case 'lap_invalid': if (mine) this.hud.notice('VUELTA ANULADA', 'Límites de pista', 2); break;
        case 'lap_complete':
          if (mine && session.type !== 'race') this.hud.notice(fmtTime(d.time), d.valid ? (p.bestLap === d.time ? 'MEJOR VUELTA PERSONAL' : '') : 'VUELTA ANULADA', 2.5);
          if (mine && session.type === 'timetrial') this.onTimeTrialLap(d);
          if (mine && this.ghost) this.ghost.rec = [];
          break;
        case 'sc_deployed': this.hud.notice('SAFETY CAR', 'Prohibido adelantar', 3); break;
        case 'vsc': this.hud.notice('VIRTUAL SAFETY CAR', 'Respetá el delta', 3); break;
        case 'red_flag': this.hud.notice('BANDERA ROJA', 'Carrera suspendida', 4); break;
        case 'restart': case 'vsc_end': this.hud.notice('BANDERA VERDE', '', 2); break;
        case 'checkered': this.hud.notice('BANDERA A CUADROS', `Gana ${d.winner.fullName}`, 4); this.audio.cheer(); break;
        case 'finish': if (mine) this.hud.notice(`P${d.position}`, d.position === 1 ? '¡VICTORIA!' : d.position <= 3 ? '¡PODIO!' : 'Fin de la carrera', 5); break;
        case 'pit_stop': {
          const cam = this.world.camera.position;
          const dist = Math.hypot(cam.x - d.car.x, cam.z - d.car.z);
          if (dist < 90) for (let k = 0; k < 4; k++) this.audio.gun(0.5 + k * 0.05);
          break;
        }
        case 'pit_done': if (mine) this.hud.boxCall(false); break;
        case 'crash': if (mine) this.input.rumble(1, 1, 400); break;
        case 'retire': if (mine) this.hud.notice('ABANDONO', 'Pausa → simular hasta el final', 5); break;
        case 'session_end': setTimeout(() => this.showResults(), session.type === 'race' ? 3500 : 1500); break;
        case 'red_restart': this.hud.notice('NUEVA LARGADA', 'Largada detenida', 3); break;
      }
    });
  }

  // ---------- bucle ----------
  loop(now) {
    requestAnimationFrame(t => this.loop(t));
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.world.adapt(dt);
    if (this.state === 'menu' || this.state === 'boot' || (this.garage.active && this.state !== 'session')) {
      this.garage.update(dt);
      this.input.update(dt);
    } else if (this.state === 'session') {
      this.updateSession(dt);
    } else if (this.state === 'paused') {
      this.input.update(dt);
      if (this.input.state.pause) this.resume();
    } else if (this.state === 'replay') {
      this.updateReplay(dt);
    } else if (this.state === 'podium') {
      this.podium.update(dt);
      this.world.particles.update(dt);
      if (this.trackScene) this.trackScene.update(dt, this.t, { camPos: this.world.camera.position, excite: 1 });
    } else if (this.state === 'results') {
      this.updateSession(dt, true);
    }
    this.world.render();
  }

  updateSession(dt, passive = false) {
    const s = this.session;
    if (!s) return;
    const inp = this.input.update(dt);
    const st = this.settings;
    if (!passive) {
      if (inp.pause) { this.pause(); return; }
      if (inp.camera) { const m = this.rig.cycle(); this.hud.camLabel(CAM_LABEL[m]); st.camera = m; Store.save('settings', st); }
      if (inp.mfd) this.hud.toggleMfd();
      if (s.phys) {
        if (inp.ers) { s.phys.ersMode = (s.phys.ersMode + 1) % 3; this.hud.camLabel(['ERS apagado', 'ERS balanceado', 'ERS ataque'][s.phys.ersMode]); }
        if (inp.limiter) { s.phys.limiter = !s.phys.limiter; this.hud.camLabel(s.phys.limiter ? 'Limitador ON' : 'Limitador OFF'); }
        if (inp.reset) this.resetPlayer();
        if (inp.box) this.requestBox();
      }
    }
    this.rig.lookBack = !!inp.lookBack;
    const control = { ...inp, autoGear: st.autoGear };
    if (passive || !s.player || s.player.finished && s.phase === 'cooldown') control.throttle = s.player && s.player.finished ? Math.min(control.throttle, 0.4) : control.throttle;
    // entrada asistida a boxes
    if (s.player && s.player.pitRequest && st.pitAssist && !s.playerAuto && s.phase === 'race') {
      const tr = s.track;
      if (tr.wrapS(tr.pit.sIn - s.phys.s) < 60) this.autoPitEntry();
    }
    if (this.fastForward && !s.results) {
      const t0 = performance.now();
      while (!s.results && performance.now() - t0 < 35) { s.update(1 / 30, { steer: 0, throttle: 0, brake: 1 }); this.recorder.update(1 / 30); }
      this.hud.camLabel('Simulando hasta el final…');
    } else {
      s.update(dt, control);
    }
    if (s.wetness !== this._wet) { this._wet = s.wetness; this.trackScene.setWetness(s.wetness); }
    this.world.setAtmosphere(s.track.meta.env, s.rain);
    // cámara
    const target = this.cameraTarget();
    this.rig.update(dt, target, s.track);
    const cam = this.world.camera;
    this.world.focus(target.x, target.y, target.z);
    // helmet oculto en vistas interiores
    if (s.player && this.carViews) this.carViews.setHelmetVisible(s.player, !(this.rig.mode === 'cockpit' && target.isPlayer));
    this.carViews.update(dt, this.t, cam.position);
    this.trackScene.update(dt, this.t, {
      camPos: cam.position, lightsOn: s.phase === 'lights' ? s.lightsOn : 0, yellow: s.yellow, sc: s.scState !== 'none',
      excite: 0.25 + (this.audio.crowdBoost || 0) * 0.8 + (s.phase === 'finish' || s.phase === 'cooldown' ? 0.8 : 0),
      blueNear: s.player && s.player.blue ? s.player.s : null,
    });
    this.updateGhost(dt);
    this.world.particles.update(dt);
    this.world.rain.update(dt, cam.position, s.rain);
    // audio
    const ph = s.phys, p = s.player;
    let pa = null;
    if (ph && p && !p.retired) {
      pa = {
        rpm: ph.rpm, throttle: s.playerAuto ? (p.throttle || 0.3) : ph.throttleOut, speed: ph.speed, slide: s.playerAuto ? 0 : Math.max(ph.slideAmount, ph.lock.some(Boolean) ? 1 : 0),
        lock: ph.lock.some(Boolean), kerb: ph.onKerb > 0 && !s.playerAuto, offTrack: ph.offTrack, interior: this.rig.interior && target.isPlayer,
        pos: { x: ph.x, y: ph.y, z: ph.z }, shifted: ph.justShifted, shifting: ph.shiftTimer > 0.02, impact: ph.impact, ers: ph.ersMode === 2, wet: s.wetness > 0.2,
      };
      ph.justShifted = 0;
      if (ph.impact > 3) this.input.rumble(Math.min(1, ph.impact / 12), 0.5, 200);
      else if (ph.onKerb && ph.speed > 20) this.input.rumble(0.2, 0.35, 60);
    }
    const ai = [];
    for (const e of s.entrants) {
      if (e.isPlayer || (e.retired && !e.retiredOnTrack) || e.inGarage) continue;
      let g = 1; while (g < 8 && GEAR_TOP[g - 1] < e.v / 0.93) g++;
      ai.push({ x: e.x, y: e.y, z: e.z, rpm: Math.max(4500, 12300 * Math.min(1, e.v / GEAR_TOP[g - 1])), throttle: e.throttle ?? 0.6, e });
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.audio.update(dt, pa, { pos: cam.position, fwd }, ai, { crowdNear: 0.6, rain: s.rain });
    // HUD, relato y radio
    this.hud.update(dt, this);
    this.commentary.update();
    this.radio.update(dt);
    if (!this.fastForward) this.recorder.update(dt);
    if (ph && !s.playerAuto && p) {
      this._scr = (this._scr || 0) + dt;
      if (this._scr > 0.1 && this.rig.interior) {
        this._scr = 0;
        const m = this.carViews.modelOf(p);
        const lapT = s.t - p.lapStart;
        const delta = isFinite(p.bestLap) && p.lap >= 1 ? lapT - p.bestLap * (p.s / s.track.length) : 0;
        m?.drawScreen({ rpm: ph.rpm, gear: ph.gear, speed: ph.speed * 3.6, delta, battery: ph.battery / 4e6, drs: ph.drsOpen });
      }
    }
  }

  cameraTarget() {
    const s = this.session, p = s.player, ph = s.phys;
    if (p && ph && !s.playerAuto && !(p.retired && this.specIdx !== 0)) {
      return {
        x: ph.x, y: ph.y, z: ph.z, heading: ph.psi, pitch: 0, roll: -ph.ay * 0.0016, speed: ph.speed, ax: ph.ax, ay: ph.ay, s: ph.s,
        kerb: ph.onKerb, offTrack: ph.offTrack, impact: ph.impact, steer: ph.steerAngle, isPlayer: true,
      };
    }
    let e = p && !p.retired && this.specIdx === 0 ? p : null;
    if (!e) {
      const order = s.order || s.entrants;
      const live = order.filter(x => !x.retired && !x.inGarage);
      e = live[((this.specIdx % Math.max(1, live.length)) + live.length) % Math.max(1, live.length)] || order[0];
    }
    return { x: e.x, y: e.y, z: e.z, heading: e.heading, pitch: e.pitch || 0, roll: 0, speed: e.v, ax: e.ax, ay: e.ay, s: e.s, kerb: 0, offTrack: false, impact: 0, steer: e.steerVis, isPlayer: e.isPlayer };
  }

  spectate(dir) {
    this.specIdx += dir;
    this.rig.first = true;
    const s = this.session;
    const order = (s.order || s.entrants).filter(x => !x.retired && !x.inGarage);
    if (this.specIdx !== 0 && order.length) {
      const e = order[((this.specIdx % order.length) + order.length) % order.length];
      this.hud.camLabel(`Siguiendo a ${e.fullName}`);
    } else this.hud.camLabel('Tu auto');
  }

  onMfd(e) {
    const b = e.target.closest('[data-mfd]');
    if (!b || !this.session?.phys) return;
    const [k, v] = b.dataset.mfd.split(':');
    const ph = this.session.phys, p = this.session.player;
    if (k === 'comp') { p.pitCompound = v; this.hud.camLabel(`Próxima parada: ${COMPOUNDS[v].name}`); }
    if (k === 'ers') ph.ersMode = +v;
    if (k === 'mix') ph.fuelMix = +v;
    if (k === 'bias') ph.spec.brakeBias = Math.max(0.5, Math.min(0.62, ph.spec.brakeBias + (+v) * 0.01));
    if (k === 'lim') ph.limiter = !ph.limiter;
    this.hud.renderMfd();
  }

  requestBox() {
    const s = this.session, p = s.player;
    if (!p || s.type !== 'race' || p.inPit) return;
    p.pitRequest = !p.pitRequest;
    if (p.pitRequest) {
      p.pitCompound = p.pitCompound || s.suggestCompound(p);
      this.radio.say('box_now', { comp: COMPOUND_SPOKEN[p.pitCompound] }, 7);
      this.hud.boxCall(true);
    } else { this.hud.boxCall(false); this.hud.camLabel('Parada cancelada'); }
  }

  autoPitEntry() {
    const s = this.session, p = s.player, ph = s.phys;
    p.s = ph.s; p.d = ph.d; p.v = ph.speed;
    p.inPit = true; p.pitPhase = 'entry'; p.pitStoppedThisLap = true;
    s.playerAuto = true;
    s.emit('pit_in', { car: p });
  }

  resetPlayer() {
    const s = this.session, ph = s.phys, p = s.player, tr = s.track;
    if (!ph || s.playerAuto || p.retired || s.phase === 'lights') return;
    const sNow = ph.s;
    const pos = tr.pointAt(sNow, tr.sample(tr.line, sNow));
    ph.reset(pos.x, pos.z, pos.heading, pos.y);
    ph.ti = tr.idx(sNow);
    this.hud.camLabel('De vuelta en pista');
  }

  // ---------- línea ideal ----------
  buildRacingLine(track, session) {
    const team = session.player ? session.player.team : TEAM_BY_ID.papaya;
    const prof = track.speedProfile({ ...basePerf(team, session.rho), mu: 1.5 });
    const n = track.n, pos = [], col = [], idx = [];
    const p = {};
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const dv = prof.v[(k + 4) % n] - prof.v[k];
      const c = dv < -0.6 ? [1, 0.12, 0.1] : dv < 0.05 ? [1, 0.85, 0.1] : [0.2, 1, 0.35];
      for (const off of [-0.16, 0.16]) {
        track.pointAt(k * track.ds, track.line[k] + off, p);
        pos.push(p.x, p.y + 0.03, p.z); col.push(...c);
      }
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide }));
    m.renderOrder = 2;
    this.lineMesh = m;
    this.world.scene.add(m);
  }

  // ---------- contrarreloj: fantasma y récords ----------
  setupGhost(track, session) {
    const p = session.player;
    const model = new CarModel(p.team, p.driver, { lowOnly: false });
    model.root.traverse(o => {
      if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.32; o.material.depthWrite = false; o.castShadow = false; }
    });
    model.root.visible = false;
    this.world.scene.add(model.root);
    const saved = Store.load('ghost:' + track.id, null);
    this.ghost = { model, best: saved, rec: [], acc: 0 };
  }

  updateGhost(dt) {
    const g = this.ghost, s = this.session;
    if (!g || !s.player || !s.phys) return;
    const p = s.player, ph = s.phys;
    // grabar la vuelta actual a 10 Hz
    g.acc += dt;
    if (g.acc >= 0.1 && p.lap >= 0) { g.acc = 0; g.rec.push([+ph.x.toFixed(2), +ph.y.toFixed(2), +ph.z.toFixed(2), +ph.psi.toFixed(3)]); }
    if (!g.best || p.lap < 1) { g.model.root.visible = false; return; }
    const tl = s.t - p.lapStart;
    const k = tl * 10, i = Math.floor(k);
    const a = g.best.pts[i], b = g.best.pts[i + 1];
    if (!a || !b) { g.model.root.visible = false; return; }
    const f = k - i;
    let dh = b[3] - a[3]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    g.model.root.visible = true;
    g.model.update({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, heading: a[3] + dh * f, pitch: 0, roll: 0, steer: 0, wheelRot: tl * 40, compound: 'soft' }, dt, this.t);
  }

  onTimeTrialLap(d) {
    const s = this.session, tr = s.track, p = s.player;
    if (!d.valid) return;
    const recs = Store.load('records', {});
    if (!recs[tr.id] || d.time < recs[tr.id].time) {
      recs[tr.id] = { time: d.time, driver: p.fullName, date: Date.now() };
      Store.save('records', recs);
      this.hud.notice('¡NUEVO RÉCORD!', fmtTime(d.time), 3);
    }
    if (this.ghost && (!this.ghost.best || d.time < this.ghost.best.time)) {
      this.ghost.best = { time: d.time, pts: this.ghost.rec.slice() };
      Store.save('ghost:' + tr.id, this.ghost.best);
    }
  }

  // ---------- pausa / resultados ----------
  pause() {
    if (this.state !== 'session') return;
    this.state = 'paused';
    this.audio.silence();
    if (this.voices.synth) this.voices.synth.pause();
    this.screens.pause(this.session);
  }

  resume() {
    if (!this.session) return;
    this.state = 'session';
    if (this.voices.synth) this.voices.synth.resume();
    this.showScreen('hud');
  }

  restart() {
    this.weekendRestart = true;
    this.startSession(this.lastCfg);
  }

  quitToMenu() {
    this.weekend = null;
    this.fastForward = false;
    this.showMenu();
  }

  endSessionNow() {
    const s = this.session;
    if (!s) return;
    if (s.type === 'race') return;
    if (s.type === 'quali' || s.type === 'practice') s.simulateRemaining();
    else s.endSession();
  }

  showResults() {
    const s = this.session;
    if (!s || this.resultsShown || !s.results) return;
    this.resultsShown = true;
    this.lastReplay = this.recorder.finish(`${s.track.meta.name} · ${{ race: 'Carrera', quali: 'Clasificación', practice: 'Práctica', timetrial: 'Contrarreloj' }[s.type]}`);
    this.state = 'results';
    const cfg = this.lastCfg;
    const ctx = {};
    // flujo según el modo
    if (this.weekend && cfg.weekend) {
      const w = this.weekend;
      const step = w.steps[w.i];
      if (step === 'quali') w.grid = s.results.map(r => r.id);
      if (step === 'race') this.applySeason(s);
      if (w.i < w.steps.length - 1) {
        ctx.nextLabel = w.steps[w.i + 1] === 'quali' ? 'Ir a la clasificación' : 'Ir a la carrera';
        ctx.next = () => { w.i++; this.runWeekendStep(); };
      } else {
        ctx.nextLabel = w.cfg.mode === 'championship' ? 'Ver campeonato' : w.cfg.mode === 'career' ? 'Ver trayectoria' : 'Terminar';
        ctx.next = () => { this.weekend = null; this.afterSeasonRace(w.cfg.mode); };
      }
    } else if (cfg.mode === 'championship' || cfg.mode === 'career') {
      if (s.type === 'race') this.applySeason(s);
      ctx.nextLabel = cfg.mode === 'championship' ? 'Ver campeonato' : 'Ver trayectoria';
      ctx.next = () => this.afterSeasonRace(cfg.mode);
    } else if (cfg.type === 'timetrial') {
      ctx.nextLabel = 'Seguir girando';
      ctx.next = () => this.startSession(cfg);
    }
    this._lastCtx = ctx;
    this.screens.results(s, ctx);
  }

  reshowResults() {
    this.state = 'results';
    this.screens.results(this.session, this._lastCtx || {});
  }

  applySeason(s) {
    const mode = this.lastCfg.mode;
    if (mode !== 'championship' && mode !== 'career') return;
    if (this._appliedFor === s) return;
    this._appliedFor = s;
    const st = Season.loadChamp(mode);
    if (!st) return;
    if (mode === 'career') Season.careerAfterRace(st, s.results); else Season.applyRace(st, s.results);
    Season.saveChamp(st);
  }

  afterSeasonRace(mode) {
    this.leaveTrack();
    this.garage.enter();
    this.state = 'menu';
    const st = Season.loadChamp(mode);
    if (mode === 'career') { this.screens.careerHub(st); return; }
    if (st && Season.finished(st)) {
      const table = Season.driverTable(st);
      this.screens.show(`<h2><small>Campeonato terminado</small>¡${table[0].name} es campeón!</h2>${this.screens.standingsHtml(st)}<div class="actions"><button class="cta" data-act="menu">Menú principal</button><button class="cta ghost" data-act="new">Nuevo campeonato</button></div>`, {
        menu: () => this.showMenu(), new: () => { Season.clearChamp('championship'); this.screens.championship(); },
      });
      return;
    }
    this.screens.champHub(st);
  }

  showPodium() {
    const s = this.session;
    if (!s) return;
    const top3 = s.standings().slice(0, 3);
    this.podium.build(top3, this.trackScene);
    this.podium.enter();
    this.state = 'podium';
    const hx = n => '#' + n.toString(16).padStart(6, '0');
    const order = [1, 0, 2].filter(i => top3[i]);
    this.screens.show(`<div style="position:absolute;left:0;right:0;bottom:18px;text-align:center">
      <div class="rowf" style="justify-content:center;gap:10px;margin:0 0 12px">${order.map(i => { const e = top3[i]; return `<div class="menu-card" style="min-width:190px;border-top-color:${hx(e.team.colors.primary)}"><h4>${['1º', '2º', '3º'][i]} · ${s.track.meta.gp}</h4><div class="big">${e.fullName}</div><div class="info">${e.team.name}</div></div>`; }).join('')}</div>
      <button class="cta" data-act="back">Continuar</button></div>`, {
      back: () => { this.podium.exit(); this.reshowResults(); },
    });
    $('panel').style.background = 'transparent';
    this.audio.cheer();
    this.voices.say('relator', `¡${top3[0].fullName} en lo más alto del podio! ¡Qué carrera!`, 8);
    setTimeout(() => this.voices.say('comentarista', `Gran trabajo de todo el equipo ${top3[0].team.name}.`, 4), 400);
  }

  // ---------- repeticiones ----------
  bindReplayUI() {
    const bind = (id, fn) => $(id).addEventListener('click', fn);
    bind('rpPlay', () => { if (!this.replay) return; this.replay.playing = !this.replay.playing; $('rpPlay').textContent = this.replay.playing ? '❚❚' : '▶'; });
    bind('rpSlow', () => this.replay && (this.replay.speed = 0.25));
    bind('rpHalf', () => this.replay && (this.replay.speed = 0.5));
    bind('rpNorm', () => this.replay && (this.replay.speed = 1));
    bind('rpFast', () => this.replay && (this.replay.speed = 2));
    bind('rpExit', () => this.exitReplay());
    $('rpSeek').addEventListener('input', e => { if (this.replay) this.replay.t = (+e.target.value / 1000) * this.replay.duration; });
    $('rpCar').addEventListener('change', e => { this.replayTarget = +e.target.value; this.rig.first = true; });
    $('rpCam').addEventListener('change', e => this.rig.setMode(e.target.value));
    $('rpEvents').addEventListener('click', e => {
      const b = e.target.closest('[data-t]');
      if (!b || !this.replay) return;
      this.replay.t = Math.max(0, +b.dataset.t - 3);
      if (+b.dataset.car >= 0) { this.replayTarget = +b.dataset.car; $('rpCar').value = b.dataset.car; }
    });
  }

  async playReplay(rep) {
    if (!rep) { alert('No hay repetición disponible.'); return; }
    this.replayFrom = this.state === 'results' ? 'results' : 'menu';
    this.garage.exit();
    this.voices.clear();
    this.audio.silence();
    await this.loadTrackScene(rep.trackId);
    const track = this.trackScene.track;
    this.world.setAtmosphere(track.meta.env, 0, true);
    if (this.carViews) this.carViews.group.visible = false;
    if (this.lineMesh) this.lineMesh.visible = false;
    this.replayCars = rep.entrants.map(en => {
      const m = new CarModel(TEAM_BY_ID[en.teamId], DRIVER_BY_ID[en.id] || { num: en.num, helmet: 0xffffff });
      this.world.scene.add(m.root);
      return m;
    });
    this.replay = new ReplayPlayer(rep);
    this.replayTarget = Math.max(0, rep.entrants.findIndex(e => e.isPlayer));
    this.rig.tvCams = this.trackScene.tvCams;
    this.rig.setMode('tv');
    this.replayWheel = new Array(rep.entrants.length).fill(0);
    $('replayTitle').textContent = rep.title;
    $('rpCar').innerHTML = rep.entrants.map((e, i) => `<option value="${i}" ${i === this.replayTarget ? 'selected' : ''}>${e.name}</option>`).join('');
    $('rpCam').innerHTML = ['tv', 'chase', 'tcam', 'cockpit', 'front', 'side', 'heli', 'free'].map(m => `<option value="${m}" ${m === 'tv' ? 'selected' : ''}>${CAM_LABEL[m]}</option>`).join('');
    const names = { overtake: 'Adelantamiento', crash: 'Accidente', spin: 'Trompo', sc_deployed: 'Safety Car', lights_out: 'Largada', checkered: 'Bandera a cuadros', pit_stop: 'Parada', fastest_lap: 'Vuelta rápida', contact: 'Toque', lockup: 'Bloqueo' };
    $('rpEvents').innerHTML = rep.events.slice(0, 200).map(ev => {
      const a = rep.entrants[ev.a];
      const m = Math.floor(ev.t / 60), s2 = Math.floor(ev.t % 60);
      return `<button data-t="${ev.t}" data-car="${ev.a}">${m}:${String(s2).padStart(2, '0')} · ${names[ev.type] || ev.type}${a ? ' · ' + a.code : ''}</button>`;
    }).join('');
    this.state = 'replay';
    this.showScreen('replayHud');
  }

  updateReplay(dt) {
    const r = this.replay;
    if (!r) return;
    this.input.update(dt);
    if (this.input.state.pause) { this.exitReplay(); return; }
    if (this.input.state.camera) { const m = this.rig.cycle(['tv', 'chase', 'tcam', 'cockpit', 'heli', 'free']); $('rpCam').value = m; }
    r.update(dt);
    const smp = r.sample();
    smp.cars.forEach((c, i) => {
      const m = this.replayCars[i];
      m.root.visible = !c.hidden;
      this.replayWheel[i] = (this.replayWheel[i] + c.v / 0.36 * dt * r.speed * (r.playing ? 1 : 0)) % (Math.PI * 2);
      m.update({ ...c, wheelRot: this.replayWheel[i], brakeT: c.braking ? 900 : 300 }, dt, this.t);
      const cam = this.world.camera.position;
      const dd = Math.hypot(c.x - cam.x, c.z - cam.z); m.setLOD(dd > 65 ? 2 : dd > 25 ? 1 : 0);
    });
    const c = smp.cars[this.replayTarget] || smp.cars[0];
    const tr = this.trackScene.track;
    const pr = tr.project(c.x, c.z, this._rpHint ?? -1);
    this._rpHint = pr.i;
    this.rig.update(dt, { ...c, speed: c.v, s: pr.s, kerb: 0, offTrack: false, impact: 0, ax: 0, ay: 0 }, tr);
    this.world.focus(c.x, c.y, c.z);
    this.trackScene.update(dt, this.t, { camPos: this.world.camera.position, lightsOn: smp.lights, yellow: [0, 0, 0] });
    $('rpSeek').value = Math.round((r.t / r.duration) * 1000);
    const m = Math.floor(r.t / 60), s = Math.floor(r.t % 60);
    $('rpTime').textContent = `${m}:${String(s).padStart(2, '0')} / ${Math.floor(r.duration / 60)}:${String(Math.floor(r.duration % 60)).padStart(2, '0')}`;
  }

  exitReplay() {
    if (this.replayCars) { for (const m of this.replayCars) this.world.scene.remove(m.root); this.replayCars = null; }
    this.replay = null;
    if (this.carViews) this.carViews.group.visible = true;
    if (this.lineMesh) this.lineMesh.visible = !!this.settings.racingLine;
    this.rig.setMode(this.settings.camera || 'chase');
    if (this.replayFrom === 'results' && this.session) this.reshowResults();
    else this.showMenu();
  }
}

window.addEventListener('error', e => { console.error(e.error || e.message); });
const game = new Game();
window.__game = game;
