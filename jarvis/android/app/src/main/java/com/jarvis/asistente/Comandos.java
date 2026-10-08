package com.jarvis.asistente;

import android.content.Context;

import org.json.JSONObject;

import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Órdenes simples que Jarvis resuelve al instante en el celular, sin IA ni internet: hora, fecha, alarmas,
 * temporizadores, linterna, volumen, música, llamar y abrir apps. Solo se toman si la frase entera es la orden (así
 * "poné una alarma a las 7 y avisale a Juan" va a la IA, que puede hacer las dos cosas).
 */
final class Comandos {
    private Comandos() {}

    private static final Locale AR = new Locale("es", "AR");

    private static final Pattern LLAMADO = Pattern.compile(
            "^(?:(?:che|ey|eh|hey|hola|oye|ok|okey|bueno|dale)\\s+)?(?:jarvis|yarvis|jarbis)\\s*");
    private static final Pattern RELLENO = Pattern.compile(
            "\\b(?:por favor|porfa|porfis|si podes|podes|podrias|me haces el favor de|quiero que)\\b");

    private static final Pattern HORA = Pattern.compile("^(?:que hora (?:es|son)|hora|decime la hora|me decis la hora|que horas son)$");
    private static final Pattern FECHA = Pattern.compile("^(?:que (?:dia|fecha) es(?: hoy)?|que dia es hoy|a que estamos(?: hoy)?|que fecha es hoy|decime la fecha)$");
    private static final Pattern ALARMA = Pattern.compile(
            "^(?:(?:pone(?:me)?|programa(?:me)?|activa(?:me)?|crea(?:me)?|configura|agenda(?:me)?)\\s+)?(?:una\\s+)?(?:alarma|despertador)\\s+(.+)$");
    private static final Pattern DESPERTAME = Pattern.compile("^despertame\\s+(.+)$");
    private static final Pattern TEMPORIZADOR = Pattern.compile(
            "^(?:(?:pone(?:me)?|activa(?:me)?|crea(?:me)?|arranca(?:me)?|inicia)\\s+)?(?:un\\s+|una\\s+)?(?:temporizador|timer|cuenta regresiva)\\s+(?:de\\s+|por\\s+|para\\s+)?(.+)$");
    private static final Pattern LINTERNA = Pattern.compile(
            "^(prende(?:me)?|encende(?:me)?|activa|pone|apaga(?:me)?|desactiva|saca)\\s+(?:la\\s+)?linterna$|^linterna$");
    private static final Pattern VOLUMEN = Pattern.compile(
            "^(subi(?:le|me)?|aumenta|baja(?:le|me)?|disminui)\\s+(?:un poco\\s+)?(?:el\\s+|la\\s+)?(?:volumen|musica|sonido)(?:\\s+un poco)?$");
    private static final Pattern VOLUMEN_NIVEL = Pattern.compile(
            "^(?:pone(?:me)?\\s+)?(?:el\\s+)?volumen\\s+(?:al|a|en)\\s+(\\d{1,3})(?:\\s*%|\\s+por ciento)?$");
    private static final Pattern MODO = Pattern.compile(
            "^(?:pone(?:me)?|pasa(?:me)?)\\s+(?:el\\s+celular\\s+|el\\s+telefono\\s+)?(?:en\\s+)?(?:modo\\s+)?(silencio|vibrar|vibracion|sonido)$");
    // "Pará" o "frená" solos pueden ser para que Jarvis se calle: con la música tienen que nombrarla.
    private static final Pattern MUSICA = Pattern.compile(
            "^(pausa(?:la)?|segui|reanuda|play|dale play|siguiente|proxima|pasala|saltea(?:la)?|anterior)"
                    + "(?:\\s+(?:la\\s+|el\\s+)?(?:musica|cancion|tema|video))?$"
                    + "|^(para|frena|deten|pausa|segui|reanuda|continua|pasa|volve)\\s+(?:la\\s+|el\\s+|al\\s+|a\\s+la\\s+)?(?:musica|cancion|tema|video)(?:\\s+anterior)?$");
    private static final Pattern LLAMAR = Pattern.compile("^(?:llama(?:me|le)?|llamar|marca(?:le)?)\\s+(?:a\\s+)?(.+)$");
    private static final Pattern ABRIR = Pattern.compile("^(?:abri(?:me)?|abre|abrir|entra (?:a|en))\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+)?(.+)$");
    private static final Pattern REPRODUCIR = Pattern.compile(
            "^(?:pone(?:me)?|reproduci(?:me)?|quiero escuchar)\\s+(?:musica de\\s+|el tema\\s+|la cancion\\s+|a\\s+)?(.+?)\\s+en\\s+(spotify|youtube)$"
                    + "|^(?:pone(?:me)?|reproduci(?:me)?)\\s+musica de\\s+(.+)$");

