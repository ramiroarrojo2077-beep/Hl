package com.jarvis.asistente;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.text.Normalizer;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Datos del panel y de las herramientas: clima (Open-Meteo), noticias (Google Noticias) y estado del celular. Caché de 15 min. */
final class Info {
    private Info() {}

    private static final String TAG = "JarvisInfo";
    private static final long VIGENCIA_MS = 15 * 60_000L;
    // Sin internet un rato, mejor el último dato (que dice cuándo se actualizó) que nada.
    private static final long MAX_VIEJO_MS = 3 * 60 * 60_000L;
    private static final int MAX_CACHE = 40;
    private static final int ESPERA_MS = 15_000;

    // ---------- Caché ----------

    private static final class Guardado {
        final String json;
        final long cuando;

        Guardado(String json, long cuando) {
            this.json = json;
            this.cuando = cuando;
        }
    }

    private interface Obtener {
        String obtener() throws Exception;
    }

    // Se guarda el JSON como texto: cada llamada recibe su propia copia y nadie puede modificar la caché sin querer.
    private static final ConcurrentHashMap<String, Guardado> cache = new ConcurrentHashMap<>();
    // El panel y la IA pueden pedir el clima a la vez: un cerrojo por clave (repartido) evita dos pedidos iguales.
    private static final Object[] CERROJOS = new Object[16];

    static {
        for (int i = 0; i < CERROJOS.length; i++) CERROJOS[i] = new Object();
    }

    // Reloj que sigue contando con el celular dormido (System.nanoTime se frena en el sueño profundo).
    private static long reloj() {
        return SystemClock.elapsedRealtime();
    }

    private static String conCache(String clave, Obtener obtener) throws Exception {
        Guardado g = cache.get(clave);
        if (g != null && reloj() - g.cuando < VIGENCIA_MS) return g.json;
        synchronized (CERROJOS[(clave.hashCode() & 0x7fffffff) % CERROJOS.length]) {
            g = cache.get(clave);
            if (g != null && reloj() - g.cuando < VIGENCIA_MS) return g.json;
            try {
                String json = obtener.obtener();
                guardar(clave, json);
                return json;
            } catch (Exception e) {
                if (g != null && reloj() - g.cuando < MAX_VIEJO_MS) {
                    Log.w(TAG, "Uso el dato guardado de " + clave + ": " + e.getMessage());
                    return g.json;
                }
                throw e;
            }
        }
    }

    private static void guardar(String clave, String json) {
        long ahora = reloj();
        if (cache.size() >= MAX_CACHE) {
            // Ciudades y temas sueltos: se tira lo que ya no sirve ni como respaldo.
            for (Iterator<Map.Entry<String, Guardado>> it = cache.entrySet().iterator(); it.hasNext(); ) {
                if (ahora - it.next().getValue().cuando >= MAX_VIEJO_MS) it.remove();
            }
            if (cache.size() >= MAX_CACHE) cache.clear();
        }
        cache.put(clave, new Guardado(json, ahora));
    }

    // ---------- Clima (Open-Meteo) ----------

    /**
     * Mismo JSON que la versión de PC: {lugar, actualizado, actual:{temperatura, sensacion, humedad, precipitacion, viento,
     * esDeDia, estado, icono}, salidaSol, puestaSol, dias:[{fecha, maxima, minima, lluvia, estado, icono}]}.
     * icono ∈ sol|parcial|nube|niebla|llovizna|lluvia|nieve|tormenta.
     * @param ciudad null o vacío = Ajustes.CIUDAD; si tampoco hay, ubicación aproximada por IP (https://ipwho.is/?lang=es).
     */
    static JSONObject clima(Context c, String ciudad) throws Exception {
        String buscada = ciudad == null ? "" : ciudad.trim();
        if (buscada.isEmpty() && c != null) buscada = Ajustes.texto(c, Ajustes.CIUDAD).trim();
        final String lugar = buscada;
        return new JSONObject(conCache("clima|" + lugar.toLowerCase(Locale.ROOT), () -> pronostico(lugar).toString()));
    }

