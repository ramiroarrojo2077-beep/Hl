package com.jarvis.asistente;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Al prender el celular, Jarvis vuelve a quedar atenta a tus avisos. */
public class Arranque extends BroadcastReceiver {
    @Override
    public void onReceive(Context contexto, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || !Ajustes.configurado(contexto)) return;
        // Android no deja usar el micrófono desde el arranque: la palabra "Jarvis" se activa
        // la próxima vez que abras la app. Los avisos funcionan desde ya.
        Intent servicio = new Intent(contexto, Servicio.class).putExtra(Servicio.EXTRA_SIN_MICROFONO, true);
        contexto.startForegroundService(servicio);
    }
}
