package io.openharness.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.openharness.mobile.data.Connection
import io.openharness.mobile.util.I18n
import io.openharness.mobile.ui.theme.LocalTokens

@Composable
fun SettingsScreen(
    state: UiState,
    vm: AppViewModel,
    newTeamFolders: List<String>,
    onNewTeamFolders: (List<String>) -> Unit,
    onPickFolder: (String?) -> Unit
) {
    val tokens = LocalTokens.current
    val scroll = rememberScrollState()

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(scroll)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Column {
            PageTitle(vm.t("set.title"), tokens)
            Spacer(Modifier.height(3.dp))
            Caption(vm.t("set.lede"), tokens)
        }

        if (state.notice.isNotEmpty()) {
            val positive = state.notice.startsWith("✓")
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(
                        if (positive) tokens.ok.copy(alpha = 0.14f) else tokens.danger.copy(alpha = 0.12f)
                    )
                    .clickable { vm.clearNotice() }
                    .padding(12.dp)
            ) {
                Text(
                    state.notice,
                    color = if (positive) tokens.ok else tokens.danger,
                    fontSize = 12.sp
                )
            }
        }

        LanguageCard(state, vm)

        ConnectionCard(state, vm)

        TeamsCard(state, vm, newTeamFolders, onNewTeamFolders, onPickFolder)

        AgentsCard(state, vm)

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun LanguageCard(state: UiState, vm: AppViewModel) {
    val tokens = LocalTokens.current
    HarnessCard(tokens) {
        SectionHeader(vm.t("set.language"), tokens)
        Caption(vm.t("set.languageSub"), tokens)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            I18n.languages.forEach { (lang, label) ->
                HarnessButton(
                    label = label,
                    tokens = tokens,
                    primary = state.lang == lang,
                    onClick = { vm.setLang(lang) },
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
private fun ConnectionCard(state: UiState, vm: AppViewModel) {
    val tokens = LocalTokens.current
    var name by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("claude") }
    var model by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf("") }
    var apiKey by remember { mutableStateOf("") }

    HarnessCard(tokens) {
        SectionHeader(vm.t("set.connections"), tokens)
        Caption(vm.t("set.connectionsSub"), tokens)
        Spacer(Modifier.height(12.dp))

        Field(name, { name = it }, vm.t("set.name"), vm, "Ma clé Anthropic")
        Spacer(Modifier.height(8.dp))

        Caption(vm.t("set.providerType"), tokens)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 6.dp)) {
            listOf("claude" to "Claude", "openai" to "OpenAI", "custom" to vm.t("set.custom")).forEach { (value, label) ->
                HarnessButton(
                    label, tokens,
                    primary = type == value,
                    onClick = { type = value },
                    modifier = Modifier.weight(1f)
                )
            }
        }

        Text(
            "Claude : https://api.anthropic.com/v1/messages\nOpenAI : https://api.openai.com/v1/chat/completions\n" +
                vm.t("set.customUrlHint") + " http://localhost:11434/v1)",
            color = tokens.text3, fontSize = 10.5.sp, lineHeight = 15.sp
        )
        Spacer(Modifier.height(10.dp))

        if (type == "custom") {
            Field(baseUrl, { baseUrl = it }, vm.t("set.baseUrl"), vm, "http://localhost:11434/v1")
            Spacer(Modifier.height(8.dp))
        }
        Field(model, { model = it }, vm.t("set.modelId"), vm, "claude-3-5-sonnet-latest")
        Spacer(Modifier.height(8.dp))
        Field(apiKey, { apiKey = it }, vm.t("set.apiKey"), vm, vm.t("set.apiKeyPlaceholder"), password = true)

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HarnessButton(
                vm.t("set.saveConnection"), tokens, primary = true,
                onClick = {
                    vm.saveConnection(name, type, baseUrl, model, apiKey)
                    name = ""; model = ""; baseUrl = ""; apiKey = ""
                },
                modifier = Modifier.weight(1f)
            )
            HarnessButton(
                vm.t("set.test"), tokens,
                onClick = {
                    vm.testConnection(
                        AppViewModel.TestPayload(
                            key = "form", type = type, baseUrl = baseUrl, apiKey = apiKey, model = model
                        )
                    )
                },
                modifier = Modifier.weight(1f)
            )
        }

        if (state.data.connections.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Divider(tokens)
            Spacer(Modifier.height(10.dp))
        }
        state.data.connections.forEach { connection ->
            ConnectionRow(connection, state, vm)
        }

        Spacer(Modifier.height(12.dp))
        Caption(vm.t("set.openaiNote"), tokens)
    }
}

