package ai.nexus.app.features.auth

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.NexusCore
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTextField
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.core.ui.userMessage
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class LoginState(
    val server: String = "",
    val email: String = "",
    val password: String = "",
    val name: String = "",
    val register: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    val serverCheck: String? = null,
)

class LoginViewModel(private val c: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(LoginState(server = c.session.prefs.value.serverUrl))
    val state: StateFlow<LoginState> = _state

    fun update(f: (LoginState) -> LoginState) { _state.value = f(_state.value).copy(error = null) }

    fun checkServer() {
        val url = _state.value.server.trim()
        viewModelScope.launch {
            _state.value = _state.value.copy(serverCheck = "Comprobando…")
            val (ok, ms) = c.apiClient.health(url)
            _state.value = _state.value.copy(serverCheck = if (ok) "Servidor NEXUS disponible ($ms ms)" else "No responde un servidor NEXUS en esa dirección")
        }
    }

    fun submit() {
        val s = _state.value
        if (s.email.isBlank() || s.password.isBlank() || (s.register && s.name.isBlank())) {
            _state.value = s.copy(error = "Completá todos los campos")
            return
        }
        viewModelScope.launch {
            _state.value = s.copy(loading = true, error = null)
            try {
                c.session.setServerUrl(s.server.trim())
                val auth = if (s.register) c.api.register(s.email.trim(), s.password, s.name.trim()) else c.api.login(s.email.trim(), s.password)
                c.session.saveLogin(s.server.trim(), auth.tokens.accessToken, auth.tokens.refreshToken, auth.user.id, auth.user.email, auth.user.displayName)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.userMessage())
            }
        }
    }
}

@Composable
fun LoginScreen() {
    val vm = nexusViewModel { LoginViewModel(it) }
    val s by vm.state.collectAsState()
    Box(Modifier.fillMaxSize().statusBarsPadding().imePadding(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 480.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            NexusCore(activeAgents = 0, emergency = false, connected = true, subtitle = "Multi-Agent AI System", modifier = Modifier.fillMaxWidth().height(260.dp))
            HudPanel(Modifier.fillMaxWidth(), title = if (s.register) "Crear cuenta" else "Acceso al centro de control") {
                NexusTextField(s.server, { v -> vm.update { it.copy(server = v, serverCheck = null) } }, "Servidor NEXUS", keyboardType = KeyboardType.Uri,
                    supporting = s.serverCheck ?: "URL de tu backend (HTTPS en producción)")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = vm::checkServer) { Text("PROBAR CONEXIÓN", color = NexusColors.Cyan, style = MaterialTheme.typography.labelSmall) }
                }
                if (s.register) {
                    NexusTextField(s.name, { v -> vm.update { it.copy(name = v) } }, "Nombre")
                    Spacer(Modifier.height(8.dp))
                }
                NexusTextField(s.email, { v -> vm.update { it.copy(email = v) } }, "Email", keyboardType = KeyboardType.Email)
                Spacer(Modifier.height(8.dp))
                NexusTextField(s.password, { v -> vm.update { it.copy(password = v) } }, "Contraseña", password = true,
                    supporting = if (s.register) "Mínimo 10 caracteres con mayúsculas, minúsculas y números" else null)
                if (s.error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(s.error!!, color = NexusColors.Red, style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(14.dp))
                PrimaryButton(if (s.register) "Crear cuenta" else "Iniciar sesión", vm::submit, Modifier.fillMaxWidth(), loading = s.loading)
                Spacer(Modifier.height(8.dp))
                GhostButton(if (s.register) "Ya tengo cuenta" else "Crear una cuenta nueva", { vm.update { it.copy(register = !it.register) } }, Modifier.fillMaxWidth())
            }
            Spacer(Modifier.height(12.dp))
            Text("Las claves de los proveedores de IA se configuran en el servidor y nunca se guardan en el teléfono.",
                style = MaterialTheme.typography.bodySmall, color = NexusColors.TextMuted, textAlign = TextAlign.Center)
        }
    }
}
