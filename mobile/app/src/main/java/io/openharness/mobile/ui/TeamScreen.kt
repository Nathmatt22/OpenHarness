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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.openharness.mobile.data.MissionEvent
import io.openharness.mobile.ui.theme.LocalTokens

@Composable
fun TeamScreen(state: UiState, vm: AppViewModel) {
    val tokens = LocalTokens.current
    val team = state.data.teams.firstOrNull { it.id == state.selectedTeamId }
        ?: state.data.teams.firstOrNull()
    val roster: List<String> = team?.agentIds?.parseIds() ?: emptyList()
    val folderCount = team?.folders?.parseFolders()?.size ?: 0

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Eyebrow(vm.t("team.eyebrow"), tokens)
        Spacer(Modifier.height(6.dp))
        PageTitle(vm.t("team.title"), tokens)
        Spacer(Modifier.height(6.dp))
        Caption(vm.t("team.lede"), tokens)
        Spacer(Modifier.height(18.dp))

        if (state.data.teams.isEmpty()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(tokens.danger.copy(alpha = 0.12f))
                    .padding(14.dp)
            ) {
                Text(vm.t("team.createFirst"), color = tokens.danger, fontSize = 13.sp)
            }
            return@Column
        }

        HarnessCard(tokens) {
            Caption(vm.t("team.label"), tokens)
            Spacer(Modifier.height(6.dp))
            state.data.teams.forEach { option ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(
                            if (option.id == team?.id) tokens.accentSoft else tokens.surface
                        )
                        .clickable { vm.selectTeam(option.id) }
                        .padding(horizontal = 12.dp, vertical = 10.dp)
                ) {
                    Text(
                        option.name,
                        color = if (option.id == team?.id) tokens.accent else tokens.text,
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
                Spacer(Modifier.height(6.dp))
            }

            Spacer(Modifier.height(8.dp))
            Caption(
                vm.t("team.order") + " " + roster.joinToString(" → ") { vm.agentName(it) },
                tokens
            )

            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    HarnessIcons.of("layers"), contentDescription = null,
                    tint = tokens.text2, modifier = Modifier.size(13.dp)
                )
                Spacer(Modifier.width(6.dp))
                Text(vm.t("team.foldersTitle"), color = tokens.text2, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.height(6.dp))
            if (folderCount == 0) {
                Text(vm.t("team.noFolders"), color = tokens.text3, fontSize = 11.5.sp)
            } else {
                state.workspace.forEach { listing ->
                    Text(
                        listing.folder,
                        color = tokens.text2, fontSize = 11.5.sp, fontWeight = FontWeight.Medium
                    )
                    Text(
                        listing.entries.joinToString(" · ") { it.name }.ifEmpty { vm.t("team.emptyFolder") },
                        color = tokens.text3, fontSize = 11.sp
                    )
                    Spacer(Modifier.height(6.dp))
                }
            }

            Spacer(Modifier.height(14.dp))
            Caption(vm.t("team.mission"), tokens)
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = state.missionTask,
                onValueChange = vm::setMissionTask,
                placeholder = { Text(vm.t("team.missionPlaceholder"), color = tokens.text3, fontSize = 13.sp) },
                maxLines = 5,
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

            Spacer(Modifier.height(12.dp))
            if (state.missionRunning) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(7.dp)
                            .clip(RoundedCornerShape(99.dp))
                            .background(tokens.accent)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(vm.t("team.running"), color = tokens.text2, fontSize = 12.5.sp)
                    Spacer(Modifier.width(12.dp))
                    HarnessButton(vm.t("team.stop"), tokens, onClick = vm::stopMission)
                }
            } else {
                HarnessButton(
                    vm.t("team.start"), tokens, primary = true,
                    enabled = state.missionTask.isNotBlank(),
                    onClick = vm::startMission
                )
            }

            if (state.error.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Text(state.error, color = tokens.danger, fontSize = 12.sp)
            }
            if (state.missionDone.isNotEmpty() && !state.missionRunning) {
                Spacer(Modifier.height(10.dp))
                Text(
                    vm.t("team.done", mapOf("status" to state.missionDone)),
                    color = tokens.ok, fontSize = 12.sp
                )
            }
        }

        Spacer(Modifier.height(20.dp))
        Text(vm.t("team.activity"), color = tokens.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))

        if (state.missionEvents.isEmpty()) {
            Text(vm.t("team.timelineEmpty"), color = tokens.text3, fontSize = 12.sp)
        } else {
            state.missionEvents.forEach { event ->
                TimelineItem(event, vm)
                Spacer(Modifier.height(10.dp))
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun TimelineItem(event: MissionEvent, vm: AppViewModel) {
    val tokens = LocalTokens.current
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(tokens.surface)
            .padding(12.dp)
    ) {
        Column {
            Text(
                vm.agentName(event.agentId),
                color = tokens.accent, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(4.dp))
            Text(event.content, color = tokens.text2, fontSize = 12.5.sp, lineHeight = 18.sp)
        }
    }
}

@Composable
fun TeamActivityList(events: List<MissionEvent>, vm: AppViewModel, modifier: Modifier = Modifier) {
    LazyColumn(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(events) { event -> TimelineItem(event, vm) }
    }
}

internal fun String.parseIds(): List<String> = try {
    val arr = org.json.JSONArray(this)
    (0 until arr.length()).map { arr.getString(it) }
} catch (_: Throwable) {
    emptyList()
}

internal fun String.parseFolders(): List<String> = try {
    val arr = org.json.JSONArray(this)
    (0 until arr.length()).map { arr.getString(it) }
} catch (_: Throwable) {
    emptyList()
}
