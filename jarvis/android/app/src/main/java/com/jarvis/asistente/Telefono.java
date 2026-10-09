package com.jarvis.asistente;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.KeyEvent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * Lo propio del celular: agenda (el calendario de Google ya sincronizado en el teléfono, sin configurar nada),
 * contactos, música, volumen, linterna, navegación, cámara, portapapeles, ajustes rápidos y llamadas.
 * Los errores son Exception con un mensaje en español para que Jarvis los diga en voz alta.
 */
final class Telefono {
    private Telefono() {}

    private static final Locale AR = new Locale("es", "AR");

    private static boolean tiene(Context c, String permiso) {
        return c.checkSelfPermission(permiso) == PackageManager.PERMISSION_GRANTED;
    }

    private static String sinAcentos(String texto) {
        return Normalizer.normalize(texto == null ? "" : texto, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).trim();
    }

    private static void abrir(Context c, Intent i, String siFalla) throws Exception {
        try {
            c.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException e) {
            throw new Exception(siFalla);
        }
    }

    // ---------- Contactos ----------

    /** [{nombre, telefonos:[...], emails:[...]}] de los contactos cuyo nombre contiene lo buscado (máx. 5). */
    static JSONArray buscarContactos(Context c, String nombre) throws Exception {
        if (!tiene(c, Manifest.permission.READ_CONTACTS)) {
            throw new Exception("No tengo permiso para ver tus contactos. Dámelo en los permisos de Jarvis.");
        }
        String buscado = sinAcentos(nombre);
        if (buscado.isEmpty()) throw new Exception("¿De quién?");
        Map<Long, JSONObject> encontrados = new LinkedHashMap<>();
        ContentResolver cr = c.getContentResolver();
        try (Cursor cur = cr.query(ContactsContract.Contacts.CONTENT_URI,
                new String[] {ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY},
                null, null, ContactsContract.Contacts.TIMES_CONTACTED + " DESC")) {
            // Primero coincidencias exactas, después las que contienen el nombre.
            Map<Long, JSONObject> contienen = new LinkedHashMap<>();
            while (cur != null && cur.moveToNext()) {
                String visible = cur.getString(1);
                String normal = sinAcentos(visible);
                if (normal.isEmpty() || !normal.contains(buscado)) continue;
                JSONObject contacto = new JSONObject().put("nombre", visible).put("telefonos", new JSONArray()).put("emails", new JSONArray());
                if (normal.equals(buscado) || normal.startsWith(buscado + " ")) encontrados.put(cur.getLong(0), contacto);
                else contienen.put(cur.getLong(0), contacto);
            }
            for (Map.Entry<Long, JSONObject> e : contienen.entrySet()) encontrados.putIfAbsent(e.getKey(), e.getValue());
        }
        JSONArray salida = new JSONArray();
        for (Map.Entry<Long, JSONObject> e : encontrados.entrySet()) {
            if (salida.length() >= 5) break;
            String id = String.valueOf(e.getKey());
            try (Cursor t = cr.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[] {ContactsContract.CommonDataKinds.Phone.NUMBER},
                    ContactsContract.CommonDataKinds.Phone.CONTACT_ID + "=?", new String[] {id}, null)) {
                while (t != null && t.moveToNext()) e.getValue().getJSONArray("telefonos").put(t.getString(0));
            }
            try (Cursor m = cr.query(ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                    new String[] {ContactsContract.CommonDataKinds.Email.ADDRESS},
                    ContactsContract.CommonDataKinds.Email.CONTACT_ID + "=?", new String[] {id}, null)) {
                while (m != null && m.moveToNext()) e.getValue().getJSONArray("emails").put(m.getString(0));
            }
            salida.put(e.getValue());
        }
        return salida;
    }

    /** {nombre, numero} del primer contacto con teléfono que coincide, o null. */
    static JSONObject telefonoDe(Context c, String nombre) throws Exception {
        JSONArray contactos = buscarContactos(c, nombre);
        for (int i = 0; i < contactos.length(); i++) {
            JSONObject k = contactos.getJSONObject(i);
            JSONArray tels = k.getJSONArray("telefonos");
            if (tels.length() > 0) return new JSONObject().put("nombre", k.getString("nombre")).put("numero", tels.getString(0));
        }
        return null;
    }

    /** Pasa un número de la agenda al formato internacional que pide WhatsApp (ej: 5491112345678). */
    static String internacional(Context c, String numero) {
        String digitos = numero.replaceAll("[^0-9+]", "");
        if (digitos.startsWith("+")) return digitos.substring(1).replace("+", "");
        digitos = digitos.replace("+", "");
        if (digitos.startsWith("00")) return digitos.substring(2);
        if ("AR".equalsIgnoreCase(Ajustes.texto(c, Ajustes.PAIS))) {
            if (digitos.startsWith("54")) return digitos;
            if (digitos.startsWith("0")) digitos = digitos.substring(1);
            // Celulares de Argentina: 54 + 9 + característica + número (sin el 15).
            return "549" + digitos.replaceFirst("^(\\d{2,4})15(\\d{6,8})$", "$1$2");
        }
        return digitos.startsWith("0") ? digitos.substring(1) : digitos;
    }

    // ---------- Llamadas ----------

    /**
     * Llama directo si el usuario lo pidió con sus palabras y dio permiso de llamadas; si no, abre el marcador.
     * @param nombreONumero un número o el nombre de un contacto.
     */
    static JSONObject llamar(Context c, String nombreONumero, boolean directo) throws Exception {
        String numero = nombreONumero;
        String nombre = null;
        if (nombreONumero.matches(".*\\p{L}.*")) {
            JSONObject contacto = telefonoDe(c, nombreONumero);
            if (contacto == null) throw new Exception("No encontré a " + nombreONumero + " en tus contactos, o no tiene teléfono.");
            numero = contacto.getString("numero");
            nombre = contacto.getString("nombre");
        }
        String limpio = numero.replaceAll("[^0-9*#+]", "");
        if (limpio.replaceAll("\\D", "").length() < 3) throw new Exception("Ese número de teléfono no parece válido.");
        boolean llamaSola = directo && tiene(c, Manifest.permission.CALL_PHONE);
        abrir(c, new Intent(llamaSola ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.fromParts("tel", limpio, null)),
                "No encontré la app de teléfono.");
        JSONObject r = new JSONObject().put("numero", limpio).put("llamando", llamaSola);
        if (nombre != null) r.put("contacto", nombre);
        if (!llamaSola) r.put("nota", "Abrí el teléfono con el número: falta que el usuario toque llamar.");
        return r;
    }

    // ---------- Agenda ----------

    private static String hora(long ms, boolean todoElDia) {
        return new SimpleDateFormat(todoElDia ? "EEEE d/M" : "EEEE d/M HH:mm", AR).format(new Date(ms));
    }

    /** [{titulo, inicio, fin, todoElDia, lugar, cuando}] entre dos momentos (de todos los calendarios visibles). */
    static JSONArray agenda(Context c, long desde, long hasta) throws Exception {
        if (!tiene(c, Manifest.permission.READ_CALENDAR)) {
            throw new Exception("No tengo permiso para ver tu calendario. Dámelo en los permisos de Jarvis.");
        }
        Uri.Builder b = CalendarContract.Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(b, desde);
        ContentUris.appendId(b, hasta);
        JSONArray salida = new JSONArray();
        try (Cursor cur = c.getContentResolver().query(b.build(),
                new String[] {CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
                        CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.EVENT_LOCATION},
                CalendarContract.Instances.VISIBLE + "=1", null, CalendarContract.Instances.BEGIN + " ASC")) {
            while (cur != null && cur.moveToNext() && salida.length() < 50) {
                boolean todoElDia = cur.getInt(3) == 1;
                long inicio = cur.getLong(1);
                // Los eventos de todo el día vienen en UTC: se corrigen a la zona del celular.
                if (todoElDia) inicio -= TimeZone.getDefault().getOffset(inicio);
                salida.put(new JSONObject()
                        .put("titulo", cur.getString(0) == null ? "(sin título)" : cur.getString(0))
                        .put("inicio", Almacen.iso(inicio))
                        .put("fin", Almacen.iso(cur.getLong(2)))
                        .put("todoElDia", todoElDia)
                        .put("lugar", cur.getString(4) == null ? "" : cur.getString(4))
                        .put("cuando", hora(inicio, todoElDia)));
            }
        }
        return salida;
    }

    /** Crea un evento en tu calendario principal; si no hay permiso, abre la pantalla de nuevo evento ya completa. */
    static JSONObject crearEvento(Context c, String titulo, long inicio, long fin, String lugar, String descripcion) throws Exception {
        if (titulo.isEmpty()) throw new Exception("¿Cómo se llama el evento?");
        if (fin <= inicio) fin = inicio + 60 * 60_000L;
        if (tiene(c, Manifest.permission.WRITE_CALENDAR)) {
            long calendario = calendarioPrincipal(c);
            if (calendario >= 0) {
                ContentValues v = new ContentValues();
                v.put(CalendarContract.Events.CALENDAR_ID, calendario);
                v.put(CalendarContract.Events.TITLE, titulo);
                v.put(CalendarContract.Events.DTSTART, inicio);
                v.put(CalendarContract.Events.DTEND, fin);
                v.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
                if (!lugar.isEmpty()) v.put(CalendarContract.Events.EVENT_LOCATION, lugar);
                if (!descripcion.isEmpty()) v.put(CalendarContract.Events.DESCRIPTION, descripcion);
                Uri creado = c.getContentResolver().insert(CalendarContract.Events.CONTENT_URI, v);
                if (creado != null) {
                    // Aviso 15 minutos antes, como hace la app de Calendario.
                    ContentValues aviso = new ContentValues();
                    aviso.put(CalendarContract.Reminders.EVENT_ID, ContentUris.parseId(creado));
                    aviso.put(CalendarContract.Reminders.MINUTES, 15);
                    aviso.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                    try {
                        c.getContentResolver().insert(CalendarContract.Reminders.CONTENT_URI, aviso);
                    } catch (RuntimeException ignorada) {
                    }
                    return new JSONObject().put("creado", titulo).put("cuando", hora(inicio, false));
                }
            }
        }
        Intent i = new Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, inicio)
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, fin)
                .putExtra(CalendarContract.Events.TITLE, titulo)
                .putExtra(CalendarContract.Events.EVENT_LOCATION, lugar)
                .putExtra(CalendarContract.Events.DESCRIPTION, descripcion);
        abrir(c, i, "No encontré la app de calendario.");
        return new JSONObject().put("abierto", true).put("nota", "Abrí el calendario con el evento completo: falta tocar guardar.");
    }

    private static long calendarioPrincipal(Context c) {
        long elegido = -1;
        try (Cursor cur = c.getContentResolver().query(CalendarContract.Calendars.CONTENT_URI,
                new String[] {CalendarContract.Calendars._ID, CalendarContract.Calendars.IS_PRIMARY, CalendarContract.Calendars.ACCOUNT_TYPE},
                CalendarContract.Calendars.VISIBLE + "=1 AND " + CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + ">="
                        + CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR, null, null)) {
            while (cur != null && cur.moveToNext()) {
                // Preferimos el principal de la cuenta de Google.
                if (cur.getInt(1) == 1 && "com.google".equals(cur.getString(2))) return cur.getLong(0);
                if (elegido < 0 || cur.getInt(1) == 1) elegido = cur.getLong(0);
            }
        } catch (RuntimeException ignorada) {
        }
        return elegido;
    }

    // ---------- Música, volumen y linterna ----------

    /** accion: reproducir | pausar | siguiente | anterior. Controla lo que esté sonando (Spotify, YouTube Music…). */
    static JSONObject musica(Context c, String accion) throws Exception {
        int tecla;
        switch (sinAcentos(accion)) {
            case "reproducir": case "play": case "seguir": tecla = KeyEvent.KEYCODE_MEDIA_PLAY; break;
            case "pausar": case "pausa": case "parar": tecla = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
            case "siguiente": tecla = KeyEvent.KEYCODE_MEDIA_NEXT; break;
            case "anterior": tecla = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
            default: throw new Exception("No entendí qué hacer con la música.");
        }
        AudioManager audio = c.getSystemService(AudioManager.class);
        long ahora = SystemClock.uptimeMillis();
        audio.dispatchMediaKeyEvent(new KeyEvent(ahora, ahora, KeyEvent.ACTION_DOWN, tecla, 0));
        audio.dispatchMediaKeyEvent(new KeyEvent(ahora, ahora, KeyEvent.ACTION_UP, tecla, 0));
        return new JSONObject().put("listo", accion);
    }

    /** accion: subir | bajar | silenciar | vibrar | sonido, o nivel 0-100 para la música. */
    static JSONObject volumen(Context c, String accion, Integer nivel) throws Exception {
        AudioManager audio = c.getSystemService(AudioManager.class);
        int maximo = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        if (nivel != null) {
            int valor = Math.round(Math.max(0, Math.min(100, nivel)) * maximo / 100f);
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, valor, AudioManager.FLAG_SHOW_UI);
        } else {
            switch (sinAcentos(accion)) {
                case "subir": audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI); break;
                case "bajar": audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI); break;
                case "silenciar": audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI); break;
                case "vibrar":
                    try {
                        audio.setRingerMode(AudioManager.RINGER_MODE_VIBRATE);
                    } catch (SecurityException e) {
                        throw new Exception("Android no me deja cambiar el modo de sonido mientras está en No molestar.");
                    }
                    break;
                case "sonido":
                    try {
                        audio.setRingerMode(AudioManager.RINGER_MODE_NORMAL);
                    } catch (SecurityException e) {
                        throw new Exception("Android no me deja cambiar el modo de sonido mientras está en No molestar.");
                    }
                    break;
                default: throw new Exception("No entendí qué hacer con el volumen.");
            }
        }
        int actual = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        return new JSONObject().put("volumenMusica", Math.round(actual * 100f / Math.max(1, maximo)) + "%");
    }

    static JSONObject linterna(Context c, boolean prender) throws Exception {
        CameraManager camaras = c.getSystemService(CameraManager.class);
        for (String id : camaras.getCameraIdList()) {
            Boolean flash = camaras.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
            if (Boolean.TRUE.equals(flash)) {
                camaras.setTorchMode(id, prender);
                return new JSONObject().put("linterna", prender ? "prendida" : "apagada");
            }
        }
        throw new Exception("Este celular no tiene linterna.");
    }

    // ---------- Navegación, música por búsqueda, cámara, portapapeles y ajustes ----------

    /** modo: auto | caminando | bici | transporte. Abre Google Maps navegando hacia el destino. */
    static JSONObject navegar(Context c, String destino, String modo) throws Exception {
        if (destino.isEmpty()) throw new Exception("¿Adónde querés ir?");
        String m;
        switch (sinAcentos(modo)) {
            case "caminando": case "a pie": m = "w"; break;
            case "bici": case "bicicleta": m = "b"; break;
            case "transporte": case "colectivo": case "subte": m = "l"; break;
            default: m = "d";
        }
        Intent navegacion = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(destino) + "&mode=" + m));
        try {
            abrir(c, navegacion, "");
        } catch (Exception sinMaps) {
            abrir(c, new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(destino))), "No encontré una app de mapas.");
        }
        return new JSONObject().put("navegandoA", destino);
    }

    /** app: spotify | youtube. Abre la búsqueda de la canción, artista o video. */
    static JSONObject reproducir(Context c, String que, String app) throws Exception {
        if (que.isEmpty()) throw new Exception("¿Qué querés escuchar?");
        boolean youtube = sinAcentos(app).contains("youtube");
        Uri uri = youtube ? Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(que))
                : Uri.parse("spotify:search:" + Uri.encode(que));
        try {
            abrir(c, new Intent(Intent.ACTION_VIEW, uri), "");
        } catch (Exception sinApp) {
            abrir(c, new Intent(Intent.ACTION_VIEW, Uri.parse(youtube ? uri.toString() : "https://open.spotify.com/search/" + Uri.encode(que))),
                    "No encontré " + (youtube ? "YouTube" : "Spotify") + ".");
        }
        return new JSONObject().put("buscando", que).put("en", youtube ? "YouTube" : "Spotify")
                .put("nota", "Abrí la búsqueda: el usuario elige qué reproducir.");
    }

    static JSONObject camara(Context c, boolean video) throws Exception {
        abrir(c, new Intent(video ? MediaStore.INTENT_ACTION_VIDEO_CAMERA : MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA),
                "No encontré la cámara.");
        return new JSONObject().put("abierta", video ? "cámara de video" : "cámara de fotos");
    }

    static JSONObject copiar(Context c, String texto) throws Exception {
        if (texto.isEmpty()) throw new Exception("¿Qué copio?");
        c.getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Jarvis", texto));
        return new JSONObject().put("copiado", true);
    }

    /** cual: wifi | bluetooth | datos | internet | nfc | volumen | pantalla | bateria | ubicacion | no_molestar. */
    static JSONObject ajustes(Context c, String cual) throws Exception {
        String accion;
        String que = sinAcentos(cual);
        boolean q = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        switch (que) {
            case "wifi": accion = q ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS; break;
            case "internet": case "datos": accion = q ? Settings.Panel.ACTION_INTERNET_CONNECTIVITY : Settings.ACTION_DATA_ROAMING_SETTINGS; break;
            case "nfc": accion = q ? Settings.Panel.ACTION_NFC : Settings.ACTION_NFC_SETTINGS; break;
            case "volumen": accion = q ? Settings.Panel.ACTION_VOLUME : Settings.ACTION_SOUND_SETTINGS; break;
            case "bluetooth": accion = Settings.ACTION_BLUETOOTH_SETTINGS; break;
            case "pantalla": case "brillo": accion = Settings.ACTION_DISPLAY_SETTINGS; break;
            case "bateria": accion = Intent.ACTION_POWER_USAGE_SUMMARY; break;
            case "ubicacion": accion = Settings.ACTION_LOCATION_SOURCE_SETTINGS; break;
            case "no_molestar": case "no molestar": accion = Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS; break;
            default: accion = Settings.ACTION_SETTINGS;
        }
        try {
            abrir(c, new Intent(accion), "");
        } catch (Exception e) {
            abrir(c, new Intent(Settings.ACTION_SETTINGS), "No pude abrir los ajustes.");
        }
        return new JSONObject().put("abierto", cual).put("nota", "Android no deja que las apps cambien esto solas: abrí el ajuste para que lo toque el usuario.");
    }

    /** Para "abrime la alarma de las 7" en el reloj: muestra las alarmas. */
    static JSONObject verAlarmas(Context c) throws Exception {
        abrir(c, new Intent(AlarmClock.ACTION_SHOW_ALARMS), "No encontré la app de reloj.");
        return new JSONObject().put("abierto", "alarmas");
    }
}
