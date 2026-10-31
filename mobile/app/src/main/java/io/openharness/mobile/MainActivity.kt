package io.openharness.mobile

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.openharness.mobile.ui.AppViewModel
import io.openharness.mobile.ui.ChatScreen
import io.openharness.mobile.ui.Eyebrow
import io.openharness.mobile.ui.HarnessIcons
import io.openharness.mobile.ui.Screen
import io.openharness.mobile.ui.SettingsScreen
import io.openharness.mobile.ui.TeamScreen
import io.openharness.mobile.ui.theme.HarnessTheme
import io.openharness.mobile.ui.theme.LocalTokens
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { HarnessApp() }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun HarnessApp(vm: AppViewModel = viewModel()) {
    val state by vm.state.collectAsState()
    HarnessTheme(light = state.light) {
        val tokens = LocalTokens.current
        val drawer = rememberDrawerState(DrawerValue.Closed)
        val scope = rememberCoroutineScope()
        val appContext = LocalContext.current
        var pendingFolders by remember { mutableStateOf(listOf<String>()) }
        var pendingTeamId by remember { mutableStateOf<String?>(null) }

        val folderPicker = rememberLauncherForActivityResult(
            ActivityResultContracts.OpenDocumentTree()
        ) { uri: Uri? ->
            if (uri != null) {
                runCatching {
                    appContext.contentResolver.takePersistableUriPermission(
                        uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                }
                val target = pendingTeamId
                if (target != null) {
                    vm.addFolderToTeam(target, uri.toString())
                } else {
                    pendingFolders = (pendingFolders + uri.toString()).distinct()
                }
            }
        }

        val close: () -> Unit = { scope.launch { drawer.close() }; Unit }

        LaunchedEffect(state.drawerOpen) {
            if (state.drawerOpen) drawer.open() else drawer.close()
        }
        LaunchedEffect(drawer.currentValue) {
            vm.setDrawerOpen(drawer.currentValue == DrawerValue.Open)
        }

        ModalNavigationDrawer(
            drawerState = drawer,
            gesturesEnabled = true,
            drawerContent = {
                ModalDrawerSheet(
                    drawerContainerColor = tokens.surface,
                    drawerContentColor = tokens.text,
                    modifier = Modifier.width(292.dp)
                ) { Sidebar(state, vm, close) }
            }
        ) {
            Column(Modifier.fillMaxSize().background(tokens.bg)) {
                Topbar(state, vm) { scope.launch { drawer.open() } }
                Box(Modifier.fillMaxWidth().weight(1f)) {
                    when (state.screen) {
                        Screen.CHAT -> ChatScreen(state, vm)
                        Screen.TEAM -> TeamScreen(state, vm)
                        Screen.SETTINGS -> SettingsScreen(
                            state = state,
                            vm = vm,
                            newTeamFolders = pendingFolders,
                            onNewTeamFolders = { pendingFolders = it },
                            onPickFolder = { teamId ->
                                pendingTeamId = teamId
                                folderPicker.launch(null)
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Topbar(state: io.openharness.mobile.ui.UiState, vm: AppViewModel, onMenu: () -> Unit) {
    val tokens = LocalTokens.current
    val title = when (state.screen) {
        Screen.SETTINGS -> vm.t("top.settings")
        Screen.TEAM -> vm.t("top.team")
        else -> state.data.agents.firstOrNull { it.id == state.agentId }?.name ?: "OpenHarness"
    }
    val connection = state.data.connections.firstOrNull()

    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .background(tokens.surface)
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { onMenu() },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    HarnessIcons.of("layers"), contentDescription = vm.t("side.menu"),
                    tint = tokens.text2, modifier = Modifier.size(19.dp)
                )
            }
            Spacer(Modifier.width(6.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = tokens.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                if (state.screen != Screen.SETTINGS) {
                    Text(
                        connection?.let { "${it.name} · ${it.model}" } ?: vm.t("top.noConnectionApi"),
                        color = if (connection != null) tokens.ok else tokens.danger,
                        fontSize = 10.5.sp
                    )
                }
            }
            val agent = state.data.agents.firstOrNull { it.id == state.agentId }
            if (state.screen == Screen.CHAT && agent != null) {
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(tokens.accentSoft),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        HarnessIcons.of(agent.icon), contentDescription = null,
                        tint = tokens.accent, modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(tokens.line))
    }
}

@Composable
private fun Sidebar(state: io.openharness.mobile.ui.UiState, vm: AppViewModel, close: () -> Unit) {
    val tokens = LocalTokens.current
    Column(
        Modifier
            .fillMaxHeight()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 18.dp)
    ) {
        io.openharness.mobile.ui.BrandBlock(tokens)
        Spacer(Modifier.height(18.dp))

        io.openharness.mobile.ui.HarnessButton(
            vm.t("side.newChat"), tokens, primary = true,
            icon = HarnessIcons.of("plus"),
            onClick = { vm.newChat(); close() },
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(14.dp))

        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(tokens.surface2)
                .padding(4.dp)
        ) {
            ModeButton(vm.t("side.solo"), !state.teamMode, tokens, Modifier.weight(1f)) {
                vm.go(Screen.CHAT); close()
            }
            ModeButton(vm.t("side.team"), state.teamMode, tokens, Modifier.weight(1f)) {
                vm.go(Screen.TEAM); close()
            }
        }

        Spacer(Modifier.height(16.dp))
        Eyebrow(vm.t("side.agents"), tokens)
        Spacer(Modifier.height(6.dp))
        state.data.agents.forEach { agent ->
            val active = agent.id == state.agentId && !state.teamMode && state.screen == Screen.CHAT
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (active) tokens.surface3 else tokens.surface)
                    .clickable { vm.selectAgent(agent.id); close() }
                    .padding(horizontal = 10.dp, vertical = 9.dp)
            ) {
                Icon(
                    HarnessIcons.of(agent.icon), contentDescription = null,
                    tint = if (active) tokens.accent else tokens.text2,
                    modifier = Modifier.size(15.dp)
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    agent.name,
                    color = if (active) tokens.text else tokens.text2,
                    fontSize = 13.sp,
                    modifier = Modifier.weight(1f)
                )
                if (agent.custom == 1) {
                    Text(vm.t("common.bespoke"), color = tokens.text3, fontSize = 8.5.sp, letterSpacing = 0.5.sp)
                }
            }
            Spacer(Modifier.height(3.dp))
        }

        Spacer(Modifier.height(16.dp))
        Eyebrow(vm.t("side.history"), tokens)
        Spacer(Modifier.height(6.dp))
        if (state.data.conversations.isEmpty()) {
            Text(vm.t("side.noConversations"), color = tokens.text3, fontSize = 11.5.sp)
        }
        state.data.conversations.take(30).forEach { conversation ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(
                        if (conversation.id == state.conversationId) tokens.surface3 else tokens.surface
                    )
                    .clickable { vm.openConversation(conversation.id) }
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            ) {
                Icon(
                    HarnessIcons.of("chat"), contentDescription = null,
                    tint = tokens.text3, modifier = Modifier.size(12.dp)
                )
                Spacer(Modifier.width(9.dp))
                Text(
                    conversation.title.ifEmpty { vm.t("side.newChat") },
                    color = tokens.text2, fontSize = 12.sp,
                    maxLines = 1,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    "×", color = tokens.text3, fontSize = 14.sp,
                    modifier = Modifier
                        .clickable { vm.deleteConversation(conversation.id) }
                        .padding(horizontal = 4.dp)
                )
            }
            Spacer(Modifier.height(2.dp))
        }

        Spacer(Modifier.height(18.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(9.dp))
                .clickable { vm.go(Screen.SETTINGS); close() }
                .padding(horizontal = 10.dp, vertical = 10.dp)
        ) {
            Icon(HarnessIcons.of("settings"), contentDescription = null, tint = tokens.text2, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(10.dp))
            Text(vm.t("side.settings"), color = tokens.text2, fontSize = 13.sp)
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(9.dp))
                .clickable { vm.toggleTheme() }
                .padding(horizontal = 10.dp, vertical = 10.dp)
        ) {
            Icon(HarnessIcons.logo, contentDescription = null, tint = tokens.text2, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(10.dp))
            Text(
                if (state.light) vm.t("side.darkTheme") else vm.t("side.lightTheme"),
                color = tokens.text2, fontSize = 13.sp
            )
        }
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun ModeButton(label: String, active: Boolean, tokens: io.openharness.mobile.ui.theme.Tokens, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(7.dp))
            .background(if (active) tokens.surface3 else tokens.surface2)
            .clickable { onClick() }
            .padding(vertical = 9.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = if (active) tokens.text else tokens.text2, fontSize = 12.5.sp)
    }
}
