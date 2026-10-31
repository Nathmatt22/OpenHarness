package io.openharness.mobile.ui

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.openharness.mobile.data.AppData
import io.openharness.mobile.data.FolderListing
import io.openharness.mobile.data.HarnessDb
import io.openharness.mobile.data.ProviderInput
import io.openharness.mobile.data.SecretStore
import io.openharness.mobile.data.Team
import io.openharness.mobile.net.ProviderError
import io.openharness.mobile.net.Providers
import io.openharness.mobile.net.WireMessage
import io.openharness.mobile.util.I18n
import io.openharness.mobile.util.Lang
import io.openharness.mobile.util.Workspace
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray

enum class Screen { CHAT, TEAM, SETTINGS }

data class UiState(
    val data: AppData = AppData(),
    val screen: Screen = Screen.CHAT,
    val teamMode: Boolean = false,
    val agentId: String = "",
    val conversationId: String = "",
    val messages: List<io.openharness.mobile.data.ChatMessage> = emptyList(),
    val input: String = "",
    val streaming: String = "",
    val busy: Boolean = false,
    val error: String = "",
    val notice: String = "",
    val light: Boolean = false,
    val lang: Lang = Lang.FR,
    val drawerOpen: Boolean = false,
    // team mission
    val selectedTeamId: String = "",
    val missionTask: String = "",
    val missionRunning: Boolean = false,
    val missionDone: String = "",
    val missionEvents: List<io.openharness.mobile.data.MissionEvent> = emptyList(),
    val workspace: List<FolderListing> = emptyList(),
    // settings form feedback
    val testingId: String = "",
    val testResults: Map<String, Boolean> = emptyMap(),
    val ready: Boolean = false
)

