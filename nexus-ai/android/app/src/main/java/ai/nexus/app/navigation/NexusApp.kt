package ai.nexus.app.navigation

import ai.nexus.app.AppContainer
import ai.nexus.app.core.design.HudSnackbarHost
import ai.nexus.app.core.design.ConfirmDialog
import ai.nexus.app.core.design.HudBackground
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTheme
import ai.nexus.app.core.design.VisualPrefs
import ai.nexus.app.core.realtime.ConnectionState
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.appContainer
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.features.activity.ActivityScreen
import ai.nexus.app.features.agents.AgentDetailScreen
import ai.nexus.app.features.agents.AgentEditorScreen
import ai.nexus.app.features.agents.AgentsScreen
import ai.nexus.app.features.approvals.ApprovalsScreen
import ai.nexus.app.features.approvals.NotificationsScreen
import ai.nexus.app.features.auth.LoginScreen
import ai.nexus.app.features.chat.ChatScreen
import ai.nexus.app.features.actions.ActionsScreen
import ai.nexus.app.features.dashboard.DashboardScreen
import ai.nexus.app.features.home.HomeScreen
import ai.nexus.app.features.more.IntegrationsScreen
import ai.nexus.app.features.more.MoreScreen
import ai.nexus.app.features.meetings.CreateMeetingScreen
import ai.nexus.app.features.meetings.MeetingDetailScreen
import ai.nexus.app.features.meetings.MeetingsScreen
import ai.nexus.app.features.memory.MemoryScreen
import ai.nexus.app.features.missions.CreateMissionScreen
import ai.nexus.app.features.missions.MissionDetailScreen
import ai.nexus.app.features.missions.MissionsScreen
import ai.nexus.app.features.projects.ProjectDetailScreen
import ai.nexus.app.features.projects.ProjectsScreen
import ai.nexus.app.features.settings.SettingsScreen
import ai.nexus.app.features.settings.SettingsSectionScreen
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.Apps
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class NavItem(val route: String, val label: String, val icon: ImageVector)

/** NEXUS 2.0: la experiencia cotidiana (asistente, chat, acciones) separada de las herramientas técnicas (Más). */
val PRIMARY_NAV = listOf(
    NavItem("home", "Home", Icons.Outlined.Hub),
    NavItem("chat", "Chat", Icons.Outlined.Chat),
    NavItem("actions", "Acciones", Icons.Outlined.TaskAlt),
    NavItem("more", "Más", Icons.Outlined.Apps),
)

val ALL_SECTIONS = listOf(
    NavItem("home", "Home", Icons.Outlined.Hub),
    NavItem("chat", "Chat con NEXUS", Icons.Outlined.Chat),
    NavItem("actions", "Acciones y rutinas", Icons.Outlined.TaskAlt),
    NavItem("command", "Command Center", Icons.Outlined.Dashboard),
    NavItem("agents", "Agents", Icons.Outlined.Psychology),
    NavItem("missions", "Missions", Icons.Outlined.RocketLaunch),
    NavItem("meetings", "Meetings", Icons.Outlined.Groups),
    NavItem("memory", "Memory", Icons.Outlined.Memory),
    NavItem("activity", "Activity", Icons.Outlined.History),
    NavItem("projects", "Projects", Icons.Outlined.Folder),
    NavItem("integrations", "Integraciones", Icons.Outlined.Extension),
    NavItem("approvals", "Aprobaciones", Icons.Outlined.PanTool),
    NavItem("notifications", "Notificaciones", Icons.Outlined.Notifications),
    NavItem("settings", "Settings", Icons.Outlined.Settings),
)

data class ShellState(val unread: Int = 0, val approvals: Int = 0, val emergency: Boolean = false)

/** Estado global de la barra superior, sincronizado por WebSocket y por consulta periódica. */
class ShellViewModel(private val c: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(ShellState())
    val state: StateFlow<ShellState> = _state

    init {
        refresh()
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                when (e.type) {
                    "notification.created", "approval.created", "system.emergency_stop", "mission.updated" -> refresh()
                }
            }
        }
        viewModelScope.launch {
            c.realtime.state.collect { if (it == ConnectionState.Connected) refresh() }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            runCatching { c.api.dashboard() }.onSuccess {
                _state.value = ShellState(it.unreadNotifications, it.pendingApprovals, it.emergencyStop)
            }
        }
    }

    fun toggleEmergency(onResult: (String) -> Unit) {
        viewModelScope.launch {
            try {
                if (_state.value.emergency) {
                    val r = c.api.clearEmergencyStop(resume = true)
                    onResult("STOP ALL desactivado. Misiones reanudadas: ${r["missions_resumed"] ?: 0}")
                } else {
                    val r = c.api.emergencyStop("Activado desde la app")
                    onResult("STOP ALL activado: agentes detenidos, ${r["automations_paused"] ?: 0} rutinas pausadas, ${r["pending_actions_cancelled"] ?: 0} acciones canceladas")
                }
                refresh()
            } catch (e: Exception) {
                onResult(e.userMessage())
            }
        }
    }
}

