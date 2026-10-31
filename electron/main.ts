import { app, BrowserWindow, Menu, ipcMain, safeStorage, dialog } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { database, initDatabase } from './database';
import { builtInAgents } from './agents';
import { streamChat, testProvider, providerEndpoint, type ProviderInput, type ChatMessage } from './providers';
import {
  listWorkspace, readWorkspaceFile, writeWorkspaceFile, deleteWorkspaceEntry, mkdirWorkspace,
  parseWorkspaceRequests, parseFolderFlags, performWorkspaceAction, runApplication, isPolicy,
  type ParsedRequest, type WorkspaceFolders
} from './workspace';

let win: BrowserWindow;
const controllers = new Map<string, AbortController>();

const allowed = new Set([
  'app:init', 'settings:get', 'settings:set',
  'connection:save', 'connection:delete', 'connection:test',
  'conversation:create', 'conversation:list', 'conversation:messages', 'conversation:delete',
  'chat:send', 'chat:stop',
  'agent:save', 'agent:delete',
  'team:save', 'team:delete', 'team:pickFolder', 'workspace:list', 'workspace:read',
  'workspace:write', 'workspace:delete', 'workspace:mkdir', 'workspace:run',
  'teamchat:create', 'teamchat:list', 'teamchat:messages', 'teamchat:send', 'teamchat:stop',
  'mission:start', 'mission:stop', 'mission:events'
]);
const emittedChannels = new Set([
  'chat:delta', 'chat:error', 'mission:event', 'mission:done', 'mission:started', 'agent:activity'
]);
const isString = (v: unknown): v is string => typeof v === 'string';
function fail(message: string): never { throw new Error(message); }

function register(channel: string, handler: (data: any) => unknown) {
  if (!allowed.has(channel)) throw new Error('Invalid IPC channel');
  ipcMain.handle(channel, async (_event, data) => handler(data));
}

function connectionRow(id: string): any {
  return database().prepare('SELECT * FROM connections WHERE id=?').get(id) as any;
}

function providerFor(id: string): ProviderInput {
  const row = connectionRow(id);
  if (!row) fail('Choisissez une connexion API dans les paramètres.');
  return {
    type: row.type,
    baseUrl: row.base_url,
    model: row.model,
    apiKey: row.secret && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(row.secret, 'base64'))
      : ''
  };
}

function emit(channel: string, data: unknown) {
  if (!emittedChannels.has(channel)) throw new Error('IPC event not allowed');
  win?.webContents.send(channel, data);
}

function agent(id: string) {
  return database().prepare('SELECT * FROM agents WHERE id=?').get(id) as any;
}

/** Alias used by the team-chat paths. */
const agentRow = agent;

/** Folders stored on the team row; `[]` when the team has none or is unknown. */
function teamFolders(teamId: string): string[] {
  const team = database().prepare('SELECT folders FROM teams WHERE id=?').get(teamId) as any;
  return team?.folders ? (JSON.parse(team.folders) as string[]) : [];
}

/** Decoded folder entries plus the writable subset (entries may carry a flag). */
function teamWorkspace(teamId: string) {
  return parseFolderFlags(teamFolders(teamId));
}

/** Whether the team-level "agents may launch applications" switch is on. */
function teamAllowRun(teamId: string): boolean {
  const team = database().prepare('SELECT allow_run FROM teams WHERE id=?').get(teamId) as any;
  return team?.allow_run === 1;
}

/** Decoded workspace capabilities (folders, writable subset, run switch) for a team. */
function teamCapabilities(teamId: string): WorkspaceFolders {
  const { folders, writable } = teamWorkspace(teamId);
  return { folders, writable, allowRun: teamAllowRun(teamId) };
}

/**
 * Workspace intro for the first message of a team conversation: per-folder
 * capability flags plus the action-marker how-to. Empty when the team has no
 * folder assigned.
 */
