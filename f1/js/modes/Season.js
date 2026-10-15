// Campeonato y modo trayectoria: calendario, puntos, tablas de pilotos y constructores,
// desarrollo de los autos durante la temporada, ofertas de contrato y reputación.

import { TRACKS } from '../data/tracks.js';
import { TEAMS, DRIVERS, TEAM_BY_ID, DRIVER_BY_ID, POINTS } from '../data/teams.js';
import * as Store from '../core/Storage.js';

export function newChampionship({ trackIds, laps, difficulty, weather, teamId, driverId }) {
  const st = {
    kind: 'championship', created: Date.now(), calendar: trackIds.slice(), round: 0, laps, difficulty, weather,
    teamId, driverId, drivers: {}, teams: {}, results: [], teamOverrides: {},
  };
  for (const d of DRIVERS) st.drivers[d.id] = 0;
  for (const t of TEAMS) st.teams[t.id] = 0;
  return st;
}

export function applyRace(st, results) {
  for (const r of results) {
    st.drivers[r.id] = (st.drivers[r.id] || 0) + r.points;
    const teamId = r.teamId;
    st.teams[teamId] = (st.teams[teamId] || 0) + r.points;
  }
  st.results.push({ trackId: st.calendar[st.round], podium: results.slice(0, 3).map(r => r.name), player: results.find(r => r.isPlayer)?.pos });
  st.round++;
  // desarrollo de los autos a lo largo de la temporada (pequeñas mejoras aleatorias)
  st.teamPerf = st.teamPerf || {};
  for (const t of TEAMS) {
    const cur = st.teamPerf[t.id] || { car: t.car, aero: t.aero, power: t.power };
    const dev = (Math.random() - 0.35) * 0.006;
    cur.car = Math.min(1.02, cur.car + dev);
    cur.aero = Math.min(1.02, cur.aero + dev * 0.8);
    cur.power = Math.min(1.02, cur.power + dev * 0.5);
    st.teamPerf[t.id] = cur;
  }
  return st;
}

export function driverTable(st, playerName) {
  return Object.entries(st.drivers).map(([id, pts]) => {
    const d = DRIVER_BY_ID[id];
    const isPlayer = id === st.driverId;
    const teamId = st.teamOverrides?.[id] || d.team;
    return { id, name: isPlayer && playerName ? playerName : `${d.first} ${d.last}`, team: TEAM_BY_ID[teamId].name, color: TEAM_BY_ID[teamId].colors.primary, pts, isPlayer };
  }).sort((a, b) => b.pts - a.pts);
}

export function teamTable(st) {
  return Object.entries(st.teams).map(([id, pts]) => ({ id, name: TEAM_BY_ID[id].name, color: TEAM_BY_ID[id].colors.primary, pts, isPlayer: id === st.teamId }))
    .sort((a, b) => b.pts - a.pts);
}

export function finished(st) { return st.round >= st.calendar.length; }

// ---------------- trayectoria ----------------
export function careerOffers(reputation) {
  // equipos ordenados por rendimiento; la reputación abre puertas
  const sorted = TEAMS.slice().sort((a, b) => a.car - b.car);
  const n = Math.max(3, Math.min(10, Math.round(3 + reputation * 7)));
  const pool = sorted.slice(0, n);
  return pool.slice(-3).reverse().map(t => ({ teamId: t.id, salary: Math.round(1 + t.car * 9 + reputation * 6), goal: goalFor(t) }));
}

function goalFor(team) {
  const rank = TEAMS.slice().sort((a, b) => b.car - a.car).findIndex(t => t.id === team.id);
  if (rank <= 1) return { text: 'Pelear por el campeonato', pos: 3 };
  if (rank <= 4) return { text: 'Terminar entre los cinco primeros', pos: 6 };
  if (rank <= 7) return { text: 'Sumar puntos con regularidad', pos: 11 };
  return { text: 'Superar a tu compañero de equipo', pos: 15 };
}

export function newCareer({ first, last, num, nat, teamId }) {
  const team = TEAM_BY_ID[teamId];
  // el jugador reemplaza al piloto con menos ritmo del equipo
  const mates = DRIVERS.filter(d => d.team === teamId).sort((a, b) => a.skill.pace - b.skill.pace);
  const seat = mates[0];
  const st = newChampionship({ trackIds: TRACKS.map(t => t.id), laps: 5, difficulty: 'normal', weather: 'aleatorio', teamId, driverId: seat.id });
  Object.assign(st, {
    kind: 'career', player: { first, last, num, nat }, season: 1, reputation: 0.15, contract: { teamId, seasons: 1, goal: goalFor(team) },
    history: [], titles: 0, wins: 0, podiums: 0, races: 0,
  });
  return st;
}

export function careerAfterRace(st, results) {
  applyRace(st, results);
  const me = results.find(r => r.isPlayer);
  if (me) {
    st.races++;
    if (me.pos === 1) st.wins++;
    if (me.pos <= 3) st.podiums++;
    const goal = st.contract.goal.pos;
    st.reputation = Math.max(0, Math.min(1, st.reputation + (goal - me.pos) * 0.006 + (me.pos === 1 ? 0.03 : 0)));
  }
  return st;
}

export function careerEndSeason(st) {
  const table = driverTable(st);
  const pos = table.findIndex(r => r.isPlayer) + 1;
  st.history.push({ season: st.season, teamId: st.teamId, pos, points: st.drivers[st.driverId] });
  if (pos === 1) st.titles++;
  return { pos, offers: careerOffers(st.reputation) };
}

export function careerNewSeason(st, offer) {
  // cambio de equipo: el jugador toma el asiento del piloto más lento del nuevo equipo
  const prevSeat = st.driverId;
  const teamId = offer.teamId;
  const mates = DRIVERS.filter(d => (st.teamOverrides[d.id] || d.team) === teamId && d.id !== prevSeat).sort((a, b) => a.skill.pace - b.skill.pace);
  if (teamId !== st.teamId && mates.length) {
    const swap = mates[0];
    // intercambio de asientos
    st.teamOverrides[swap.id] = st.teamId;
    st.teamOverrides[prevSeat] = teamId;
  }
  st.teamId = teamId;
  st.contract = { teamId, seasons: 1, goal: goalFor(TEAM_BY_ID[teamId]) };
  st.season++;
  st.round = 0;
  st.results = [];
  for (const k in st.drivers) st.drivers[k] = 0;
  for (const k in st.teams) st.teams[k] = 0;
  st.teamPerf = {};
  return st;
}

export const saveChamp = st => Store.save(st.kind, st);
export const loadChamp = kind => Store.load(kind, null);
export const clearChamp = kind => Store.remove(kind);
