import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * End-to-end tests for the team chat: a scripted SSE provider plays each
 * agent turn; assertions run against the captured request bodies and the
 * SQLite database, exactly like the mission E2E suite.
 */

const mockHandlers = new Map<string, (data: any) => unknown>();
const mockEvents: { channel: string; data: any }[] = [];
const mockDataDir = { current: '' };

vi.mock('better-sqlite3', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  class MockDatabase {
    private db: InstanceType<typeof DatabaseSync>;
    constructor(file: string) { this.db = new DatabaseSync(file); }
    pragma(statement: string) { this.db.exec(`pragma ${statement}`); return {}; }
    exec(sql: string) { this.db.exec(sql); }
    close() { this.db.close(); }
    prepare(sql: string) {
      const stmt = this.db.prepare(sql);
      return {
        run: (...params: unknown[]) => stmt.run(...(params as never[])),
        get: (...params: unknown[]) => stmt.get(...(params as never[])),
        all: (...params: unknown[]) => stmt.all(...(params as never[]))
      };
    }
  }
  return { default: MockDatabase };
});

vi.mock('electron', () => {
  const win = {
    webContents: {
      send: (channel: string, data: any) => mockEvents.push({ channel, data }),
      on: () => undefined,
      setWindowOpenHandler: () => undefined
    },
    loadURL: async () => undefined,
    loadFile: async () => undefined,
    on: () => undefined
  };
  return {
    app: {
      whenReady: () => Promise.resolve(true),
      isPackaged: false,
      getPath: (key: string) => (key === 'userData' ? mockDataDir.current : ''),
      on: () => undefined,
      quit: () => undefined
    },
    BrowserWindow: function () { return win; },
    Menu: { setApplicationMenu: () => undefined },
    ipcMain: { handle: (channel: string, handler: any) => mockHandlers.set(channel, handler) },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (buffer: Buffer) => buffer.toString()
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  };
});

const invoke = (channel: string, data?: any) => {
  const handler = mockHandlers.get(channel) as ((event: unknown, data: unknown) => unknown) | undefined;
  if (!handler) throw new Error(`Handler absent : ${channel}`);
  return handler(null, data);
};

let dataDir: string;
let wsDir: string;
let server: any;
let serverUrl = '';
const capturedBodies: string[] = [];
const turnScripts: string[] = [];
let turnIndex = 0;

