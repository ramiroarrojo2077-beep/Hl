import { listarRutinas, buscarBot, type Horario, type Rutina } from "./almacen.ts";

const MINUTOS_MINIMOS = 5;
const CADA_MS = 20_000;
export const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export interface HorarioCrudo {
  tipo: string;
  minutos?: number | null;
  hora?: string | null;
  dia?: number | null;
}

// Valida un horario que viene de la interfaz o del modelo. Tira un Error con un mensaje para mostrar.
export function normalizarHorario(h: HorarioCrudo): Horario {
  const hora = (h.hora ?? "").trim();
  const horaValida = /^([01]?\d|2[0-3]):[0-5]\d$/.test(hora);
  const horaNormal = horaValida ? hora.padStart(5, "0") : "";
  switch (h.tipo) {
    case "intervalo": {
      const minutos = Math.round(Number(h.minutos));
      if (!Number.isFinite(minutos) || minutos < MINUTOS_MINIMOS) {
        throw new Error(`El intervalo tiene que ser de al menos ${MINUTOS_MINIMOS} minutos.`);
      }
      return { tipo: "intervalo", minutos };
    }
    case "diaria":
      if (!horaValida) throw new Error('La hora tiene que tener el formato "HH:MM".');
      return { tipo: "diaria", hora: horaNormal };
    case "semanal": {
      const dia = Number(h.dia);
      if (!Number.isInteger(dia) || dia < 0 || dia > 6) throw new Error("El día tiene que ser de 0 (domingo) a 6 (sábado).");
      if (!horaValida) throw new Error('La hora tiene que tener el formato "HH:MM".');
      return { tipo: "semanal", dia, hora: horaNormal };
    }
    default:
      throw new Error('El tipo de horario tiene que ser "intervalo", "diaria" o "semanal".');
  }
}

export function describirHorario(h: Horario): string {
  if (h.tipo === "intervalo") return h.minutos % 60 === 0 ? `cada ${h.minutos / 60} h` : `cada ${h.minutos} min`;
  if (h.tipo === "diaria") return `todos los días a las ${h.hora}`;
  return `todos los ${DIAS[h.dia]} a las ${h.hora}`;
}

// Próxima ejecución en hora local del servidor, a partir de la última (o de cuando se creó).
export function proximaEjecucion(r: Rutina): Date {
  const base = new Date(r.ultimaEjecucion ?? r.creada);
  const h = r.horario;
  if (h.tipo === "intervalo") return new Date(base.getTime() + h.minutos * 60_000);
  const [hh, mm] = h.hora.split(":").map(Number);
  const candidata = new Date(base);
  candidata.setHours(hh!, mm!, 0, 0);
  while (candidata <= base || (h.tipo === "semanal" && candidata.getDay() !== h.dia)) {
    candidata.setDate(candidata.getDate() + 1);
  }
  return candidata;
}

// Revisa cada 20 segundos qué rutinas tocan. Una rutina atrasada (servidor apagado) corre una sola vez.
export function iniciarProgramador(ejecutar: (r: Rutina) => void): void {
  const revisar = () => {
    const ahora = new Date();
    for (const r of listarRutinas()) {
      if (!r.activa || !buscarBot(r.botId)) continue;
      if (r.ejecuciones[0]?.estado === "en_curso") continue;
      if (proximaEjecucion(r) <= ahora) ejecutar(r);
    }
  };
  setInterval(revisar, CADA_MS).unref();
  revisar();
}