@Composable
private fun ConnectionRow(connection: Connection, state: UiState, vm: AppViewModel) {
    val tokens = LocalTokens.current
    Row(
        Modifier.fillMaxWidth().padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(connection.name, color = tokens.text, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.width(6.dp))
                Pill(connection.type, tokens)
            }
            Text(
                connection.model + if (connection.baseUrl.isNotEmpty()) " · ${connection.baseUrl}" else "",
                color = tokens.text3, fontSize = 11.sp
            )
        }
        val result = state.testResults[connection.id]
        Text(
            when {
                state.testingId == connection.id -> vm.t("set.testing")
                result == true -> vm.t("set.testOk")
                result == false -> vm.t("set.testFail")
                else -> vm.t("set.test")
            },
            color = when {
                result == true -> tokens.ok
                result == false -> tokens.danger
                else -> tokens.accent
            },
            fontSize = 12.sp,
            modifier = Modifier
                .clickable(enabled = state.testingId != connection.id) {
                    vm.testConnection(AppViewModel.TestPayload(key = connection.id, id = connection.id))
                }
                .padding(horizontal = 6.dp, vertical = 4.dp)
        )
        Text(
            vm.t("set.delete"),
            color = tokens.danger, fontSize = 12.sp,
            modifier = Modifier
                .clickable { vm.deleteConnection(connection.id) }
                .padding(horizontal = 6.dp, vertical = 4.dp)
        )
    }
}

@Composable
private fun TeamsCard(
    state: UiState,
    vm: AppViewModel,
    pendingFolders: List<String>,
    onPendingFolders: (List<String>) -> Unit,
    onPickFolder: (String?) -> Unit
) {
    val tokens = LocalTokens.current
    var teamName by remember { mutableStateOf("") }
    val selected = remember { mutableStateOf(setOf<String>()) }

    HarnessCard(tokens) {
        SectionHeader(vm.t("set.teams"), tokens)
        Caption(vm.t("set.teamsSub"), tokens)
        Spacer(Modifier.height(12.dp))

        Field(teamName, { teamName = it }, vm.t("set.teamName"), vm, vm.t("set.teamNamePlaceholder"))
        Spacer(Modifier.height(10.dp))

        Caption(vm.t("set.participants"), tokens)
        state.data.agents.forEach { agent ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        selected.value = if (selected.value.contains(agent.id)) {
                            selected.value - agent.id
                        } else {
                            selected.value + agent.id
                        }
                    }
            ) {
                Checkbox(
                    checked = selected.value.contains(agent.id),
                    onCheckedChange = {
                        selected.value = if (it) selected.value + agent.id else selected.value - agent.id
                    },
                    colors = CheckboxDefaults.colors(checkedColor = tokens.accent, uncheckedColor = tokens.lineStrong)
                )
                Text(agent.name, color = tokens.text, fontSize = 13.sp)
            }
        }

        Spacer(Modifier.height(10.dp))
        Caption(vm.t("set.folders"), tokens)
        Spacer(Modifier.height(6.dp))
        HarnessButton(
            vm.t("set.assignFolder"), tokens,
            icon = HarnessIcons.of("layers"),
            onClick = { onPickFolder(null) }
        )
        pendingFolders.forEach { folder ->
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    folder, color = tokens.text2, fontSize = 10.5.sp,
                    modifier = Modifier.weight(1f).padding(end = 8.dp)
                )
                Text(
                    "×", color = tokens.danger, fontSize = 15.sp,
                    modifier = Modifier
                        .clickable { onPendingFolders(pendingFolders - folder) }
                        .padding(horizontal = 6.dp)
                )
            }
        }

        Spacer(Modifier.height(12.dp))
        HarnessButton(
            vm.t("set.saveTeam"), tokens, primary = true,
            enabled = teamName.isNotBlank() && selected.value.isNotEmpty(),
            onClick = {
                vm.saveTeam(teamName, selected.value.toList(), pendingFolders)
                teamName = ""; selected.value = setOf(); onPendingFolders(emptyList())
            }
        )

        if (state.data.teams.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Divider(tokens)
        }
        state.data.teams.forEach { team ->
            val folderCount = team.folders?.foldersCount() ?: 0
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(team.name, color = tokens.text, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    Text(
                        "${team.agentIds.idsCount()} agents" +
                            if (folderCount > 0) " · $folderCount ${vm.t("set.foldersCount")}" else "",
                        color = tokens.text3, fontSize = 11.sp
                    )
                }
                Text(
                    vm.t("set.addFolder"),
                    color = tokens.accent, fontSize = 12.sp,
                    modifier = Modifier
                        .clickable { onPickFolder(team.id) }
                        .padding(horizontal = 6.dp, vertical = 4.dp)
                )
                Text(
                    vm.t("set.delete"),
                    color = tokens.danger, fontSize = 12.sp,
                    modifier = Modifier
                        .clickable { vm.deleteTeam(team.id) }
                        .padding(horizontal = 6.dp, vertical = 4.dp)
                )
            }
        }
    }
}