function buildWorkspaceContext(ws: WorkspaceFolders): string {
  if (!ws.folders.length) return '';
  let workspaceContext = '';
  try {
    const listing = listWorkspace(ws.folders);
    workspaceContext = '\n\nDossiers assignés à l’équipe :\n' + listing.map((l) =>
      `${ws.writable.has(l.folder) ? '[écriture autorisée]' : '[lecture seule]'} ${l.folder} → ${l.entries.map((e) => e.name).join(', ') || '(vide)'}`).join('\n');
  } catch (e) {
    if (!isPolicy(e)) throw e;
    workspaceContext = `\n\nDossiers assignés illisibles : ${e.message}`;
  }
  const capabilities = [
    'Pour lire un fichier, écris une ligne complète "READ: chemin/relatif.ext".'
  ];
  if (ws.writable.size) {
    capabilities.push(
      'Dans les dossiers marqués [écriture autorisée], tu peux aussi demander, sur une seule ligne :',
      '- "WRITE: chemin/relatif.ext | contenu complet du fichier" (crée ou remplace le fichier, 512 Ko max) ;',
      '- "MKDIR: sous/dossier" ;',
      '- "DELETE: chemin/relatif" (fichier ou dossier vide).'
    );
  } else {
    capabilities.push('Ces dossiers sont en lecture seule : aucune écriture n’est possible.');
  }
  if (ws.allowRun) {
    capabilities.push(
      'Tu peux lancer des applications installées par leur nom, ou par un chemin dans les dossiers assignés :',
      '- "RUN: programme argument1 argument2" pour lancer sans attendre (aperçu de sortie limité) ;',
      '- "RUN_WAIT: programme arguments | sous/dossier" pour attendre la fin et obtenir le code de sortie (120 s max) ; le segment après | est le dossier de travail.',
      'N’invente jamais une exécution : si tu n’as pas réellement lancé de commande, dis-le.'
    );
  }
  return workspaceContext + '\n\nActions disponibles :\n' + capabilities.map((c) => `- ${c}`).join('\n');
}

/** Fallback connection id: the oldest configured connection. */
function firstConnectionId(): string | undefined {
  return (database().prepare('SELECT id FROM connections ORDER BY created_at LIMIT 1').get() as any)?.id;
}

/**
 * Store one message; team messages carry the speaking agent's id in the
 * agent_id column so the renderer can attribute every bubble.
 */
