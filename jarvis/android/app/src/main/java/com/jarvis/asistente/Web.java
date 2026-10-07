package com.jarvis.asistente;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.IDN;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.MalformedURLException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.SSLException;

/** Búsqueda en internet y lectura de páginas. */
final class Web {
    private Web() {}

    private static final String TAG = "JarvisWeb";
    static final String AGENTE_JARVIS = "Jarvis/1.0 (Android)";
    static final String AGENTE_NAVEGADOR =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

    private static final int MAX_PAGINA = 2_000_000;
    private static final int MAX_TEXTO = 8000;
    private static final int MAX_REDIRECCIONES = 5;
    private static final int MAX_RESPUESTA_API = 4_000_000;
    private static final int CONEXION_MS = 10_000;

    // ---------- Búsqueda ----------

    /**
     * Tavily si hay Ajustes.TAVILY ({respuesta, resultados:[{titulo, url, resumen}]}); si no, DuckDuckGo HTML
     * (https://html.duckduckgo.com/html/?kl=ar-es&q=…, decodificando uddg=) y, si falla, la API de búsqueda de Wikipedia en español.
     */
    static JSONObject buscar(Context c, String consulta) throws Exception {
        String q = consulta == null ? "" : consulta.trim();
        if (q.isEmpty()) throw new IllegalArgumentException("Falta la consulta.");
        if (Ajustes.tiene(c, Ajustes.TAVILY)) {
            try {
                JSONObject r = tavily(Ajustes.texto(c, Ajustes.TAVILY), q);
                if (r != null) return r;
            } catch (IOException | JSONException e) {
                // Si Tavily se cae o se acabó el cupo, se sigue con la búsqueda gratuita.
                Log.w(TAG, "Tavily: " + e.getMessage() + ", uso DuckDuckGo");
            }
        }
        try {
            JSONArray resultados = duckDuckGo(q);
            if (resultados.length() > 0) return new JSONObject().put("resultados", resultados);
        } catch (IOException e) {
            Log.w(TAG, "DuckDuckGo: " + e.getMessage());
        }
        try {
            return new JSONObject().put("resultados", wikipedia(q));
        } catch (IOException | JSONException e) {
            Log.w(TAG, "Wikipedia: " + e.getMessage());
            throw new ErrorWeb("No pude buscar en internet.", e);
        }
    }

    /** null si Tavily respondió con error (para pasar a DuckDuckGo). */
    private static JSONObject tavily(String clave, String consulta) throws IOException, JSONException {
        JSONObject cuerpo = new JSONObject()
                .put("query", consulta)
                .put("max_results", 5)
                .put("include_answer", true);
        Map<String, String> cabeceras = new HashMap<>();
        cabeceras.put("Authorization", "Bearer " + clave);
        cabeceras.put("Content-Type", "application/json");
        Respuesta res = pedir("POST", "https://api.tavily.com/search", AGENTE_JARVIS, cabeceras,
                cuerpo.toString().getBytes(StandardCharsets.UTF_8), 20_000, MAX_RESPUESTA_API, false);
        if (!res.ok()) {
            Log.w(TAG, "Tavily HTTP " + res.codigo + ", uso DuckDuckGo");
            return null;
        }
        JSONObject r = new JSONObject(res.texto());
        JSONArray resultados = new JSONArray();
        JSONArray lista = r.optJSONArray("results");
        if (lista != null) {
            for (int i = 0; i < lista.length(); i++) {
                JSONObject x = lista.optJSONObject(i);
                if (x == null) continue;
                resultados.put(new JSONObject()
                        .put("titulo", campo(x, "title"))
                        .put("url", campo(x, "url"))
                        .put("resumen", recortar(campo(x, "content"), 500)));
            }
        }
        JSONObject salida = new JSONObject();
        String respuesta = campo(r, "answer").trim();
        if (!respuesta.isEmpty()) salida.put("respuesta", respuesta);
        return salida.put("resultados", resultados);
    }

