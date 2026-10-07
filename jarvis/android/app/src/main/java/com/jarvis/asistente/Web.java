package com.jarvis.asistente;

import android.content.Context;

import org.json.JSONObject;

/** Búsqueda en internet y lectura de páginas. */
final class Web {
    private Web() {}

    /**
     * Tavily si hay Ajustes.TAVILY ({respuesta, resultados:[{titulo, url, resumen}]}); si no, DuckDuckGo HTML
     * (https://html.duckduckgo.com/html/?kl=ar-es&q=…, decodificando uddg=) y, si falla, la API de búsqueda de Wikipedia en español.
     */
    static JSONObject buscar(Context c, String consulta) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    /** {titulo, url, texto (máx. 8000 caracteres, sin scripts/estilos)}. Rechaza la red local (ver {@link #validarUrl}). */
    static JSONObject leerPagina(String url) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Solo http/https y nunca localhost, IPs privadas (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc/fd/fe80) ni .local. */
    static String validarUrl(String url) {
        throw new UnsupportedOperationException("pendiente");
    }
}
