package io.openharness.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.openharness.mobile.data.ChatMessage
import io.openharness.mobile.ui.theme.LocalTokens

@Composable
fun ChatScreen(state: UiState, vm: AppViewModel) {
    val tokens = LocalTokens.current
    val listState = rememberLazyListState()
    val agent = state.data.agents.firstOrNull { it.id == state.agentId } ?: state.data.agents.firstOrNull()

    val visible = if (state.streaming.isNotEmpty()) {
        state.messages.filterIndexed { i, m ->
            !(m.role == "assistant" && m.content.isEmpty() && i == state.messages.lastIndex)
        } + ChatMessage("streaming", "assistant", state.streaming)
    } else {
        state.messages.filter { !(it.role == "assistant" && it.content.isEmpty()) }
    }

    LaunchedEffect(visible.size, state.streaming.length) {
        if (visible.isNotEmpty()) listState.animateScrollToItem(visible.lastIndex)
    }

    Column(Modifier.fillMaxSize().background(tokens.bg)) {
        Box(Modifier.fillMaxWidth().weight(1f)) {
            if (visible.isEmpty()) {
                Column(
                    Modifier.fillMaxSize().padding(28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    BrandMark(tokens, 52)
                    Spacer(Modifier.height(18.dp))
                    Text(
                        vm.t("chat.welcomeTitle"),
                        color = tokens.text, fontSize = 21.sp, fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        vm.t("chat.welcomeSub"),
                        color = tokens.text3, fontSize = 13.sp
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    itemsIndexed(visible) { index, message ->
                        MessageBubble(message, agent?.icon ?: "sparkles", agent?.name ?: "OpenHarness", vm)
                    }
                }
            }
        }

        if (state.error.isNotEmpty()) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(tokens.danger.copy(alpha = 0.12f))
                    .padding(12.dp)
            ) {
                Text(state.error, color = tokens.danger, fontSize = 12.sp)
            }
        }

        if (state.data.connections.isEmpty()) {
            Text(
                vm.t("chat.noConnectionBanner"),
                color = tokens.text3,
                fontSize = 11.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
            )
        }

        Composer(state, vm, agent?.name)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun MessageBubble(
    message: ChatMessage,
    agentIcon: String,
    agentName: String,
    vm: AppViewModel
) {
    val tokens = LocalTokens.current
    val isUser = message.role == "user"
    Row(
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
        modifier = Modifier.fillMaxWidth()
    ) {
        if (!isUser) {
            Box(
                Modifier
                    .size(28.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(tokens.accentSoft),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    HarnessIcons.of(agentIcon), contentDescription = null,
                    tint = tokens.accent, modifier = Modifier.size(15.dp)
                )
            }
            Spacer(Modifier.width(9.dp))
        }
        Column(
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
            modifier = Modifier.fillMaxWidth(0.86f)
        ) {
            Text(
                if (isUser) vm.t("chat.you") else agentName,
                color = tokens.text3, fontSize = 10.5.sp, fontWeight = FontWeight.Medium
            )
            Spacer(Modifier.height(4.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (isUser) tokens.accent else tokens.surface)
                    .padding(horizontal = 13.dp, vertical = 10.dp)
            ) {
                if (message.content.isNotEmpty()) {
                    Text(
                        message.content,
                        color = if (isUser) Color.White else tokens.text,
                        fontSize = 13.5.sp,
                        lineHeight = 20.sp
                    )
                } else {
                    Text("…", color = tokens.text3, fontSize = 13.5.sp)
                }
            }
        }
    }
}

@Composable
private fun Composer(state: UiState, vm: AppViewModel, agentName: String?) {
    val tokens = LocalTokens.current
    val connection = state.data.connections.firstOrNull()

    Column(Modifier.padding(horizontal = 12.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                value = state.input,
                onValueChange = vm::setInput,
                placeholder = {
                    Text(
                        agentName?.let { vm.t("chat.placeholderAgent", mapOf("agent" to it)) }
                            ?: vm.t("chat.placeholder"),
                        color = tokens.text3, fontSize = 13.5.sp
                    )
                },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences,
                    imeAction = ImeAction.Default
                ),
                keyboardActions = KeyboardActions(),
                maxLines = 6,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = tokens.surface,
                    unfocusedContainerColor = tokens.surface,
                    focusedBorderColor = tokens.accent,
                    unfocusedBorderColor = tokens.line,
                    focusedTextColor = tokens.text,
                    unfocusedTextColor = tokens.text,
                    cursorColor = tokens.accent
                )
            )
            Spacer(Modifier.width(8.dp))
            Box(
                modifier = Modifier
                    .size(46.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(
                        if (state.busy) tokens.danger
                        else if (state.input.isBlank()) tokens.surface2 else tokens.accent
                    )
                    .clickable(enabled = state.busy || state.input.isNotBlank()) {
                        if (state.busy) vm.stopChat() else vm.send()
                    },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    if (state.busy) HarnessIcons.of("stop") else HarnessIcons.of("send"),
                    contentDescription = if (state.busy) vm.t("chat.stop") else vm.t("chat.send"),
                    tint = if (state.input.isBlank() && !state.busy) tokens.text3 else Color.White,
                    modifier = Modifier.size(19.dp)
                )
            }
        }
        Spacer(Modifier.height(5.dp))
        Text(vm.t("chat.enterHint"), color = tokens.text3, fontSize = 10.sp)
        if (state.data.connections.isNotEmpty()) {
            Spacer(Modifier.height(2.dp))
            Text(
                vm.t("chat.connection") + " " + (connection?.let { "${it.name} · ${it.model}" } ?: "—"),
                color = tokens.text3, fontSize = 10.sp
            )
        }
    }
}