beforeAll(async () => {
  const base = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'oh-tchat-'));
  dataDir = path.join(base, 'data');
  wsDir = path.join(base, 'projet');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(wsDir);
  fs.writeFileSync(path.join(wsDir, 'brief.md'), 'cahier des charges v1');
  mockDataDir.current = dataDir;

  const http = await import('node:http');
  server = http.createServer((req: any, res: any) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      capturedBodies.push(body);
      const content = turnScripts[turnIndex] ?? 'FIN';
      turnIndex += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = JSON.stringify({ choices: [{ delta: { content } }] });
      res.end(`data: ${frame}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  await import('./main');
  await new Promise((resolve) => setTimeout(resolve, 20));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { fs.rmSync(path.dirname(dataDir), { recursive: true, force: true }); }
  catch { /* Windows keeps the sqlite file locked briefly after close */ }
});

describe('team chat (E2E)', () => {
  it('lets every agent answer in one shared, persisted thread', async () => {
    await invoke('connection:save', { name: 'fake', type: 'custom', baseUrl: serverUrl, model: 'fake-model' });
    const alpha = await invoke('agent:save', { name: 'Alpha', instructions: 'Tu es Alpha.' }) as { id: string };
    const beta = await invoke('agent:save', { name: 'Beta', instructions: 'Tu es Beta.' }) as { id: string };
    const team = await invoke('team:save', { name: 'Tchat', agentIds: [alpha.id, beta.id], folders: [wsDir] }) as { id: string };

    turnScripts.length = 0;
    turnIndex = 0;
    turnScripts.push('Réponse d’Alpha.', 'Réponse de Beta.');
    capturedBodies.length = 0;
    mockEvents.length = 0;

    const created = await invoke('teamchat:create', { teamId: team.id }) as { id: string };
    const send = await invoke('teamchat:send', { conversationId: created.id, content: 'Bonjour l’équipe' }) as { content: string };

    // The last stored assistant answer is the final participant's.
    expect(send.content).toBe('Réponse de Beta.');
    // Both agents ran in roster order against the same conversation.
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0]).toContain('Tu es Alpha.');
    expect(capturedBodies[0]).toContain('Bonjour l’équipe');
    // Beta sees Alpha's answer in history — one shared thread.
    expect(capturedBodies[1]).toContain('Réponse d’Alpha.');
    // Workspace intro rode with the first message (folder assigned).
    expect(capturedBodies[0]).toContain('Actions disponibles');

    // Streaming reached the renderer with the agent attribution.
    const deltas = mockEvents.filter((e) => e.channel === 'chat:delta');
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[0].data.agentId).toBe(alpha.id);

    const Database = (await import('better-sqlite3')).default as unknown as new (file: string) => {
      prepare: (sql: string) => { get: (...params: unknown[]) => any; all: (...params: unknown[]) => any[]; };
      close: () => void;
    };
    const db = new Database(path.join(dataDir, 'openharness.sqlite'));
    const rows = db.prepare('SELECT role,content,agent_id FROM messages WHERE conversation_id=? ORDER BY created_at')
      .all(created.id) as any[];
    // user, assistant(Alpha), assistant(Beta)
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(rows[1].agent_id).toBe(alpha.id);
    expect(rows[2].agent_id).toBe(beta.id);
    db.close();

    // The thread is listed as a team conversation and readable again.
    const list = await invoke('teamchat:list') as any[];
    expect(list.some((c) => c.id === created.id)).toBe(true);
    const again = await invoke('teamchat:messages', { id: created.id }) as any[];
    expect(again).toHaveLength(3);
  }, 30000);

  it('executes workspace actions during the chat and hides tool plumbing', async () => {
    const lecteur = await invoke('agent:save', { name: 'Lecteur', instructions: 'Tu lis les fichiers.' }) as { id: string };
    const team = await invoke('team:save', { name: 'Tchat fichiers', agentIds: [lecteur.id], folders: [wsDir] }) as { id: string };

    turnScripts.length = 0;
    turnIndex = 0;
    turnScripts.push('READ: brief.md', 'Le fichier contient « cahier des charges v1 ».');
    capturedBodies.length = 0;
    mockEvents.length = 0;

    const created = await invoke('teamchat:create', { teamId: team.id }) as { id: string };
    await invoke('teamchat:send', { conversationId: created.id, content: 'Que contient brief.md ?' });

    // Round 2 received the file content through the READ cycle.
    expect(capturedBodies[1]).toContain('FILE_CONTENT');
    expect(capturedBodies[1]).toContain('cahier des charges v1');

    const stored = await invoke('teamchat:messages', { id: created.id }) as any[];
    const userTexts = stored.filter((m) => m.role === 'user').map((m) => m.content);
    // The tool plumbing is stored for the model but is not user speech.
    expect(userTexts.some((c) => c.startsWith('Résultats des actions demandées'))).toBe(true);
    const visible = stored.filter((m) => m.role !== 'user' || !m.content.startsWith('Résultats des actions demandées'));
    expect(visible.every((m) => !m.content.startsWith('Résultats des actions demandées'))).toBe(true);
  }, 30000);

  it('refuses teamchat:send on a solo conversation', async () => {
    const agent = await invoke('agent:save', { name: 'Solo', instructions: 'Solo.' }) as { id: string };
    const conv = await invoke('conversation:create', { agentId: agent.id }) as { id: string };
    await expect(invoke('teamchat:send', { conversationId: conv.id, content: 'salut' }))
      .rejects.toThrow('Conversation d’équipe introuvable.');
  }, 30000);

  it('broadcasts live activity (thinking, reading, idle) while agents work', async () => {
    const lecteur = await invoke('agent:save', { name: 'Actif', instructions: 'Tu lis.' }) as { id: string };
    const team = await invoke('team:save', { name: 'Tchat actif', agentIds: [lecteur.id], folders: [wsDir] }) as { id: string };

    turnScripts.length = 0;
    turnIndex = 0;
    turnScripts.push('READ: brief.md', 'Terminé.');
    capturedBodies.length = 0;
    mockEvents.length = 0;

    const created = await invoke('teamchat:create', { teamId: team.id }) as { id: string };
    await invoke('teamchat:send', { conversationId: created.id, content: 'Lis brief.md' });

    const acts = mockEvents
      .filter((e) => e.channel === 'agent:activity')
      .map((e) => e.data as { conversationId: string; agentId?: string; activity: string });
    // The agent is shown thinking, then reading, and ends idle (cleared).
    expect(acts.some((a) => a.activity === 'thinking' && a.agentId === lecteur.id)).toBe(true);
    expect(acts.some((a) => a.activity === 'reading' && a.agentId === lecteur.id)).toBe(true);
    expect(acts.at(-1)?.activity).toBe('idle');
    expect(acts.every((a) => a.conversationId === created.id)).toBe(true);
  }, 30000);
});