@Composable
private fun AgentsCard(state: UiState, vm: AppViewModel) {
    val tokens = LocalTokens.current
    var showForm by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var instructions by remember { mutableStateOf("") }

    HarnessCard(tokens) {
        SectionHeader(vm.t("set.agents"), tokens)
        Caption(vm.t("set.agentsSub"), tokens)
        Spacer(Modifier.height(12.dp))

        if (!showForm) {
            HarnessButton(vm.t("set.createAgent"), tokens, icon = HarnessIcons.of("plus"), onClick = { showForm = true })
        } else {
            Field(name, { name = it }, vm.t("set.name"), vm)
            Spacer(Modifier.height(8.dp))
            Field(description, { description = it }, vm.t("set.description"), vm)
            Spacer(Modifier.height(8.dp))
            Field(instructions, { instructions = it }, vm.t("set.instructions"), vm, lines = 4)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HarnessButton(
                    vm.t("set.save"), tokens, primary = true,
                    enabled = name.isNotBlank() && instructions.isNotBlank(),
                    onClick = {
                        vm.saveAgent(name, description, instructions)
                        showForm = false; name = ""; description = ""; instructions = ""
                    },
                    modifier = Modifier.weight(1f)
                )
                HarnessButton(
                    vm.t("set.cancel"), tokens,
                    onClick = { showForm = false },
                    modifier = Modifier.weight(1f)
                )
            }
        }

        val custom = state.data.agents.filter { it.custom == 1 }
        if (custom.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Divider(tokens)
        }
        custom.forEach { agent ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    HarnessIcons.of(agent.icon), contentDescription = null,
                    tint = tokens.accent, modifier = Modifier.size(14.dp)
                )
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(agent.name, color = tokens.text, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    Text(agent.description.ifEmpty { vm.t("set.noDescription") }, color = tokens.text3, fontSize = 11.sp)
                }
                Text(
                    vm.t("set.delete"),
                    color = tokens.danger, fontSize = 12.sp,
                    modifier = Modifier
                        .clickable { vm.deleteAgent(agent.id) }
                        .padding(horizontal = 6.dp, vertical = 4.dp)
                )
            }
        }
    }
}

@Composable
fun Field(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    vm: AppViewModel,
    placeholder: String = "",
    password: Boolean = false,
    lines: Int = 1
) {
    val tokens = LocalTokens.current
    Column {
        Text(label, color = tokens.text2, fontSize = 11.5.sp)
        Spacer(Modifier.height(4.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(placeholder, color = tokens.text3, fontSize = 13.sp) },
            singleLine = lines == 1,
            maxLines = lines,
            visualTransformation = if (password) {
                androidx.compose.ui.text.input.PasswordVisualTransformation()
            } else {
                androidx.compose.ui.text.input.VisualTransformation.None
            },
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = tokens.surface2,
                unfocusedContainerColor = tokens.surface2,
                focusedBorderColor = tokens.accent,
                unfocusedBorderColor = tokens.line,
                focusedTextColor = tokens.text,
                unfocusedTextColor = tokens.text,
                cursorColor = tokens.accent
            )
        )
    }
}

private fun String.idsCount(): Int = try {
    org.json.JSONArray(this).length()
} catch (_: Throwable) {
    0
}

private fun String.foldersCount(): Int = try {
    org.json.JSONArray(this).length()
} catch (_: Throwable) {
    0
}
