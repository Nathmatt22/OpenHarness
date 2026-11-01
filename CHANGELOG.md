# Changelog

## 0.4.0 - Environnements virtuels d'équipe (PC virtuel) et build Android

- **Environnements virtuels** : chaque équipe peut se voir assigner un PC virtuel (`Paramètres → Environnements virtuels`) : un espace de travail isolé dans les données protégées de l'application (`userData/vm-environments/<id>`, avec `Desktop/`, `Documents/`, `Downloads/`), un bureau web dédié (`bureau.html`, généré sans ressource externe) ouvert dans une fenêtre Electron séparée, et un navigateur de machine dont la navigation est restreinte aux raccourcis http(s) configurés (session persistante `persist:vme-<id>` par machine).
- Les agents agissent dans la machine par marqueurs lignes complètes : `VM_LS`, `VM_READ`, `VM_WRITE` (512 Ko max, `\n`/`\t` échappés), `VM_MKDIR`, `VM_DELETE`, et `VM_RUN`/`VM_RUN_WAIT` derrière une bascule d'équipe dédiée (« Autoriser les commandes dans l'environnement virtuel ») ; résultats étiquetés (`VM_FILE_CONTENT`, `VM_WRITE_RESULT`, `VM_RUN_RESULT`…) renvoyés dans le même tour (3 tours, 8 actions/tour).
- Confinement identique aux dossiers assignés : chemins relatifs obligatoires, `..` toléré tant que la cible résolue (lexique + realpath, liens symboliques) reste dans la machine, programmes du PATH ou chemins internes uniquement, arguments hors machine refusés, pas d'interprétation shell ; les refus remontent comme texte étiqueté, jamais de contenu externe.
- Une machine n'appartient qu'à une équipe (assignation dans la carte Équipes, sélecteur + bascule commandes) ; la suppression d'une équipe détache sa machine (elle survit non assignée) et la suppression d'une machine assignée est refusée. Vue Équipe et tchat d'équipe affichent la machine et permettent d'ouvrir son bureau web.
- Badge d'activité `vm` (« travaille dans l'environnement virtuel… ») et introduction VM dans missions et tchats d'équipe ; stockage dans une nouvelle table `virtual_machines` + colonnes `teams.virtual_machine`/`teams.vm_allow_run` (migration automatique).
- Tests : 12 nouveaux tests (`electron/vm.test.ts`) couvrant le provisionnement, le confinement fichiers/commandes, la génération du bureau, le cycle de vie IPC (`vme:create/list/delete/open`) et l'usage réel par une mission (écriture dans la machine, refus de VM_RUN sans bascule, blocage de traversée).
- **Build Android** : packaging Capacitor de la même interface (`capacitor.config.ts`, `android/`, `npm run build:android`) — APK compagnon de consultation ; les appels fournisseurs restent réservés au bureau (message clair sans pont IPC). La CI produit l'APK (ubuntu, JDK 17 + SDK Android) et le joint à la release GitHub aux côtés des installateurs Windows et Linux.

## 0.1.0 - Initial workspace implementation

- Electron/React/TypeScript foundation and dark/light UI.
- SQLite persistence, encrypted provider secret storage, built-in/custom agents.
- Streaming individual chats and sequential team missions.
- Windows NSIS and Linux AppImage packaging configuration.

## 0.1.1 - Interface and connectors

- Component-based UI rewrite: sidebar, chat, team mission timeline, settings.
- Official Claude and OpenAI endpoints enforced in the main process; Custom remains user-configured.
- Removed the default Electron menu bar; added application icons for Windows/Linux.
- Per-conversation connection selection, connection test status, and generation stop.

## 0.1.2 - Settings fixes

- Fixed "Cannot read properties of null (reading 'reset')" when saving a connection: form reset now uses a ref instead of the detached event target.
- "Tester" on a saved connection now uses the stored encrypted key instead of a blank key, so the check no longer always fails with 401.
- Added the missing `connection_id` column to `conversations` (with automatic migration), which previously made the first message of a conversation fail; also fixed the mission events insert column count.
- Success confirmations in settings are now displayed as neutral notices instead of error styling.

## 0.1.3 - Streaming rendering

- Fixed the assistant answer appearing twice: the accumulated stream was never cleared and was rendered on top of the persisted message. The in-flight answer is now a single bubble that grows during streaming, then becomes the persisted message.
- Stream handling moved to refs so event handlers always target the active conversation; the realtime subscription is established once instead of on every conversation switch.

## 0.3.3 - Scroll corrigé, outils plus tolérants

- **Scroll réparé** : en fenêtre agrandie, le tchat d'équipe était clippé sans ascenseur (ligne de grille implicite qui s'étirait). Les rangées de la grille sont clampées (`minmax(0, 1fr)`) et le chat solo retrouve son auto-scroll (le ref de scroll pointe désormais sur un élément avec une boîte, pas un `display: contents`).
- **Chemins plus tolérants** : `..` est accepté tant que la cible résolue reste dans le dossier assigné (vérification lexicale + realpath). Les décorations autour des chemins (backticks, guillemets, puces markdown, gras) sont ignorées ; les marqueurs d'action enrobés dans du markdown (`- **WRITE**: \`fichier\` | contenu`) sont reconnus et dédoublonnés.
- **RUN plus tolérant** : commandes jusqu'à 2000 caractères (au lieu de 512), guillemets autorisés autour des chemins de fichiers (les quotes restent de la syntaxe shell, pas une infraction), `RUN` possible même quand la mission n'a aucun dossier assigné (programme du PATH), programmes relatifs `./outils/x.bat` résolus depuis le dossier de travail du RUN, et fin de phrase décorative tolérée (`RUN: node --version.`).

