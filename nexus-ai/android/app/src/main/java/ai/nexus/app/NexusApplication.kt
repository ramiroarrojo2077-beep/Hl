package ai.nexus.app

import ai.nexus.app.push.NotificationHelper
import ai.nexus.app.push.PushSetup
import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Configuration
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

open class NexusApplication : Application(), Configuration.Provider {
    lateinit var container: AppContainer
        private set

    @Volatile var isInForeground = false
        private set

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()

    protected open fun createContainer(): AppContainer = AppContainer(this)

    override fun onCreate() {
        super.onCreate()
        container = createContainer()
        CrashReporter.install(this)
        NotificationHelper.createChannel(this)
        PushSetup.init(this)

        // El WebSocket vive mientras la app está en primer plano; en segundo plano los agentes
        // siguen trabajando en el servidor y avisan por push o por la sincronización periódica.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                isInForeground = true
                container.realtime.start()
            }

            override fun onStop(owner: LifecycleOwner) {
                isInForeground = false
                container.realtime.stop()
            }
        })

        container.scope.launch {
            container.session.session.map { it?.userId }.distinctUntilChanged().collect { userId ->
                if (userId != null) {
                    CrashReporter.flush(container)
                    PushSetup.registerToken(this@NexusApplication)
                    PushSetup.scheduleSync(this@NexusApplication)
                    if (isInForeground) container.realtime.restart()
                } else {
                    container.realtime.stop()
                }
            }
        }
    }
}