    private static String normal(String texto) {
        String t = Normalizer.normalize(texto == null ? "" : texto, Normalizer.Form.NFD).replaceAll("\\p{M}", "")
                .toLowerCase(Locale.ROOT);
        t = t.replaceAll("[¡!¿?.,;]+", " ").replaceAll("\\s+", " ").trim();
        t = LLAMADO.matcher(t).replaceFirst("");
        t = RELLENO.matcher(t).replaceAll(" ").replaceAll("\\s+", " ").trim();
        return t;
    }

    /** Una orden entendida: qué herramienta usar (o ninguna) y qué decir si sale bien. */
    static final class Orden {
        final String herramienta;
        final JSONObject argumentos;
        final String respuesta;

        Orden(String herramienta, JSONObject argumentos, String respuesta) {
            this.herramienta = herramienta;
            this.argumentos = argumentos;
            this.respuesta = respuesta;
        }
    }

    /**
     * @return lo que Jarvis contesta (para decirlo en voz alta), o null si no es una orden simple y la tiene que pensar
     *     la IA.
     */
    static String resolver(Context c, String original, Asistente.AlHerramienta alHerramienta) {
        Orden o;
        try {
            o = interpretar(original);
        } catch (Exception e) {
            return null;
        }
        if (o == null) return null;
        if (o.herramienta == null) return o.respuesta;
        if (alHerramienta != null) alHerramienta.usando(o.herramienta);
        String resultado = Herramientas.ejecutar(c, o.herramienta, o.argumentos.toString(), original);
        try {
            JSONObject r = new JSONObject(resultado);
            if (r.has("error")) return r.optString("error");
        } catch (Exception noEsUnObjeto) {
            // Algunas herramientas devuelven una lista: con no ser un error alcanza.
        }
        return o.respuesta;
    }

    /** Las mismas palabras que {@code buscado} (sin tildes) pero como las dijiste, con tildes y mayúsculas. */
    private static String comoLoDijo(String original, String buscado) {
        String[] dichas = original.replaceAll("[¡!¿?.,;]+", " ").trim().split("\\s+");
        String[] buscadas = buscado.trim().split("\\s+");
        for (int i = 0; i + buscadas.length <= dichas.length; i++) {
            boolean igual = true;
            for (int j = 0; j < buscadas.length && igual; j++) {
                igual = Normalizer.normalize(dichas[i + j], Normalizer.Form.NFD).replaceAll("\\p{M}", "")
                        .toLowerCase(Locale.ROOT).equals(buscadas[j]);
            }
            if (igual) return String.join(" ", java.util.Arrays.copyOfRange(dichas, i, i + buscadas.length));
        }
        return buscado;
    }

