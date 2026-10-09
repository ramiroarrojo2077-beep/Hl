package com.jarvis.asistente;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.AlarmClock;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.math.BigDecimal;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Lo que Jarvis puede hacer cuando le pedís algo. Enviar mensajes nunca es directo: arma un borrador que vos aprobás. */
final class Herramientas {
    private Herramientas() {}

    private static final String TAG = "JarvisHerramientas";
    private static final int MAX_RESULTADO = 6000;
    private static final Locale ARGENTINA = Locale.forLanguageTag("es-AR");
    // Un recordatorio "para dentro de un minuto" puede llegar apenas vencido por lo que tarda la IA en contestar.
    private static final long TOLERANCIA_PASADO_MS = 2 * 60_000L;

    /** Error pensado para la IA (y para decirlo en voz alta): su mensaje vuelve tal cual en {"error": "..."}. */
    private static final class Falla extends Exception {
        Falla(String mensaje) {
            super(mensaje);
        }
    }

    private interface Accion {
        Object ejecutar(Context c, JSONObject a, String textoUsuario) throws Exception;
    }

    private interface Condicion {
        boolean cumple(Context c);
    }

    private static final class Herramienta {
        final String descripcion;
        final Accion accion;
        // {nombre, tipo, descripción}; se arma un JSON nuevo en cada definiciones() para no compartir objetos mutables.
        final List<String[]> parametros = new ArrayList<>();
        final List<String> requeridos = new ArrayList<>();
        Condicion disponible;

        Herramienta(String descripcion, Accion accion) {
            this.descripcion = descripcion;
            this.accion = accion;
        }

        Herramienta parametro(String nombre, String tipo, String descripcion) {
            parametros.add(new String[] {nombre, tipo, descripcion});
            return this;
        }

        Herramienta requeridos(String... nombres) {
            Collections.addAll(requeridos, nombres);
            return this;
        }

        Herramienta si(Condicion condicion) {
            disponible = condicion;
            return this;
        }
    }

    // Se llena una sola vez al cargar la clase y después solo se lee: se puede usar desde varios hilos.
    private static final Map<String, Herramienta> HERRAMIENTAS = new LinkedHashMap<>();

    private static Herramienta agregar(String nombre, String descripcion, Accion accion) {
        Herramienta h = new Herramienta(descripcion, accion);
        HERRAMIENTAS.put(nombre, h);
        return h;
    }

