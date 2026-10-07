package com.jarvis.asistente;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Todo lo que Jarvis recuerda, en un JSON dentro del celular: historial de charla, memoria, recordatorios,
 * avisos y borradores. Mismo formato que la versión de PC.
 *
 * Para leer o modificar los arreglos, sincronizar sobre la instancia: {@code synchronized (almacen) {...}}
 * y después llamar a {@link #guardar()}.
 */
final class Almacen {
    private static final String TAG = "JarvisAlmacen";
    private static final int MAX_HISTORIAL = 200;
    private static final int MAX_AVISOS = 200;
    private static final int MAX_PROPUESTAS = 100;
    private static Almacen instancia;

    private final File archivo;
    private final ScheduledExecutorService escritor = Executors.newSingleThreadScheduledExecutor();
    private ScheduledFuture<?> pendiente;
    private JSONObject datos;

    static synchronized Almacen de(Context c) {
        if (instancia == null) instancia = new Almacen(c.getApplicationContext());
        return instancia;
    }

    private Almacen(Context c) {
        archivo = new File(c.getFilesDir(), "jarvis.json");
        try {
            datos = new JSONObject(new String(Files.readAllBytes(archivo.toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) {
            datos = new JSONObject();
        }
        try {
            if (!datos.has("activa")) datos.put("activa", true);
            for (String lista : new String[] {"historial", "memoria", "recordatorios", "avisos", "propuestas"}) {
                if (datos.optJSONArray(lista) == null) datos.put(lista, new JSONArray());
            }
            if (!datos.has("ultimoResumen")) datos.put("ultimoResumen", "");
        } catch (JSONException ignorada) {
        }
    }

    synchronized boolean activa() {
        return datos.optBoolean("activa", true);
    }

    synchronized void activa(boolean valor) {
        try {
            datos.put("activa", valor);
        } catch (JSONException ignorada) {
        }
        guardar();
    }

    /** Arreglos vivos: modificarlos dentro de synchronized (almacen) y después llamar a guardar(). */
    synchronized JSONArray historial() { return datos.optJSONArray("historial"); }
    synchronized JSONArray memoria() { return datos.optJSONArray("memoria"); }
    synchronized JSONArray recordatorios() { return datos.optJSONArray("recordatorios"); }
    synchronized JSONArray avisos() { return datos.optJSONArray("avisos"); }
    synchronized JSONArray propuestas() { return datos.optJSONArray("propuestas"); }

    synchronized String ultimoResumen() {
        return datos.optString("ultimoResumen", "");
    }

    synchronized void ultimoResumen(String dia) {
        try {
            datos.put("ultimoResumen", dia);
        } catch (JSONException ignorada) {
        }
        guardar();
    }

    /** Reemplaza un arreglo entero (por ejemplo, después de filtrarlo). */
    synchronized void reemplazar(String lista, JSONArray nuevo) {
        try {
            datos.put(lista, nuevo);
        } catch (JSONException ignorada) {
        }
        guardar();
    }

    /** Busca por "id" dentro de un arreglo. */
    synchronized JSONObject buscar(JSONArray lista, String id) {
        for (int i = 0; i < lista.length(); i++) {
            JSONObject o = lista.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    /** Agrupa escrituras seguidas en una sola y escribe de forma atómica. */
    synchronized void guardar() {
        if (pendiente != null) pendiente.cancel(false);
        pendiente = escritor.schedule(this::escribir, 300, TimeUnit.MILLISECONDS);
    }

    private void escribir() {
        String json;
        synchronized (this) {
            recortar("historial", MAX_HISTORIAL);
            recortar("avisos", MAX_AVISOS);
            recortar("propuestas", MAX_PROPUESTAS);
            json = datos.toString();
        }
        File temporal = new File(archivo.getPath() + ".tmp");
        try (FileOutputStream salida = new FileOutputStream(temporal)) {
            salida.write(json.getBytes(StandardCharsets.UTF_8));
            salida.getFD().sync();
        } catch (Exception e) {
            Log.w(TAG, "No pude guardar: " + e.getMessage());
            return;
        }
        if (!temporal.renameTo(archivo)) Log.w(TAG, "No pude reemplazar jarvis.json");
    }

    private void recortar(String lista, int maximo) {
        JSONArray arreglo = datos.optJSONArray(lista);
        if (arreglo == null || arreglo.length() <= maximo) return;
        JSONArray recortado = new JSONArray();
        for (int i = arreglo.length() - maximo; i < arreglo.length(); i++) recortado.put(arreglo.opt(i));
        try {
            datos.put(lista, recortado);
        } catch (JSONException ignorada) {
        }
    }

    static String nuevoId() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    /** Fecha y hora actual en ISO 8601 UTC, como la versión de PC ("2026-10-07T19:05:33.693Z"). */
    static String ahora() {
        return iso(System.currentTimeMillis());
    }

    static String iso(long milisegundos) {
        SimpleDateFormat formato = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formato.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formato.format(new Date(milisegundos));
    }

    /** Lee un ISO 8601 (con Z, con offset o sin zona = hora local del celular). Devuelve -1 si no se entiende. */
    static long leerIso(String texto) {
        if (texto == null) return -1;
        String t = texto.trim();
        String[] formatos = {
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX", "yyyy-MM-dd'T'HH:mmXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm",
        };
        for (String f : formatos) {
            try {
                SimpleDateFormat formato = new SimpleDateFormat(f, Locale.US);
                formato.setLenient(false);
                Date d = formato.parse(t);
                if (d != null) return d.getTime();
            } catch (Exception ignorada) {
            }
        }
        return -1;
    }
}
