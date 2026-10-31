import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { Server } from 'node:http';
import { parseReadRequests } from './workspace';

// better-sqlite3 is compiled for the Electron ABI and cannot load under plain
// Node in vitest; node:sqlite (DatabaseSync) offers the same surface we use.
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

describe('READ marker parsing', () => {
  it('extracts relative file requests from model output', () => {
    const content = [
      'Je consulte les fichiers suivants :',
      'READ: notes.txt',
      '  read:  sous/dossier/data.json  ',
      'READ:',
      'et ensuite READ: ../etc/passwd'
    ].join('\n');
    // Only full lines starting with READ: count — the standalone "READ:" and the
    // mid-sentence mention are ignored on purpose (no accidental cross-line capture).
    expect(parseReadRequests(content)).toEqual(['notes.txt', 'sous/dossier/data.json']);
  });

  it('limits the number of reads per turn', () => {
    const content = Array.from({ length: 12 }, (_, i) => `READ: fichier${i}.txt`).join('\n');
    expect(parseReadRequests(content)).toHaveLength(5);
  });

  it('returns nothing without markers', () => {
    expect(parseReadRequests('Aucune demande ici.')).toEqual([]);
  });
});


const mockHandlers = new Map<string, (data: any) => unknown>();
const mockEvents: { channel: string; data: any }[] = [];
const mockDataDir = { current: '' };

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
  // Electron's ipcMain.handle wraps handlers as (_event, data): mimic it.
  return handler(null, data);
};

let wsDir: string;
let outsideDir: string;
let dataDir: string;
let server: Server;
let serverUrl = '';
const capturedBodies: string[] = [];

const sse = (res: http.ServerResponse, content: string) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const frame = JSON.stringify({ choices: [{ delta: { content } }] });
  res.end(`data: ${frame}\n\ndata: [DONE]\n\n`);
};

// Flat response queue: each request consumes the next scripted answer.
const turnScripts: string[] = [];
let turnIndex = 0;

beforeAll(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-e2e-'));
  dataDir = path.join(base, 'data');
  wsDir = path.join(base, 'projet');
  outsideDir = path.join(base, 'prive');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(wsDir);
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(wsDir, 'notes.txt'), 'contenu interne');
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'TOPSECRET_CONTENT');
  mockDataDir.current = dataDir;

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      capturedBodies.push(body);
      const content = turnScripts[turnIndex] ?? 'FIN';
      turnIndex += 1;
      sse(res, content);
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

