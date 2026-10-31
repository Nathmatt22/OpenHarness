import { app, BrowserWindow, Menu, ipcMain, safeStorage, dialog } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { database, initDatabase } from './database';
import { builtInAgents } from './agents';
import { streamChat, testProvider, providerEndpoint, type ProviderInput, type ChatMessage } from './providers';
import { listWorkspace, readWorkspaceFile, parseReadRequests, isPolicy } from './workspace';

let win: BrowserWindow;
const controllers = new Map<string, AbortController>();

const allowed = new Set([
  'app:init', 'settings:get', 'settings:set',
  'connection:save', 'connection:delete', 'connection:test',
  'conversation:create', 'conversation:list', 'conversation:messages', 'conversation:delete',
  'chat:send', 'chat:stop',
  'agent:save', 'agent:delete',
  'team:save', 'team:delete', 'team:pickFolder', 'workspace:list', 'workspace:read',
  'mission:start', 'mission:stop', 'mission:events'
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

function emit(channel: string, data: unknown) { win?.webContents.send(channel, data); }

function agent(id: string) {
  return database().prepare('SELECT * FROM agents WHERE id=?').get(id) as any;
}

function saveMessage(conversationId: string, role: string, content: string) {
  database().prepare('INSERT INTO messages VALUES(?,?,?,?,?)')
    .run(randomUUID(), conversationId, role, content, new Date().toISOString());
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
  else void win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.webContents.on('did-fail-load', (_e, code, description, url) =>
    console.error(`Renderer load failed (${code}): ${description} [${url}]`));
  win.webContents.on('render-process-gone', (_e, details) => console.error('Renderer process stopped:', details));

  register('app:init', () => ({
    agents: d.prepare('SELECT * FROM agents ORDER BY custom,name').all(),
    connections: d.prepare('SELECT id,name,type,base_url,model,created_at FROM connections ORDER BY created_at').all(),
    conversations: d.prepare('SELECT * FROM conversations ORDER BY created_at DESC').all(),
    teams: d.prepare('SELECT id,name,agent_ids,folders,created_at FROM teams ORDER BY created_at DESC').all(),
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
    d.prepare('INSERT INTO teams(id,name,agent_ids,folders,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,agent_ids=excluded.agent_ids,folders=excluded.folders')
      .run(id, p.name.trim(), JSON.stringify(p.agentIds), JSON.stringify(folders), new Date().toISOString());
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
    const team = d.prepare('SELECT folders FROM teams WHERE id=?').get(p.teamId) as any;
    const folders: string[] = team?.folders ? JSON.parse(team.folders) : [];
    if (!folders.length) fail('Cette équipe n’a aucun dossier assigné.');
    return listWorkspace(folders);
  });

  register('workspace:read', (p: any) => {
    if (!isString(p?.relative) || !p.relative.trim()) fail('Nom de fichier requis.');
    const team = d.prepare('SELECT folders FROM teams WHERE id=?').get(p.teamId) as any;
    const folders: string[] = team?.folders ? JSON.parse(team.folders) : [];
    if (!folders.length) fail('Cette équipe n’a aucun dossier assigné.');
    return readWorkspaceFile(folders, p.relative);
  });

  register('mission:start', async (p: any) => {
    const team = d.prepare('SELECT * FROM teams WHERE id=?').get(p.teamId) as any;
    if (!team || !isString(p?.task) || !p.task.trim()) fail('Équipe ou mission manquante.');
    const ids = JSON.parse(team.agent_ids) as string[];
    if (!ids.length) fail('L’équipe est vide.');
    const folders: string[] = team.folders ? JSON.parse(team.folders) : [];
    const id = randomUUID();
    controllers.set(id, new AbortController());
    emit('mission:started', { missionId: id });
    d.prepare('INSERT INTO missions VALUES(?,?,?,?,?,?)').run(id, p.teamId, p.task.trim(), 'running', '', new Date().toISOString());
    const record = (aid: string, text: string) => {
      d.prepare('INSERT INTO mission_events(id,mission_id,agent_id,content,created_at) VALUES(?,?,?,?,?)')
        .run(randomUUID(), id, aid, text, new Date().toISOString());
      emit('mission:event', { missionId: id, agentId: aid, content: text });
    };

    // Workspace context built from the folders assigned to the team.
    let workspaceContext = '';
    if (folders.length) {
      try {
        const listing = listWorkspace(folders);
        workspaceContext = '\n\nDossiers assignés à l’équipe (lecture seule) :\n' + listing.map((l) =>
          `${l.folder} → ${l.entries.map((e) => e.name).join(', ') || '(vide)'}`).join('\n');
      } catch (e) {
        if (!isPolicy(e)) throw e;
        workspaceContext = `\n\nDossiers assignés illisibles : ${e.message}`;
      }
    }

    // One real file read per agent turn: the model signals a file with a READ
    // marker line, the main process reads it inside the assigned folders and
    // re-sends the content so the agent can use it in the same turn.
    const runAgentTurn = async (conversationId: string, instructions: string): Promise<string> => {
      let content = '';
      let round = 0;
      while (round < 3) {
        round += 1;
        const conversation = d.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId) as any;
        const provider = providerFor(conversation?.connection_id
          || (d.prepare('SELECT id FROM connections ORDER BY created_at LIMIT 1').get() as any)?.id);
        const history = d.prepare('SELECT role,content FROM messages WHERE conversation_id=? ORDER BY created_at')
          .all(conversationId) as ChatMessage[];
        const signal = controllers.get(id)?.signal;
        if (!signal) fail('Mission annulée.');
        content = '';
        for await (const delta of streamChat(provider, [{ role: 'system', content: instructions }, ...history], signal)) {
          content += delta;
          emit('chat:delta', { id: conversationId, streamId: conversationId, delta });
        }
        saveMessage(conversationId, 'assistant', content);
        const matches = parseReadRequests(content);
        if (!matches.length || round >= 3) return content;
        const readResults: string[] = [];
        for (const match of matches) {
          try {
            const text = readWorkspaceFile(folders, match);
            readResults.push(`Contenu de ${match} :\n${text}`);
          } catch (e) {
            readResults.push(`Lecture de ${match} impossible : ${e instanceof Error ? e.message : e}`);
          }
        }
        saveMessage(conversationId, 'user',
          `Résultats de lecture (lecture seule, dossiers assignés) :\n${readResults.join('\n\n')}`);
      }
      return content;
    };

    let context = `Mission: ${p.task.trim()}`;
    try {
      for (const agentId of ids) {
        if (controllers.get(id)?.signal.aborted) break;
        const a = agent(agentId);
        if (!a) continue;
        record(a.id, `${a.name} démarre son analyse.`);
        const conv = randomUUID();
        d.prepare('INSERT INTO conversations(id,title,agent_id,connection_id,created_at) VALUES(?,?,?,?,?)')
          .run(conv, `Mission — ${p.task.slice(0, 40)}`, a.id, null, new Date().toISOString());
        saveMessage(conv, 'user',
          `Mission globale: ${p.task}\n\nContexte et résultats des agents précédents:\n${context}` +
          (workspaceContext ? `\n${workspaceContext}\n\nSi un fichier listé est utile, répondez avec une ligne "READ: nom-du-fichier" pour en obtenir le contenu.` : ''));
        const result = await runAgentTurn(conv, a.instructions);
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