    private static final Pattern ENLACE = Pattern.compile("<a\\s([^>]*)>(.*?)</a\\s*>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern CLASE = Pattern.compile("\\bclass\\s*=\\s*[\"']([^\"']*)[\"']", Pattern.CASE_INSENSITIVE);
    private static final Pattern HREF = Pattern.compile("\\bhref\\s*=\\s*[\"']([^\"']*)[\"']", Pattern.CASE_INSENSITIVE);
    private static final Pattern UDDG = Pattern.compile("[?&]uddg=([^&]+)");

    private static JSONArray duckDuckGo(String consulta) throws IOException {
        return parsearDuckDuckGo(obtener("https://html.duckduckgo.com/html/?kl=ar-es&q=" + codificar(consulta), AGENTE_NAVEGADOR, 15_000));
    }

    static JSONArray parsearDuckDuckGo(String html) {
        JSONArray resultados = new JSONArray();
        JSONObject actual = null;
        Matcher m = ENLACE.matcher(html);
        // Se recorren los enlaces en orden: cada "result__a" abre un resultado y el "result__snippet" que sigue es su resumen.
        while (m.find()) {
            String atributos = m.group(1);
            Matcher clase = CLASE.matcher(atributos);
            if (!clase.find()) continue;
            String clases = " " + clase.group(1) + " ";
            try {
                if (clases.contains(" result__a ")) {
                    if (resultados.length() >= 6) break;
                    Matcher href = HREF.matcher(atributos);
                    String url = href.find() ? urlDeDuckDuckGo(href.group(1)) : "";
                    if (url.isEmpty()) {
                        actual = null; // publicidad o enlace interno de DuckDuckGo
                        continue;
                    }
                    actual = new JSONObject().put("titulo", aTexto(m.group(2), false)).put("url", url).put("resumen", "");
                    resultados.put(actual);
                } else if (clases.contains(" result__snippet ") && actual != null && actual.optString("resumen").isEmpty()) {
                    actual.put("resumen", aTexto(m.group(2), false));
                }
            } catch (JSONException ignorada) {
            }
        }
        return resultados;
    }

    /** Saca la URL real del enlace de DuckDuckGo ("" si es publicidad o no se entiende). */
    private static String urlDeDuckDuckGo(String href) {
        String url = href.replace("&amp;", "&");
        Matcher real = UDDG.matcher(url);
        if (real.find()) url = decodificar(real.group(1));
        else if (url.startsWith("//")) url = "https:" + url;
        String minusculas = url.toLowerCase(Locale.ROOT);
        if (!minusculas.startsWith("http://") && !minusculas.startsWith("https://")) return "";
        if (minusculas.matches("^https?://([a-z0-9-]+\\.)*duckduckgo\\.com([/?#].*)?$")) return "";
        return url;
    }

    private static JSONArray wikipedia(String consulta) throws IOException, JSONException {
        JSONObject r = obtenerJson("https://es.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=5&srsearch="
                + codificar(consulta), AGENTE_JARVIS, 15_000);
        JSONArray resultados = new JSONArray();
        JSONObject query = r.optJSONObject("query");
        JSONArray lista = query == null ? null : query.optJSONArray("search");
        if (lista == null) return resultados;
        for (int i = 0; i < lista.length(); i++) {
            JSONObject s = lista.optJSONObject(i);
            if (s == null) continue;
            String titulo = campo(s, "title");
            resultados.put(new JSONObject()
                    .put("titulo", titulo)
                    .put("url", "https://es.wikipedia.org/wiki/" + codificar(titulo.replace(' ', '_')))
                    .put("resumen", aTexto(campo(s, "snippet"), false)));
        }
        return resultados;
    }

    // ---------- Leer una página ----------

    private static final Pattern TIPO_TEXTO = Pattern.compile("text|html|json|xml", Pattern.CASE_INSENSITIVE);

    /** {titulo, url, texto (máx. 8000 caracteres, sin scripts/estilos)}. Rechaza la red local (ver {@link #validarUrl}). */
    static JSONObject leerPagina(String url) throws Exception {
        String actual = validarUrl(url);
        long limite = System.nanoTime() + 40_000_000_000L;
        for (int saltos = 0; ; saltos++) {
            URL destino = new URL(actual);
            comprobarDestino(destino.getHost());
            HttpURLConnection con = null;
            try {
                int codigo;
                String tipo;
                byte[] cuerpo;
                try {
                    con = (HttpURLConnection) destino.openConnection();
                    // Las redirecciones se siguen a mano para validar cada destino: que una página no nos lleve a la red local.
                    con.setInstanceFollowRedirects(false);
                    con.setConnectTimeout(CONEXION_MS);
                    con.setReadTimeout(20_000);
                    con.setRequestProperty("User-Agent", AGENTE_NAVEGADOR);
                    con.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5");
                    con.setRequestProperty("Accept-Language", "es-AR,es;q=0.9,en;q=0.5");
                    codigo = con.getResponseCode();
                    if (esRedireccion(codigo)) {
                        String ubicacion = con.getHeaderField("Location");
                        if (ubicacion == null || ubicacion.trim().isEmpty()) {
                            throw new ErrorWeb("La página redirige sin decir a dónde.");
                        }
                        if (saltos >= MAX_REDIRECCIONES) throw new ErrorWeb("La página redirige demasiadas veces.");
                        actual = siguienteDestino(destino, ubicacion.trim());
                        continue;
                    }
                    if (codigo < 200 || codigo >= 300) throw new ErrorWeb("La página respondió " + codigo + ".");
                    tipo = con.getContentType() == null ? "" : con.getContentType();
                    if (!TIPO_TEXTO.matcher(tipo).find()) {
                        throw new ErrorWeb("No es una página de texto (" + (tipo.isEmpty() ? "sin tipo" : tipo) + ").");
                    }
                    try (InputStream entrada = con.getInputStream()) {
                        // Una página lenta no traba a Jarvis: pasado el tiempo se usa lo que llegó.
                        cuerpo = leer(entrada, MAX_PAGINA, limite, true);
                    }
                } catch (IOException e) {
                    throw esNuestro(e) ? e : errorDeRed(destino.getHost(), e);
                }
                return extraer(cuerpo, tipo, actual);
            } finally {
                if (con != null) con.disconnect();
            }
        }
    }

    private static boolean esRedireccion(int codigo) {
        return codigo == 301 || codigo == 302 || codigo == 303 || codigo == 307 || codigo == 308;
    }

    private static String siguienteDestino(URL desde, String ubicacion) throws IOException {
        String absoluta;
        try {
            absoluta = new URL(desde, ubicacion).toString();
        } catch (MalformedURLException e) {
            throw new ErrorWeb("La página redirige a una dirección inválida.");
        }
        try {
            return validarUrl(absoluta);
        } catch (IllegalArgumentException e) {
            if (RED_LOCAL.equals(e.getMessage())) throw new IllegalArgumentException("La página redirige a la red local.");
            throw e;
        }
    }

    /** Error con un mensaje propio, ya en español: no se envuelve como error de red. */
    static final class ErrorWeb extends IOException {
        ErrorWeb(String mensaje) {
            super(mensaje);
        }

        ErrorWeb(String mensaje, Throwable causa) {
            super(mensaje, causa);
        }
    }

    private static boolean esNuestro(IOException e) {
        return e instanceof ErrorWeb;
    }

    private static JSONObject extraer(byte[] cuerpo, String tipo, String url) throws JSONException {
        String html = new String(cuerpo, charsetDe(tipo, cuerpo));
        String minusculas = tipo.toLowerCase(Locale.ROOT);
        String titulo = "";
        String texto;
        if (!minusculas.contains("html") && !minusculas.contains("xml")) {
            // JSON o texto plano: va tal cual, solo se ordenan los espacios.
            texto = ordenarEspacios(html, true);
        } else {
            titulo = titulo(html);
            texto = aTexto(html, true);
        }
        return new JSONObject().put("titulo", titulo).put("url", url).put("texto", recortar(texto, MAX_TEXTO));
    }

    private static String titulo(String html) {
        String minusculas = minusculasAscii(html);
        int inicio = minusculas.indexOf("<title");
        while (inicio >= 0 && inicio + 6 < minusculas.length() && Character.isLetterOrDigit(minusculas.charAt(inicio + 6))) {
            inicio = minusculas.indexOf("<title", inicio + 6);
        }
        if (inicio < 0) return "";
        int abre = minusculas.indexOf('>', inicio);
        if (abre < 0) return "";
        int cierra = minusculas.indexOf("</title", abre);
        if (cierra < 0) return "";
        return recortar(aTexto(html.substring(abre + 1, cierra), false), 300);
    }

    // ---------- Seguridad de las direcciones ----------

    private static final String RED_LOCAL = "No se permiten direcciones de la red local.";
    private static final String SOLO_HTTP = "Solo se permiten URLs http o https.";
    private static final String INVALIDA = "URL inválida.";
    private static final Pattern ESQUEMA = Pattern.compile("^([a-zA-Z][a-zA-Z0-9+.-]*):");
    private static final Pattern HOST_VALIDO = Pattern.compile("^[a-z0-9_.-]+$");
    private static final Pattern IPV6 = Pattern.compile("^[0-9a-f:.]+$");
    private static final Pattern IPV4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");

    /** Solo http/https y nunca localhost, IPs privadas (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc/fd/fe80) ni .local. */
    static String validarUrl(String url) {
        // Como un navegador: se ignoran tabs y saltos de línea, y "www.algo.com" se toma como https.
        String t = url == null ? "" : url.replaceAll("[\\t\\r\\n]", "").trim();
        if (t.isEmpty()) throw new IllegalArgumentException(INVALIDA);
        if (t.startsWith("//")) t = "https:" + t;
        String esquema;
        String resto;
        Matcher m = ESQUEMA.matcher(t);
        if (m.find() && !t.substring(m.end()).matches("^\\d+([/?#].*)?$")) {
            esquema = m.group(1).toLowerCase(Locale.ROOT);
            if (!esquema.equals("http") && !esquema.equals("https")) throw new IllegalArgumentException(SOLO_HTTP);
            resto = t.substring(m.end());
        } else {
            esquema = "https"; // sin esquema ("www.algo.com" o "algo.com:8080/x")
            resto = t;
        }
        // "https:algo.com", "https:/algo.com" o con barras invertidas: los navegadores lo entienden igual.
        int barras = 0;
        while (barras < resto.length() && (resto.charAt(barras) == '/' || resto.charAt(barras) == '\\')) barras++;
        resto = resto.substring(barras);

        int finAutoridad = resto.length();
        for (int i = 0; i < resto.length(); i++) {
            char ch = resto.charAt(i);
            if (ch == '/' || ch == '\\' || ch == '?' || ch == '#') {
                finAutoridad = i;
                break;
            }
        }
        String autoridad = resto.substring(0, finAutoridad);
        String camino = resto.substring(finAutoridad);
        // Usuario y clave en la URL no hacen falta para leer una página: se descartan.
        int arroba = autoridad.lastIndexOf('@');
        if (arroba >= 0) autoridad = autoridad.substring(arroba + 1);

        String host;
        String puerto = "";
        if (autoridad.startsWith("[")) {
            int cierre = autoridad.indexOf(']');
            if (cierre < 0) throw new IllegalArgumentException(INVALIDA);
            host = autoridad.substring(1, cierre).toLowerCase(Locale.ROOT);
            String despues = autoridad.substring(cierre + 1);
            if (!despues.isEmpty()) {
                if (!despues.startsWith(":")) throw new IllegalArgumentException(INVALIDA);
                puerto = despues.substring(1);
            }
            if (!IPV6.matcher(host).matches() || !host.contains(":")) throw new IllegalArgumentException(INVALIDA);
        } else {
            int dosPuntos = autoridad.lastIndexOf(':');
            if (dosPuntos >= 0) {
                puerto = autoridad.substring(dosPuntos + 1);
                autoridad = autoridad.substring(0, dosPuntos);
            }
            host = normalizarHost(autoridad);
        }
        int numeroPuerto = -1;
        if (!puerto.isEmpty()) {
            if (!puerto.matches("\\d{1,5}")) throw new IllegalArgumentException(INVALIDA);
            numeroPuerto = Integer.parseInt(puerto);
            if (numeroPuerto > 65535) throw new IllegalArgumentException(INVALIDA);
            if ((esquema.equals("http") && numeroPuerto == 80) || (esquema.equals("https") && numeroPuerto == 443)) numeroPuerto = -1;
        }
        if (esDireccionPrivada(host)) throw new IllegalArgumentException(RED_LOCAL);

        String hostUrl = host.contains(":") ? "[" + host + "]" : host;
        String normalizada = esquema + "://" + hostUrl + (numeroPuerto >= 0 ? ":" + numeroPuerto : "") + normalizarCamino(camino);
        // Control final: lo que va a usar la conexión tiene que ser exactamente el host que se validó.
        try {
            String visto = new URL(normalizada).getHost().toLowerCase(Locale.ROOT);
            if (visto.startsWith("[") && visto.endsWith("]")) visto = visto.substring(1, visto.length() - 1);
            if (!visto.equals(host)) throw new IllegalArgumentException(INVALIDA);
        } catch (MalformedURLException e) {
            throw new IllegalArgumentException(INVALIDA);
        }
        return normalizada;
    }

    /** Host en minúsculas, con IDN en ASCII y las IPv4 escritas raro ("0x7f.1", "2130706433") pasadas a la forma normal. */
    private static String normalizarHost(String crudo) {
        String host = decodificar(crudo).toLowerCase(Locale.ROOT);
        boolean ascii = true;
        for (int i = 0; i < host.length(); i++) if (host.charAt(i) >= 0x80) ascii = false;
        if (!ascii) {
            try {
                host = IDN.toASCII(host, IDN.ALLOW_UNASSIGNED).toLowerCase(Locale.ROOT);
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException(INVALIDA);
            }
        }
        while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        if (host.isEmpty() || !HOST_VALIDO.matcher(host).matches()) throw new IllegalArgumentException(INVALIDA);
        String ipv4 = ipv4Flexible(host);
        return ipv4 != null ? ipv4 : host;
    }

    /**
     * Interpreta el host como lo haría inet_aton (lo que usa el sistema para resolver): 1 a 4 partes en decimal, hexa (0x)
     * u octal (0…). Devuelve la IPv4 normal o null si no es una IP.
     */
    private static String ipv4Flexible(String host) {
        String[] partes = host.split("\\.", -1);
        if (partes.length > 4) return null;
        long[] valores = new long[partes.length];
        for (int i = 0; i < partes.length; i++) {
            String p = partes[i];
            if (p.isEmpty() || p.length() > 12) return null;
            int base = 10;
            if (p.startsWith("0x")) {
                base = 16;
                p = p.substring(2);
                if (p.isEmpty()) p = "0";
            } else if (p.length() > 1 && p.startsWith("0")) {
                base = 8;
                p = p.substring(1);
            }
            try {
                valores[i] = Long.parseLong(p, base);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        long ip = 0;
        for (int i = 0; i < valores.length - 1; i++) {
            if (valores[i] > 255) throw new IllegalArgumentException(INVALIDA);
            ip = (ip << 8) | valores[i];
        }
        int bytesFinales = 5 - valores.length;
        long ultimo = valores[valores.length - 1];
        if (ultimo >= (1L << (8 * bytesFinales))) throw new IllegalArgumentException(INVALIDA);
        ip = (ip << (8 * bytesFinales)) | ultimo;
        return ((ip >> 24) & 255) + "." + ((ip >> 16) & 255) + "." + ((ip >> 8) & 255) + "." + (ip & 255);
    }

    /** Escapa lo que no puede ir en una URL (espacios, acentos…) sin tocar lo que ya venía escapado. */
    private static String normalizarCamino(String camino) {
        String fragmento = null;
        int numeral = camino.indexOf('#');
        if (numeral >= 0) {
            fragmento = camino.substring(numeral + 1);
            camino = camino.substring(0, numeral);
        }
        int pregunta = camino.indexOf('?');
        String ruta = pregunta >= 0 ? camino.substring(0, pregunta) : camino;
        String consulta = pregunta >= 0 ? camino.substring(pregunta + 1) : null;
        ruta = ruta.replace('\\', '/');
        if (ruta.isEmpty()) ruta = "/";
        StringBuilder sb = new StringBuilder();
        escapar(sb, ruta, "/");
        if (consulta != null) {
            sb.append('?');
            escapar(sb, consulta, "/?");
        }
        if (fragmento != null) {
            sb.append('#');
            escapar(sb, fragmento, "/?");
        }
        return sb.toString();
    }

    private static final String PERMITIDOS = "-._~!$&'()*+,;=:@";

    private static void escapar(StringBuilder sb, String s, String extra) {
        byte[] bytes = s.getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < bytes.length; i++) {
            int b = bytes[i] & 0xff;
            char ch = (char) b;
            boolean valido = b < 0x80 && (Character.isLetterOrDigit(ch) || PERMITIDOS.indexOf(ch) >= 0 || extra.indexOf(ch) >= 0);
            if (valido) {
                sb.append(ch);
            } else if (b == '%' && i + 2 < bytes.length && esHexa(bytes[i + 1]) && esHexa(bytes[i + 2])) {
                sb.append('%'); // ya escapado
            } else {
                porciento(sb, b);
            }
        }
    }

    private static boolean esHexa(byte b) {
        return (b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F');
    }

    // Evita que una página o un mensaje malicioso haga que Jarvis lea servicios de tu red local.
    private static boolean esDireccionPrivada(String host) {
        String h = host.toLowerCase(Locale.ROOT);
        if (h.startsWith("[") && h.endsWith("]")) h = h.substring(1, h.length() - 1);
        while (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.isEmpty() || h.equals("localhost")) return true;
        for (String sufijo : new String[] {".localhost", ".local", ".internal", ".lan", ".home.arpa"}) {
            if (h.endsWith(sufijo)) return true;
        }
        if (h.contains(":")) {
            // IPv6 literal: solo pasan las globales (2000::/3), escritas de forma simple. Así quedan afuera ::1, fc/fd, fe80,
            // las que llevan una IPv4 adentro (::ffff:127.0.0.1) y cualquier forma rara.
            if (!h.matches("^[0-9a-f:]+$")) return true;
            String primero = h.substring(0, h.indexOf(':'));
            return primero.length() != 4 || (primero.charAt(0) != '2' && primero.charAt(0) != '3');
        }
        Matcher ip = IPV4.matcher(h);
        if (ip.matches()) {
            int a = Integer.parseInt(ip.group(1));
            int b = Integer.parseInt(ip.group(2));
            return ipv4Privada(a, b) || a > 255 || b > 255;
        }
        // Un nombre sin puntos ("router", "impresora") es de la red local.
        return !h.contains(".");
    }

    private static boolean ipv4Privada(int a, int b) {
        return a == 0 || a == 10 || a == 127 || (a == 169 && b == 254) || (a == 172 && b >= 16 && b <= 31)
                || (a == 192 && b == 168) || (a == 100 && b >= 64 && b <= 127) || a >= 224;
    }

    /** Segunda barrera: un nombre público que resuelve a una IP local ("127.0.0.1.nip.io") tampoco pasa. */
    private static void comprobarDestino(String host) {
        InetAddress[] direcciones;
        try {
            direcciones = InetAddress.getAllByName(host);
        } catch (UnknownHostException e) {
            return; // la conexión va a dar el error de red claro
        }
        for (InetAddress d : direcciones) {
            if (esLocal(d)) throw new IllegalArgumentException(RED_LOCAL);
        }
    }

    private static boolean esLocal(InetAddress d) {
        if (d.isAnyLocalAddress() || d.isLoopbackAddress() || d.isLinkLocalAddress() || d.isSiteLocalAddress()
                || d.isMulticastAddress()) {
            return true;
        }
        byte[] b = d.getAddress();
        if (d instanceof Inet4Address) return ipv4Privada(b[0] & 0xff, b[1] & 0xff);
        if (d instanceof Inet6Address) {
            if ((b[0] & 0xfe) == 0xfc) return true; // fc00::/7
            boolean ceros = true;
            for (int i = 0; i < 10; i++) if (b[i] != 0) ceros = false;
            // IPv4 compatible (::a.b.c.d) o mapeada (::ffff:a.b.c.d), por si el sistema no la convirtió.
            if (ceros && ((b[10] == 0 && b[11] == 0) || (b[10] == (byte) 0xff && b[11] == (byte) 0xff))) {
                return ipv4Privada(b[12] & 0xff, b[13] & 0xff);
            }
            // NAT64 (64:ff9b::/96) con una IPv4 privada adentro.
            if (b[0] == 0 && b[1] == 0x64 && b[2] == (byte) 0xff && b[3] == (byte) 0x9b) {
                return ipv4Privada(b[12] & 0xff, b[13] & 0xff);
            }
        }
        return false;
    }

    // ---------- HTML → texto ----------

    // Elementos cuyo contenido no es texto para leer: se saltean enteros.
    private static final String[] OMITIR = {"script", "style", "noscript", "svg", "template", "iframe", "nav", "footer", "header", "head"};
    // Script y estilo sin cerrar se comen el resto de la página (como en un navegador).
    private static final String[] SIN_CERRAR_HASTA_EL_FINAL = {"script", "style", "noscript", "template"};
    private static final String[] BLOQUES = {
        "p", "div", "li", "ul", "ol", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section", "article",
        "blockquote", "pre", "hr", "dd", "dt", "dl", "main", "aside", "form", "figure", "figcaption", "title",
    };

    /**
     * Pasa HTML a texto en una sola recorrida (sin regex que puedan trabarse con una página maliciosa).
     * @param renglones true respeta los saltos de párrafo; false deja todo en una línea.
     */
    static String aTexto(String html, boolean renglones) {
        if (html == null || html.isEmpty()) return "";
        String minusculas = minusculasAscii(html);
        int n = html.length();
        StringBuilder sb = new StringBuilder(Math.min(n, 1 << 16));
        // Lo que ya se sabe que no aparece más adelante, para no recorrer la página una y otra vez (tiempo lineal).
        Set<String> sinCierre = new HashSet<>();
        boolean[] sinComilla = new boolean[2];
        int i = 0;
        while (i < n) {
            char ch = html.charAt(i);
            if (ch == '&') {
                i = entidad(html, i, sb);
                continue;
            }
            if (ch != '<') {
                sb.append(ch);
                i++;
                continue;
            }
            if (html.startsWith("<!--", i)) {
                int fin = html.indexOf("-->", i + 4);
                i = fin < 0 ? n : fin + 3;
                continue;
            }
            if (html.startsWith("<![CDATA[", i)) {
                int fin = html.indexOf("]]>", i + 9);
                sb.append(html, i + 9, fin < 0 ? n : fin);
                i = fin < 0 ? n : fin + 3;
                continue;
            }
            int j = i + 1;
            boolean cierre = j < n && html.charAt(j) == '/';
            if (cierre) j++;
            if (j < n && (html.charAt(j) == '!' || html.charAt(j) == '?')) {
                int fin = html.indexOf('>', j);
                i = fin < 0 ? n : fin + 1;
                continue;
            }
            int inicioNombre = j;
            while (j < n && esLetraDeEtiqueta(minusculas.charAt(j))) j++;
            if (j == inicioNombre) {
                // "<3" o "a < b": no es una etiqueta, es texto.
                sb.append('<');
                i++;
                continue;
            }
            String nombre = minusculas.substring(inicioNombre, j);
            int finEtiqueta = finDeEtiqueta(html, j, sinComilla);
            if (finEtiqueta < 0) break; // etiqueta cortada al final
            i = finEtiqueta + 1;
            if (!cierre && contiene(OMITIR, nombre)) {
                int fin = sinCierre.contains(nombre) ? -1 : buscarCierre(minusculas, nombre, i);
                if (fin < 0) sinCierre.add(nombre);
                if (fin >= 0) {
                    i = fin;
                } else if (contiene(SIN_CERRAR_HASTA_EL_FINAL, nombre)) {
                    i = n;
                }
                sb.append(renglones ? '\n' : ' ');
                continue;
            }
            if (contiene(BLOQUES, nombre)) sb.append(renglones ? '\n' : ' ');
            else if (nombre.equals("td") || nombre.equals("th")) sb.append(' ');
        }
        return ordenarEspacios(sb.toString(), renglones);
    }

    /**
     * Posición del '>' que cierra la etiqueta, salteando los valores entre comillas (title="a > b"). Como en un navegador,
     * la comilla solo abre un valor después de un '=' (en alt=Juan's es parte del texto).
     * @param sinComilla [doble, simple]: ya se sabe que esa comilla no vuelve a aparecer.
     */
    private static int finDeEtiqueta(String html, int desde, boolean[] sinComilla) {
        int n = html.length();
        char anterior = ' ';
        int i = desde;
        while (i < n) {
            char ch = html.charAt(i);
            if (ch == '>') return i;
            if ((ch == '"' || ch == '\'') && anterior == '=') {
                int cual = ch == '"' ? 0 : 1;
                int cierre = sinComilla[cual] ? -1 : html.indexOf(ch, i + 1);
                if (cierre < 0) {
                    // Comilla sin cerrar: como fallback, el primer '>' que haya.
                    sinComilla[cual] = true;
                    return html.indexOf('>', i);
                }
                i = cierre + 1;
                anterior = ch;
                continue;
            }
            if (!Character.isWhitespace(ch)) anterior = ch;
            i++;
        }
        return -1;
    }

    /**
     * Minúsculas solo en ASCII: mismo largo que el original, así las posiciones sirven para los dos
     * (toLowerCase puede cambiar el largo, por ejemplo con "İ").
     */
    private static String minusculasAscii(String s) {
        char[] letras = s.toCharArray();
        for (int i = 0; i < letras.length; i++) {
            char ch = letras[i];
            if (ch >= 'A' && ch <= 'Z') letras[i] = (char) (ch + 32);
        }
        return new String(letras);
    }

    private static boolean esLetraDeEtiqueta(char ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == ':';
    }

    /** Posición después de "</nombre…>" desde {@code desde}, o -1. */
    private static int buscarCierre(String minusculas, String nombre, int desde) {
        String buscado = "</" + nombre;
        int k = desde;
        while (true) {
            k = minusculas.indexOf(buscado, k);
            if (k < 0) return -1;
            int despues = k + buscado.length();
            if (despues >= minusculas.length()) return -1;
            char ch = minusculas.charAt(despues);
            if (ch == '>' || Character.isWhitespace(ch) || ch == '/') {
                int fin = minusculas.indexOf('>', despues);
                return fin < 0 ? -1 : fin + 1;
            }
            k = despues;
        }
    }

    private static boolean contiene(String[] lista, String valor) {
        for (String s : lista) if (s.equals(valor)) return true;
        return false;
    }

    private static final Map<String, String> ENTIDADES = new HashMap<>();

    static {
        String[] pares = {
            "amp", "&", "lt", "<", "gt", ">", "quot", "\"", "apos", "'", "nbsp", " ", "aacute", "á", "eacute", "é",
            "iacute", "í", "oacute", "ó", "uacute", "ú", "Aacute", "Á", "Eacute", "É", "Iacute", "Í", "Oacute", "Ó",
            "Uacute", "Ú", "ntilde", "ñ", "Ntilde", "Ñ", "uuml", "ü", "Uuml", "Ü", "iexcl", "¡", "iquest", "¿",
            "laquo", "«", "raquo", "»", "ldquo", "“", "rdquo", "”", "lsquo", "‘", "rsquo", "’", "sbquo", "‚",
            "bdquo", "„", "mdash", "—", "ndash", "–", "hellip", "…", "middot", "·", "bull", "•", "copy", "©",
            "reg", "®", "trade", "™", "deg", "°", "euro", "€", "pound", "£", "cent", "¢", "ordm", "º", "ordf", "ª",
            "times", "×", "divide", "÷", "plusmn", "±", "frac12", "½", "frac14", "¼", "frac34", "¾", "sup2", "²",
            "sup3", "³", "agrave", "à", "egrave", "è", "ccedil", "ç", "acirc", "â", "ecirc", "ê", "ocirc", "ô",
            "ouml", "ö", "auml", "ä", "shy", "", "zwj", "", "zwnj", "", "thinsp", " ", "ensp", " ", "emsp", " ",
        };
        for (int i = 0; i < pares.length; i += 2) ENTIDADES.put(pares[i], pares[i + 1]);
    }

    /** Decodifica la entidad que empieza en {@code i} (o deja el '&' tal cual) y devuelve dónde seguir. */
    private static int entidad(String s, int i, StringBuilder sb) {
        // Se mira solo un poco hacia adelante: una página llena de '&' sin ';' no puede volver lento esto.
        int fin = -1;
        for (int k = i + 1; k < s.length() && k <= i + 12; k++) {
            char ch = s.charAt(k);
            if (ch == ';') {
                fin = k;
                break;
            }
            if (!Character.isLetterOrDigit(ch) && ch != '#') break;
        }
        if (fin < 0) {
            sb.append('&');
            return i + 1;
        }
        String nombre = s.substring(i + 1, fin);
        if (nombre.startsWith("#")) {
            try {
                int codigo = nombre.length() > 1 && (nombre.charAt(1) == 'x' || nombre.charAt(1) == 'X')
                        ? Integer.parseInt(nombre.substring(2), 16)
                        : Integer.parseInt(nombre.substring(1));
                if (codigo >= 0x80 && codigo <= 0x9F && Charset.isSupported("windows-1252")) {
                    // Como los navegadores: &#147; son las comillas de windows-1252.
                    sb.append(new String(new byte[] {(byte) codigo}, Charset.forName("windows-1252")));
                } else if (codigo > 0 && codigo <= 0x10FFFF && (codigo < 0xD800 || codigo > 0xDFFF)) {
                    sb.appendCodePoint(codigo == 0xA0 ? ' ' : codigo);
                }
                return fin + 1;
            } catch (NumberFormatException e) {
                sb.append('&');
                return i + 1;
            }
        }
        String valor = ENTIDADES.get(nombre);
        if (valor == null) valor = ENTIDADES.get(nombre.toLowerCase(Locale.ROOT));
        if (valor == null) {
            sb.append('&');
            return i + 1;
        }
        sb.append(valor);
        return fin + 1;
    }

    /** Decodifica entidades HTML/XML ("&amp;", "&#39;", "&#x1F600;"…) sin tocar nada más. */
    static String decodificarEntidades(String s) {
        if (s == null || s.indexOf('&') < 0) return s == null ? "" : s;
        StringBuilder sb = new StringBuilder(s.length());
        int i = 0;
        while (i < s.length()) {
            char ch = s.charAt(i);
            if (ch == '&') {
                i = entidad(s, i, sb);
            } else {
                sb.append(ch);
                i++;
            }
        }
        return sb.toString();
    }

    /** Junta los espacios repetidos; con renglones deja un salto entre párrafos. */
    static String ordenarEspacios(String s, boolean renglones) {
        StringBuilder sb = new StringBuilder(s.length());
        boolean espacio = false;
        boolean salto = false;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            boolean esSalto = ch == '\n';
            if (esSalto && renglones) {
                salto = true;
                espacio = false;
            } else if (Character.isWhitespace(ch) || Character.isSpaceChar(ch) || ch == '\u00A0' || ch == '\uFEFF') {
                if (!salto) espacio = true;
            } else if (Character.getType(ch) == Character.FORMAT) {
                // caracteres invisibles (U+200B, U+00AD…): fuera
            } else {
                if (sb.length() > 0) {
                    if (salto) sb.append('\n');
                    else if (espacio) sb.append(' ');
                }
                salto = false;
                espacio = false;
                sb.append(ch);
            }
        }
        return sb.toString();
    }

    /** Texto de un campo JSON externo: "" si falta o es null (optString devolvería "null"). */
    static String campo(JSONObject o, String clave) {
        return o == null || o.isNull(clave) ? "" : o.optString(clave, "");
    }

    static String recortar(String s, int maximo) {
        if (s == null) return "";
        if (s.length() <= maximo) return s;
        int corte = maximo;
        if (Character.isHighSurrogate(s.charAt(corte - 1))) corte--;
        return s.substring(0, corte);
    }

    // ---------- Codificación de URLs ----------

    private static final char[] HEXA = "0123456789ABCDEF".toCharArray();

    private static void porciento(StringBuilder sb, int b) {
        sb.append('%').append(HEXA[(b >> 4) & 15]).append(HEXA[b & 15]);
    }

    /** Como encodeURIComponent de JavaScript. */
    static String codificar(String s) {
        StringBuilder sb = new StringBuilder();
        for (byte x : s.getBytes(StandardCharsets.UTF_8)) {
            int b = x & 0xff;
            char ch = (char) b;
            if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || "-_.!~*'()".indexOf(ch) >= 0) {
                sb.append(ch);
            } else {
                porciento(sb, b);
            }
        }
        return sb.toString();
    }

    /** Como decodeURIComponent, pero sin fallar: lo que no se entiende queda como estaba. El '+' no se toca. */
    static String decodificar(String s) {
        if (s.indexOf('%') < 0) return s;
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(s.length());
        int i = 0;
        while (i < s.length()) {
            char ch = s.charAt(i);
            if (ch == '%' && i + 2 < s.length()
                    && Character.digit(s.charAt(i + 1), 16) >= 0 && Character.digit(s.charAt(i + 2), 16) >= 0) {
                bytes.write(Character.digit(s.charAt(i + 1), 16) * 16 + Character.digit(s.charAt(i + 2), 16));
                i += 3;
            } else {
                byte[] b = String.valueOf(ch).getBytes(StandardCharsets.UTF_8);
                if (Character.isHighSurrogate(ch) && i + 1 < s.length()) {
                    b = s.substring(i, i + 2).getBytes(StandardCharsets.UTF_8);
                    i++;
                }
                bytes.write(b, 0, b.length);
                i++;
            }
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }

    // ---------- HTTP (también lo usa Info) ----------

    static final class Respuesta {
        final int codigo;
        final String tipo;
        final byte[] cuerpo;

        Respuesta(int codigo, String tipo, byte[] cuerpo) {
            this.codigo = codigo;
            this.tipo = tipo;
            this.cuerpo = cuerpo;
        }

        boolean ok() {
            return codigo >= 200 && codigo < 300;
        }

        String texto() {
            return new String(cuerpo, charsetDe(tipo, cuerpo));
        }
    }

    /**
     * GET de texto a un servicio conocido (sigue redirecciones). Lanza IOException con un mensaje para decir en voz alta,
     * también si responde con un código de error ("HTTP 503 en api.open-meteo.com").
     */
    static String obtener(String url, String agente, int tiempoMs) throws IOException {
        Respuesta r = pedir("GET", url, agente, null, null, tiempoMs, MAX_RESPUESTA_API, false);
        if (!r.ok()) throw new ErrorWeb("HTTP " + r.codigo + " en " + host(url));
        return r.texto();
    }

    /** Como {@link #obtener} pero parsea JSON; si llega otra cosa (un portal cautivo, por ejemplo) lo dice claro. */
    static JSONObject obtenerJson(String url, String agente, int tiempoMs) throws IOException {
        String texto = obtener(url, agente, tiempoMs);
        try {
            return new JSONObject(texto);
        } catch (JSONException e) {
            throw new ErrorWeb(host(url) + " devolvió una respuesta que no entiendo.");
        }
    }

    /**
     * Pedido HTTP genérico. No lanza por códigos de error (se ven en {@link Respuesta#codigo}); los problemas de red sí,
     * como IOException con un mensaje en español.
     * @param cortar true = si la respuesta pasa de maxBytes o del tiempo total, se usa lo que llegó; false = error.
     */
    static Respuesta pedir(String metodo, String url, String agente, Map<String, String> cabeceras, byte[] cuerpo,
            int tiempoMs, int maxBytes, boolean cortar) throws IOException {
        String host = host(url);
        URL destino;
        try {
            destino = new URL(url);
        } catch (MalformedURLException e) {
            throw new ErrorWeb("URL inválida.");
        }
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) destino.openConnection();
            con.setRequestMethod(metodo);
            con.setConnectTimeout(Math.min(CONEXION_MS, tiempoMs));
            con.setReadTimeout(tiempoMs);
            con.setUseCaches(false);
            con.setRequestProperty("User-Agent", agente);
            if (cabeceras != null) for (Map.Entry<String, String> e : cabeceras.entrySet()) con.setRequestProperty(e.getKey(), e.getValue());
            if (cuerpo != null) {
                con.setDoOutput(true);
                con.setFixedLengthStreamingMode(cuerpo.length);
                try (OutputStream salida = con.getOutputStream()) {
                    salida.write(cuerpo);
                }
            }
            int codigo = con.getResponseCode();
            String tipo = con.getContentType() == null ? "" : con.getContentType();
            InputStream entrada = codigo >= 400 ? con.getErrorStream() : con.getInputStream();
            byte[] datos = new byte[0];
            if (entrada != null) {
                try (InputStream in = entrada) {
                    // El tiempo total se limita a dos veces el de lectura: un servidor que manda de a gotas no traba a Jarvis.
                    long limite = System.nanoTime() + 2L * tiempoMs * 1_000_000L;
                    datos = leer(in, codigo >= 400 ? 64 * 1024 : maxBytes, limite, cortar || codigo >= 400);
                }
            }
            return new Respuesta(codigo, tipo, datos);
        } catch (IOException e) {
            throw esNuestro(e) ? e : errorDeRed(host, e);
        } finally {
            if (con != null) con.disconnect();
        }
    }