describe('mission with assigned folder (E2E)', () => {
  it('runs a mission where the agent reads a file from the assigned folder', async () => {
    await invoke('connection:save', { name: 'fake', type: 'custom', baseUrl: serverUrl, model: 'fake-model' });
    const agent = await invoke('agent:save', { name: 'Lecteur', instructions: 'Tu analyses les fichiers.' }) as { id: string };
    const team = await invoke('team:save', { name: 'Équipe dossier', agentIds: [agent.id], folders: [wsDir] }) as { id: string };

    turnScripts.length = 0;
    turnScripts.push('Je consulte le fichier.\nREAD: notes.txt', 'TERMINE — le fichier contient ce qui faut.');
    turnIndex = 0;
    capturedBodies.length = 0;

    const mission = await invoke('mission:start', { teamId: team.id, task: 'Analyse notes.txt' }) as { id: string; result: string };

    expect(mission.result).toContain('TERMINE');
    // Round 2 must have received the real file content through the READ cycle.
    expect(capturedBodies[1]).toContain('Résultats des actions demandées (dossiers assignés)');
    expect(capturedBodies[1]).toContain('FILE_CONTENT');

    const Database = (await import('better-sqlite3')).default as unknown as new (file: string) => {
      prepare: (sql: string) => { get: (...params: unknown[]) => any; all: (...params: unknown[]) => any[]; };
      close: () => void;
    };
    const db = new Database(path.join(dataDir, 'openharness.sqlite'));
    const row = db.prepare('SELECT status FROM missions WHERE id=?').get(mission.id) as any;
    expect(row.status).toBe('completed');
    const leaks = db.prepare('SELECT content FROM messages').all().map((r: any) => r.content).join('\n');
    expect(leaks).toContain('contenu interne');
    db.close();
  }, 30000);

  it('blocks a READ that escapes the assigned folder', async () => {
    const agent = await invoke('agent:save', { name: 'Fouineur', instructions: 'Tu lis tout.' }) as { id: string };
    const team = await invoke('team:save', { name: 'Équipe traversal', agentIds: [agent.id], folders: [`${wsDir} [WRITABLE]`], allowRun: true }) as { id: string };

    turnScripts.length = 0;
    turnScripts.push('READ: ../prive/secret.txt', 'FIN');
    turnIndex = 0;
    capturedBodies.length = 0;
    mockEvents.length = 0;

    const mission = await invoke('mission:start', { teamId: team.id, task: 'Tenter la traversée' }) as { id: string; result: string };

    expect(mission.result).toContain('FIN');
    // The second turn reports the policy refusal, never the file content.
    expect(capturedBodies[1]).toContain('Résultats des actions demandées (dossiers assignés)');
    expect(capturedBodies[1]).toMatch(/impossible : (Chemin de fichier invalide|Chemin hors des dossiers assignés)/);
    const allText = JSON.stringify(capturedBodies) + JSON.stringify(mockEvents) + mission.result;
    expect(allText).not.toContain('TOPSECRET_CONTENT');
  }, 30000);

  it('writes files and creates folders when the folder is marked writable', async () => {
    const agent = await invoke('agent:save', { name: 'Rédacteur', instructions: 'Tu écris les fichiers demandés.' }) as { id: string };
    const team = await invoke('team:save', { name: 'Équipe écriture', agentIds: [agent.id], folders: [`${wsDir} [WRITABLE]`] }) as { id: string };

    turnScripts.length = 0;
    turnScripts.push(
      'Je crée le rapport.\nWRITE: rapports/analyse.md | # Analyse\\nTout est vérifié.\nMKDIR: rapports/archives |mk1',
      'Écriture terminée, dossier archives prêt.'
    );
    turnIndex = 0;
    capturedBodies.length = 0;
    mockEvents.length = 0;

    const mission = await invoke('mission:start', { teamId: team.id, task: 'Rédige le rapport' }) as { id: string; result: string };

    expect(mission.result).toContain('Écriture terminée');
    expect(fs.readFileSync(path.join(wsDir, 'rapports', 'analyse.md'), 'utf8')).toBe('# Analyse\nTout est vérifié.');
    expect(fs.statSync(path.join(wsDir, 'rapports', 'archives')).isDirectory()).toBe(true);
    // The agent received the tool results and the write marker stayed out of the final answer.
    expect(capturedBodies[1]).toContain('WRITE_RESULT rapports/analyse.md');
    expect(capturedBodies[1]).toContain('MKDIR_RESULT [mk1]');
  }, 30000);

  it('refuses WRITE when no folder is writable and refuses RUN when the team toggle is off', async () => {
    const agent = await invoke('agent:save', { name: 'Zélé', instructions: 'Tu agis.' }) as { id: string };
    const team = await invoke('team:save', { name: 'Équipe stricte', agentIds: [agent.id], folders: [wsDir], allowRun: false }) as { id: string };

    turnScripts.length = 0;
    turnScripts.push('WRITE: hack.txt | contenu\nRUN: notepad.exe', 'Je m’arrête.');
    turnIndex = 0;
    capturedBodies.length = 0;

    const mission = await invoke('mission:start', { teamId: team.id, task: 'Tentative interdite' }) as { id: string; result: string };

    expect(mission.result).toContain('Je m’arrête.');
    expect(capturedBodies[1]).toContain('Aucun dossier en écriture');
    expect(capturedBodies[1]).toContain('le lancement d’applications est désactivé');
    expect(fs.existsSync(path.join(wsDir, 'hack.txt'))).toBe(false);
  }, 30000);

  it('runs an allowed application during a mission and reports the exit code', async () => {
    const agent = await invoke('agent:save', { name: 'Opérateur', instructions: 'Tu exécutes.' }) as { id: string };
    const team = await invoke('team:save', { name: 'Équipe ops', agentIds: [agent.id], folders: [wsDir], allowRun: true }) as { id: string };

    turnScripts.length = 0;
    turnScripts.push(
      'RUN_WAIT: node --eval "process.stdout.write(\'mission-ok\')" | tools',
      'Commande exécutée avec succès.'
    );
    turnIndex = 0;
    capturedBodies.length = 0;

    const mission = await invoke('mission:start', { teamId: team.id, task: 'Vérifie l’environnement' }) as { id: string; result: string };

    expect(mission.result).toContain('Commande exécutée avec succès.');
    expect(capturedBodies[1]).toContain('RUN_RESULT');
    expect(capturedBodies[1]).toContain('mission-ok');
    expect(capturedBodies[1]).toContain('Code de sortie : 0');
  }, 30000);
});