@Composable
fun NexusRoot(initialRoute: String?, onRouteConsumed: () -> Unit) {
    val container = appContainer()
    val prefs by container.session.prefs.collectAsState()
    val session by container.session.session.collectAsState()
    var booted by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { container.session.current(); booted = true }
    NexusTheme(VisualPrefs(animations = prefs.animations, glow = prefs.glow)) {
        HudBackground {
            when {
                !booted -> Unit
                session == null -> LoginScreen()
                else -> Shell(initialRoute, onRouteConsumed)
            }
        }
    }
}

@Composable
private fun Shell(initialRoute: String?, onRouteConsumed: () -> Unit) {
    val nav = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val shell = nexusViewModel { ShellViewModel(it) }
    val shellState by shell.state.collectAsState()
    val connection by appContainer().realtime.state.collectAsState()
    var confirmStop by rememberSaveable { mutableStateOf(false) }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route ?: "home"

    LaunchedEffect(initialRoute) {
        if (initialRoute != null) { nav.navigate(initialRoute); onRouteConsumed() }
    }
    val navigate: (String) -> Unit = { route -> nav.navigate(route) { launchSingleTop = true } }
    fun goTop(route: String) {
        if (tabOf(current) == route && current != route) {
            // Tocar de nuevo la pestaña activa vuelve a su pantalla principal.
            nav.navigate(route) { popUpTo(route) { inclusive = true }; launchSingleTop = true }
        } else {
            nav.navigate(route) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true }
        }
    }

    if (confirmStop) {
        ConfirmDialog(
            title = if (shellState.emergency) "Reanudar agentes" else "STOP ALL AGENTS",
            message = if (shellState.emergency) "Se desactiva la detención de emergencia y se reanudan las misiones pausadas por ella. Las rutinas pausadas se reanudan a mano desde Acciones."
            else "Se detienen todos los agentes y workers: no arrancan tareas nuevas, las que están en curso se interrumpen en su siguiente punto seguro, se cancelan los trabajos en cola, se pausan las rutinas, se deshabilitan las acciones pendientes (incluidas las externas) y se revocan permisos temporales. Los registros se conservan.",
            confirm = if (shellState.emergency) "Reanudar" else "Detener todo",
            danger = !shellState.emergency,
            onConfirm = { shell.toggleEmergency { msg -> scope.launch { snackbar.showSnackbar(msg) } } },
            onDismiss = { confirmStop = false },
        )
    }

    CompositionLocalProvider(LocalSnackbar provides snackbar, LocalNavigate provides navigate) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val wide = maxWidth >= 840.dp
            ModalNavigationDrawer(
                drawerState = drawer,
                gesturesEnabled = !wide,
                drawerContent = {
                    ModalDrawerSheet(drawerContainerColor = NexusColors.Background) {
                        SideNav(current, shellState, Modifier.fillMaxHeight()) { route -> scope.launch { drawer.close() }; goTop(route) }
                    }
                },
            ) {
                Row(Modifier.fillMaxSize()) {
                    if (wide) SideNav(current, shellState, Modifier.width(250.dp).fillMaxHeight()) { goTop(it) }
                    Scaffold(
                        containerColor = Color.Transparent,
                        topBar = {
                            TopBar(
                                connection = connection, state = shellState, showMenu = !wide,
                                onMenu = { scope.launch { drawer.open() } }, onBell = { navigate("notifications") },
                                onApprovals = { navigate("approvals") }, onStop = { confirmStop = true }, onProfile = { navigate("settings") },
                            )
                        },
                        bottomBar = { if (!wide) BottomNav(current) { goTop(it) } },
                    ) { padding ->
                        Box(Modifier.padding(padding)) {
                            NexusNavHost(nav)
                            HudSnackbarHost(snackbar, Modifier.align(Alignment.TopCenter))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NexusNavHost(nav: NavHostController) {
    NavHost(nav, startDestination = "home") {
        composable("home") { HomeScreen() }
        composable("command") { DashboardScreen() }
        composable("actions") { ActionsScreen() }
        composable("more") { MoreScreen() }
        composable("integrations") { IntegrationsScreen() }
        composable("agents") { AgentsScreen() }
        composable("agent/new") { AgentEditorScreen(agentId = null, onDone = { nav.popBackStack() }) }
        composable("agent/{id}") { AgentDetailScreen(it.arguments?.getString("id")!!) }
        composable("agent/{id}/edit") { AgentEditorScreen(agentId = it.arguments?.getString("id"), onDone = { nav.popBackStack() }) }
        composable("missions") { MissionsScreen() }
        composable("mission/new") { CreateMissionScreen(projectId = null, onCreated = { id -> nav.popBackStack(); nav.navigate("mission/$id") }) }
        composable("mission/new/{projectId}") { CreateMissionScreen(projectId = it.arguments?.getString("projectId"), onCreated = { id -> nav.popBackStack(); nav.navigate("mission/$id") }) }
        composable("mission/{id}") { MissionDetailScreen(it.arguments?.getString("id")!!) }
        composable("meetings") { MeetingsScreen() }
        composable("meeting/new") { CreateMeetingScreen(onCreated = { id -> nav.popBackStack(); nav.navigate("meeting/$id") }) }
        composable("meeting/{id}") { MeetingDetailScreen(it.arguments?.getString("id")!!) }
        composable("memory") { MemoryScreen() }
        composable("activity") { ActivityScreen() }
        composable("projects") { ProjectsScreen() }
        composable("project/{id}") { ProjectDetailScreen(it.arguments?.getString("id")!!) }
        composable("chat") { ChatScreen(conversationId = null) }
        composable("chat/{id}") { ChatScreen(conversationId = it.arguments?.getString("id")) }
        composable("approvals") { ApprovalsScreen() }
        composable("notifications") { NotificationsScreen() }
        composable("settings") { SettingsScreen() }
        composable("settings/{section}") { SettingsSectionScreen(it.arguments?.getString("section")!!) }
    }
}

@Composable
private fun TopBar(
    connection: ConnectionState, state: ShellState, showMenu: Boolean,
    onMenu: () -> Unit, onBell: () -> Unit, onApprovals: () -> Unit, onStop: () -> Unit, onProfile: () -> Unit = {},
) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showMenu) IconButton(onClick = onMenu) { Icon(Icons.Outlined.Menu, "Menú", tint = NexusColors.TextPrimary) }
        Row(Modifier.weight(1f).padding(start = if (showMenu) 0.dp else 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ai.nexus.app.core.design.NexusEmblem(30.dp, online = connection == ConnectionState.Connected && !state.emergency)
            Spacer(Modifier.width(8.dp))
            Column {
                Text("NEXUS", style = MaterialTheme.typography.titleMedium.copy(fontFamily = ai.nexus.app.core.design.Orbitron, letterSpacing = 5.sp,
                    fontWeight = FontWeight.SemiBold, shadow = androidx.compose.ui.graphics.Shadow(NexusColors.Cyan, androidx.compose.ui.geometry.Offset.Zero, 12f)),
                    color = Color.White)
                ConnectionIndicator(connection, state.emergency)
            }
        }
        if (state.approvals > 0) {
            IconButton(onClick = onApprovals) {
                BadgedBox(badge = { Badge(containerColor = NexusColors.Amber) { Text("${state.approvals}") } }) {
                    Icon(Icons.Outlined.PanTool, "Aprobaciones", tint = NexusColors.Amber)
                }
            }
        }
        IconButton(onClick = onProfile) { Icon(Icons.Outlined.Person, "Perfil y ajustes", tint = NexusColors.TextSecondary) }
        IconButton(onClick = onBell) {
            BadgedBox(badge = { if (state.unread > 0) Badge(containerColor = NexusColors.Cyan, contentColor = NexusColors.Background) { Text("${state.unread.coerceAtMost(99)}") } }) {
                Icon(Icons.Outlined.Notifications, "Notificaciones", tint = NexusColors.TextPrimary)
            }
        }
        val stopColor = if (state.emergency) NexusColors.Green else NexusColors.Red
        Row(
            Modifier.clip(RoundedCornerShape(10.dp)).background(stopColor.copy(alpha = 0.12f)).border(1.dp, stopColor.copy(alpha = 0.6f), RoundedCornerShape(10.dp))
                .clickable(onClick = onStop).padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.StopCircle, null, tint = stopColor, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(4.dp))
            Text(if (state.emergency) "REANUDAR" else "STOP ALL", style = MaterialTheme.typography.labelSmall, color = stopColor)
        }
    }
}

@Composable
fun ConnectionIndicator(connection: ConnectionState, emergency: Boolean) {
    val (label, color) = when {
        emergency -> "AGENTES DETENIDOS" to NexusColors.Red
        connection == ConnectionState.Connected -> "EN LÍNEA" to NexusColors.Green
        connection is ConnectionState.Reconnecting -> "RECONECTANDO (${connection.inSeconds}s)" to NexusColors.Amber
        connection == ConnectionState.Connecting -> "CONECTANDO…" to NexusColors.Amber
        connection == ConnectionState.Unauthorized -> "SESIÓN EXPIRADA" to NexusColors.Red
        else -> "SIN CONEXIÓN" to NexusColors.TextMuted
    }
    val blink by if (ai.nexus.app.core.design.LocalVisualPrefs.current.animations) {
        rememberInfiniteTransition(label = "conn").animateFloat(0.4f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "b")
    } else remember { androidx.compose.runtime.mutableFloatStateOf(1f) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).alpha(if (connection == ConnectionState.Connected && !emergency) 1f else blink).clip(CircleShape).background(color))
        Spacer(Modifier.width(5.dp))
        Text(label, style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp), color = color)
    }
}