    static {
        agregar("clima", "Clima actual y pronóstico de 7 días. Sin ciudad, usa la del usuario.",
                (c, a, u) -> Info.clima(c, texto(a, "ciudad")))
                .parametro("ciudad", "string", "Ciudad, opcional");

        agregar("noticias", "Titulares de noticias recientes del país del usuario, o sobre un tema.",
                (c, a, u) -> Info.noticias(c, texto(a, "tema"), 8))
                .parametro("tema", "string", "Tema a buscar, opcional");

        agregar("buscar_web", "Busca en internet información actual: precios, resultados, datos, lugares, horarios, etc.",
                (c, a, u) -> Web.buscar(c, texto(a, "consulta")))
                .parametro("consulta", "string", "Qué buscar")
                .requeridos("consulta");

        agregar("leer_pagina", "Lee el texto de una página web pública (por ejemplo, un resultado de buscar_web).",
                (c, a, u) -> Web.leerPagina(texto(a, "url")))
                .parametro("url", "string", "URL completa, con https://")
                .requeridos("url");

        agregar("calcular",
                "Calcula una expresión matemática exacta. Ej: (1500*1.21)/3, sqrt(2)^3, 15% de 2000 se escribe 2000*15/100.",
                (c, a, u) -> new JSONObject().put("resultado", Calculadora.calcular(texto(a, "expresion"))))
                .parametro("expresion", "string",
                        "Expresión con + - * / ^ ( ) y funciones sqrt, abs, round, min, max, sin, cos, log, ln")
                .requeridos("expresion");

        agregar("estado_celular", "Batería, memoria RAM, almacenamiento, red y tiempo encendido del celular del usuario.",
                (c, a, u) -> estadoCelular(c));

        agregar("recordar",
                "Guarda en la memoria permanente un dato útil sobre el usuario (gustos, datos personales, contactos, preferencias).",
                (c, a, u) -> recordar(c, texto(a, "dato")))
                .parametro("dato", "string", "El dato, en una frase")
                .requeridos("dato");

        agregar("olvidar", "Borra un dato de la memoria permanente por su id.",
                (c, a, u) -> olvidar(c, texto(a, "id")))
                .parametro("id", "string", "Id del dato")
                .requeridos("id");

        agregar("crear_recordatorio",
                "Programa un recordatorio. Jarvis avisará en voz alta en ese momento, aunque el celular esté bloqueado.",
                (c, a, u) -> crearRecordatorio(c, texto(a, "texto"), texto(a, "cuando")))
                .parametro("texto", "string", "Qué recordar")
                .parametro("cuando", "string", "Fecha y hora local en formato ISO 8601, ej: 2026-10-08T09:30:00")
                .requeridos("texto", "cuando");

        agregar("ver_recordatorios", "Lista los recordatorios pendientes.",
                (c, a, u) -> verRecordatorios(c));

        agregar("borrar_recordatorio", "Borra un recordatorio por su id.",
                (c, a, u) -> borrarRecordatorio(c, texto(a, "id")))
                .parametro("id", "string", "Id del recordatorio")
                .requeridos("id");

        agregar("leer_mensajes",
                "Lee los últimos mensajes que llegaron al celular (WhatsApp, Telegram, Instagram, SMS…) desde que Jarvis "
                        + "lee las notificaciones, de todos o de una app o persona.",
                (c, a, u) -> leerMensajes(texto(a, "filtro"), numero(a, "cantidad", 15, 50)))
                .parametro("filtro", "string", "Nombre de la persona, del grupo o de la app (ej: WhatsApp), opcional")
                .parametro("cantidad", "integer", "Cuántos, por defecto 15 (máximo 50)")
                .si(Herramientas::hayNotificaciones);

        agregar("leer_emails", "Lee los últimos mails de Gmail (de la bandeja si está conectada, o de las notificaciones de Gmail).",
                (c, a, u) -> leerEmails(c, numero(a, "cantidad", 5, 15), !esFalso(a.opt("solo_no_leidos"))))
                .parametro("cantidad", "integer", "Cuántos, por defecto 5 (máximo 15)")
                .parametro("solo_no_leidos", "boolean", "true = solo no leídos (por defecto)")
                .si(c -> hayCorreo(c) || hayNotificaciones(c));

        agregar("responder_aviso",
                "Prepara un borrador de respuesta a un mensaje (WhatsApp, Telegram, SMS…) o mail que llegó (usa el id del "
                        + "aviso). NO lo envía: queda para que el usuario lo apruebe.",
                (c, a, u) -> responderAviso(c, texto(a, "aviso_id"), texto(a, "texto")))
                .parametro("aviso_id", "string", "Id del aviso")
                .parametro("texto", "string", "Texto de la respuesta")
                .requeridos("aviso_id", "texto");

        agregar("proponer_email", "Prepara un borrador de mail nuevo. NO lo envía: queda para que el usuario lo apruebe.",
                (c, a, u) -> proponerEmail(c, texto(a, "para"), texto(a, "asunto"), texto(a, "texto")))
                .parametro("para", "string", "Dirección de correo del destinatario")
                .parametro("asunto", "string", "Asunto")
                .parametro("texto", "string", "Cuerpo del mail")
                .requeridos("para", "asunto", "texto")
                .si(Herramientas::hayCorreo);

        agregar("proponer_whatsapp",
                "Prepara un borrador de WhatsApp para una persona, un GRUPO (por su nombre, ej: 'Facu' o 'Familia') o un "
                        + "número. NO lo envía: queda para que el usuario lo apruebe. Si el chat o grupo escribió hace poco, al "
                        + "aprobarlo se manda directo.",
                (c, a, u) -> proponerWhatsapp(c, texto(a, "numero"), texto(a, "nombre"), texto(a, "texto")))
                .parametro("numero", "string",
                        "Nombre de un contacto o de un grupo (ej: Juan, Familia) o número con código de país, solo dígitos (ej: 5491112345678; en "
                                + "Argentina 549 + característica sin 0 + número sin 15)")
                .parametro("nombre", "string", "Nombre de la persona, opcional")
                .parametro("texto", "string", "Mensaje")
                .requeridos("numero", "texto");

        agregar("enviar_borrador",
                "Envía un borrador pendiente. Usala SOLO si el usuario lo pidió explícitamente en su último mensaje (ej: "
                        + "'mandala', 'sí, enviásela'). Si dijo 'mandala' sin aclarar, es el borrador más reciente.",
                (c, a, u) -> enviarBorrador(c, texto(a, "id"), texto(a, "texto"), u))
                .parametro("id", "string", "Id del borrador")
                .parametro("texto", "string", "Texto final si el usuario pidió un cambio de último momento, opcional")
                .requeridos("id");

        agregar("corregir_borrador", "Cambia el texto de un borrador pendiente según lo que pidió el usuario. No lo envía.",
                (c, a, u) -> corregirBorrador(c, texto(a, "id"), texto(a, "texto"), texto(a, "asunto")))
                .parametro("id", "string", "Id del borrador")
                .parametro("texto", "string", "Texto nuevo completo")
                .parametro("asunto", "string", "Asunto nuevo, opcional (solo mails)")
                .requeridos("id", "texto");

        agregar("descartar_borrador", "Descarta un borrador pendiente (no se envía nada).",
                (c, a, u) -> descartarBorrador(c, texto(a, "id")))
                .parametro("id", "string", "Id del borrador")
                .requeridos("id");

        agregar("abrir",
                "Abre una app del celular (WhatsApp, Spotify, YouTube, Maps, la cámara…) o una página web en el navegador.",
                (c, a, u) -> abrir(c, texto(a, "destino")))
                .parametro("destino", "string", "Nombre de la app (ej: Spotify) o URL completa con https://")
                .requeridos("destino");

        agregar("poner_alarma", "Pone una alarma en la app de reloj del celular.",
                (c, a, u) -> ponerAlarma(c, a.opt("hora"), a.opt("minutos"), texto(a, "mensaje")))
                .parametro("hora", "integer", "Hora, de 0 a 23")
                .parametro("minutos", "integer", "Minutos, de 0 a 59 (por defecto 0)")
                .parametro("mensaje", "string", "Para qué es la alarma, opcional")
                .requeridos("hora");

        agregar("poner_temporizador", "Pone un temporizador (cuenta regresiva) en la app de reloj del celular.",
                (c, a, u) -> ponerTemporizador(c, a.opt("segundos"), texto(a, "mensaje")))
                .parametro("segundos", "integer", "Duración en segundos (ej: 10 minutos = 600), hasta 24 horas")
                .parametro("mensaje", "string", "Para qué es, opcional")
                .requeridos("segundos");

        agregar("llamar",
                "Llama a un contacto o número. Si el usuario lo pidió con sus palabras ('llamá a mamá') y dio permiso de "
                        + "llamadas, llama directo; si no, abre el teléfono con el número marcado.",
                (c, a, u) -> Telefono.llamar(c, texto(a, "a_quien"), sinAcentos(u).contains("llam")))
                .parametro("a_quien", "string", "Nombre del contacto (ej: Mamá) o número de teléfono")
                .requeridos("a_quien");

        agregar("buscar_contacto", "Busca en los contactos del celular por nombre: teléfonos y mails.",
                (c, a, u) -> Telefono.buscarContactos(c, texto(a, "nombre")))
                .parametro("nombre", "string", "Nombre o parte del nombre")
                .requeridos("nombre");

        agregar("proponer_sms",
                "Prepara un SMS para un contacto o número. NO lo envía: al aprobarlo se abre la app de mensajes con el texto listo.",
                (c, a, u) -> proponerSms(c, texto(a, "a_quien"), texto(a, "texto")))
                .parametro("a_quien", "string", "Nombre del contacto o número")
                .parametro("texto", "string", "Mensaje")
                .requeridos("a_quien", "texto");

        agregar("ver_agenda",
                "Eventos del calendario del celular (el de Google incluido): hoy, mañana o los próximos días.",
                (c, a, u) -> verAgenda(c, numero(a, "dias", 1, 31), texto(a, "desde")))
                .parametro("desde", "string", "Fecha local ISO 8601 desde la que mirar (por defecto hoy)")
                .parametro("dias", "integer", "Cuántos días mirar, por defecto 1 (máximo 31)");

        agregar("crear_evento", "Crea un evento en el calendario del celular (se sincroniza con Google Calendar).",
                (c, a, u) -> crearEvento(c, texto(a, "titulo"), texto(a, "inicio"), texto(a, "fin"), texto(a, "lugar"), texto(a, "detalle")))
                .parametro("titulo", "string", "Título del evento")
                .parametro("inicio", "string", "Fecha y hora local ISO 8601, ej: 2026-10-09T15:00:00")
                .parametro("fin", "string", "Fecha y hora local de fin, opcional (por defecto 1 hora)")
                .parametro("lugar", "string", "Lugar, opcional")
                .parametro("detalle", "string", "Descripción, opcional")
                .requeridos("titulo", "inicio");

        agregar("musica", "Controla la música o el video que está sonando en el celular.",
                (c, a, u) -> Telefono.musica(c, texto(a, "accion")))
                .parametro("accion", "string", "reproducir | pausar | siguiente | anterior")
                .requeridos("accion");

        agregar("reproducir", "Busca y abre una canción, artista, playlist o video en Spotify o YouTube.",
                (c, a, u) -> Telefono.reproducir(c, texto(a, "que"), texto(a, "app")))
                .parametro("que", "string", "Qué buscar, ej: 'Soda Stereo' o 'música para concentrarse'")
                .parametro("app", "string", "spotify (por defecto) o youtube")
                .requeridos("que");

        agregar("volumen", "Sube, baja o fija el volumen de la música, o pone el celular en vibrar o con sonido.",
                (c, a, u) -> Telefono.volumen(c, texto(a, "accion"), entero(a.opt("nivel"))))
                .parametro("accion", "string", "subir | bajar | silenciar | vibrar | sonido (vacío si se usa nivel)")
                .parametro("nivel", "integer", "Volumen de la música de 0 a 100, opcional");

        agregar("linterna", "Prende o apaga la linterna del celular.",
                (c, a, u) -> Telefono.linterna(c, !esFalso(a.opt("prender"))))
                .parametro("prender", "boolean", "true = prender, false = apagar")
                .requeridos("prender");

        agregar("navegar", "Abre Google Maps navegando hacia un lugar.",
                (c, a, u) -> Telefono.navegar(c, texto(a, "destino"), texto(a, "modo")))
                .parametro("destino", "string", "Dirección o lugar")
                .parametro("modo", "string", "auto (por defecto) | caminando | bici | transporte")
                .requeridos("destino");

        agregar("camara", "Abre la cámara para sacar una foto o grabar un video.",
                (c, a, u) -> Telefono.camara(c, !esFalso(a.opt("video")) && a.has("video")))
                .parametro("video", "boolean", "true = video, por defecto foto");

        agregar("copiar", "Copia un texto al portapapeles del celular (para pegarlo en otra app).",
                (c, a, u) -> Telefono.copiar(c, texto(a, "texto")))
                .parametro("texto", "string", "Texto a copiar")
                .requeridos("texto");

        agregar("buscar_emails", "Busca mails en la bandeja de entrada por persona, asunto o palabra (ej: 'facturas', 'Juan', 'reserva').",
                (c, a, u) -> {
                    JSONArray r = Correo.buscar(c, texto(a, "consulta"), numero(a, "cantidad", 5, 15));
                    return r.length() == 0 ? new JSONObject().put("mails", r).put("nota", "No encontré mails con eso.") : r;
                })
                .parametro("consulta", "string", "Qué buscar")
                .parametro("cantidad", "integer", "Cuántos, por defecto 5 (máximo 15)")
                .requeridos("consulta")
                .si(Herramientas::hayCorreo);

        agregar("agregar_tarea", "Anota una tarea pendiente del usuario (Jarvis se la recuerda si tiene fecha y la tiene en cuenta al revisar).",
                (c, a, u) -> Autonomia.agregarTarea(c, texto(a, "texto"), texto(a, "para"), texto(a, "prioridad"), "vos"))
                .parametro("texto", "string", "La tarea, en una frase")
                .parametro("para", "string", "Fecha y hora límite local ISO 8601, opcional")
                .parametro("prioridad", "string", "alta | media | baja")
                .requeridos("texto");

        agregar("ver_tareas", "Lista las tareas pendientes (y las últimas hechas).",
                (c, a, u) -> {
                    JSONArray t = Autonomia.tareas(c, true);
                    return t.length() == 0 ? new JSONObject().put("nota", "No hay tareas.") : t;
                });

        agregar("completar_tarea", "Marca una tarea como hecha por su id.",
                (c, a, u) -> Autonomia.completarTarea(c, texto(a, "id")))
                .parametro("id", "string", "Id de la tarea")
                .requeridos("id");

        agregar("borrar_tarea", "Borra una tarea por su id.",
                (c, a, u) -> Autonomia.borrar(c, "tareas", texto(a, "id")))
                .parametro("id", "string", "Id de la tarea")
                .requeridos("id");

        agregar("crear_rutina",
                "Crea una rutina: algo que Jarvis hace sola todos los días (o ciertos días) a una hora, y después le cuenta el resultado. "
                        + "Ej: 'revisá mis mails y decime lo importante', 'buscá el precio del dólar blue', 'decime el pronóstico'.",
                (c, a, u) -> Autonomia.crearRutina(c, texto(a, "tarea"), texto(a, "hora"), texto(a, "dias")))
                .parametro("tarea", "string", "La instrucción, como se la darías a Jarvis")
                .parametro("hora", "string", "HH:MM (24 h)")
                .parametro("dias", "string", "todos | laborables | finde | días separados por coma: lun,mar,mie,jue,vie,sab,dom")
                .requeridos("tarea", "hora");

        agregar("ver_rutinas", "Lista las rutinas programadas.",
                (c, a, u) -> {
                    JSONArray r = Autonomia.rutinas(c);
                    return r.length() == 0 ? new JSONObject().put("nota", "No hay rutinas.") : r;
                });

        agregar("borrar_rutina", "Borra una rutina por su id.",
                (c, a, u) -> Autonomia.borrar(c, "rutinas", texto(a, "id")))
                .parametro("id", "string", "Id de la rutina")
                .requeridos("id");

        agregar("revisar_todo",
                "Revisa ya mismo correo, mensajes, agenda, tareas y borradores y devuelve un panorama (lo que Jarvis hace sola cada 30 minutos).",
                (c, a, u) -> new JSONObject().put("panorama", Autonomia.foto(c)));

        agregar("ajustes_celular",
                "Abre un ajuste del celular para que el usuario lo cambie (Android no deja que las apps prendan el wifi solas).",
                (c, a, u) -> Telefono.ajustes(c, texto(a, "cual")))
                .parametro("cual", "string", "wifi | bluetooth | datos | nfc | volumen | pantalla | bateria | ubicacion | no_molestar")
                .requeridos("cual");
    }

