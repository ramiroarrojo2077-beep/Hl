package ai.nexus.app.core.ui

import ai.nexus.app.AppContainer
import ai.nexus.app.NexusApplication
import ai.nexus.app.core.network.ApiException
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Estado de una carga remota. `data` se conserva durante recargas para no parpadear. */
data class Loadable<T>(val data: T? = null, val loading: Boolean = false, val error: String? = null) {
    val isInitialLoading get() = loading && data == null
}

fun Throwable.userMessage(): String = when (this) {
    is ApiException -> message
    else -> message ?: "Error inesperado"
}

val LocalSnackbar = staticCompositionLocalOf { SnackbarHostState() }
val LocalNavigate = staticCompositionLocalOf<(String) -> Unit> { {} }

@Composable
fun appContainer(): AppContainer = (LocalContext.current.applicationContext as NexusApplication).container

@Composable
inline fun <reified VM : ViewModel> nexusViewModel(key: String? = null, crossinline create: (AppContainer) -> VM): VM {
    val container = appContainer()
    return viewModel(key = key, factory = viewModelFactory { initializer { create(container) } })
}

/** Utilidad para ViewModels: carga con manejo de errores y conservación de datos previos. */
open class LoadViewModel<T> : ViewModel() {
    protected val _state = MutableStateFlow(Loadable<T>())
    val state: StateFlow<Loadable<T>> = _state
    private var job: Job? = null

    protected fun load(fetch: suspend () -> T) {
        job?.cancel()
        _state.value = _state.value.copy(loading = true, error = null)
        job = viewModelScope.launch {
            _state.value = try {
                Loadable(fetch(), false, null)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                _state.value.copy(loading = false, error = e.userMessage())
            }
        }
    }

    protected fun seed(cached: T?) {
        if (cached != null && _state.value.data == null) _state.value = _state.value.copy(data = cached)
    }

    fun action(onResult: (String?) -> Unit = {}, success: String? = null, block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block(); onResult(success)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                onResult(e.userMessage())
            }
        }
    }
}

object Time {
    private val zone: ZoneId = ZoneId.systemDefault()
    private val dateTime = DateTimeFormatter.ofPattern("d MMM, HH:mm", Locale.forLanguageTag("es"))
    private val time = DateTimeFormatter.ofPattern("HH:mm")

    fun parse(iso: String?): OffsetDateTime? = try {
        iso?.let { OffsetDateTime.parse(it) }
    } catch (_: Exception) {
        null
    }

    fun relative(iso: String?): String {
        val t = parse(iso) ?: return "—"
        val d = Duration.between(t, OffsetDateTime.now())
        return when {
            d.isNegative -> "en ${humanize(d.negated())}"
            d.seconds < 45 -> "recién"
            else -> "hace ${humanize(d)}"
        }
    }

    fun humanize(d: Duration): String = when {
        d.toMinutes() < 1 -> "${d.seconds} s"
        d.toHours() < 1 -> "${d.toMinutes()} min"
        d.toDays() < 1 -> "${d.toHours()} h"
        else -> "${d.toDays()} d"
    }

    fun short(iso: String?): String = parse(iso)?.atZoneSameInstant(zone)?.format(dateTime) ?: "—"
    fun clock(iso: String?): String = parse(iso)?.atZoneSameInstant(zone)?.format(time) ?: "—"

    fun elapsed(start: String?, end: String?): String {
        val s = parse(start) ?: return "—"
        val e = parse(end) ?: OffsetDateTime.now()
        return humanize(Duration.between(s, e))
    }
}

fun money(value: String?): String {
    val v = value?.toBigDecimalOrNull() ?: return "—"
    return "US$ " + v.setScale(if (v < java.math.BigDecimal.ONE) 4 else 2, java.math.RoundingMode.HALF_UP).toPlainString()
}

fun compact(n: Long): String = when {
    n >= 1_000_000 -> String.format(Locale.US, "%.1fM", n / 1_000_000.0)
    n >= 1_000 -> String.format(Locale.US, "%.1fk", n / 1_000.0)
    else -> n.toString()
}
