package ai.nexus.app.push

import ai.nexus.app.BuildConfig
import ai.nexus.app.MainActivity
import ai.nexus.app.NexusApplication
import ai.nexus.app.R
import ai.nexus.app.data.model.NotificationDto
import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.concurrent.TimeUnit

const val CHANNEL_ID = "nexus_events"
const val EXTRA_ROUTE = "nexus_route"

object NotificationHelper {
    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.channel_events), NotificationManager.IMPORTANCE_HIGH)
            channel.description = context.getString(R.string.channel_events_desc)
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    /** Ruta de la app a la que lleva cada notificación. */
    fun routeFor(eventType: String, data: Map<String, String>): String = when {
        data["approval_id"] != null -> "approvals"
        data["mission_id"] != null -> "mission/${data["mission_id"]}"
        data["meeting_id"] != null -> "meeting/${data["meeting_id"]}"
        eventType == "budget_reached" -> "settings/budgets"
        else -> "notifications"
    }

    fun show(context: Context, id: String, eventType: String, title: String, body: String, data: Map<String, String>) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_ROUTE, routeFor(eventType, data))
        }
        val pending = PendingIntent.getActivity(context, id.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_nexus)
            .setColor(0xFF00D9FF.toInt())
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(if (eventType in setOf("approval_requested", "mission_blocked", "important_error")) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        NotificationManagerCompat.from(context).notify(id.hashCode(), notification)
    }

    fun show(context: Context, n: NotificationDto) =
        show(context, n.id, n.eventType, n.title, n.body, n.data.mapValues { (it.value as? JsonPrimitive)?.contentOrNull.orEmpty() })
}

object PushSetup {
    /** Firebase solo se activa si el APK fue compilado con la configuración del proyecto Firebase. */
    fun isConfigured() = BuildConfig.FIREBASE_APP_ID.isNotBlank() && BuildConfig.FIREBASE_API_KEY.isNotBlank() &&
        BuildConfig.FIREBASE_PROJECT_ID.isNotBlank()

    fun init(context: Context) {
        if (!isConfigured() || FirebaseApp.getApps(context).isNotEmpty()) return
        val options = FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
            .build()
        FirebaseApp.initializeApp(context, options)
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
    }

    fun registerToken(app: NexusApplication) {
        if (!isConfigured()) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            app.container.scope.launch { runCatching { app.container.api.registerDevice(token) } }
        }
    }

    /** Respaldo sin FCM: revisa periódicamente notificaciones nuevas (mínimo de Android: 15 min). */
    fun scheduleSync(context: Context) {
        val request = PeriodicWorkRequestBuilder<NotificationSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("nexus-notification-sync", ExistingPeriodicWorkPolicy.KEEP, request)
    }
}

class NexusMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = application as NexusApplication
        app.container.scope.launch { runCatching { app.container.api.registerDevice(token) } }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = message.notification?.title ?: data["title"] ?: "NEXUS"
        val body = message.notification?.body ?: data["body"] ?: ""
        NotificationHelper.show(this, data["notification_id"] ?: message.messageId ?: title, data["event_type"] ?: "", title, body, data)
    }
}

class NotificationSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as NexusApplication).container
        if (container.session.current() == null) return Result.success()
        if ((applicationContext as NexusApplication).isInForeground) return Result.success() // en primer plano llegan por WebSocket
        return try {
            val lastSeen = container.session.prefs.value.lastNotificationSeen
            val fresh = container.api.notifications(unreadOnly = true)
                .filter { lastSeen == null || it.createdAt > lastSeen }
                .sortedBy { it.createdAt }
            fresh.takeLast(5).forEach { NotificationHelper.show(applicationContext, it) }
            fresh.lastOrNull()?.let { container.session.setLastNotificationSeen(it.createdAt) }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
