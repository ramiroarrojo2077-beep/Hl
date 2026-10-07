package com.jarvis.asistente;

import android.content.Context;

/** El cerebro: charla con herramientas, análisis de lo que te llega, recordatorios y resumen diario. */
final class Asistente {
    private Asistente() {}

    interface AlHerramienta {
        void usando(String nombre);
    }

    /**
     * Charla con herramientas (hasta 6 vueltas), de a una conversación por vez (serializada). Usa los últimos 20
     * mensajes del historial y guarda pregunta y respuesta; emite "historial" {canal, pregunta, respuesta}.
     * @param canal "voz" | "texto" | "api".
     */
    static String chat(Context c, String texto, String canal, IA.AlTexto alTexto, AlHerramienta alHerramienta)
            throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Encola el análisis de algo que llegó (de a uno, en segundo plano) y termina en Acciones.registrarAviso. */
    static void entrante(Context c, Entrante e) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Resumen de buenos días hablado (clima, recordatorios de hoy, borradores pendientes, titulares). */
    static String resumenDelDia(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /**
     * Programa en AlarmManager la próxima alarma: el recordatorio pendiente más cercano o el resumen diario
     * (Ajustes.RESUMEN_DIARIO), lo que venga antes. La alarma la recibe {@link Alarma}.
     */
    static void programar(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Lo llama {@link Alarma}: avisa los recordatorios vencidos y, si toca, el resumen del día; después reprograma. */
    static void revisarAgenda(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }
}
