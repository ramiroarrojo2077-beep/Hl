package com.jarvis.asistente;

import android.content.Context;

/**
 * Servidor HTTP interno (solo 127.0.0.1): sirve la interfaz HUD desde los assets de la app y la misma API que la
 * versión de PC, implementada con el cerebro del celular. Toda ruta /api/ exige el token de Ajustes.tokenLocal
 * (Authorization: Bearer o ?token=), un Host 127.0.0.1/localhost y un Origin propio si viene.
 */
final class ServidorLocal {
    private ServidorLocal() {}

    /** Arranca una sola vez (idempotente). Usa el puerto 3700 o, si está ocupado, uno libre. */
    static synchronized void iniciar(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    static int puerto() {
        throw new UnsupportedOperationException("pendiente");
    }

    /** "http://127.0.0.1:PUERTO/?modo=vertical&movil=1&token=TOKEN". */
    static String url(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }
}
