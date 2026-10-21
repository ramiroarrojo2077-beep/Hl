package ar.gravity.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Vuelve a prender el motor al reiniciar el celular o al actualizar la app, y despierta al
 * celular para las rutinas (alarma que programa el motor). Corre en el proceso ":motor".
 * Si apagaste Gravity desde la app o todavía no cargaste la clave, no hace nada.
 */
class Despertador : BroadcastReceiver() {
    override fun onReceive(contexto: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, DESPERTAR -> Unit
            else -> return
        }
        if (Gravity.apagadoAMano(contexto) || !Clave.existe(contexto)) return
        val motor = Motor.instancia
        if (motor != null) {
            motor.despertar()
            return
        }
        try {
            Motor.enviar(contexto, Motor.ACCION_DESPERTAR)
        } catch (e: Exception) {
            // Android no dejó arrancar un servicio desde segundo plano (pasa con alarmas aproximadas
            // sin la excepción de batería). Arranca la próxima vez que abras la app.
        }
    }

    companion object {
        const val DESPERTAR = "ar.gravity.app.DESPERTAR_RUTINA"
    }
}
