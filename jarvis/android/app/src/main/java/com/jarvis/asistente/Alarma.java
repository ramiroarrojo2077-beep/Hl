package com.jarvis.asistente;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/** Recibe las alarmas de recordatorios y del resumen diario (programadas por Asistente.programar). */
public class Alarma extends BroadcastReceiver {
    @Override
    public void onReceive(Context contexto, Intent intent) {
        PendingResult resultado = goAsync();
        Context app = contexto.getApplicationContext();
        new Thread(() -> {
            try {
                Asistente.revisarAgenda(app);
            } catch (Exception e) {
                Log.w("JarvisAlarma", "No pude revisar la agenda: " + e.getMessage());
            } finally {
                resultado.finish();
            }
        }, "jarvis-alarma").start();
    }
}
