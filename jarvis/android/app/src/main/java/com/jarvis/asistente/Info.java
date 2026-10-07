package com.jarvis.asistente;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

/** Datos del panel y de las herramientas: clima (Open-Meteo), noticias (Google Noticias) y estado del celular. Caché de 15 min. */
final class Info {
    private Info() {}

    /**
     * Mismo JSON que la versión de PC: {lugar, actualizado, actual:{temperatura, sensacion, humedad, precipitacion, viento,
     * esDeDia, estado, icono}, salidaSol, puestaSol, dias:[{fecha, maxima, minima, lluvia, estado, icono}]}.
     * icono ∈ sol|parcial|nube|niebla|llovizna|lluvia|nieve|tormenta.
     * @param ciudad null o vacío = Ajustes.CIUDAD; si tampoco hay, ubicación aproximada por IP (https://ipwho.is/?lang=es).
     */
    static JSONObject clima(Context c, String ciudad) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    /** [{titulo, fuente, url, fecha}] del RSS de Google Noticias para Ajustes.PAIS (hl=es-419). tema vacío = portada. */
    static JSONArray noticias(Context c, String tema, int cantidad) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    /**
     * {cpu:-1 (Android no lo deja leer), nucleos, ram:{total, libre}, disco:{unidad:"Interno", total, libre},
     * encendidoSeg, equipo (marca y modelo), ip (local, o "" si no hay red), plataforma ("Android 15"),
     * bateria:{nivel 0-100, cargando}}.
     */
    static JSONObject sistema(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }
}
