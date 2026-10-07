package com.jarvis.asistente;

import android.content.Context;

import org.json.JSONArray;

/** Lo que Jarvis puede hacer cuando le pedís algo. Enviar mensajes nunca es directo: arma un borrador que vos aprobás. */
final class Herramientas {
    private Herramientas() {}

    /** Definiciones OpenAI [{type:"function", function:{name, description, parameters?}}] de las herramientas disponibles. */
    static JSONArray definiciones(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /**
     * Ejecuta una herramienta y devuelve el resultado como texto/JSON (máx. 6000 caracteres). Nunca lanza: los errores
     * vuelven como {"error": "..."}.
     * @param textoUsuario lo último que dijo el usuario, tal cual (para la barrera de aprobación de enviar_borrador).
     */
    static String ejecutar(Context c, String nombre, String argumentosJson, String textoUsuario) {
        throw new UnsupportedOperationException("pendiente");
    }
}