    private static String sinAcentos(String texto) {
        return java.text.Normalizer.normalize(texto == null ? "" : texto, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
    }

    private static String proponerSms(Context c, String aQuien, String texto) throws Exception {
        if (texto.isEmpty()) throw new Falla("Falta el mensaje.");
        String numero = aQuien;
        String nombre = aQuien;
        if (LETRAS.matcher(aQuien).find()) {
            JSONObject contacto = Telefono.telefonoDe(c, aQuien);
            if (contacto == null) throw new Falla("No encontré a " + aQuien + " en tus contactos, o no tiene teléfono.");
            numero = contacto.getString("numero");
            nombre = contacto.getString("nombre");
        }
        if (numero.replaceAll("\\D", "").length() < 3) throw new Falla("Ese número no parece válido.");
        JSONObject datos = new JSONObject()
                .put("canal", "sms_nuevo")
                .put("para", numero.replaceAll("[^0-9+]", ""))
                .put("paraNombre", nombre)
                .put("app", "SMS")
                .put("texto", texto)
                .put("motivo", "Pedido del usuario");
        return Acciones.describirPropuesta(c, Acciones.crearPropuesta(c, datos));
    }

    private static JSONObject verAgenda(Context c, int dias, String desdeTexto) throws Exception {
        java.util.Calendar inicio = java.util.Calendar.getInstance();
        long desde = Almacen.leerIso(desdeTexto);
        if (desde > 0) inicio.setTimeInMillis(desde);
        inicio.set(java.util.Calendar.HOUR_OF_DAY, 0);
        inicio.set(java.util.Calendar.MINUTE, 0);
        inicio.set(java.util.Calendar.SECOND, 0);
        inicio.set(java.util.Calendar.MILLISECOND, 0);
        long hasta = inicio.getTimeInMillis() + dias * 86_400_000L;
        JSONArray eventos = Telefono.agenda(c, inicio.getTimeInMillis(), hasta);
        JSONObject r = new JSONObject().put("eventos", eventos);
        if (eventos.length() == 0) r.put("nota", "No hay eventos en ese período.");
        return r;
    }

    private static JSONObject crearEvento(Context c, String titulo, String inicio, String fin, String lugar, String detalle)
            throws Exception {
        long desde = Almacen.leerIso(inicio);
        if (desde < 0) throw new Falla("No entendí la fecha del evento: usá ISO 8601, ej: 2026-10-09T15:00:00.");
        long hasta = Almacen.leerIso(fin);
        return Telefono.crearEvento(c, titulo, desde, hasta, lugar, detalle);
    }

    // ---------- Definiciones y ejecución ----------

    /** Definiciones OpenAI [{type:"function", function:{name, description, parameters?}}] de las herramientas disponibles. */
    static JSONArray definiciones(Context c) {
        return definiciones(c, null);
    }

    /** Solo las herramientas de la lista (null = todas). */
    static JSONArray definiciones(Context c, java.util.Set<String> solo) {
        JSONArray lista = new JSONArray();
        for (Map.Entry<String, Herramienta> e : HERRAMIENTAS.entrySet()) {
            Herramienta h = e.getValue();
            if (solo != null && !solo.contains(e.getKey())) continue;
            if (!disponible(c, h)) continue;
            try {
                JSONObject funcion = new JSONObject().put("name", e.getKey()).put("description", h.descripcion);
                // Gemini rechaza objetos sin propiedades, así que las herramientas sin parámetros no los declaran.
                if (!h.parametros.isEmpty()) {
                    JSONObject propiedades = new JSONObject();
                    for (String[] p : h.parametros) {
                        propiedades.put(p[0], new JSONObject().put("type", p[1]).put("description", p[2]));
                    }
                    JSONObject parametros = new JSONObject().put("type", "object").put("properties", propiedades);
                    if (!h.requeridos.isEmpty()) parametros.put("required", new JSONArray(h.requeridos));
                    funcion.put("parameters", parametros);
                }
                lista.put(new JSONObject().put("type", "function").put("function", funcion));
            } catch (JSONException ignorada) {
                // Con claves y textos fijos no pasa.
            }
        }
        return lista;
    }

    /**
     * Ejecuta una herramienta y devuelve el resultado como texto/JSON (máx. 6000 caracteres). Nunca lanza: los errores
     * vuelven como {"error": "..."}.
     * @param textoUsuario lo último que dijo el usuario, tal cual (para la barrera de aprobación de enviar_borrador).
     */
    static String ejecutar(Context c, String nombre, String argumentosJson, String textoUsuario) {
        Herramienta h = nombre == null ? null : HERRAMIENTAS.get(nombre);
        if (h == null || !disponible(c, h)) return error("No existe la herramienta " + nombre + ".");
        JSONObject args;
        try {
            args = argumentos(argumentosJson);
        } catch (JSONException e) {
            return error("Argumentos con JSON inválido.");
        }
        try {
            Object resultado = h.accion.ejecutar(c, args, textoUsuario == null ? "" : textoUsuario);
            return recortar(serializar(resultado));
        } catch (Throwable e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            String mensaje = mensajeDeError(nombre, e);
            Log.w(TAG, nombre + ": " + mensaje, e instanceof Falla ? null : e);
            return error(mensaje);
        }
    }

    private static boolean disponible(Context c, Herramienta h) {
        if (h.disponible == null) return true;
        try {
            return h.disponible.cumple(c);
        } catch (RuntimeException e) {
            // Si no se puede saber (por ejemplo, el módulo todavía no arrancó), mejor no ofrecerla.
            Log.w(TAG, "No pude ver si está disponible: " + e.getMessage());
            return false;
        }
    }

    private static boolean hayNotificaciones(Context c) {
        return Escucha.permisoConcedido(c);
    }

    private static boolean hayCorreo(Context c) {
        return Correo.configurado(c);
    }

    private static JSONObject argumentos(String json) throws JSONException {
        String t = json == null ? "" : json.trim();
        if (t.isEmpty()) return new JSONObject();
        Object valor = new JSONTokener(t).nextValue();
        if (valor instanceof JSONObject) return (JSONObject) valor;
        if (valor == null || valor == JSONObject.NULL) return new JSONObject();
        throw new JSONException("no es un objeto");
    }

    private static String serializar(Object resultado) {
        if (resultado == null) return "null";
        if (resultado instanceof String) return (String) resultado;
        // org.json de Android escribe las barras como "\/": se sacan para que las URLs ocupen menos lugar en la charla.
        // Es seguro: en la salida de org.json una barra invertida literal siempre viene duplicada.
        return resultado.toString().replace("\\/", "/");
    }

    private static String recortar(String s) {
        if (s.length() <= MAX_RESULTADO) return s;
        int corte = MAX_RESULTADO;
        if (Character.isHighSurrogate(s.charAt(corte - 1))) corte--;
        return s.substring(0, corte) + "…(recortado)";
    }

    private static String error(String mensaje) {
        try {
            return new JSONObject().put("error", mensaje).toString();
        } catch (JSONException e) {
            return "{\"error\":\"No pude completar la herramienta.\"}";
        }
    }

    private static String mensajeDeError(String nombre, Throwable e) {
        if (e instanceof NumberFormatException) return "Uno de los números no tiene un formato válido.";
        if (e instanceof Falla || e instanceof IllegalArgumentException) {
            String m = e.getMessage();
            if (m != null && !m.trim().isEmpty()) return m.trim();
        }
        if (e instanceof SecurityException) return "Android no me dio permiso para hacer eso.";
        if (e instanceof UnsupportedOperationException) return "Eso todavía no está disponible en el celular.";
        if (e instanceof InterruptedException) return "Se canceló antes de terminar.";
        if (e instanceof JSONException) return "Llegó una respuesta que no pude entender.";
        if (e instanceof Error) return "Algo falló al usar " + nombre + ".";
        String m = e.getMessage();
        return m == null || m.trim().isEmpty() ? "No pude completar " + nombre + "." : m.trim();
    }

    // ---------- Argumentos ----------

    /** Texto de un argumento, sin espacios en los bordes. Los números se aceptan también (un id "12345678" puede llegar sin comillas). */
    private static String texto(JSONObject a, String clave) {
        Object v = a.opt(clave);
        if (v instanceof String) return ((String) v).trim();
        if (v instanceof Integer || v instanceof Long) return v.toString();
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) return "";
            return new BigDecimal(v.toString()).stripTrailingZeros().toPlainString();
        }
        return "";
    }

    private static double comoNumero(Object v) {
        if (v instanceof Number) return ((Number) v).doubleValue();
        if (v instanceof Boolean) return (Boolean) v ? 1 : 0;
        if (v instanceof String) {
            String t = ((String) v).trim();
            if (t.isEmpty()) return 0;
            try {
                return Double.parseDouble(t);
            } catch (NumberFormatException e) {
                return Double.NaN;
            }
        }
        return Double.NaN;
    }

    /** Como en la PC: un entero entre 1 y máximo, o el valor por defecto si no vino o no es un número positivo. */
    private static int numero(JSONObject a, String clave, int porDefecto, int maximo) {
        double v = comoNumero(a.opt(clave));
        long n = !Double.isNaN(v) && !Double.isInfinite(v) && v > 0 ? Math.round(v) : porDefecto;
        return (int) Math.min(maximo, Math.max(1, n));
    }

    /** Solo un false explícito (o "false"/"no") lo desactiva. */
    private static boolean esFalso(Object v) {
        if (v instanceof Boolean) return !(Boolean) v;
        if (v instanceof String) {
            String t = ((String) v).trim().toLowerCase(Locale.ROOT);
            return t.equals("false") || t.equals("no");
        }
        return false;
    }

    /** Entero exacto (acepta "7" o 7.0); null si no vino o no es entero. */
    private static Integer entero(Object v) {
        if (v == null || v == JSONObject.NULL || v instanceof Boolean) return null;
        double d = comoNumero(v);
        if (Double.isNaN(d) || Double.isInfinite(d)) return null;
        if (v instanceof String && ((String) v).trim().isEmpty()) return null;
        if (d != Math.rint(d) || Math.abs(d) > Integer.MAX_VALUE) return null;
        return (int) d;
    }

    private static final Pattern MARCAS = Pattern.compile("\\p{M}+");

    /** Sin acentos, en minúsculas y sin espacios en los bordes (como normalizar() de la PC). */
    static String normalizar(String texto) {
        if (texto == null) return "";
        String sinMarcas = MARCAS.matcher(Normalizer.normalize(texto, Normalizer.Form.NFD)).replaceAll("");
        return sinMarcas.toLowerCase(Locale.ROOT).trim();
    }

    private static final Pattern LETRAS = Pattern.compile("\\p{L}");

    // ---------- Barrera de aprobación ----------

    private static final Pattern NEGACION = Pattern.compile("^(no|nunca|todavia no|espera)\\b");
    private static final Pattern APROBACION = Pattern.compile(
            "\\b(mand\\w*|envi\\w*|dale|si|ok\\w*|de una|confirm\\w*|aprob\\w*|respond\\w*|contesta\\w*|hacelo|perfecto|listo|manda)\\b");

    /**
     * Segunda barrera (la primera es la IA): un envío solo sale si el usuario lo pidió con sus palabras.
     * Así, un mail con instrucciones escondidas no puede hacer que Jarvis mande nada por su cuenta.
     */
    static boolean aproboEnvio(String textoUsuario) {
        String t = normalizar(textoUsuario);
        if (NEGACION.matcher(t).find()) return false;
        return APROBACION.matcher(t).find();
    }

    // ---------- Celular ----------

    private static JSONObject estadoCelular(Context c) throws JSONException {
        JSONObject s = Info.sistema(c);
        // Android no deja leer el uso de CPU: mejor no darle a la IA un -1 para que lo lea en voz alta.
        s.remove("cpu");
        StringBuilder resumen = new StringBuilder();
        JSONObject bateria = s.optJSONObject("bateria");
        if (bateria != null && bateria.optInt("nivel", -1) >= 0) {
            resumen.append("Batería al ").append(bateria.optInt("nivel")).append(" %")
                    .append(bateria.optBoolean("cargando") ? ", cargando" : "").append(". ");
        }
        JSONObject ram = s.optJSONObject("ram");
        if (ram != null && ram.optLong("total") > 0) {
            resumen.append("Memoria: ").append(gigas(ram.optLong("libre"))).append(" libres de ")
                    .append(gigas(ram.optLong("total"))).append(". ");
        }
        JSONObject disco = s.optJSONObject("disco");
        if (disco != null && disco.optLong("total") > 0) {
            resumen.append("Almacenamiento: ").append(gigas(disco.optLong("libre"))).append(" libres de ")
                    .append(gigas(disco.optLong("total"))).append(". ");
        }
        long encendido = s.optLong("encendidoSeg", -1);
        if (encendido >= 0) resumen.append("Encendido hace ").append(duracion(encendido)).append('.');
        String r = resumen.toString().trim();
        if (!r.isEmpty()) s.put("resumen", r);
        return s;
    }

    private static String gigas(long bytes) {
        double gb = bytes / (1024.0 * 1024 * 1024);
        return String.format(ARGENTINA, gb >= 10 ? "%.0f GB" : "%.1f GB", gb);
    }

    private static String duracion(long segundos) {
        long dias = segundos / 86400;
        long horas = segundos % 86400 / 3600;
        long minutos = segundos % 3600 / 60;
        long resto = segundos % 60;
        StringBuilder sb = new StringBuilder();
        if (dias > 0) sb.append(dias).append(dias == 1 ? " día " : " días ");
        if (horas > 0) sb.append(horas).append(" h ");
        if (minutos > 0) sb.append(minutos).append(" min ");
        if (resto > 0 && dias == 0 && horas == 0) sb.append(resto).append(" s");
        String r = sb.toString().trim();
        return r.isEmpty() ? "0 s" : r;
    }

    // ---------- Memoria ----------

    /** Copia de un arreglo vivo del Almacen (llamar con el almacén sincronizado) para emitirlo sin tener el cerrojo. */
    private static JSONArray copiar(JSONArray vivo) throws JSONException {
        return new JSONArray(vivo.toString());
    }

    private static JSONObject recordar(Context c, String dato) throws Exception {
        if (dato.isEmpty()) throw new Falla("Falta el dato.");
        Almacen almacen = Almacen.de(c);
        JSONObject nuevo = new JSONObject().put("id", Almacen.nuevoId()).put("texto", dato).put("fecha", Almacen.ahora());
        JSONObject guardado;
        JSONArray copia;
        synchronized (almacen) {
            JSONArray memoria = almacen.memoria();
            // Si ya lo sabía, no lo repite: la memoria va entera en cada charla.
            String buscado = normalizar(dato);
            for (int i = 0; i < memoria.length(); i++) {
                JSONObject d = memoria.optJSONObject(i);
                if (d != null && normalizar(d.optString("texto")).equals(buscado)) {
                    return new JSONObject().put("guardado", new JSONObject(d.toString())).put("yaLoSabia", true);
                }
            }
            guardado = new JSONObject(nuevo.toString());
            memoria.put(nuevo);
            copia = copiar(memoria);
            almacen.guardar();
        }
        Eventos.emitir("memoria", copia);
        return new JSONObject().put("guardado", guardado);
    }

    private static JSONObject olvidar(Context c, String id) throws Exception {
        if (id.isEmpty()) throw new Falla("Falta el id del dato.");
        Almacen almacen = Almacen.de(c);
        boolean borrado = false;
        JSONArray copia;
        synchronized (almacen) {
            JSONArray memoria = almacen.memoria();
            for (int i = memoria.length() - 1; i >= 0; i--) {
                JSONObject d = memoria.optJSONObject(i);
                if (d != null && id.equals(d.optString("id"))) {
                    memoria.remove(i);
                    borrado = true;
                }
            }
            if (borrado) almacen.guardar();
            copia = copiar(memoria);
        }
        Eventos.emitir("memoria", copia);
        return new JSONObject().put("borrado", borrado);
    }

    // ---------- Recordatorios ----------

    /** "jueves 8/10/2026 09:30", en la hora del celular. */
    private static String fechaLocal(long ms) {
        return new SimpleDateFormat("EEEE d/M/yyyy HH:mm", ARGENTINA).format(new Date(ms));
    }

    private static JSONObject crearRecordatorio(Context c, String que, String cuandoTexto) throws Exception {
        if (que.isEmpty()) throw new Falla("Falta qué recordar.");
        long cuando = Almacen.leerIso(cuandoTexto);
        if (cuando < 0) throw new Falla("Fecha inválida, usá ISO 8601 con fecha y hora (ej: 2026-10-08T09:30:00).");
        long ahora = System.currentTimeMillis();
        if (cuando < ahora - TOLERANCIA_PASADO_MS) {
            throw new Falla("Esa fecha ya pasó: ahora es " + fechaLocal(ahora) + ". Revisá el día y la hora.");
        }
        JSONObject recordatorio = new JSONObject()
                .put("id", Almacen.nuevoId())
                .put("texto", que)
                .put("cuando", Almacen.iso(cuando))
                .put("avisado", false);
        JSONObject creado = new JSONObject(recordatorio.toString()).put("cuando", fechaLocal(cuando));
        Almacen almacen = Almacen.de(c);
        JSONArray copia;
        synchronized (almacen) {
            almacen.recordatorios().put(recordatorio);
            copia = copiar(almacen.recordatorios());
            almacen.guardar();
        }
        Eventos.emitir("recordatorios", copia);
        JSONObject r = new JSONObject().put("creado", creado);
        if (!reprogramar(c)) {
            r.put("advertencia", "Quedó guardado, pero no pude programar la alarma del celular: puede que avise tarde.");
        }
        return r;
    }

    /** Reprograma la alarma de la agenda; false si no se pudo (el recordatorio queda guardado igual). */
    private static boolean reprogramar(Context c) {
        try {
            Asistente.programar(c);
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "No pude programar la alarma de la agenda", e);
            return false;
        }
    }

    private static JSONArray verRecordatorios(Context c) throws JSONException {
        List<JSONObject> pendientes = new ArrayList<>();
        Almacen almacen = Almacen.de(c);
        synchronized (almacen) {
            JSONArray todos = almacen.recordatorios();
            for (int i = 0; i < todos.length(); i++) {
                JSONObject r = todos.optJSONObject(i);
                if (r != null && !r.optBoolean("avisado")) pendientes.add(new JSONObject(r.toString()));
            }
        }
        Collections.sort(pendientes, (x, y) -> Long.compare(
                Almacen.leerIso(x.optString("cuando")), Almacen.leerIso(y.optString("cuando"))));
        JSONArray salida = new JSONArray();
        for (JSONObject r : pendientes) {
            long cuando = Almacen.leerIso(r.optString("cuando"));
            if (cuando >= 0) r.put("cuando", fechaLocal(cuando));
            salida.put(r);
        }
        return salida;
    }

    private static JSONObject borrarRecordatorio(Context c, String id) throws Exception {
        if (id.isEmpty()) throw new Falla("Falta el id del recordatorio.");
        Almacen almacen = Almacen.de(c);
        boolean borrado = false;
        JSONArray copia;
        synchronized (almacen) {
            JSONArray todos = almacen.recordatorios();
            for (int i = todos.length() - 1; i >= 0; i--) {
                JSONObject r = todos.optJSONObject(i);
                if (r != null && id.equals(r.optString("id"))) {
                    todos.remove(i);
                    borrado = true;
                }
            }
            if (borrado) almacen.guardar();
            copia = copiar(todos);
        }
        if (!borrado) throw new Falla("No hay ningún recordatorio con ese id.");
        Eventos.emitir("recordatorios", copia);
        reprogramar(c);
        return new JSONObject().put("listo", true);
    }

    // ---------- Mensajes y mails ----------

    private static Object leerMensajes(String filtro, int cantidad) throws JSONException {
        // Sin filtro va "" (no null): así cualquier forma de filtrar ("contiene", isEmpty) lo toma como "todos".
        JSONArray mensajes = Escucha.recientes(filtro, cantidad);
        if (mensajes != null && mensajes.length() > 0) return mensajes;
        // Sin esto, la IA tiende a decir que "no tenés mensajes" cuando en realidad Jarvis recién empezó a escuchar.
        String nota = filtro.isEmpty()
                ? "No llegó ningún mensaje desde que Jarvis empezó a leer las notificaciones (los anteriores no los ve)."
                : "No llegó ningún mensaje de «" + filtro + "» desde que Jarvis empezó a leer las notificaciones.";
        return new JSONObject().put("mensajes", new JSONArray()).put("nota", nota);
    }

    /** Los mails que llegaron como notificación (Gmail, Outlook), para cuando no hay cuenta conectada por IMAP. */
    static JSONArray mailsDeNotificaciones(int cantidad) throws JSONException {
        JSONArray todos = Escucha.recientes("", 100);
        JSONArray salida = new JSONArray();
        for (int i = 0; i < todos.length() && salida.length() < cantidad; i++) {
            JSONObject m = todos.getJSONObject(i);
            if (!"email".equals(m.optString("canal"))) continue;
            salida.put(new JSONObject().put("de", m.optString("de")).put("deNombre", m.optString("de"))
                    .put("asunto", m.optString("asunto")).put("texto", m.optString("texto")).put("fecha", m.optString("fecha"))
                    .put("fuente", "notificaciones"));
        }
        return salida;
    }

    private static Object leerEmails(Context c, int cantidad, boolean soloNoLeidos) throws Exception {
        if (!Correo.configurado(c)) {
            JSONArray avisos = mailsDeNotificaciones(cantidad);
            return new JSONObject().put("mails", avisos).put("nota", (avisos.length() == 0
                    ? "No llegó ningún mail como notificación desde que Jarvis está prendida. "
                    : "Estos son los mails que llegaron como notificación de Gmail. ")
                    + "Para leer toda la bandeja, el usuario puede cargar su Gmail y una contraseña de aplicación en Ajustes > Correo.");
        }
        JSONArray mails = Correo.leer(c, cantidad, soloNoLeidos);
        if (mails == null || mails.length() == 0) {
            return new JSONObject().put("mails", new JSONArray())
                    .put("nota", soloNoLeidos ? "No hay mails sin leer." : "La bandeja de entrada está vacía.");
        }
        for (int i = 0; i < mails.length(); i++) {
            JSONObject m = mails.optJSONObject(i);
            if (m != null && m.optString("texto").length() > 1200) m.put("texto", Web.recortar(m.optString("texto"), 1200));
        }
        return mails;
    }

    // ---------- Borradores ----------

    private static JSONObject copiaDeAviso(Context c, String id) throws JSONException {
        Almacen almacen = Almacen.de(c);
        synchronized (almacen) {
            JSONObject aviso = almacen.buscar(almacen.avisos(), id);
            return aviso == null ? null : new JSONObject(aviso.toString());
        }
    }

    private static String responderAviso(Context c, String avisoId, String texto) throws Exception {
        if (avisoId.isEmpty()) throw new Falla("Falta el id del aviso.");
        if (texto.isEmpty()) throw new Falla("Falta el texto de la respuesta.");
        JSONObject aviso = copiaDeAviso(c, avisoId);
        if (aviso == null) throw new Falla("Ese aviso no existe.");
        JSONObject origen = aviso.optJSONObject("origen");
        if (origen == null) throw new Falla("Ese aviso no se puede responder desde Jarvis.");
        String de = aviso.optString("de");
        String motivo = aviso.optString("resumen").trim();
        if (motivo.isEmpty()) motivo = aviso.optString("titulo");
        JSONObject datos;
        switch (origen.optString("canal")) {
            case "notificacion": {
                String clave = origen.optString("clave");
                if (clave.isEmpty() || !Respuestas.puedeResponder(clave)) {
                    throw new Falla("Ya no puedo responder ese mensaje desde la notificación (se borró o la app no lo "
                            + "permite). Hay que contestarlo desde la app.");
                }
                String app = origen.optString("app");
                datos = new JSONObject()
                        .put("canal", "notificacion")
                        .put("para", clave)
                        .put("paraNombre", de.isEmpty() ? app : de)
                        .put("app", app)
                        .put("texto", texto)
                        .put("motivo", motivo)
                        .put("claveRespuesta", clave);
                break;
            }
            case "email": {
                String responderA = origen.optString("responderA");
                if (responderA.isEmpty()) throw new Falla("Ese mail no tiene una dirección a la que responder.");
                String asunto = origen.optString("asunto").trim();
                String cuenta = origen.optString("cuenta");
                JSONArray references = origen.optJSONArray("references");
                datos = new JSONObject()
                        .put("canal", "email")
                        .put("para", responderA)
                        .put("paraNombre", de.isEmpty() ? responderA : de)
                        .put("app", appDeCorreo(cuenta))
                        .put("cuenta", cuenta)
                        .put("asunto", asunto.regionMatches(true, 0, "re:", 0, 3) ? asunto : ("Re: " + asunto).trim())
                        .put("texto", texto)
                        .put("motivo", motivo)
                        .put("enRespuestaA", new JSONObject()
                                .put("messageId", origen.optString("messageId"))
                                .put("references", references == null ? new JSONArray() : references));
                break;
            }
            default:
                throw new Falla("Ese aviso no se puede responder desde Jarvis.");
        }
        return Acciones.describirPropuesta(c, Acciones.crearPropuesta(c, datos));
    }

    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private static String proponerEmail(Context c, String para, String asunto, String texto) throws Exception {
        if (!EMAIL.matcher(para).matches()) throw new Falla("Dirección de correo inválida.");
        if (texto.isEmpty()) throw new Falla("Falta el texto del mail.");
        JSONObject datos = new JSONObject()
                .put("canal", "email")
                .put("para", para)
                .put("paraNombre", para)
                .put("app", appDeCorreo(primeraCuenta(c)))
                .put("asunto", asunto)
                .put("texto", texto)
                .put("motivo", "Pedido del usuario");
        return Acciones.describirPropuesta(c, Acciones.crearPropuesta(c, datos));
    }

    /** Primera cuenta de Ajustes.EMAIL_CUENTAS ("a@gmail.com:clave,…"), solo para mostrar con qué app sale. */
    private static String primeraCuenta(Context c) {
        for (String parte : Ajustes.texto(c, Ajustes.EMAIL_CUENTAS).split(",")) {
            int dosPuntos = parte.indexOf(':');
            String cuenta = (dosPuntos >= 0 ? parte.substring(0, dosPuntos) : parte).trim();
            if (cuenta.contains("@")) return cuenta;
        }
        return "";
    }

    private static String appDeCorreo(String cuenta) {
        String dominio = cuenta == null ? "" : cuenta.substring(cuenta.indexOf('@') + 1).toLowerCase(Locale.ROOT);
        if (dominio.startsWith("gmail.") || dominio.startsWith("googlemail.")) return "Gmail";
        if (dominio.startsWith("yahoo.")) return "Yahoo";
        if (dominio.equals("icloud.com") || dominio.equals("me.com") || dominio.equals("mac.com")) return "iCloud";
        if (dominio.startsWith("outlook.") || dominio.startsWith("hotmail.") || dominio.startsWith("live.")) return "Outlook";
        return "Correo";
    }

    private static String proponerWhatsapp(Context c, String numero, String nombre, String texto) throws Exception {
        if (texto.isEmpty()) throw new Falla("Falta el mensaje.");
        if (!numero.isEmpty() && LETRAS.matcher(numero).find()) {
            // 1) Una conversación (persona o GRUPO) que escribió hace poco: se responde directo desde la notificación.
            Respuestas.Chat chat = Respuestas.buscar(numero, "whatsapp");
            if (chat != null) {
                JSONObject datos = new JSONObject()
                        .put("canal", "notificacion").put("para", chat.clave).put("claveRespuesta", chat.clave)
                        .put("paraNombre", chat.nombre + (chat.grupo ? " (grupo)" : "")).put("app", chat.app)
                        .put("texto", texto).put("motivo", "Pedido del usuario");
                return Acciones.describirPropuesta(c, Acciones.crearPropuesta(c, datos));
            }
            // 2) Un contacto con teléfono.
            JSONObject contacto = Telefono.telefonoDe(c, numero);
            if (contacto == null) {
                // 3) Puede ser un grupo que no escribió desde que Jarvis está prendida: al aprobarlo se abre WhatsApp con
                // el texto para que elijas el grupo.
                JSONObject datos = new JSONObject()
                        .put("canal", "whatsapp_compartir").put("para", numero).put("paraNombre", numero).put("app", "WhatsApp")
                        .put("texto", texto).put("motivo", "Pedido del usuario");
                return Acciones.describirPropuesta(c, Acciones.crearPropuesta(c, datos))
                        + " Como «" + numero + "» no escribió hace poco, al aprobarlo se abre WhatsApp con el texto para elegir el chat o grupo.";
            }
            if (nombre.isEmpty()) nombre = contacto.getString("nombre");
            numero = Telefono.internacional(c, contacto.getString("numero"));
        }
        if (numero.isEmpty() || LETRAS.matcher(numero).find()) {
            throw new Falla("Necesito el número con código de país (ej: 5491112345678). Si esa persona te escribió hace "
                    + "poco, respondé su aviso con responder_aviso.");
        }
        String digitos = numero.replaceAll("\\D", "");
        // "00" es el prefijo internacional: 0054… es lo mismo que +54…
        if (digitos.startsWith("00")) digitos = digitos.substring(2);
        if (digitos.length() < 8 || digitos.length() > 15 || digitos.startsWith("0")) {
            throw new Falla("Ese número no sirve para WhatsApp: tiene que llevar el código de país y nada de 0 adelante "
                    + "(ej: 5491112345678).");
        }
        if (texto.isEmpty()) throw new Falla("Falta el mensaje.");
        JSONObject datos = new JSONObject()
                .put("canal", "whatsapp_nuevo")
                .put("para", digitos)
                .put("paraNombre", nombre.isEmpty() ? "+" + digitos : nombre)
                .put("app", "WhatsApp")
                .put("texto", texto)
                .put("motivo", "Pedido del usuario");
        return Acciones.describirPropuesta(c, Acciones.crearPropuesta(c, datos));
    }

    /** Si la IA no pasó id ("mandala" sin aclarar), el borrador pendiente más reciente. */
    private static String idDeBorrador(Context c, String id) throws Falla {
        if (!id.isEmpty()) return id;
        Almacen almacen = Almacen.de(c);
        synchronized (almacen) {
            JSONArray propuestas = almacen.propuestas();
            for (int i = propuestas.length() - 1; i >= 0; i--) {
                JSONObject p = propuestas.optJSONObject(i);
                if (p != null && "pendiente".equals(p.optString("estado")) && !p.optString("id").isEmpty()) {
                    return p.optString("id");
                }
            }
        }
        throw new Falla("No hay ningún borrador pendiente.");
    }

    private static JSONObject enviarBorrador(Context c, String id, String texto, String textoUsuario) throws Exception {
        if (!aproboEnvio(textoUsuario)) {
            throw new Falla("El usuario no pidió enviarlo. Preguntale si lo querés mandar antes de enviarlo.");
        }
        JSONObject p = Acciones.enviarPropuesta(c, idDeBorrador(c, id), texto.isEmpty() ? null : texto, null);
        JSONObject r = new JSONObject()
                .put("enviado", true)
                .put("canal", p.optString("canal"))
                .put("para", p.optString("paraNombre"));
        if ("whatsapp_nuevo".equals(p.optString("canal"))) {
            r.put("nota", "Abrí WhatsApp con el mensaje escrito: falta que el usuario toque enviar.");
        } else if (!p.optString("nota").isEmpty()) {
            r.put("nota", p.optString("nota"));
        }
        return r;
    }

    private static JSONObject corregirBorrador(Context c, String id, String texto, String asunto) throws Exception {
        if (texto.isEmpty()) throw new Falla("Falta el texto nuevo.");
        JSONObject p = Acciones.editarPropuesta(c, idDeBorrador(c, id), texto, asunto.isEmpty() ? null : asunto);
        JSONObject r = new JSONObject().put("corregido", true).put("texto", p.optString("texto"));
        if (!asunto.isEmpty()) r.put("asunto", p.optString("asunto"));
        return r;
    }

    private static JSONObject descartarBorrador(Context c, String id) throws Exception {
        JSONObject p = Acciones.descartarPropuesta(c, idDeBorrador(c, id));
        return new JSONObject().put("descartado", true).put("para", p.optString("paraNombre"));
    }

    // ---------- Abrir apps y páginas ----------

    private static Context aplicacion(Context c) {
        Context app = c.getApplicationContext();
        return app != null ? app : c;
    }

    /**
     * Abre una actividad desde el contexto de la aplicación. Android no deja abrir pantallas desde segundo plano salvo
     * que Jarvis esté a la vista o tenga «Mostrar sobre otras apps»; si no, avisa (el pedido se intenta igual).
     */
    private static String abrirActividad(Context c, Intent i, String sinApp) throws Falla {
        Context app = aplicacion(c);
        // Se mira antes de abrir: apenas se abre la otra app, la pantalla de Jarvis deja de estar a la vista.
        boolean puede = Principal.visible;
        if (!puede) {
            try {
                puede = Settings.canDrawOverlays(app);
            } catch (RuntimeException ignorada) {
            }
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            app.startActivity(i);
        } catch (ActivityNotFoundException e) {
            throw new Falla(sinApp);
        } catch (SecurityException e) {
            Log.w(TAG, "No me dejaron abrir " + i, e);
            throw new Falla("Android no me dejó abrir eso.");
        }
        return puede ? null : "Jarvis estaba en segundo plano y sin el permiso «Mostrar sobre otras apps»: puede que "
                + "Android no lo haya dejado abrir.";
    }

    private static final Pattern CON_ESQUEMA = Pattern.compile("^[a-zA-Z][a-zA-Z0-9+.-]*://");
    // "youtube.com", "www.mercadolibre.com.ar/ofertas": una dirección sin https://.
    private static final Pattern DOMINIO = Pattern.compile("^(www\\.)?[\\p{L}0-9-]+(\\.[\\p{L}0-9-]+)*\\.[a-zA-Z]{2,}([/?#:].*)?$");

    private static JSONObject abrir(Context c, String destino) throws Exception {
        if (destino.isEmpty()) throw new Falla("Falta qué abrir.");
        boolean esUrl = CON_ESQUEMA.matcher(destino).find();
        List<App> apps = esUrl ? null : appsInstaladas(aplicacion(c));
        // "Booking.com" o "Maps.me" pueden ser el nombre de una app: si hay una que se llama exactamente así, gana la app.
        if (!esUrl && DOMINIO.matcher(destino).matches()) {
            String clave = compacto(destino);
            esUrl = true;
            for (App a : apps) {
                if (a.clave.equals(clave)) {
                    esUrl = false;
                    break;
                }
            }
        }
        if (esUrl) {
            // Igual que en la PC: solo http/https y nunca la red local (Web.validarUrl tira el motivo en español).
            String url = Web.validarUrl(destino);
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE);
            String advertencia = abrirActividad(c, i, "No hay ninguna app para abrir esa dirección.");
            return conAdvertencia(new JSONObject().put("abierto", url), advertencia);
        }
        App app = buscarApp(apps, destino);
        if (app == null) throw new Falla("No encontré ninguna app que se llame «" + destino + "» en el celular.");
        Intent i = new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setClassName(app.paquete, app.actividad)
                // Como el lanzador: si la app ya estaba abierta, vuelve a donde estaba.
                .addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        String advertencia = abrirActividad(c, i, "No pude abrir " + app.etiqueta + ".");
        return conAdvertencia(new JSONObject().put("abierto", app.etiqueta), advertencia);
    }

    private static JSONObject conAdvertencia(JSONObject r, String advertencia) throws JSONException {
        if (advertencia != null) r.put("advertencia", advertencia);
        return r;
    }

    private static final class App {
        final String etiqueta;
        final String clave;
        final String paquete;
        final String actividad;

        App(String etiqueta, String paquete, String actividad) {
            this.etiqueta = etiqueta;
            this.clave = compacto(etiqueta);
            this.paquete = paquete;
            this.actividad = actividad;
        }
    }

    /** Las apps del cajón (MAIN/LAUNCHER; el manifiesto declara la consulta para verlas en Android 11+). */
    private static List<App> appsInstaladas(Context app) {
        List<App> apps = new ArrayList<>();
        PackageManager pm = app.getPackageManager();
        Intent lanzador = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> lista;
        try {
            lista = Build.VERSION.SDK_INT >= 33
                    ? pm.queryIntentActivities(lanzador, PackageManager.ResolveInfoFlags.of(0))
                    : pm.queryIntentActivities(lanzador, 0);
        } catch (RuntimeException e) {
            Log.w(TAG, "No pude ver las apps instaladas", e);
            return apps;
        }
        for (ResolveInfo ri : lista) {
            ActivityInfo ai = ri.activityInfo;
            if (ai == null || ai.packageName == null || ai.name == null) continue;
            try {
                CharSequence etiqueta = ri.loadLabel(pm);
                if (etiqueta != null && etiqueta.toString().trim().length() > 0) {
                    apps.add(new App(etiqueta.toString().trim(), ai.packageName, ai.name));
                }
            } catch (RuntimeException ignorada) {
                // Una app que se desinstala en el medio no impide revisar las demás.
            }
        }
        return apps;
    }

    /** Sin acentos, mayúsculas, espacios ni signos: "Google Maps" → "googlemaps", "Mercado Pago" → "mercadopago". */
    private static String compacto(String s) {
        return normalizar(s).replaceAll("[^\\p{L}\\p{N}]", "");
    }

    // Por si el celular está en otro idioma o la app se llama distinto según la marca.
    private static final String[][] SINONIMOS = {
        {"mapas", "maps"}, {"maps", "mapas"}, {"ajustes", "configuracion"}, {"configuracion", "ajustes"},
        {"galeria", "fotos"}, {"fotos", "galeria"}, {"camara", "camera"}, {"telefono", "phone"},
        {"mensajes", "messages"}, {"calendario", "calendar"}, {"reloj", "clock"}, {"calculadora", "calculator"},
        {"navegador", "chrome"}, {"correo", "gmail"}, {"musica", "music"}, {"tienda", "playstore"},
    };

    private static App buscarApp(List<App> apps, String nombre) {
        String buscada = compacto(nombre);
        if (buscada.isEmpty()) return null;
        App app = buscarExactaOContiene(apps, buscada);
        if (app != null) return app;
        for (String[] s : SINONIMOS) {
            if (s[0].equals(buscada)) {
                app = buscarExactaOContiene(apps, s[1]);
                if (app != null) return app;
            }
        }
        // "la app de mercado pago": el pedido contiene el nombre; gana el nombre más largo (el más específico).
        App mejor = null;
        for (App a : apps) {
            if (a.clave.length() >= 4 && buscada.contains(a.clave)
                    && (mejor == null || a.clave.length() > mejor.clave.length())) {
                mejor = a;
            }
        }
        return mejor;
    }

    private static App buscarExactaOContiene(List<App> apps, String buscada) {
        for (App a : apps) if (a.clave.equals(buscada)) return a;
        // Entre las que contienen el nombre, la de nombre más corto es la más parecida ("YouTube" antes que "YouTube Music").
        App mejor = null;
        for (App a : apps) {
            if (a.clave.contains(buscada) && (mejor == null || a.clave.length() < mejor.clave.length())) mejor = a;
        }
        return mejor;
    }

    // ---------- Reloj y teléfono ----------

    private static final Pattern HORA_TEXTO = Pattern.compile("^(\\d{1,2})\\s*[:.hH]\\s*(\\d{1,2})?\\s*(hs?)?$");

    private static JSONObject ponerAlarma(Context c, Object horaCruda, Object minutosCruda, String mensaje) throws Exception {
        Integer hora = entero(horaCruda);
        Integer minutos = entero(minutosCruda);
        // Si la IA manda "7:30" en la hora, se entiende igual.
        if (hora == null && horaCruda instanceof String) {
            Matcher m = HORA_TEXTO.matcher(((String) horaCruda).trim());
            if (m.matches()) {
                hora = Integer.parseInt(m.group(1));
                if (m.group(2) != null && minutos == null) minutos = Integer.parseInt(m.group(2));
            }
        }
        if (hora == null || hora < 0 || hora > 23) throw new Falla("La hora tiene que ser un número de 0 a 23.");
        if (minutos == null) minutos = 0;
        if (minutos < 0 || minutos > 59) throw new Falla("Los minutos tienen que ir de 0 a 59.");
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hora)
                .putExtra(AlarmClock.EXTRA_MINUTES, minutos)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        if (!mensaje.isEmpty()) i.putExtra(AlarmClock.EXTRA_MESSAGE, mensaje);
        String advertencia = abrirActividad(c, i, "No encontré una app de reloj para poner la alarma.");
        JSONObject r = new JSONObject().put("alarma", String.format(Locale.ROOT, "%02d:%02d", hora, minutos));
        if (!mensaje.isEmpty()) r.put("mensaje", mensaje);
        return conAdvertencia(r, advertencia);
    }

    private static JSONObject ponerTemporizador(Context c, Object segundosCrudos, String mensaje) throws Exception {
        double valor = comoNumero(segundosCrudos);
        if (segundosCrudos == null || segundosCrudos instanceof Boolean || Double.isNaN(valor) || Double.isInfinite(valor)) {
            throw new Falla("Falta la duración en segundos.");
        }
        if (valor < 0.5) throw new Falla("El temporizador tiene que durar al menos un segundo.");
        long segundos = Math.round(valor);
        // Es el máximo que acepta AlarmClock.EXTRA_LENGTH.
        if (segundos > 86_400) throw new Falla("El temporizador puede durar hasta 24 horas.");
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER)
                .putExtra(AlarmClock.EXTRA_LENGTH, (int) segundos)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        if (!mensaje.isEmpty()) i.putExtra(AlarmClock.EXTRA_MESSAGE, mensaje);
        String advertencia = abrirActividad(c, i, "No encontré una app de reloj para poner el temporizador.");
        JSONObject r = new JSONObject().put("temporizador", duracion(segundos));
        if (!mensaje.isEmpty()) r.put("mensaje", mensaje);
        return conAdvertencia(r, advertencia);
    }

    private static JSONObject llamar(Context c, String numero) throws Exception {
        if (numero.isEmpty() || LETRAS.matcher(numero).find()) {
            throw new Falla("Necesito el número de teléfono: todavía no puedo buscar en tus contactos.");
        }
        // Se dejan solo los caracteres que entiende el marcador; el + solo al principio.
        String limpio = numero.replaceAll("[^0-9*#+]", "");
        limpio = (limpio.startsWith("+") ? "+" : "") + limpio.replace("+", "");
        if (limpio.replaceAll("\\D", "").length() < 3) throw new Falla("Ese número de teléfono no parece válido.");
        // ACTION_DIAL solo abre el marcador con el número: la llamada la confirma el usuario.
        Intent i = new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", limpio, null));
        String advertencia = abrirActividad(c, i, "No encontré la app de teléfono.");
        JSONObject r = new JSONObject()
                .put("marcando", limpio)
                .put("nota", "Abrí el teléfono con el número: falta que el usuario toque llamar.");
        return conAdvertencia(r, advertencia);
    }
}
