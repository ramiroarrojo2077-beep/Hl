package ar.gravity.app

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.os.SystemClock
import android.view.View
import android.widget.Toast

/**
 * Modo privado: al abrir Gravity, o al volver después de un minuto afuera, pide la huella, el rostro o
 * el PIN del celular. Mientras tanto la pantalla queda oculta. Si se cancela, la app se cierra (los
 * compañeros siguen trabajando en segundo plano). Necesita Android 9 o más y un bloqueo de pantalla.
 */
class Bloqueo(private val activity: Activity, private val vista: View) {
    private val preferencias = activity.getSharedPreferences("gravity", Context.MODE_PRIVATE)
    private var desbloqueado = false
    private var pidiendo = false
    private var salio = 0L

    var activo: Boolean
        get() = preferencias.getBoolean(CLAVE, false)
        private set(valor) { preferencias.edit().putBoolean(CLAVE, valor).apply() }

    /** El celular tiene huella/rostro o PIN configurado y Android 9+. */
    fun disponible(): Boolean =
        Build.VERSION.SDK_INT >= 28 && activity.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true

    fun alSalir() {
        salio = SystemClock.elapsedRealtime()
    }

    fun alVolver() {
        if (!activo || !disponible()) {
            vista.visibility = View.VISIBLE
            return
        }
        if (desbloqueado && SystemClock.elapsedRealtime() - salio < ESPERA_MS) return
        desbloqueado = false
        vista.visibility = View.INVISIBLE
        pedir(cerrarSiCancela = true) {
            desbloqueado = true
            vista.visibility = View.VISIBLE
        }
    }

    /** Prender o apagar desde el menú: siempre se confirma con la huella o el PIN. */
    fun alternar() {
        if (!disponible()) {
            Toast.makeText(activity, R.string.privado_no_disponible, Toast.LENGTH_LONG).show()
            return
        }
        pedir(cerrarSiCancela = false) {
            activo = !activo
            desbloqueado = true
            Toast.makeText(activity, if (activo) R.string.privado_prendido else R.string.privado_apagado, Toast.LENGTH_SHORT).show()
        }
    }

    private fun pedir(cerrarSiCancela: Boolean, alListo: () -> Unit) {
        if (pidiendo || Build.VERSION.SDK_INT < 28) return
        pidiendo = true
        val armado = BiometricPrompt.Builder(activity)
            .setTitle(activity.getString(R.string.privado_titulo))
            .setSubtitle(activity.getString(R.string.privado_subtitulo))
        when {
            Build.VERSION.SDK_INT >= 30 ->
                armado.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
            Build.VERSION.SDK_INT == 29 -> @Suppress("DEPRECATION") armado.setDeviceCredentialAllowed(true)
            else -> armado.setNegativeButton(activity.getString(R.string.privado_cancelar), activity.mainExecutor) { _, _ ->
                pidiendo = false
                if (cerrarSiCancela) activity.finish()
            }
        }
        armado.build().authenticate(
            CancellationSignal(),
            activity.mainExecutor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) {
                    pidiendo = false
                    alListo()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) {
                    pidiendo = false
                    if (cerrarSiCancela) activity.finish()
                }
            },
        )
    }

    private companion object {
        const val CLAVE = "modo_privado"
        const val ESPERA_MS = 60_000L
    }
}