class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val db = HarnessDb(app)
    private val secrets = SecretStore()
    private val context: Context get() = getApplication<Application>()

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var chatJob: Job? = null
    private var missionJob: Job? = null

    private val langKey = "ui.language"

    init {
        viewModelScope.launch { load() }
    }

    // ── app:init ────────────────────────────────────────────────────────────
    private suspend fun load() {
        val data = db.appData()
        val stored = data.settings[langKey]
        val lang = when (stored) {
            "en" -> Lang.EN
            "fr" -> Lang.FR
            else -> if (java.util.Locale.getDefault().language == "fr") Lang.FR else Lang.EN
        }
        _state.update {
            it.copy(
                data = data,
                ready = true,
                lang = lang,
                agentId = it.agentId.ifEmpty { data.agents.firstOrNull()?.id ?: "" },
                selectedTeamId = it.selectedTeamId.ifEmpty { data.teams.firstOrNull()?.id ?: "" }
            )
        }
        refreshWorkspace()
    }

    fun refresh() = viewModelScope.launch { load() }

    fun t(key: String, vars: Map<String, String> = emptyMap()): String = I18n.t(_state.value.lang, key, vars)

    fun setNotice(message: String) = _state.update { it.copy(notice = message) }
    fun clearNotice() = _state.update { it.copy(notice = "") }

    // ── navigation ──────────────────────────────────────────────────────────
    fun openDrawer() = _state.update { it.copy(drawerOpen = true) }
    fun closeDrawer() = _state.update { it.copy(drawerOpen = false) }
    fun setDrawerOpen(open: Boolean) = _state.update { it.copy(drawerOpen = open) }
    fun toggleTheme() = _state.update { it.copy(light = !it.light) }

    fun go(screen: Screen) = _state.update {
        it.copy(screen = screen, drawerOpen = false, teamMode = screen == Screen.TEAM, error = "")
    }

    fun selectAgent(id: String) {
        _state.update {
            it.copy(
                agentId = id, teamMode = false, screen = Screen.CHAT, conversationId = "",
                messages = emptyList(), streaming = "", error = "", drawerOpen = false
            )
        }
    }

    fun newChat() = _state.update {
        it.copy(
            teamMode = false, screen = Screen.CHAT, conversationId = "",
            messages = emptyList(), streaming = "", error = "", drawerOpen = false
        )
    }

    fun openConversation(id: String) = viewModelScope.launch {
        val conv = _state.value.data.conversations.firstOrNull { it.id == id }
        _state.update {
            it.copy(
                screen = Screen.CHAT, teamMode = false, conversationId = id,
                streaming = "", error = "", drawerOpen = false,
                agentId = conv?.agentId ?: it.agentId,
                messages = db.messages(id)
            )
        }
    }

    fun deleteConversation(id: String) = viewModelScope.launch {
        db.deleteConversation(id)
        if (_state.value.conversationId == id) {
            _state.update { it.copy(conversationId = "", messages = emptyList()) }
        }
        load()
    }

    fun setInput(text: String) = _state.update { it.copy(input = text) }

    fun setLang(lang: Lang) = viewModelScope.launch {
        _state.update { it.copy(lang = lang) }
        db.setSetting(langKey, if (lang == Lang.FR) "fr" else "en")
    }

    // ── connections ─────────────────────────────────────────────────────────
    private fun providerFor(id: String?): ProviderInput {
        val row = id?.takeIf { it.isNotBlank() }?.let { db.connection(it) }
            ?: db.firstConnectionId()?.let { db.connection(it) }
        if (row == null) throw ProviderError("Choisissez une connexion API dans les paramètres.")
        val secret = db.connectionSecret(row.id)
        val apiKey = if (secret.isNullOrEmpty()) "" else try {
            secrets.decrypt(secret)
        } catch (_: Throwable) {
            ""
        }
        return ProviderInput(row.type, row.baseUrl, apiKey, row.model)
    }

    fun saveConnection(name: String, type: String, baseUrl: String, model: String, apiKey: String, id: String? = null) =
        viewModelScope.launch {
            try {
                require(name.isNotBlank()) { "Le nom de la connexion est requis." }
                require(model.isNotBlank()) { "Le Model ID est requis." }
                require(type in listOf("claude", "openai", "custom")) { "Type de fournisseur inconnu." }
                if (type == "custom") {
                    require(baseUrl.trim().matches(Regex("^https?://.+"))) { "Base URL HTTP(S) requise pour une API personnalisée." }
                }
                val secret = if (apiKey.isNotBlank()) {
                    require(secrets.isAvailable()) { "Chiffrement keystore indisponible." }
                    secrets.encrypt(apiKey)
                } else ""
                db.saveConnection(
                    name.trim(), type, if (type == "custom") baseUrl.trim() else "", model.trim(), secret, id
                )
                load()
                setNotice(t("set.savedConnection"))
            } catch (e: Throwable) {
                setNotice(e.message ?: "Erreur")
            }
        }

    fun deleteConnection(id: String) = viewModelScope.launch {
        db.deleteConnection(id)
        load()
    }

    fun testConnection(payload: TestPayload) = viewModelScope.launch {
        _state.update { it.copy(testingId = payload.key, notice = "") }
        try {
            val provider = if (payload.id != null) providerFor(payload.id) else ProviderInput(
                payload.type, payload.baseUrl, payload.apiKey, payload.model
            )
            Providers.test(provider)
            _state.update { it.copy(testResults = it.testResults + (payload.key to true)) }
        } catch (e: Throwable) {
            _state.update {
                it.copy(testResults = it.testResults + (payload.key to false), notice = e.message ?: "Échec")
            }
        } finally {
            _state.update { it.copy(testingId = "") }
        }
    }

    data class TestPayload(
        val key: String,
        val id: String? = null,
        val type: String = "claude",
        val baseUrl: String = "",
        val apiKey: String = "",
        val model: String = ""
    )

    // ── agents ──────────────────────────────────────────────────────────────
    fun saveAgent(name: String, description: String, instructions: String) = viewModelScope.launch {
        try {
            require(name.isNotBlank()) { "Le nom de l’agent est requis." }
            require(instructions.isNotBlank()) { "Les instructions système sont requises." }
            db.saveAgent(name.trim(), description, instructions, "sparkles")
            load()
            setNotice(t("set.savedAgent"))
        } catch (e: Throwable) {
            setNotice(e.message ?: "Erreur")
        }
    }

    fun deleteAgent(id: String) = viewModelScope.launch {
        db.deleteCustomAgent(id)
        load()
    }

    // ── chat ────────────────────────────────────────────────────────────────
    fun send() {
        val s = _state.value
        val content = s.input.trim()
        if (content.isEmpty() || s.busy) return
        val agentId = s.agentId.ifEmpty { s.data.agents.firstOrNull()?.id ?: return }
        val agent = db.agent(agentId) ?: return

        var convId = s.conversationId
        if (convId.isEmpty()) {
            convId = db.createConversation(
                agentId,
                s.data.connections.firstOrNull()?.id,
                content.take(60)
            )
        }
        db.saveMessage(convId, "user", content)
        val firstMessage = s.messages.isEmpty()
        _state.update {
            it.copy(
                conversationId = convId,
                input = "",
                error = "",
                busy = true,
                streaming = "",
                messages = it.messages + io.openharness.mobile.data.ChatMessage("u", "user", content)
            )
        }

        chatJob = viewModelScope.launch {
            val streamed = StringBuilder()
            try {
                val conversation = s.data.conversations.firstOrNull { it.id == convId }
                val chosen = conversation?.connectionId ?: s.data.connections.firstOrNull()?.id
                val provider = providerFor(chosen)
                val history = db.messages(convId).map { WireMessage(it.role, it.content) }
                val prompt = listOf(WireMessage("system", agent.instructions)) + history
                Providers.stream(provider, prompt).collect { delta ->
                    streamed.append(delta)
                    _state.update { it.copy(streaming = streamed.toString()) }
                }
                db.saveMessage(convId, "assistant", streamed.toString())
                if (firstMessage) db.renameConversation(convId, content.take(60))
            } catch (e: CancellationException) {
                if (streamed.isNotEmpty()) db.saveMessage(convId, "assistant", streamed.toString())
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(error = e.message ?: "Erreur inconnue") }
            } finally {
                val finished = db.messages(convId)
                _state.update { it.copy(busy = false, streaming = "", messages = finished) }
                load()
            }
        }
    }

    fun stopChat() {
        chatJob?.cancel()
        _state.update { it.copy(busy = false, streaming = "") }
    }

    // ── teams ───────────────────────────────────────────────────────────────
    fun saveTeam(name: String, agentIds: List<String>, folders: List<String>, id: String? = null) =
        viewModelScope.launch {
            try {
                require(name.isNotBlank()) { "Le nom de l’équipe est requis." }
                require(agentIds.isNotEmpty()) { "Sélectionnez au moins un agent." }
                db.saveTeam(name.trim(), agentIds, folders.distinct(), id)
                load()
                setNotice(t("set.savedTeam"))
            } catch (e: Throwable) {
                setNotice(e.message ?: "Erreur")
            }
        }

    fun deleteTeam(id: String) = viewModelScope.launch {
        db.deleteTeam(id)
        load()
    }

    /** Called with a SAF tree URI the user granted. Persisted as team folder. */
    fun addFolderToTeam(teamId: String?, uri: String) = viewModelScope.launch {
        val existing = teamId?.let { db.team(it) }
        val folders = (existing?.folders?.let(::parseFolders) ?: emptyList()).toMutableList()
        if (!folders.contains(uri)) folders.add(uri)
        db.saveTeam(
            existing?.name ?: "Équipe",
            existing?.agentIds?.let(::parseIds) ?: _state.value.data.agents.take(1).map { it.id },
            folders,
            teamId
        )
        load()
        setNotice(t("set.savedFolder"))
    }

    fun removeFolderFromTeam(teamId: String, uri: String) = viewModelScope.launch {
        val team = db.team(teamId) ?: return@launch
        val folders = parseFolders(team.folders).filter { it != uri }
        db.saveTeam(team.name, parseIds(team.agentIds), folders, teamId)
        load()
    }

    fun selectTeam(id: String) {
        _state.update { it.copy(selectedTeamId = id) }
        refreshWorkspace()
    }

    fun setMissionTask(text: String) = _state.update { it.copy(missionTask = text) }

    fun refreshWorkspace() = viewModelScope.launch {
        val teamId = _state.value.selectedTeamId.ifEmpty { _state.value.data.teams.firstOrNull()?.id ?: "" }
        if (teamId.isEmpty()) {
            _state.update { it.copy(workspace = emptyList()) }
            return@launch
        }
        val team = db.team(teamId)
        val folders = parseFolders(team?.folders)
        if (folders.isEmpty()) {
            _state.update { it.copy(workspace = emptyList()) }
            return@launch
        }
        val listing = try {
            Workspace.list(context, folders)
        } catch (_: Throwable) {
            emptyList()
        }
        _state.update { it.copy(workspace = listing) }
    }

    fun stopMission() {
        missionJob?.cancel()
        _state.update { it.copy(missionRunning = false) }
    }

    /**
     * Sequential delegation: each team agent is really invoked, in order, with
     * the previous results folded into the next prompt. Real provider calls
     * only — nothing is mocked. Assigned folders are read through the SAF
     * grants, one READ round per turn, exactly like the desktop orchestrator.
     */
    fun startMission() {
        val s = _state.value
        val teamId = s.selectedTeamId.ifEmpty { s.data.teams.firstOrNull()?.id ?: "" }
        val task = s.missionTask.trim()
        if (teamId.isEmpty() || task.isEmpty() || s.missionRunning) return
        val team: Team = db.team(teamId) ?: return
        val ids = parseIds(team.agentIds)
        if (ids.isEmpty()) {
            _state.update { it.copy(error = "L’équipe est vide.") }
            return
        }
        val folders = parseFolders(team.folders)

        val missionId = db.startMission(teamId, task)
        _state.update {
            it.copy(missionRunning = true, missionDone = "", missionEvents = emptyList(), error = "")
        }

        missionJob = viewModelScope.launch {
            val record = { agentId: String, text: String ->
                db.recordEvent(missionId, agentId, text)
                _state.update { current ->
                    current.copy(
                        missionEvents = current.missionEvents +
                            io.openharness.mobile.data.MissionEvent(missionId, agentId, text)
                    )
                }
            }

            var workspaceContext = ""
            if (folders.isNotEmpty()) {
                workspaceContext = try {
                    val listing = Workspace.list(context, folders)
                    "\n\nDossiers assignés à l’équipe (lecture seule) :\n" + listing.joinToString("\n") { l ->
                        "${l.folder} → " + (l.entries.map { e -> e.name }.joinToString(", ").ifEmpty { "(vide)" })
                    }
                } catch (e: Throwable) {
                    if (!Workspace.isPolicy(e)) throw e
                    "\n\nDossiers assignés illisibles : ${e.message}"
                }
            }

            var context = "Mission: $task"
            try {
                for (agentId in ids) {
                    val agent = db.agent(agentId) ?: continue
                    record(agent.id, "${agent.name} démarre son analyse.")

                    val conv = db.createConversation(agent.id, null, "Mission — ${task.take(40)}")
                    db.saveMessage(
                        conv, "user",
                        "Mission globale: $task\n\nContexte et résultats des agents précédents:\n$context" +
                            (if (workspaceContext.isNotEmpty())
                                "\n$workspaceContext\n\nSi un fichier listé est utile, répondez avec une ligne \"READ: nom-du-fichier\" pour en obtenir le contenu."
                            else "")
                    )

                    val result = runAgentTurn(conv, agent.instructions, folders)
                    context += "\n\n${agent.name}: $result"
                    record(agent.id, result)
                }
                db.finishMission(missionId, "completed", context)
                _state.update { it.copy(missionRunning = false, missionDone = "completed") }
            } catch (e: CancellationException) {
                db.finishMission(missionId, "cancelled", context)
                _state.update { it.copy(missionRunning = false, missionDone = "cancelled") }
                throw e
            } catch (e: Throwable) {
                db.finishMission(missionId, "failed", context)
                _state.update { it.copy(missionRunning = false, error = e.message ?: "Échec de la mission.") }
            }
        }
    }

    /** Up to three rounds, one real file read per round. */
    private suspend fun runAgentTurn(conversationId: String, instructions: String, folders: List<String>): String {
        var content = ""
        var round = 0
        while (round < 3) {
            round += 1
            val provider = providerFor(db.firstConnectionId())
            val history = db.messages(conversationId).map { WireMessage(it.role, it.content) }
            content = ""
            Providers.stream(provider, listOf(WireMessage("system", instructions)) + history).collect { delta ->
                content += delta
            }
            db.saveMessage(conversationId, "assistant", content)
            val matches = Workspace.parseReadRequests(content)
            if (matches.isEmpty() || round >= 3) return content
            val results = matches.map { name ->
                try {
                    "Contenu de $name :\n" + Workspace.read(context, folders, name)
                } catch (e: Throwable) {
                    "Lecture de $name impossible : ${e.message}"
                }
            }
            db.saveMessage(
                conversationId, "user",
                "Résultats de lecture (lecture seule, dossiers assignés) :\n${results.joinToString("\n\n")}"
            )
        }
        return content
    }

    private fun parseIds(raw: String): List<String> = try {
        val arr = JSONArray(raw)
        (0 until arr.length()).map { arr.getString(it) }
    } catch (_: Throwable) {
        emptyList()
    }

    private fun parseFolders(raw: String?): List<String> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    fun agentName(id: String): String =
        _state.value.data.agents.firstOrNull { it.id == id }?.name ?: t("team.orchestrator")
}