function saveTeamMessage(conversationId: string, role: string, content: string, agentId?: string) {
  database().prepare('INSERT INTO messages(id,conversation_id,role,content,created_at,agent_id) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), conversationId, role, content, new Date().toISOString(), agentId ?? null);
}

/** Live agent activity states surfaced to the renderer. */
export type AgentActivity = 'thinking' | 'reading' | 'writing' | 'creating' | 'deleting' | 'running' | 'queued' | 'idle';

/** Broadcast what an agent is doing right now (renderer shows a live badge). */
function setActivity(conversationId: string, activity: AgentActivity, agentId?: string, missionId?: string) {
  emit('agent:activity', { conversationId, missionId, agentId, activity });
}

/**
 * Run one participant turn: stream the answer (emitting chat:delta), persist
 * it, execute any workspace action markers and feed the tagged results back,
 * then return the final text. Activity events mark thinking/reading/writing/
 * running phases so the interface can show what the agent is doing live.
 */
async function runAgentTurn(
  conversationId: string,
  instructions: string,
  ws: WorkspaceFolders,
  signal: AbortSignal,
  opts?: { agentId?: string; maxRounds?: number; missionId?: string }
): Promise<string> {
  const maxRounds = opts?.maxRounds ?? 3;
  let content = '';
  const budget = { writeBytes: 0 };
  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      const conversation = database().prepare('SELECT * FROM conversations WHERE id=?').get(conversationId) as any;
      const provider = providerFor(conversation?.connection_id || firstConnectionId());
      const history = database().prepare('SELECT role,content FROM messages WHERE conversation_id=? ORDER BY created_at')
        .all(conversationId) as ChatMessage[];
      setActivity(conversationId, 'thinking', opts?.agentId, opts?.missionId);
      content = '';
      for await (const delta of streamChat(provider, [{ role: 'system', content: instructions }, ...history], signal)) {
        content += delta;
        emit('chat:delta', { id: conversationId, streamId: conversationId, delta, agentId: opts?.agentId });
      }
      saveTeamMessage(conversationId, 'assistant', content, opts?.agentId);
      const requests = parseWorkspaceRequests(content);
      if (!requests.length || round >= maxRounds) return content;
      const results: string[] = [];
      for (const request of requests) {
        const phase: AgentActivity =
          request.action === 'READ' ? 'reading'
          : request.action === 'WRITE' ? 'writing'
          : request.action === 'MKDIR' ? 'creating'
          : request.action === 'DELETE' ? 'deleting'
          : request.action === 'RUN' || request.action === 'RUN_WAIT' ? 'running'
          : 'thinking';
        setActivity(conversationId, phase, opts?.agentId, opts?.missionId);
        results.push(await performWorkspaceAction(ws, request, budget));
      }
      saveTeamMessage(conversationId, 'user',
        `Résultats des actions demandées (dossiers assignés) :\n${results.join('\n\n')}\n\n` +
        'Continue à partir de ces résultats. Ces lignes outil ne sont pas des réponses de l’utilisateur.');
    }
    return content;
  } finally {
    setActivity(conversationId, 'idle', opts?.agentId, opts?.missionId);
  }
}

function saveMessage(conversationId: string, role: string, content: string) {
  saveTeamMessage(conversationId, role, content);
}

async function answer(conversationId: string, agentId: string, streamKey: string) {
  const a = agent(agentId);
  if (!a) fail('Agent inconnu.');
  const conversation = database().prepare('SELECT * FROM conversations WHERE id=?').get(conversationId) as any;
  const connId = conversation?.connection_id
    || (database().prepare('SELECT id FROM connections ORDER BY created_at LIMIT 1').get() as any)?.id;
  if (!connId) fail('Aucune connexion configurée.');
  const provider = providerFor(connId);
  const history = database()
    .prepare('SELECT role,content FROM messages WHERE conversation_id=? ORDER BY created_at')
    .all(conversationId) as ChatMessage[];
  const controller = new AbortController();
  controllers.set(streamKey, controller);
  let result = '';
  try {
    for await (const delta of streamChat(provider, [{ role: 'system', content: a.instructions }, ...history], controller.signal)) {
      result += delta;
      emit('chat:delta', { id: conversationId, streamId: streamKey, delta });
    }
  } finally {
    controllers.delete(streamKey);
  }
  saveMessage(conversationId, 'assistant', result);
  return result;
}

