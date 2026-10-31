package io.openharness.mobile.data

data class Agent(
    val id: String,
    val name: String,
    val description: String,
    val instructions: String,
    val icon: String,
    val tools: String,
    val custom: Int
)

data class Connection(
    val id: String,
    val name: String,
    val type: String,
    val baseUrl: String,
    val model: String,
    val createdAt: String
)

data class Conversation(
    val id: String,
    val title: String,
    val agentId: String,
    val connectionId: String?,
    val createdAt: String
)

data class ChatMessage(
    val id: String,
    val role: String,
    val content: String
)

data class Team(
    val id: String,
    val name: String,
    val agentIds: String,
    val folders: String?,
    val createdAt: String
)

data class MissionEvent(
    val missionId: String,
    val agentId: String,
    val content: String
)

data class WorkspaceEntry(
    val name: String,
    val isFolder: Boolean,
    val size: Long = 0
)

data class FolderListing(
    val folder: String,
    val entries: List<WorkspaceEntry>
)

data class AppData(
    val agents: List<Agent> = emptyList(),
    val connections: List<Connection> = emptyList(),
    val conversations: List<Conversation> = emptyList(),
    val teams: List<Team> = emptyList(),
    val settings: Map<String, String> = emptyMap(),
    val encryptionAvailable: Boolean = true
)

data class ProviderInput(
    val type: String,
    val baseUrl: String = "",
    val apiKey: String = "",
    val model: String = ""
) {
    companion object {
        const val CLAUDE_ENDPOINT = "https://api.anthropic.com/v1/messages"
        const val OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
        const val DEFAULT_TIMEOUT_MS = 120_000L
    }
}
