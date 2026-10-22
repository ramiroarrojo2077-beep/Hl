package ar.gravity.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Vuelve a prender el motor al reiniciar el celular o al actualizar la app, y despierta al
 * celular para las rutinas (alarma que programa el motor). Corre en el proceso ":motor".
 * Si apagaste Gravity desde la app o todavía no cargaste una clave, no hace nada.
 */
class Despertador : BroadcastReceiver() {
    override fun onReceive(contexto: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> despertarMotor(contexto)
        }
    }
}

/** La alarma de las rutinas. No exportado: solo lo dispara la alarma de la propia app. */
class DespertadorRutina : BroadcastReceiver() {
    override fun onReceive(contexto: Context, intent: Intent) {
        despertarMotor(contexto)
    }
}

private fun despertarMotor(contexto: Context) {
        if (Gravity.apagadoAMano(contexto) || !Clave.lista(contexto)) return
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
