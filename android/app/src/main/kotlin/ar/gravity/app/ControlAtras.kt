package ar.gravity.app

import android.annotation.TargetApi
import android.app.Activity
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher

/**
 * Botón "atrás" en Android 13+ (API 33). Con predictive back, el sistema ya no llama a
 * onBackPressed: la app registra un callback solo mientras tiene algo propio para hacer
 * (volver en el historial del WebView o cerrar el panel de dirección). Si no hay nada,
 * el gesto vuelve al inicio con la animación del sistema.
 */
@TargetApi(33)
class ControlAtras(private val actividad: Activity, private val alVolver: () -> Unit) {
    private val callback = OnBackInvokedCallback { alVolver() }
    private var registrado = false

    fun activar(activo: Boolean) {
        if (activo == registrado) return
        val despachador = actividad.onBackInvokedDispatcher
        if (activo) {
            despachador.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback)
        } else {
            despachador.unregisterOnBackInvokedCallback(callback)
        }
        registrado = activo
    }
}