app.whenReady().then(() => {
  initDatabase();
  const d = database();

  Menu.setApplicationMenu(null);

  for (const a of builtInAgents) {
    d.prepare('INSERT OR IGNORE INTO agents(id,name,description,instructions,icon,tools,custom) VALUES(?,?,?,?,?,?,0)')
      .run(a.id, a.name, a.description, a.instructions, a.icon, JSON.stringify(a.tools));
  }

  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 640,
    backgroundColor: '#0c0d11',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = undefined as any; });

  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else if (!app.isPackaged) void win.loadURL('http://localhost:5173');
  else void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  win.webContents.on('did-fail-load', (_e, code, description, url) =>
    console.error(`Renderer load failed (${code}): ${description} [${url}]`));
  win.webContents.on('render-process-gone', (_e, details) => console.error('Renderer process stopped:', details));

  register('app:init', () => ({
    agents: d.prepare('SELECT * FROM agents ORDER BY custom,name').all(),
    connections: d.prepare('SELECT id,name,type,base_url,model,created_at FROM connections ORDER BY created_at').all(),
    conversations: d.prepare('SELECT id,title,agent_id,connection_id,team_id,created_at FROM conversations ORDER BY created_at DESC').all(),
    teams: d.prepare('SELECT id,name,agent_ids,folders,allow_run,created_at FROM teams ORDER BY created_at DESC').all(),
    settings: Object.fromEntries(d.prepare('SELECT key,value FROM settings').all().map((r: any) => [r.key, r.value])) as Record<string, string>,
    endpoints: providerEndpoint('claude') && providerEndpoint('openai')
      ? { claude: providerEndpoint('claude'), openai: providerEndpoint('openai') }
      : undefined,
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }));

  register('settings:get', (p: any) => {
    const row = d.prepare('SELECT value FROM settings WHERE key=?').get(String(p?.key || '')) as any;
    return row ? row.value : null;
  });

  register('settings:set', (p: any) => {
    if (!isString(p?.key) || !p.key.trim() || p.key.length > 64) fail('Clé de réglage invalide.');
    const value = isString(p.value) ? p.value : String(p.value ?? '');
    if (value.length > 10000) fail('Valeur de réglage trop longue.');
    d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(p.key.trim(), value);
    return true;
  });

  register('connection:save', (p: any) => {
    if (!isString(p?.name) || !p.name.trim()) fail('Le nom de la connexion est requis.');
    if (!isString(p?.model) || !p.model.trim()) fail('Le Model ID est requis.');
    if (!['claude', 'openai', 'custom'].includes(p.type)) fail('Type de fournisseur inconnu.');
    if (p.type === 'custom' && !/^https?:\/\/.+/i.test(p.baseUrl || '')) fail('Base URL HTTP(S) requise pour une API personnalisée.');
    const id = p.id || randomUUID();
    const secret = p.apiKey
      ? (safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(String(p.apiKey)).toString('base64')
        : fail('Chiffrement système indisponible.'))
      : '';
    d.prepare(`INSERT INTO connections VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,base_url=excluded.base_url,
      model=excluded.model,secret=CASE WHEN excluded.secret='' THEN connections.secret ELSE excluded.secret END`)
      .run(id, p.name.trim(), p.type, p.type === 'custom' ? String(p.baseUrl).trim() : '', p.model, secret, new Date().toISOString());
    return { id };
  });

  register('connection:delete', (p: any) => { d.prepare('DELETE FROM connections WHERE id=?').run(p.id); return true; });
  register('connection:test', async (p: any) => {
    // With an id, use the stored (encrypted) key; without one, test the unsaved form values.
    const provider: ProviderInput = p.id
      ? providerFor(p.id)
      : { type: p.type, baseUrl: p.baseUrl, apiKey: isString(p.apiKey) ? p.apiKey : '', model: p.model };
    if (!isString(provider.model) || !provider.model.trim()) fail('Model ID requis pour tester la connexion.');
    return testProvider(provider);
  });

  register('conversation:create', (p: any) => {
    if (!agent(p.agentId)) fail('Agent inconnu.');
    const id = randomUUID();
    const connectionId = isString(p.connectionId) && p.connectionId ? p.connectionId : null;
    if (connectionId && !connectionRow(connectionId)) fail('Connexion inconnue.');
    d.prepare('INSERT INTO conversations(id,title,agent_id,connection_id,created_at) VALUES(?,?,?,?,?)')
      .run(id, isString(p.title) && p.title.trim() ? p.title.trim() : 'Nouvelle conversation', p.agentId, connectionId, new Date().toISOString());
    return { id };
  });

  register('conversation:delete', (p: any) => {
    d.prepare('DELETE FROM messages WHERE conversation_id=?').run(p.id);
    d.prepare('DELETE FROM conversations WHERE id=?').run(p.id);
    return true;
  });

  register('conversation:list', () => d.prepare('SELECT * FROM conversations ORDER BY created_at DESC').all());
  register('conversation:messages', (p: any) => d.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at').all(p.id));

  register('chat:send', async (p: any) => {
    if (!isString(p?.content) || !p.content.trim() || p.content.length > 50000) fail('Message invalide.');
    saveMessage(p.conversationId, 'user', p.content);
    try {
      return await answer(p.conversationId, p.agentId, p.conversationId);
    } catch (e) {
      emit('chat:error', { id: p.conversationId, error: String(e instanceof Error ? e.message : e) });
      throw e;
    }
  });

  register('chat:stop', (p: any) => { controllers.get(p.id)?.abort(); return true; });

  register('agent:save', (p: any) => {
    if (!isString(p?.name) || !p.name.trim()) fail('Le nom de l’agent est requis.');
    if (!isString(p?.instructions) || !p.instructions.trim()) fail('Les instructions système sont requises.');
    const id = p.id || randomUUID();
    d.prepare(`INSERT INTO agents VALUES(?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
      instructions=excluded.instructions,icon=excluded.icon,tools=excluded.tools`)
      .run(id, p.name.trim(), isString(p.description) ? p.description : '', p.instructions, isString(p.icon) && p.icon ? p.icon : 'sparkles', JSON.stringify(p.tools || []));
    return { id };
  });

  register('agent:delete', (p: any) => {
    d.prepare('DELETE FROM agents WHERE id=? AND custom=1').run(p.id);
    return true;
  });

  register('team:save', (p: any) => {
    if (!isString(p?.name) || !p.name.trim()) fail('Le nom de l’équipe est requis.');
    if (!Array.isArray(p.agentIds) || !p.agentIds.length) fail('Sélectionnez au moins un agent.');
    const id = p.id || randomUUID();
    const folders = Array.isArray(p.folders)
      ? [...new Set(p.folders.map((f: unknown) => String(f).trim()).filter(Boolean))]
      : [];
    d.prepare(`INSERT INTO teams(id,name,agent_ids,folders,allow_run,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,agent_ids=excluded.agent_ids,
      folders=excluded.folders,allow_run=excluded.allow_run`)
      .run(id, p.name.trim(), JSON.stringify(p.agentIds), JSON.stringify(folders),
        p.allowRun ? 1 : 0, new Date().toISOString());
    return { id };
  });

  register('team:delete', (p: any) => {
    d.prepare('DELETE FROM mission_events WHERE mission_id IN (SELECT id FROM missions WHERE team_id=?)').run(p.id);
    d.prepare('DELETE FROM missions WHERE team_id=?').run(p.id);
    d.prepare('DELETE FROM teams WHERE id=?').run(p.id);
    return true;
  });

  register('team:pickFolder', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Assigner un dossier à l’équipe'
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  register('workspace:list', (p: any) => {
    const { folders } = teamWorkspace(p.teamId);
    if (!folders.length) fail('Cette équipe n’a aucun dossier assigné.');
    return listWorkspace(folders);
  });

  register('workspace:read', (p: any) => {
    if (!isString(p?.relative) || !p.relative.trim()) fail('Nom de fichier requis.');
    const { folders } = teamWorkspace(p.teamId);
    if (!folders.length) fail('Cette équipe n’a aucun dossier assigné.');
    return readWorkspaceFile(folders, p.relative);
  });

  register('workspace:write', (p: any) => {
    if (!isString(p?.relative) || !p.relative.trim()) fail('Nom de fichier requis.');
    if (!isString(p?.content)) fail('Contenu requis.');
    if (p.content.length > 512 * 1024) fail('Contenu trop volumineux (max 512 Ko).');
    const { folders, writable } = teamWorkspace(p.teamId);
    return writeWorkspaceFile(folders, writable, p.relative, p.content);
  });

  register('workspace:delete', (p: any) => {
    if (!isString(p?.relative) || !p.relative.trim()) fail('Nom de fichier requis.');
    const { folders, writable } = teamWorkspace(p.teamId);
    return deleteWorkspaceEntry(folders, writable, p.relative);
  });

  register('workspace:mkdir', (p: any) => {
    if (!isString(p?.relative) || !p.relative.trim()) fail('Nom de dossier requis.');
    const { folders, writable } = teamWorkspace(p.teamId);
    return mkdirWorkspace(folders, writable, p.relative);
  });

  register('workspace:run', async (p: any) => {
    if (!isString(p?.command) || !p.command.trim()) fail('Commande requise.');
    const { folders } = teamWorkspace(p.teamId);
    if (!folders.length) fail('Cette équipe n’a aucun dossier assigné.');
    if (!teamAllowRun(p.teamId)) fail('Le lancement d’applications est désactivé pour cette équipe.');
    const result = await runApplication(folders, p.command, {
      wait: p.wait === true,
      cwd: isString(p.cwd) ? p.cwd : undefined
    });
    return result.summary;
  });

  register('teamchat:create', (p: any) => {
    const team = d.prepare('SELECT id,name FROM teams WHERE id=?').get(p?.teamId) as any;
    if (!team) fail('Équipe inconnue.');
    const id = randomUUID();
    d.prepare('INSERT INTO conversations(id,title,agent_id,connection_id,team_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, isString(p?.title) && p.title.trim() ? p.title.trim() : team.name, null, null, p.teamId, new Date().toISOString());
    return { id };
  });

  register('teamchat:list', () =>
    d.prepare('SELECT * FROM conversations WHERE team_id IS NOT NULL ORDER BY created_at DESC').all());

  register('teamchat:messages', (p: any) => {
    const conversation = d.prepare('SELECT team_id FROM conversations WHERE id=?').get(p?.id) as any;
    if (!conversation?.team_id) fail('Conversation d’équipe introuvable.');
    return d.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at').all(p.id);
  });

  register('teamchat:send', async (p: any) => {
    if (!isString(p?.content) || !p.content.trim() || p.content.length > 50000) fail('Message invalide.');
    const conversation = d.prepare('SELECT * FROM conversations WHERE id=?').get(p.conversationId) as any;
    if (!conversation?.team_id) fail('Conversation d’équipe introuvable.');
    const team = d.prepare('SELECT * FROM teams WHERE id=?').get(conversation.team_id) as any;
    const roster: string[] = team?.agent_ids ? JSON.parse(team.agent_ids) : [];
    if (!roster.length) fail('Cette équipe est vide.');
    const ws = teamCapabilities(conversation.team_id);
    const active = controllers.get(p.conversationId);
    if (active) active.abort(); // one generation at a time per team conversation
    const signal = new AbortController();
    controllers.set(p.conversationId, signal);
    const mention = isString(p?.mention) && roster.includes(p.mention) ? p.mention : null;
    // Workspace intro rides with the very first user message of the conversation.
    const fresh = !d.prepare('SELECT id FROM messages WHERE conversation_id=?').get(p.conversationId);
    try {
      if (fresh && ws.folders.length) {
        saveTeamMessage(p.conversationId, 'user',
          `${p.content.trim()}\n${buildWorkspaceContext(ws)}\n\nPour obtenir le contenu d'un fichier ou exécuter une action, utilise les lignes actions décrites ci-dessus dans ta réponse.`);
      } else {
        saveTeamMessage(p.conversationId, 'user',
          `L'utilisateur écrit à l’équipe : ${p.content.trim()}\n` +
          `Réponds directement, en une réponse courte et actionnable. Ne répète pas les réponses des autres agents.`);
      }
      const order = mention ? [mention, ...roster.filter((a) => a !== mention)] : roster;
      for (const agentId of order) {
        const a = agentRow(agentId);
        if (!a) continue;
        await runAgentTurn(p.conversationId, a.instructions, ws, signal.signal, { agentId });
      }
      const answers = d.prepare('SELECT content FROM messages WHERE conversation_id=? AND role=? ORDER BY created_at')
        .all(p.conversationId, 'assistant') as { content: string }[];
      return { content: answers.at(-1)?.content ?? '' };
    } catch (e) {
      emit('chat:error', { id: p.conversationId, error: String(e instanceof Error ? e.message : e) });
      throw e;
    } finally {
      controllers.delete(p.conversationId);
    }
  });

  register('teamchat:stop', (p: any) => { controllers.get(p?.id)?.abort(); return true; });

  register('mission:start', async (p: any) => {
    const team = d.prepare('SELECT * FROM teams WHERE id=?').get(p.teamId) as any;
    if (!team || !isString(p?.task) || !p.task.trim()) fail('Équipe ou mission manquante.');
    const ids = JSON.parse(team.agent_ids) as string[];
    if (!ids.length) fail('L’équipe est vide.');
    const id = randomUUID();
    controllers.set(id, new AbortController());
    emit('mission:started', { missionId: id });
    d.prepare('INSERT INTO missions VALUES(?,?,?,?,?,?)').run(id, p.teamId, p.task.trim(), 'running', '', new Date().toISOString());
    const record = (aid: string, text: string) => {
      d.prepare('INSERT INTO mission_events(id,mission_id,agent_id,content,created_at) VALUES(?,?,?,?,?)')
        .run(randomUUID(), id, aid, text, new Date().toISOString());
      emit('mission:event', { missionId: id, agentId: aid, content: text });
    };

    // Workspace capabilities for this mission: plain folders are readable,
    // entries flagged [WRITABLE] add write support, allow_run gates RUN.
    const ws = teamCapabilities(p.teamId);
    const workspaceContext = buildWorkspaceContext(ws);

    // Tool loop: the model signals actions with full-line markers (READ/WRITE/
    // DELETE/MKDIR/RUN/RUN_WAIT), the main process executes them inside the
    // assigned folders and feeds the tagged results back within the same turn.
    const runMissionTurn = async (conversationId: string, instructions: string, agentId: string): Promise<string> =>
      runAgentTurn(conversationId, instructions, ws, controllers.get(id)!.signal, { agentId, missionId: id });

    let context = `Mission: ${p.task.trim()}`;
    try {
      for (const agentId of ids) {
        if (controllers.get(id)?.signal.aborted) break;
        const a = agent(agentId);
        if (!a) continue;
        record(a.id, `${a.name} démarre son analyse.`);
        setActivity(id, 'queued', undefined, id);
        const conv = randomUUID();
        d.prepare('INSERT INTO conversations(id,title,agent_id,connection_id,created_at) VALUES(?,?,?,?,?)')
          .run(conv, `Mission — ${p.task.slice(0, 40)}`, a.id, null, new Date().toISOString());
        saveMessage(conv, 'user',
          `Mission globale: ${p.task}\n\nContexte et résultats des agents précédents:\n${context}` +
          (workspaceContext ? `\n${workspaceContext}\n\nPour obtenir le contenu d'un fichier ou exécuter une action, utilise les lignes actions décrites ci-dessus dans ta réponse.` : ''));
        const result = await runMissionTurn(conv, a.instructions, a.id);
        context += `\n\n${a.name}: ${result}`;
        record(a.id, result);
      }
      const aborted = controllers.get(id)?.signal.aborted;
      const status = aborted ? 'cancelled' : 'completed';
      d.prepare('UPDATE missions SET status=?,result=? WHERE id=?').run(status, context, id);
      emit('mission:done', { missionId: id, status, result: context });
      return { id, result: context };
    } catch (e) {
      d.prepare('UPDATE missions SET status=? WHERE id=?').run('failed', id);
      throw e;
    } finally {
      controllers.delete(id);
    }
  });

  register('mission:stop', (p: any) => {
    controllers.get(p.id)?.abort();
    d.prepare('UPDATE missions SET status=? WHERE id=?').run('cancelled', p.id);
    return true;
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
