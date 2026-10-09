package com.jarvis.asistente;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Todo lo que la interfaz tiene que enterarse en vivo pasa por acá y sale por GET /api/eventos.
 * Tipos: "estado" (datos null: el servidor arma el estado completo), "activa", "aviso", "propuesta",
 * "recordatorios", "historial", "memoria".
 */
final class Eventos {
    private Eventos() {}

    interface Oyente {
        /** @param datosJson el JSON del evento ya serializado ("null" si no hay datos). */
        void evento(String tipo, String datosJson);
    }

    private static final CopyOnWriteArrayList<Oyente> oyentes = new CopyOnWriteArrayList<>();

    static void escuchar(Oyente o) {
        oyentes.add(o);
    }

    static void dejar(Oyente o) {
        oyentes.remove(o);
    }

    /** @param datos JSONObject, JSONArray o null. */
    static void emitir(String tipo, Object datos) {
        String json = datos == null ? "null" : datos.toString();
        for (Oyente o : oyentes) {
            try {
                o.evento(tipo, json);
            } catch (RuntimeException ignorada) {
            }
        }
    }
}