    private static byte[] leer(InputStream in, int maximo, long limiteNanos, boolean cortar) throws IOException {
        ByteArrayOutputStream salida = new ByteArrayOutputStream(16 * 1024);
        byte[] buffer = new byte[16 * 1024];
        while (true) {
            if (System.nanoTime() > limiteNanos) {
                if (cortar) break;
                throw new SocketTimeoutException("tiempo total agotado");
            }
            int n = in.read(buffer, 0, Math.min(buffer.length, maximo + 1 - salida.size()));
            if (n < 0) break;
            salida.write(buffer, 0, n);
            if (salida.size() > maximo) {
                if (cortar) break;
                throw new ErrorWeb("La respuesta es demasiado grande.");
            }
        }
        byte[] datos = salida.toByteArray();
        if (datos.length > maximo) {
            byte[] recortado = new byte[maximo];
            System.arraycopy(datos, 0, recortado, 0, maximo);
            return recortado;
        }
        return datos;
    }

    private static String host(String url) {
        try {
            String h = new URL(url).getHost();
            return h == null || h.isEmpty() ? url : h;
        } catch (MalformedURLException e) {
            return url;
        }
    }

    /** Traduce el error de red a algo que Jarvis pueda decir. */
    static ErrorWeb errorDeRed(String host, IOException e) {
        String mensaje;
        if (e instanceof UnknownHostException) mensaje = "No pude conectarme a " + host + ". Fijate si hay internet.";
        else if (e instanceof SocketTimeoutException) mensaje = host + " tardó demasiado en responder.";
        else if (e instanceof SSLException) mensaje = "Falló la conexión segura con " + host + ".";
        else if (e instanceof ConnectException || e instanceof NoRouteToHostException) mensaje = "No pude conectarme a " + host + ".";
        else mensaje = "Se cortó la conexión con " + host + ".";
        return new ErrorWeb(mensaje, e);
    }