    /** Entiende la orden sin ejecutarla (null si no es una orden simple). */
    static Orden interpretar(String original) throws Exception {
        String t = normal(original);
        if (t.isEmpty() || t.split(" ").length > 12) return null;
        Matcher m;
        if (HORA.matcher(t).matches()) {
            return new Orden(null, null, "Son las " + new SimpleDateFormat("HH:mm", AR).format(new Date()) + ".");
        }
        if (FECHA.matcher(t).matches()) {
            return new Orden(null, null, "Hoy es " + new SimpleDateFormat("EEEE d 'de' MMMM", AR).format(new Date()) + ".");
        }
        if ((m = ALARMA.matcher(t)).matches() || (m = DESPERTAME.matcher(t)).matches()) {
            String resto = m.group(1);
            String mensaje = "";
            Matcher para = Pattern.compile("^(.+?)\\s+(?:para|que diga)\\s+(?!las?\\b|manana\\b|hoy\\b)(.+)$").matcher(resto);
            if (para.matches()) {
                resto = para.group(1);
                mensaje = comoLoDijo(original, para.group(2));
            }
            int[] hm = hora(resto);
            if (hm == null) return null;
            return new Orden("poner_alarma", new JSONObject().put("hora", hm[0]).put("minutos", hm[1]).put("mensaje", mensaje),
                    String.format(AR, "Listo, alarma a las %02d:%02d%s.", hm[0], hm[1], mensaje.isEmpty() ? "" : " para " + mensaje));
        }
        if ((m = TEMPORIZADOR.matcher(t)).matches()) {
            int segundos = duracion(m.group(1));
            if (segundos <= 0) return null;
            return new Orden("poner_temporizador", new JSONObject().put("segundos", segundos), "Listo, temporizador de " + decirDuracion(segundos) + ".");
        }
        if ((m = LINTERNA.matcher(t)).matches()) {
            String verbo = m.group(1) == null ? "prende" : m.group(1);
            boolean prender = !(verbo.startsWith("apaga") || verbo.startsWith("desactiva") || verbo.startsWith("saca"));
            return new Orden("linterna", new JSONObject().put("prender", prender), prender ? "Linterna prendida." : "Linterna apagada.");
        }
        if ((m = VOLUMEN.matcher(t)).matches()) {
            boolean subir = m.group(1).startsWith("subi") || m.group(1).startsWith("aumenta");
            return new Orden("volumen", new JSONObject().put("accion", subir ? "subir" : "bajar"), subir ? "Subí el volumen." : "Bajé el volumen.");
        }
        if ((m = VOLUMEN_NIVEL.matcher(t)).matches()) {
            int nivel = Math.min(100, Integer.parseInt(m.group(1)));
            return new Orden("volumen", new JSONObject().put("accion", "").put("nivel", nivel), "Volumen al " + nivel + " por ciento.");
        }
        if ((m = MODO.matcher(t)).matches()) {
            String modo = m.group(1).startsWith("vibra") ? "vibrar" : m.group(1).equals("silencio") ? "silenciar" : "sonido";
            return new Orden("volumen", new JSONObject().put("accion", modo),
                    "vibrar".equals(modo) ? "Listo, en vibrar." : "silenciar".equals(modo) ? "Listo, en silencio." : "Listo, con sonido.");
        }
        if ((m = MUSICA.matcher(t)).matches()) {
            String v = m.group(1) != null ? m.group(1) : m.group(2);
            if (t.endsWith("anterior")) v = "anterior";
            String accion = v.startsWith("pausa") || v.equals("para") || v.equals("frena") || v.equals("deten") ? "pausar"
                    : v.startsWith("siguiente") || v.startsWith("proxima") || v.startsWith("pasa") || v.startsWith("saltea") ? "siguiente"
                    : v.startsWith("anterior") || v.startsWith("volve") ? "anterior" : "reproducir";
            String dicho = "pausar".equals(accion) ? "Pausado." : "siguiente".equals(accion) ? "Siguiente." : "anterior".equals(accion) ? "Anterior." : "Dale play.";
            return new Orden("musica", new JSONObject().put("accion", accion), dicho);
        }
        if ((m = REPRODUCIR.matcher(t)).matches()) {
            String que = m.group(1) != null ? m.group(1) : m.group(3);
            if (que != null) que = comoLoDijo(original, que);
            String app = m.group(2) != null ? m.group(2) : "spotify";
            if (que == null || que.split(" ").length > 6) return null;
            return new Orden("reproducir", new JSONObject().put("que", que).put("app", app),
                    "Te pongo " + que + " en " + (app.equals("youtube") ? "YouTube" : "Spotify") + ".");
        }
        if ((m = LLAMAR.matcher(t)).matches()) {
            String quien = comoLoDijo(original, m.group(1).trim());
            if (quien.split(" ").length > 4 || quien.contains(" y ") || quien.contains(" que ")) return null;
            return new Orden("llamar", new JSONObject().put("a_quien", quien), "Llamando a " + quien + ".");
        }
        if ((m = ABRIR.matcher(t)).matches()) {
            String app = comoLoDijo(original, m.group(1).trim());
            if (app.split(" ").length > 3 || app.contains(" y ")) return null;
            return new Orden("abrir", new JSONObject().put("destino", app), "Abriendo " + app + ".");
        }
        return null;
    }

    // ---------- Números, horas y duraciones en castellano ----------

    private static final String[] UNIDADES = {"cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
            "diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete", "dieciocho", "diecinueve", "veinte",
            "veintiuno", "veintidos", "veintitres", "veinticuatro", "veinticinco", "veintiseis", "veintisiete", "veintiocho",
            "veintinueve"};
    private static final String[] DECENAS = {"", "", "", "treinta", "cuarenta", "cincuenta"};

    /** "7", "siete", "treinta y cinco", "una", "un" → número; -1 si no es un número. */
    static int numero(String palabra) {
        String p = palabra.trim();
        if (p.matches("\\d{1,5}")) return Integer.parseInt(p);
        if (p.equals("un") || p.equals("una")) return 1;
        if (p.equals("veintiun") || p.equals("veintiuna")) return 21;
        for (int i = 0; i < UNIDADES.length; i++) if (UNIDADES[i].equals(p)) return i;
        for (int d = 3; d < DECENAS.length; d++) {
            if (p.equals(DECENAS[d])) return d * 10;
            if (p.startsWith(DECENAS[d] + " y ")) {
                int u = numero(p.substring(DECENAS[d].length() + 3));
                if (u >= 1 && u <= 9) return d * 10 + u;
            }
        }
        return -1;
    }

