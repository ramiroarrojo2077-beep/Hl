package ai.nexus.app.voice

import ai.nexus.app.MainActivity
import ai.nexus.app.NexusApplication
import ai.nexus.app.R
import ai.nexus.app.whatsapp.ContactResolver
import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Palabra de activación OPCIONAL ("NEXUS" por defecto). Reglas:
 * - Solo con consentimiento explícito y arrancado por una acción del usuario con la app abierta.
 * - Servicio en primer plano de tipo micrófono con notificación permanente y botón Desactivar
 *   (Android además muestra su indicador de micrófono).
 * - Detección LOCAL únicamente (reconocedor en el dispositivo, Android 12+). Si el teléfono no
 *   lo ofrece, la función no se activa: no se envía audio continuo a servidores.
 * - No se guarda audio. Se apaga sola a los 30 minutos.
 * - Con la app en segundo plano Android no permite abrir la pantalla sola: se avisa con una
 *   notificación para que el usuario toque y hable.
 */
class WakeWordService : Service() {
    companion object {
        const val CHANNEL = "nexus_voice"
        private const val NOTIF_ID = 4711
        private const val ACTION_STOP = "ai.nexus.app.WAKE_STOP"
        const val EXTRA_START_VOICE = "start_voice"
        private const val MAX_RUNTIME_MS = 30 * 60 * 1000L

        private val _running = MutableStateFlow(false)
        val running: StateFlow<Boolean> = _running
        private val _lastError = MutableStateFlow<String?>(null)
        val lastError: StateFlow<String?> = _lastError

        /** Pausa la escucha de fondo mientras la app usa el micrófono para la conversación. */
        @Volatile var pausedByApp = false

        fun supported(context: Context): Boolean =
            Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

        fun start(context: Context, wakeWord: String) {
            if (!supported(context)) {
                _lastError.value = "Tu teléfono no tiene reconocimiento de voz local: la palabra de activación no está disponible."
                return
            }
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                _lastError.value = "Falta el permiso de micrófono."
                return
            }
            _lastError.value = null
            ContextCompat.startForegroundService(context, Intent(context, WakeWordService::class.java).putExtra("word", wakeWord))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, WakeWordService::class.java))
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var word = "nexus"
    private var backoff = 1000L
    private val timeout = Runnable { stopSelf() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        word = ContactResolver.fold(intent?.getStringExtra("word") ?: "nexus")
        ensureChannel()
        val notification = baseNotification("NEXUS escucha la palabra «${word.uppercase()}»", "Detección local en el teléfono. No se guarda audio.")
        if (Build.VERSION.SDK_INT >= 30) startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(NOTIF_ID, notification)
        _running.value = true
        main.removeCallbacks(timeout)
        main.postDelayed(timeout, MAX_RUNTIME_MS)
        listen()
        return START_NOT_STICKY
    }

    private fun ensureChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Voz de NEXUS", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Indicador de micrófono activo para la palabra de activación"
            })
        }
    }

    private fun baseNotification(title: String, text: String) = NotificationCompat.Builder(this, CHANNEL)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setContentIntent(PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
        .addAction(0, "Desactivar", PendingIntent.getService(this, 2, Intent(this, WakeWordService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE))
        .build()

    private fun listen() {
        if (pausedByApp) { main.postDelayed({ listen() }, 2000); return }
        if (Build.VERSION.SDK_INT < 31) { stopSelf(); return }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this).also { it.setRecognitionListener(listener) }
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
        runCatching { recognizer?.startListening(intent) }.onFailure { scheduleRetry() }
    }

    private fun scheduleRetry() {
        main.postDelayed({ listen() }, backoff)
        backoff = (backoff * 2).coerceAtMost(15_000)
    }

    private fun heard(text: String): Boolean = ContactResolver.fold(text).split(' ').any { it == word || it == "$word," }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) { backoff = 1000L }
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onError(error: Int) = scheduleRetry()
        override fun onResults(results: Bundle?) {
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            if (heard(text)) onWake() else listen()
        }
        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            if (heard(text)) { recognizer?.cancel(); onWake() }
        }
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    private fun onWake() {
        val app = application as NexusApplication
        if (app.isInForeground) {
            pausedByApp = true
            app.container.wakeSignals.tryEmit(Unit)
        } else {
            val open = Intent(this, MainActivity::class.java).putExtra(EXTRA_START_VOICE, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val n = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Te escuché decir «${word.uppercase()}»").setContentText("Tocá para hablar con NEXUS")
                .setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(PendingIntent.getActivity(this, 3, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)).build()
            getSystemService(NotificationManager::class.java).notify(NOTIF_ID + 1, n)
        }
        main.postDelayed({ listen() }, 3000)
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        recognizer?.destroy()
        recognizer = null
        _running.value = false
        pausedByApp = false
        super.onDestroy()
    }
}
