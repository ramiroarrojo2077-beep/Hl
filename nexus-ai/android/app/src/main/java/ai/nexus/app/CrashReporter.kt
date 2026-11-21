package ai.nexus.app

import ai.nexus.app.data.model.CrashBody
import android.content.Context
import android.os.Build
import kotlinx.coroutines.launch
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Reporte de fallos con consentimiento. Ante un cierre inesperado se guarda SOLO el último
 * stacktrace en el almacenamiento privado de la app. Al volver a abrir: si el usuario dio su
 * consentimiento (Privacidad), se envía a su propio servidor NEXUS y se borra; si no, se borra.
 */
object CrashReporter {
    private const val FILE = "last_crash.txt"

    fun install(context: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                val sw = StringWriter()
                error.printStackTrace(PrintWriter(sw))
                File(context.filesDir, FILE).writeText(sw.toString().take(20_000))
            }
            previous?.uncaughtException(thread, error)
        }
    }

    fun flush(container: AppContainer) {
        val file = File(container.appContext.filesDir, FILE)
        if (!file.exists()) return
        container.scope.launch {
            try {
                val consent = runCatching { container.api.jarvisSettings().privacy.crashReportsConsent }.getOrDefault(false)
                if (consent) {
                    container.api.reportCrash(CrashBody(BuildConfig.VERSION_NAME, "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}",
                        file.readText()))
                }
            } finally {
                file.delete()
            }
        }
    }
}
