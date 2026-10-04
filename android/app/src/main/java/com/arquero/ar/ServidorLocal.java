package com.arquero.ar;

import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sirve los archivos del juego (assets/www) en http://localhost, sólo dentro del
 * celular. Chrome trata a localhost como origen seguro, así que ahí funcionan la
 * cámara y la realidad aumentada (WebXR), igual que con https.
 */
final class ServidorLocal {
    /** Puerto fijo: así el juego guarda los ajustes siempre en el mismo origen. */
    static final int PUERTO = 8723;

    /** De dónde salen los archivos (en la app, los assets del APK). */
    interface Archivos {
        InputStream abrir(String ruta) throws IOException;
    }

    private static ServidorLocal instancia;

    private final Archivos archivos;
    private final ServerSocket socket;
    private final ExecutorService hilos = Executors.newCachedThreadPool();

    static synchronized ServidorLocal iniciar(Archivos archivos) throws IOException {
        if (instancia == null) instancia = new ServidorLocal(archivos);
        return instancia;
    }

    private ServidorLocal(Archivos archivos) throws IOException {
        this.archivos = archivos;
        this.socket = abrir();
        Thread hilo = new Thread(this::atender, "servidor-local");
        hilo.setDaemon(true);
        hilo.start();
    }

    private static ServerSocket abrir() throws IOException {
        InetAddress local = InetAddress.getByName("127.0.0.1");
        IOException error = null;
        // Si el puerto está ocupado por otra app, prueba los siguientes.
        for (int p = PUERTO; p < PUERTO + 10; p++) {
            try {
                return new ServerSocket(p, 32, local);
            } catch (IOException e) {
                error = e;
            }
        }
        throw error;
    }

    int puerto() {
        return socket.getLocalPort();
    }

    private void atender() {
        while (!socket.isClosed()) {
            try {
                Socket cliente = socket.accept();
                hilos.execute(() -> responder(cliente));
            } catch (IOException ignorado) {
                // Sigue esperando conexiones.
            }
        }
    }

    private void responder(Socket s) {
        try (Socket cliente = s) {
            cliente.setSoTimeout(15000);
            BufferedReader entrada = new BufferedReader(
                    new InputStreamReader(cliente.getInputStream(), StandardCharsets.ISO_8859_1));
            String pedido = entrada.readLine();
            if (pedido == null) return;
            String linea;
            while ((linea = entrada.readLine()) != null && !linea.isEmpty()) {
                // Se ignoran los encabezados.
            }
            OutputStream salida = new BufferedOutputStream(cliente.getOutputStream());
            String[] partes = pedido.split(" ");
            boolean cabecera = partes.length > 0 && partes[0].equals("HEAD");
            if (partes.length < 2 || !(partes[0].equals("GET") || cabecera)) {
                enviar(salida, 405, "Method Not Allowed", "text/plain", texto("Método no permitido"), true);
                return;
            }
            String ruta = URLDecoder.decode(partes[1].split("[?#]")[0], "UTF-8");
            if (ruta.endsWith("/")) ruta += "index.html";
            if (!ruta.startsWith("/") || ruta.contains("..") || ruta.contains("\\")) {
                enviar(salida, 404, "Not Found", "text/plain", texto("No encontrado"), true);
                return;
            }
            byte[] cuerpo;
            try (InputStream archivo = archivos.abrir("www" + ruta)) {
                cuerpo = leerTodo(archivo);
            } catch (IOException e) {
                enviar(salida, 404, "Not Found", "text/plain", texto("No encontrado"), true);
                return;
            }
            enviar(salida, 200, "OK", tipo(ruta), cuerpo, !cabecera);
        } catch (IOException ignorado) {
            // El navegador cortó la conexión.
        }
    }

    private static void enviar(OutputStream salida, int codigo, String estado, String tipo, byte[] cuerpo,
                               boolean conCuerpo) throws IOException {
        String encabezado = "HTTP/1.1 " + codigo + " " + estado + "\r\n"
                + "Content-Type: " + tipo + "\r\n"
                + "Content-Length: " + cuerpo.length + "\r\n"
                + "Cache-Control: no-cache\r\n"
                + "X-Content-Type-Options: nosniff\r\n"
                + "Connection: close\r\n\r\n";
        salida.write(encabezado.getBytes(StandardCharsets.ISO_8859_1));
        if (conCuerpo) salida.write(cuerpo);
        salida.flush();
    }

    private static String tipo(String ruta) {
        String r = ruta.toLowerCase(Locale.ROOT);
        if (r.endsWith(".html")) return "text/html; charset=utf-8";
        if (r.endsWith(".js") || r.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (r.endsWith(".css")) return "text/css; charset=utf-8";
        if (r.endsWith(".json")) return "application/json; charset=utf-8";
        if (r.endsWith(".svg")) return "image/svg+xml";
        if (r.endsWith(".png")) return "image/png";
        if (r.endsWith(".jpg") || r.endsWith(".jpeg")) return "image/jpeg";
        if (r.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static byte[] texto(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] leerTodo(InputStream in) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int n;
        while ((n = in.read(buffer)) > 0) bytes.write(buffer, 0, n);
        return bytes.toByteArray();
    }
}
