// Un auto en la sesión (jugador o IA): estado de carrera, cronometraje y estado mecánico.

export class Entrant {
  constructor({ driver, team, isPlayer = false, index }) {
    this.driver = driver;
    this.team = team;
    this.isPlayer = isPlayer;
    this.index = index;
    this.name = driver.last;
    this.fullName = `${driver.first} ${driver.last}`;
    this.code = driver.last.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').slice(0, 3).toUpperCase();
    // posición en pista
    this.s = 0; this.d = 0; this.v = 0;
    this.x = 0; this.y = 0; this.z = 0; this.heading = 0;
    this.pitch = 0; this.roll = 0; this.steerVis = 0; this.yawOffset = 0;
    this.wheelRot = 0; this.ax = 0; this.ay = 0;
    this.lap = 0; // vueltas completas
    this.progress = 0; // lap * L + s
    this.position = index + 1;
    this.gridPosition = index + 1;
    // estado
    this.compound = 'medium';
    this.tyreAge = 0; // vueltas
    this.wear = 0; this.tyreTemp = 80;
    this.usedCompounds = new Set();
    this.fuel = 20;
    this.damage = { frontWing: 0, rearWing: 0, floor: 0 };
    this.failure = null;
    this.retired = false; this.retireReason = '';
    this.finished = false; this.finishTime = 0; this.finishOrder = 0;
    this.inPit = false; this.pitPhase = null; this.pitStops = 0; this.pitRequest = false; this.pitCompound = null;
    this.pitLaneLoss = 0;
    this.penaltySec = 0; this.penalties = []; this.warnings = { trackLimits: 0, sc: 0 };
    this.serveAtStop = 0;
    // cronometraje
    this.lapStart = 0; this.lapTimes = []; this.bestLap = Infinity; this.lastLap = 0;
    this.sectorTimes = [null, null, null]; this.bestSectors = [Infinity, Infinity, Infinity];
    this.sectorStart = 0; this.sector = 0;
    this.lapValid = true;
    this.loopTimes = null; // tiempos por bucle de cronometraje
    this.drsEligible = false; this.drsOpen = false;
    this.interval = 0; this.gapLeader = 0;
    this.spinTimer = 0; this.offTimer = 0; this.stoppedTimer = 0;
    this.lastOvertakeT = -99;
    this.retiredOnTrack = false;
    this.slipstream = 0; this.dirtyAir = 0;
    this.lockFx = 0; this.sparkFx = 0; this.smokeFx = 0;
    this.blue = false;
    this.lapsLed = 0;
  }

  get totalTime() { return this.finishTime + this.penaltySec; }
}