    private static final class Ubicacion {
        final String nombre;
        final double latitud;
        final double longitud;

        Ubicacion(String nombre, double latitud, double longitud) {
            this.nombre = nombre;
            this.latitud = latitud;
            this.longitud = longitud;
        }
    }

    private static Ubicacion ubicar(String ciudad) throws Exception {
        if (!ciudad.isEmpty()) {
            // "Córdoba, Argentina": el buscador solo entiende el nombre, el resto sirve para elegir entre los parecidos.
            String[] partes = ciudad.split(",");
            String nombre = partes[0].trim();
            if (nombre.isEmpty()) throw new IllegalArgumentException("No encontré la ciudad \"" + ciudad + "\".");
            boolean conDetalle = partes.length > 1;
            JSONObject r = Web.obtenerJson("https://geocoding-api.open-meteo.com/v1/search?count=" + (conDetalle ? 10 : 1)
                    + "&language=es&name=" + Web.codificar(nombre), Web.AGENTE_JARVIS, ESPERA_MS);
            JSONObject lugar = elegir(r.optJSONArray("results"), partes);
            if (lugar == null || Double.isNaN(lugar.optDouble("latitude")) || Double.isNaN(lugar.optDouble("longitude"))) {
                throw new IllegalArgumentException("No encontré la ciudad \"" + ciudad + "\".");
            }
            return new Ubicacion(unir(Web.campo(lugar, "name"), Web.campo(lugar, "admin1"), Web.campo(lugar, "country")),
                    lugar.optDouble("latitude"), lugar.optDouble("longitude"));
        }
        // Sin ciudad configurada, se estima por la IP.
        JSONObject r = Web.obtenerJson("https://ipwho.is/?lang=es", Web.AGENTE_JARVIS, ESPERA_MS);
        double latitud = r.optDouble("latitude");
        double longitud = r.optDouble("longitude");
        if (!r.optBoolean("success") || Double.isNaN(latitud) || Double.isNaN(longitud)) {
            throw new Web.ErrorWeb("No pude ubicarte. Poné tu ciudad en los ajustes de Jarvis.");
        }
        return new Ubicacion(unir(Web.campo(r, "city"), Web.campo(r, "region"), Web.campo(r, "country")), latitud, longitud);
    }

    /** El primer resultado o, si se escribió "Ciudad, Provincia/País", el primero que coincida con eso. */
    static JSONObject elegir(JSONArray resultados, String[] partes) {
        if (resultados == null) return null;
        if (partes.length > 1) {
            for (int i = 0; i < resultados.length(); i++) {
                JSONObject candidato = resultados.optJSONObject(i);
                if (candidato != null && coincide(candidato, partes)) return candidato;
            }
        }
        return resultados.optJSONObject(0);
    }

    private static boolean coincide(JSONObject lugar, String[] partes) {
        String donde = sinAcentos(Web.campo(lugar, "admin1") + " " + Web.campo(lugar, "admin2") + " " + Web.campo(lugar, "admin3")
                + " " + Web.campo(lugar, "country") + " " + Web.campo(lugar, "country_code"));
        for (int i = 1; i < partes.length; i++) {
            String parte = sinAcentos(partes[i].trim());
            if (!parte.isEmpty() && !donde.contains(parte)) return false;
        }
        return true;
    }