/** Pestaña principal a la que pertenece una ruta. */
fun tabOf(route: String): String = when {
    route == "home" -> "home"
    route.startsWith("chat") -> "chat"
    route == "actions" -> "actions"
    else -> "more"
}

@Composable
private fun BottomNav(current: String, onSelect: (String) -> Unit) {
    NavigationBar(containerColor = NexusColors.BackgroundAlt.copy(alpha = 0.98f), tonalElevation = 0.dp) {
        PRIMARY_NAV.forEach { item ->
            val selected = tabOf(current) == item.route
            NavigationBarItem(
                selected = selected,
                onClick = { onSelect(item.route) },
                icon = { Icon(item.icon, item.label) },
                label = { Text(item.label, style = MaterialTheme.typography.labelSmall) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = NexusColors.Accent, selectedTextColor = NexusColors.Accent, indicatorColor = NexusColors.Accent.copy(alpha = 0.14f),
                    unselectedIconColor = NexusColors.TextSecondary, unselectedTextColor = NexusColors.TextSecondary,
                ),
            )
        }
    }
}

@Composable
private fun SideNav(current: String, state: ShellState, modifier: Modifier, onSelect: (String) -> Unit) {
    Column(modifier.background(NexusColors.Background.copy(alpha = 0.9f)).verticalScroll(rememberScrollState()).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 12.dp)) {
            ai.nexus.app.core.design.NexusEmblem(38.dp)
            Spacer(Modifier.width(10.dp))
            Column {
                Text("NEXUS", style = MaterialTheme.typography.titleMedium.copy(fontFamily = ai.nexus.app.core.design.Orbitron, letterSpacing = 5.sp,
                    shadow = androidx.compose.ui.graphics.Shadow(NexusColors.Cyan, androidx.compose.ui.geometry.Offset.Zero, 12f)), color = Color.White)
                Text("COMMAND CENTER", style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = NexusColors.Accent)
            }
        }
        Spacer(Modifier.height(10.dp))
        ALL_SECTIONS.forEach { item ->
            val selected = current == item.route
            val badge = when (item.route) {
                "approvals" -> state.approvals
                "notifications" -> state.unread
                else -> 0
            }
            Row(
                Modifier.fillMaxWidth().padding(vertical = 2.dp).clip(RoundedCornerShape(10.dp))
                    .background(if (selected) NexusColors.Cyan.copy(alpha = 0.10f) else Color.Transparent)
                    .border(1.dp, if (selected) NexusColors.Cyan.copy(alpha = 0.5f) else Color.Transparent, RoundedCornerShape(10.dp))
                    .clickable { onSelect(item.route) }.padding(horizontal = 12.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Start,
            ) {
                Icon(item.icon, null, tint = if (selected) NexusColors.Cyan else NexusColors.TextSecondary, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(12.dp))
                Text(item.label, style = MaterialTheme.typography.bodyMedium, color = if (selected) NexusColors.TextPrimary else NexusColors.TextSecondary,
                    modifier = Modifier.weight(1f))
                if (badge > 0) Text("$badge", style = MaterialTheme.typography.labelSmall, color = NexusColors.Background,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(NexusColors.Cyan).padding(horizontal = 6.dp, vertical = 1.dp))
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.AccountTree, null, tint = NexusColors.TextMuted, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
            Text("Multi-Agent AI System", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
        }
    }
}