## 0.3.2 - Live agent activity

- The interface now shows what agents are doing in real time: a pulsing badge (`Alpha réfléchit…`, `Alpha lit les dossiers…`, `écrit un fichier…`, `crée un dossier…`, `supprime…`, `lance une application…`) attached to the streaming bubble in team chat, and a placeholder while the first agent warms up.
- Missions display the same badge next to the running status, fed by a dedicated `agent:activity` event (conversation id, mission id, agent id, state) emitted by the shared turn engine; `idle` clears the badge. The main process allowlist also gates emitted channels now, not just invoked ones.

## 0.3.1 - Team chat

- New shared team conversation: every agent of the roster answers in the same persisted thread, in order, each one seeing what the user and the previous agents said. The thread streams live in the interface, each bubble carries the name and icon of the agent that produced it, and the mention selector targets one agent instead of the whole team.
- Team threads appear in the sidebar history (distinct icon) and reopen with their full content. Team conversations are real rows in the database (`conversations.team_id`, `messages.agent_id`); the solo chat flow is untouched.
- Agents keep their folder capabilities during the chat: `READ`, `WRITE`, `MKDIR`, `DELETE` and `RUN`/`RUN_WAIT` are executed by the main process within the same rules as missions, and the internal tool-result messages are stored for the model but hidden from the thread.
- The turn engine (`runAgentTurn`) and the workspace instructions (`buildWorkspaceContext`) are now shared between missions and team chat; missions keep their own sequential hand-off view.
- Tests: team chat E2E suite (roster order, shared history, attribution of each bubble, READ cycle during a chat, refusal of `teamchat:send` on a solo conversation).

## 0.3.0 - Team workspace write access and application launching

- Folders assigned to a team can now be marked "Écriture" in Settings → Équipes; flagged entries are stored as `path [WRITABLE]` and decoded by `shared/workspace-flags.ts` (single source of truth for main process and renderer).
- During missions, agents can now emit full-line action markers: `WRITE: chemin | contenu` (512 KB max, 2 MB per turn, `\n`/`\t` escapes supported), `MKDIR: chemin` and `DELETE: chemin` (file or empty folder only) in folders flagged writable, and `RUN:` / `RUN_WAIT:` to launch applications when the new team-level toggle "Autoriser le lancement d'applications" is on.
- RUN resolves bare program names on the PATH or paths inside the assigned folders, passes arguments without shell interpolation, captures a bounded output snapshot, and `RUN_WAIT` reports the exit code (120 s max); arguments that look like out-of-root paths are refused.
- Write targets are anchored on their deepest existing ancestor, so a symlinked parent directory cannot smuggle a path out of the writable root; DELETE refuses the folder root and never recurses.
- The team view and mission context show per-folder capability flags; results come back to the agent as tagged tool lines (`FILE_CONTENT`, `WRITE_RESULT`, `MKDIR_RESULT`, `DELETE_RESULT`, `RUN_RESULT`) within the same turn (3 rounds, 6 actions per round).
- Tests: parsing of the new markers, write/delete/mkdir confinement (traversal, symlinks, read-only folders), RUN program/argument confinement and E2E missions covering write+mkdir, refusals without permissions, and an allowed RUN_WAIT execution.

## 0.2.1 - Assisted installer and interface language

- The Windows setup is now a real assisted installer: language selection dialog at startup (French/English, English fallback), license page with provider/mission notices, installation mode page (per-user default, per-machine with elevation), and a changeable installation directory.
- Branded NSIS header bitmap generated by `build/make-icons.py` from the app brand colors; `build/installer.nsh` included for future installer customization.
- The application UI is now bilingual (French/English): a language picker in Settings applies immediately, persists in the local SQLite `settings` table, and falls back to the OS language on first launch.
- New IPC channels `settings:get`/`settings:set` for durable per-installation preferences.

## 0.2.0 - Team workspace folders

- Teams can now be assigned local folders (native folder picker, chips with remove buttons in Settings → Équipes).
- During missions, each agent receives the folder listing in its context and can request a file with a `READ: <fichier>` line; the main process resolves it and feeds the content back within the same turn (up to 3 rounds, 5 files per round).
- File access is strictly read-only and confined: relative paths only, `..` and absolute paths rejected, symlinks resolved against the real path of each assigned folder (escapes refused), binaries and files over 64 KB refused.
- New IPC channels `team:pickFolder`, `workspace:list`, `workspace:read`; mission conversations and the team view show the assigned folders.
- Tests: path confinement (traversal, absolute paths, symlinks, multi-root), READ parsing, and an end-to-end mission with a scripted SSE provider proving the content reaches the agent and escapes are refused.