    private static String sinAcentos(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "").toLowerCase(Locale.ROOT);
    }

    private static String unir(String... partes) {
        StringBuilder sb = new StringBuilder();
        for (String p : partes) {
            if (p == null || p.trim().isEmpty()) continue;
            if (sb.length() > 0) sb.append(", ");
            sb.append(p.trim());
        }
        return sb.toString();
    }

    private static JSONObject pronostico(String ciudad) throws Exception {
        Ubicacion lugar = ubicar(ciudad);
        // Locale.US: con el celular en español, "%.4f" escribiría la coma decimal y Open-Meteo no lo entendería.
        String url = String.format(Locale.US,
                "https://api.open-meteo.com/v1/forecast?timezone=auto&forecast_days=7&latitude=%.4f&longitude=%.4f",
                lugar.latitud, lugar.longitud)
                + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day"
                + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset";
        return armarClima(lugar.nombre, Web.obtenerJson(url, Web.AGENTE_JARVIS, ESPERA_MS));
    }

    /** Pasa la respuesta de Open-Meteo al formato del panel. */
    static JSONObject armarClima(String lugar, JSONObject r) throws Exception {
        JSONObject c = r.optJSONObject("current");
        JSONObject d = r.optJSONObject("daily");
        if (c == null || d == null) throw new Web.ErrorWeb("El servicio del clima devolvió datos incompletos.");

        double precipitacion = c.optDouble("precipitation");
        JSONObject actual = new JSONObject()
                .put("temperatura", redondo(c.optDouble("temperature_2m")))
                .put("sensacion", redondo(c.optDouble("apparent_temperature")))
                .put("humedad", redondo(c.optDouble("relative_humidity_2m")))
                .put("precipitacion", Double.isNaN(precipitacion) ? JSONObject.NULL : (Object) precipitacion)
                .put("viento", redondo(c.optDouble("wind_speed_10m")))
                .put("esDeDia", c.optInt("is_day", 1) == 1);
        describir(c.optInt("weather_code", -1), actual);

        JSONArray fechas = d.optJSONArray("time");
        JSONArray codigos = d.optJSONArray("weather_code");
        JSONArray maximas = d.optJSONArray("temperature_2m_max");
        JSONArray minimas = d.optJSONArray("temperature_2m_min");
        JSONArray lluvias = d.optJSONArray("precipitation_probability_max");
        JSONArray dias = new JSONArray();
        for (int i = 0; fechas != null && i < fechas.length(); i++) {
            double lluvia = lluvias == null ? Double.NaN : lluvias.optDouble(i);
            JSONObject dia = new JSONObject()
                    .put("fecha", fechas.isNull(i) ? "" : fechas.optString(i))
                    .put("maxima", redondo(maximas == null ? Double.NaN : maximas.optDouble(i)))
                    .put("minima", redondo(minimas == null ? Double.NaN : minimas.optDouble(i)))
                    .put("lluvia", Double.isNaN(lluvia) ? 0 : lluvia);
            describir(codigos == null ? -1 : codigos.optInt(i, -1), dia);
            dias.put(dia);
        }
        return new JSONObject()
                .put("lugar", lugar)
                .put("actualizado", Almacen.ahora())
                .put("actual", actual)
                .put("salidaSol", hora(d.optJSONArray("sunrise")))
                .put("puestaSol", hora(d.optJSONArray("sunset")))
                .put("dias", dias);
    }

    /** Math.round de la PC; un dato que falta queda en null (no en 0, que sería mentir). */
    private static Object redondo(double v) {
        return Double.isNaN(v) || Double.isInfinite(v) ? JSONObject.NULL : (Object) Math.round(v);
    }

    /** "2026-10-07T06:45" → "06:45". */
    private static String hora(JSONArray lista) {
        String s = lista == null || lista.isNull(0) ? "" : lista.optString(0, "");
        return s.length() > 11 ? s.substring(11) : "";
    }

    private static void describir(int codigo, JSONObject destino) throws JSONException {
        String estado;
        String icono;
        switch (codigo) {
            case 0: estado = "Despejado"; icono = "sol"; break;
            case 1: estado = "Mayormente despejado"; icono = "sol"; break;
            case 2: estado = "Parcialmente nublado"; icono = "parcial"; break;
            case 3: estado = "Nublado"; icono = "nube"; break;
            case 45: estado = "Niebla"; icono = "niebla"; break;
            case 48: estado = "Niebla con escarcha"; icono = "niebla"; break;
            case 51: estado = "Llovizna leve"; icono = "llovizna"; break;
            case 53: estado = "Llovizna"; icono = "llovizna"; break;
            case 55: estado = "Llovizna intensa"; icono = "llovizna"; break;
            case 56: estado = "Llovizna helada"; icono = "llovizna"; break;
            case 57: estado = "Llovizna helada intensa"; icono = "llovizna"; break;
            case 61: estado = "Lluvia leve"; icono = "lluvia"; break;
            case 63: estado = "Lluvia"; icono = "lluvia"; break;
            case 65: estado = "Lluvia fuerte"; icono = "lluvia"; break;
            case 66: estado = "Lluvia helada"; icono = "lluvia"; break;
            case 67: estado = "Lluvia helada fuerte"; icono = "lluvia"; break;
            case 71: estado = "Nevada leve"; icono = "nieve"; break;
            case 73: estado = "Nevada"; icono = "nieve"; break;
            case 75: estado = "Nevada fuerte"; icono = "nieve"; break;
            case 77: estado = "Granizo fino"; icono = "nieve"; break;
            case 80: estado = "Chaparrones leves"; icono = "lluvia"; break;
            case 81: estado = "Chaparrones"; icono = "lluvia"; break;
            case 82: estado = "Chaparrones fuertes"; icono = "lluvia"; break;
            case 85: estado = "Chaparrones de nieve"; icono = "nieve"; break;
            case 86: estado = "Chaparrones de nieve fuertes"; icono = "nieve"; break;
            case 95: estado = "Tormenta"; icono = "tormenta"; break;
            case 96: estado = "Tormenta con granizo"; icono = "tormenta"; break;
            case 99: estado = "Tormenta fuerte con granizo"; icono = "tormenta"; break;
            default: estado = "—"; icono = "nube"; break;
        }
        destino.put("estado", estado).put("icono", icono);
    }

    // ---------- Noticias (RSS de Google Noticias) ----------

    /** [{titulo, fuente, url, fecha}] del RSS de Google Noticias para Ajustes.PAIS (hl=es-419). tema vacío = portada. */
    static JSONArray noticias(Context c, String tema, int cantidad) throws Exception {
        String pais = codigoPais(c == null ? "" : Ajustes.texto(c, Ajustes.PAIS));
        String buscado = tema == null ? "" : tema.trim();
        String json = conCache("noticias|" + pais + "|" + buscado.toLowerCase(Locale.ROOT), () -> leerNoticias(pais, buscado).toString());
        JSONArray todas = new JSONArray(json);
        int n = cantidad > 0 ? cantidad : 10;
        JSONArray salida = new JSONArray();
        for (int i = 0; i < todas.length() && i < n; i++) salida.put(todas.get(i));
        return salida;
    }

    /** Código de 2 letras para Google Noticias; si en los ajustes escribieron el nombre del país, se traduce. */
    private static String codigoPais(String valor) {
        String p = sinAcentos(valor.trim());
        if (p.matches("[a-z]{2}")) return p.toUpperCase(Locale.ROOT);
        switch (p) {
            case "argentina": return "AR";
            case "uruguay": return "UY";
            case "chile": return "CL";
            case "paraguay": return "PY";
            case "bolivia": return "BO";
            case "peru": return "PE";
            case "colombia": return "CO";
            case "venezuela": return "VE";
            case "ecuador": return "EC";
            case "mexico": return "MX";
            case "espana": return "ES";
            case "estados unidos": return "US";
            default: return "AR";
        }
    }

    private static JSONArray leerNoticias(String pais, String tema) throws Exception {
        String region = "hl=es-419&gl=" + pais + "&ceid=" + pais + ":es-419";
        String url = tema.isEmpty()
                ? "https://news.google.com/rss?" + region
                : "https://news.google.com/rss/search?q=" + Web.codificar(tema) + "&" + region;
        return parsearRss(Web.obtener(url, "Mozilla/5.0 Jarvis", ESPERA_MS));
    }

    private static final Pattern ITEM = Pattern.compile("<item\\b[^>]*>(.*?)</item\\s*>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern TITULO = campo("title");
    private static final Pattern FUENTE = campo("source");
    private static final Pattern ENLACE = campo("link");
    private static final Pattern FECHA = campo("pubDate");

    private static Pattern campo(String nombre) {
        return Pattern.compile("<" + nombre + "(?:\\s[^>]*)?>(.*?)</" + nombre + "\\s*>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    }

    static JSONArray parsearRss(String xml) throws JSONException {
        JSONArray lista = new JSONArray();
        Matcher items = ITEM.matcher(xml);
        while (items.find()) {
            String item = items.group(1);
            String titulo = valor(TITULO, item);
            if (titulo.isEmpty()) continue;
            String fuente = valor(FUENTE, item);
            // Google agrega " - Medio" al final del título.
            if (!fuente.isEmpty() && titulo.endsWith(" - " + fuente) && titulo.length() > fuente.length() + 3) {
                titulo = titulo.substring(0, titulo.length() - fuente.length() - 3).trim();
            }
            lista.put(new JSONObject()
                    .put("titulo", titulo)
                    .put("fuente", fuente)
                    .put("url", valor(ENLACE, item))
                    .put("fecha", fechaIso(valor(FECHA, item))));
        }
        return lista;
    }

    /**
     * Texto de un campo del RSS. Primero se decodifica como XML (CDATA tal cual, entidades afuera) y el resultado se lee
     * como HTML: así salen las etiquetas que vienen dentro del CDATA y las entidades doblemente escapadas ("&amp;quot;").
     */
    private static String valor(Pattern patron, String item) {
        Matcher m = patron.matcher(item);
        if (!m.find()) return "";
        String crudo = m.group(1);
        StringBuilder xml = new StringBuilder(crudo.length());
        int i = 0;
        while (i < crudo.length()) {
            int cdata = crudo.indexOf("<![CDATA[", i);
            if (cdata < 0) {
                xml.append(Web.decodificarEntidades(crudo.substring(i)));
                break;
            }
            xml.append(Web.decodificarEntidades(crudo.substring(i, cdata)));
            int fin = crudo.indexOf("]]>", cdata + 9);
            xml.append(crudo, cdata + 9, fin < 0 ? crudo.length() : fin);
            i = fin < 0 ? crudo.length() : fin + 3;
        }
        return Web.aTexto(xml.toString(), false).trim();
    }

    private static final String[] FORMATOS_RSS = {
        "EEE, d MMM yyyy HH:mm:ss zzz", "EEE, d MMM yyyy HH:mm:ss Z", "d MMM yyyy HH:mm:ss zzz", "d MMM yyyy HH:mm:ss Z",
        "EEE, d MMM yyyy HH:mm zzz", "EEE, d MMM yyyy HH:mm Z",
    };

    /** Fecha RFC 822 del RSS ("Tue, 07 Oct 2026 18:30:00 GMT") en ISO UTC; "" si no se entiende. */
    private static String fechaIso(String fecha) {
        if (fecha.isEmpty()) return "";
        for (String f : FORMATOS_RSS) {
            try {
                SimpleDateFormat formato = new SimpleDateFormat(f, Locale.US);
                ParsePosition posicion = new ParsePosition(0);
                Date d = formato.parse(fecha, posicion);
                if (d != null && posicion.getIndex() == fecha.length()) return Almacen.iso(d.getTime());
            } catch (RuntimeException ignorada) {
            }
        }
        long ms = Almacen.leerIso(fecha);
        return ms >= 0 ? Almacen.iso(ms) : "";
    }

    // ---------- Sistema ----------

    /**
     * {cpu:-1 (Android no lo deja leer), nucleos, ram:{total, libre}, disco:{unidad:"Interno", total, libre},
     * encendidoSeg, equipo (marca y modelo), ip (local, o "" si no hay red), plataforma ("Android 15"),
     * bateria:{nivel 0-100, cargando}}.
     */
    static JSONObject sistema(Context c) {
        Context app = c.getApplicationContext() != null ? c.getApplicationContext() : c;
        JSONObject r = new JSONObject();
        try {
            long ramTotal = 0;
            long ramLibre = 0;
            try {
                ActivityManager am = app.getSystemService(ActivityManager.class);
                ActivityManager.MemoryInfo memoria = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(memoria);
                ramTotal = memoria.totalMem;
                ramLibre = memoria.availMem;
            } catch (RuntimeException e) {
                Log.w(TAG, "No pude leer la memoria: " + e.getMessage());
            }
            long discoTotal = 0;
            long discoLibre = 0;
            try {
                StatFs disco = new StatFs(Environment.getDataDirectory().getPath());
                discoTotal = disco.getTotalBytes();
                discoLibre = disco.getAvailableBytes();
            } catch (RuntimeException e) {
                Log.w(TAG, "No pude leer el disco: " + e.getMessage());
            }
            r.put("cpu", -1)
                    .put("nucleos", Runtime.getRuntime().availableProcessors())
                    .put("ram", new JSONObject().put("total", ramTotal).put("libre", ramLibre))
                    .put("disco", new JSONObject().put("unidad", "Interno").put("total", discoTotal).put("libre", discoLibre))
                    .put("encendidoSeg", Math.round(SystemClock.elapsedRealtime() / 1000.0))
                    .put("equipo", equipo())
                    .put("ip", ipLocal())
                    .put("plataforma", "Android " + Build.VERSION.RELEASE)
                    .put("bateria", bateria(app));
        } catch (JSONException ignorada) {
        }
        return r;
    }

    private static String equipo() {
        String marca = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String modelo = Build.MODEL == null ? "" : Build.MODEL.trim();
        if (!marca.isEmpty()) marca = Character.toUpperCase(marca.charAt(0)) + marca.substring(1);
        // "Google Pixel 8" ya trae la marca; "SM-S918B" no.
        if (modelo.toLowerCase(Locale.ROOT).startsWith(marca.toLowerCase(Locale.ROOT))) return modelo.isEmpty() ? marca : modelo;
        return (marca + " " + modelo).trim();
    }

    /** IPv4 de la red local: primero el Wi-Fi o el cable, si no la de datos móviles; "" si no hay red. */
    private static String ipLocal() {
        String otra = "";
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            if (interfaces == null) return "";
            for (NetworkInterface ni : Collections.list(interfaces)) {
                try {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    String nombre = ni.getName() == null ? "" : ni.getName();
                    if (nombre.startsWith("p2p") || nombre.startsWith("dummy")) continue;
                    for (InetAddress d : Collections.list(ni.getInetAddresses())) {
                        if (!(d instanceof Inet4Address) || d.isLoopbackAddress() || d.isLinkLocalAddress()) continue;
                        String ip = d.getHostAddress();
                        if (ip == null) continue;
                        if (nombre.startsWith("wlan") || nombre.startsWith("eth")) return ip;
                        if (otra.isEmpty()) otra = ip;
                    }
                } catch (Exception e) {
                    // Una interfaz que desaparece en el medio no impide revisar las demás.
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "No pude leer la IP: " + e.getMessage());
        }
        return otra;
    }

    private static JSONObject bateria(Context app) throws JSONException {
        int nivel = -1;
        boolean cargando = false;
        try {
            // Broadcast "pegajoso": con receptor null devuelve el último estado sin registrar nada.
            Intent estado = app.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (estado != null) {
                int valor = estado.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int escala = estado.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (valor >= 0 && escala > 0) nivel = Math.round(valor * 100f / escala);
                int carga = estado.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                cargando = carga == BatteryManager.BATTERY_STATUS_CHARGING
                        || carga == BatteryManager.BATTERY_STATUS_FULL
                        || estado.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "No pude leer la batería: " + e.getMessage());
        }
        if (nivel < 0) {
            try {
                BatteryManager bm = app.getSystemService(BatteryManager.class);
                if (bm != null) {
                    nivel = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                    cargando = bm.isCharging();
                }
            } catch (RuntimeException ignorada) {
            }
        }
        return new JSONObject().put("nivel", Math.max(0, Math.min(100, nivel))).put("cargando", cargando);
    }
}