    private static final Pattern HORA_TEXTO = Pattern.compile(
            "^(?:para\\s+)?(?:(?:hoy|manana)\\s+)?(?:(?:a|para)\\s+)?(?:las?\\s+)?([a-z0-9]+)"
                    + "(?:(?::|\\.|\\s+y\\s+|\\s+)([a-z0-9]+(?: y [a-z]+)?|media|cuarto))?"
                    + "(?:\\s+menos\\s+(cuarto|diez|cinco|veinte|\\d{1,2}))?"
                    + "(?:\\s+(?:hs|horas|en punto))?"
                    + "(?:\\s+(de la manana|de la tarde|de la noche|de la madrugada|del mediodia|am|pm|a m|p m))?"
                    + "(?:\\s+(?:de\\s+)?(?:hoy|manana))?$");

    /** "a las 7", "7:30", "las siete y media", "8 menos cuarto", "9 de la noche" → {hora 0-23, minutos}; null si no se entiende. */
    static int[] hora(String texto) {
        Matcher m = HORA_TEXTO.matcher(texto.trim());
        if (!m.matches()) return null;
        int h = numero(m.group(1));
        if (h < 0 || h > 24) return null;
        int min = 0;
        String g2 = m.group(2);
        if (g2 != null) {
            if (g2.equals("media")) min = 30;
            else if (g2.equals("cuarto")) min = 15;
            else {
                min = numero(g2);
                if (min < 0 || min > 59) return null;
            }
        }
        if (m.group(3) != null) {
            int menos = m.group(3).equals("cuarto") ? 15 : numero(m.group(3));
            if (menos <= 0 || min != 0) return null;
            h = (h + 23) % 24;
            min = 60 - menos;
        }
        String parte = m.group(4);
        if (parte != null) {
            boolean tarde = parte.contains("tarde") || parte.contains("noche") || parte.startsWith("p");
            boolean manana = parte.contains("manana") || parte.contains("madrugada") || parte.startsWith("a");
            if (tarde && h < 12) h += 12;
            if (manana && h == 12) h = 0;
            if (parte.contains("noche") && h == 24) h = 0;
        }
        if (h == 24) h = 0;
        return new int[] {h, min};
    }

    private static final Pattern TROZO = Pattern.compile(
            "([a-z0-9]+(?: y [a-z]+)?)\\s*(horas?|hs|minutos?|mins?|segundos?|segs?)\\b(\\s+y\\s+media)?");

    /** "5 minutos", "media hora", "una hora y media", "1 hora y 20 minutos", "30 segundos" → segundos; -1 si no se entiende. */
    static int duracion(String texto) {
        String t = texto.trim().replaceAll("^(?:de|por|para)\\s+", "");
        if (t.equals("media hora")) return 1800;
        if (t.matches("(?:un )?cuarto de hora")) return 900;
        Matcher m = TROZO.matcher(t);
        int total = 0;
        int fin = 0;
        while (m.find()) {
            // Entre un trozo y otro solo puede haber "y".
            if (!t.substring(fin, m.start()).trim().replaceFirst("^y$", "").isEmpty()) return -1;
            int n = numero(m.group(1));
            if (n < 0) return -1;
            int factor = m.group(2).startsWith("h") ? 3600 : m.group(2).startsWith("m") ? 60 : 1;
            total += n * factor + (m.group(3) != null ? factor / 2 : 0);
            fin = m.end();
        }
        if (fin == 0 || !t.substring(fin).trim().isEmpty()) return -1;
        return total > 0 && total <= 24 * 3600 ? total : -1;
    }

    private static String decirDuracion(int segundos) {
        int h = segundos / 3600;
        int m = (segundos % 3600) / 60;
        int s = segundos % 60;
        StringBuilder sb = new StringBuilder();
        if (h > 0) sb.append(h).append(h == 1 ? " hora" : " horas");
        if (m > 0) sb.append(sb.length() > 0 ? " y " : "").append(m).append(m == 1 ? " minuto" : " minutos");
        if (s > 0) sb.append(sb.length() > 0 ? " y " : "").append(s).append(s == 1 ? " segundo" : " segundos");
        return sb.toString();
    }
}