    private static final Pattern CHARSET = Pattern.compile("charset\\s*=\\s*[\"']?\\s*([\\w.:-]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern META_CHARSET = Pattern.compile(
            "<meta[^>]+charset\\s*=\\s*[\"']?\\s*([\\w.:-]+)", Pattern.CASE_INSENSITIVE);

    /** BOM, después el Content-Type, después el meta charset del HTML; si no, UTF-8. */
    static Charset charsetDe(String tipo, byte[] cuerpo) {
        if (cuerpo.length >= 3 && (cuerpo[0] & 0xff) == 0xEF && (cuerpo[1] & 0xff) == 0xBB && (cuerpo[2] & 0xff) == 0xBF) {
            return StandardCharsets.UTF_8;
        }
        if (cuerpo.length >= 2 && (cuerpo[0] & 0xff) == 0xFE && (cuerpo[1] & 0xff) == 0xFF) return StandardCharsets.UTF_16BE;
        if (cuerpo.length >= 2 && (cuerpo[0] & 0xff) == 0xFF && (cuerpo[1] & 0xff) == 0xFE) return StandardCharsets.UTF_16LE;
        Charset cs = null;
        Matcher m = CHARSET.matcher(tipo == null ? "" : tipo);
        if (m.find()) cs = charset(m.group(1));
        if (cs == null) {
            String inicio = new String(cuerpo, 0, Math.min(cuerpo.length, 4096), StandardCharsets.ISO_8859_1);
            Matcher meta = META_CHARSET.matcher(inicio);
            if (meta.find()) cs = charset(meta.group(1));
        }
        return cs != null ? cs : StandardCharsets.UTF_8;
    }

    private static Charset charset(String nombre) {
        try {
            Charset cs = Charset.forName(nombre);
            // Los navegadores leen "latin1" como windows-1252 (comillas tipográficas, €…).
            if (cs.equals(StandardCharsets.ISO_8859_1) && Charset.isSupported("windows-1252")) return Charset.forName("windows-1252");
            return cs;
        } catch (RuntimeException e) {
            return null;
        }
    }
}
