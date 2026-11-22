package ai.nexus.app.local

import ai.nexus.app.NexusApplication
import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import java.util.concurrent.TimeUnit

/** Dirección especial: cuando la sesión apunta acá, la API la atiende el backend local del teléfono. */
const val LOCAL_URL = "http://nexus.local"
const val LOCAL_HOST = "nexus.local"

fun isLocalUrl(url: String?) = url?.trimEnd('/') == LOCAL_URL

/** Desvía las llamadas a la API v1 hacia el backend local, sin red. El resto del tráfico (proveedores de IA) pasa normal. */
class LocalInterceptor(private val backend: () -> LocalBackend) : Interceptor {
    private val json = "application/json; charset=utf-8".toMediaType()

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.url.host != LOCAL_HOST) return chain.proceed(request)
        val path = request.url.encodedPath.let { java.net.URLDecoder.decode(it, "UTF-8") }
        val (code, body) = if (path == "/health") 200 to """{"status":"ok","mode":"local"}""" else {
            val apiPath = path.removePrefix("/api/v1")
            val query = request.url.queryParameterNames.associateWith { request.url.queryParameter(it).orEmpty() }
            val rb = request.body
            val parts = (rb as? MultipartBody)?.parts?.map { p ->
                val disp = p.headers?.get("Content-Disposition").orEmpty()
                val name = Regex("""name="([^"]*)"""").find(disp)?.groupValues?.get(1).orEmpty()
                val file = Regex("""filename="([^"]*)"""").find(disp)?.groupValues?.get(1)
                Req.Part(name, file, p.body.contentType()?.toString(), Buffer().also { p.body.writeTo(it) }.readByteArray())
            }.orEmpty()
            val text = if (rb != null && rb !is MultipartBody) Buffer().also { rb.writeTo(it) }.readUtf8() else null
            runBlocking(Dispatchers.IO) { backend().handle(Req(request.method, apiPath, query, text, parts)) }
        }
        return Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message(if (code in 200..299) "OK" else "Error")
            .body(body.toResponseBody(json)).build()
    }
}

/** Revisa recordatorios y rutinas vencidas aunque la app esté cerrada (WorkManager). */
class LocalTickWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as NexusApplication).container
        if (isLocalUrl(c.session.serverUrl()) && c.session.current() != null) runCatching { c.localBackend.tick() }
        return Result.success()
    }
}

object LocalScheduler {
    fun periodic(context: Context) = runCatching {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("nexus-local-tick", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<LocalTickWorker>(15, TimeUnit.MINUTES).build())
    }

    /** Despierta la app cerca de la hora de un recordatorio (Android puede demorarlo unos minutos en ahorro de energía). */
    fun wakeIn(context: Context, delayMs: Long) = runCatching {
        val delay = delayMs.coerceAtLeast(0)
        val bucket = (System.currentTimeMillis() + delay) / 60_000
        WorkManager.getInstance(context).enqueueUniqueWork("nexus-local-wake-$bucket", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<LocalTickWorker>().setInitialDelay(delay, TimeUnit.MILLISECONDS).build())
    }
}
