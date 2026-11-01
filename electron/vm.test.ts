import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { Server } from 'node:http';
import {
  machinesRoot, machineFolder, listMachines, createMachine,
  listMachineFiles, readMachineFile, writeMachineFile, deleteMachineEntry, mkdirMachine,
  runInMachine, parseMachinePages, writeDesktopPage, VmPolicyError
} from './vm';

/**
 * End-to-end tests for team virtual machine environments (electron/vm.ts):
 * provisioning, confinement of every file action, command execution inside the
 * machine, desktop page generation and the DB-backed team lifecycle through the
 * main-process IPC surface.
 */

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
    session: { fromPartition: () => ({ protocol: {} }) },
    ipcMain: { handle: (channel: string, handler: any) => mockHandlers.set(channel, handler) },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (buffer: Buffer) => buffer.toString()
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  };
});

const mockHandlers = new Map<string, (data: any) => unknown>();
const mockEvents: { channel: string; data: any }[] = [];
const mockDataDir = { current: '' };

const invoke = (channel: string, data?: any) => {
  const handler = mockHandlers.get(channel) as ((event: unknown, data: unknown) => unknown) | undefined;
  if (!handler) throw new Error(`Handler absent : ${channel}`);
  // Electron's ipcMain.handle wraps handlers as (_event, data): mimic it.
  return handler(null, data);
};

let dataDir: string;
let server: Server;
let serverUrl = '';
const capturedBodies: string[] = [];
const turnScripts: string[] = [];
let turnIndex = 0;

beforeAll(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-vme-'));
  dataDir = path.join(base, 'data');
  fs.mkdirSync(dataDir);
  mockDataDir.current = dataDir;

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
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

describe('machine workspace (unit)', () => {
  let userData: string;
  let machineId: string;

  beforeAll(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-vmu-'));
    machineId = 'machine-unit';
    createMachine(userData, machineId);
  });

  afterAll(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it('provisions the machine layout under the user-data folder', () => {
    const folder = machineFolder(userData, machineId);
    expect(fs.existsSync(folder)).toBe(true);
    expect(machinesRoot(userData)).toBe(path.join(userData, 'vm-environments'));
    const names = listMachineFiles(folder).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['Desktop', 'Documents', 'README.txt']));
    expect(listMachines(userData).map((m) => m.id)).toContain(machineId);
  });

  it('reads and writes files strictly inside the machine', () => {
    const folder = machineFolder(userData, machineId);
    expect(writeMachineFile(folder, 'Documents/notes.md', '# Notes\nContenuVM')).toContain('octet');
    expect(readMachineFile(folder, 'Documents/notes.md')).toBe('# Notes\nContenuVM');
    mkdirMachine(folder, 'Documents/archives');
    expect(listMachineFiles(folder, 'Documents').map((e) => e.name)).toContain('archives');
    expect(deleteMachineEntry(folder, 'Documents/notes.md')).toBe('fichier supprimé');
    expect(fs.existsSync(path.join(folder, 'Documents', 'notes.md'))).toBe(false);
  });

  it('refuses paths escaping the machine', () => {
    const folder = machineFolder(userData, machineId);
    expect(() => readMachineFile(folder, '../outside/secret.txt')).toThrow(VmPolicyError);
    expect(() => writeMachineFile(folder, '../escape.txt', 'x')).toThrow(VmPolicyError);
    expect(() => readMachineFile(folder, 'C:/Windows/system.ini')).toThrow(VmPolicyError);
    expect(() => deleteMachineEntry(folder, '.')).toThrow(VmPolicyError);
  });

  it('runs commands inside the machine and refuses shell characters', async () => {
    const folder = machineFolder(userData, machineId);
    const result = await runInMachine(folder, `node --eval "process.stdout.write('vm-ok')"`, { wait: true });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('vm-ok');
    expect(result.summary).toContain('Code de sortie : 0');
    await expect(runInMachine(folder, 'node -e "1" && echo hacked', { wait: true }))
      .rejects.toThrow(VmPolicyError);
  });

  it('parses desktop page shortcuts (http(s) only) and writes the page', () => {
    const pages = parseMachinePages([
      'Wikipédia | https://fr.wikipedia.org',
      'https://example.org',
      'ftp://bad',
      'javascript:alert(1)'
    ]);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ label: 'Wikipédia', url: 'https://fr.wikipedia.org' });
    expect(pages[1].label.length).toBeGreaterThan(0);
    const page = writeDesktopPage(machineFolder(userData, machineId), 'PC Test', pages);
    const html = fs.readFileSync(page, 'utf8');
    expect(html).toContain('PC Test');
    expect(html).toContain('https://fr.wikipedia.org');
    expect(html).not.toContain('ftp://bad');
  });
});

describe('team machine lifecycle (E2E through the IPC surface)', () => {
  it('creates, lists and deletes a machine through vme:* channels', async () => {
    await invoke('connection:save', { name: 'fake', type: 'custom', baseUrl: serverUrl, model: 'fake-model' });
    const created = await invoke('vme:create', { name: 'PC Alpha', pages: ['https://example.org'] }) as { id: string };
    const folder = machineFolder(dataDir, created.id);
    expect(fs.existsSync(folder)).toBe(true);
    expect(fs.existsSync(path.join(folder, 'bureau.html'))).toBe(true);

    const rows = await invoke('vme:list') as any[];
    const row = rows.find((r) => r.id === created.id);
    expect(row.name).toBe('PC Alpha');
    expect(row.teamId).toBeNull();
    expect(row.ready).toBe(true);
    expect(row.pages[0].url).toBe('https://example.org');

    // Opening the desktop regenerates bureau.html and returns the machine id
    // (regression: this used to look the machine up as a *team* id and fail).
    await expect(invoke('vme:open', { id: created.id })).resolves.toBe(created.id);
    expect(fs.existsSync(path.join(folder, 'bureau.html'))).toBe(true);

    // vme:files lists the workspace by machine id as well.
    const files = await invoke('vme:files', { id: created.id }) as { name: string }[];
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(['README.txt']));

    await expect(invoke('vme:delete', { id: created.id })).resolves.toBe(true);
    expect(fs.existsSync(folder)).toBe(false);
  });

  it('assigns a machine to a team and feeds the VM intro to the agents', async () => {
    const created = await invoke('vme:create', { name: 'PC Équipe' }) as { id: string };
    const agent = await invoke('agent:save', { name: 'Pilote', instructions: 'Tu pilotes la machine.' }) as { id: string };
    const team = await invoke('team:save', {
      name: 'Équipe VM', agentIds: [agent.id], virtualMachineId: created.id, vmAllowRun: true
    }) as { id: string };

    const rows = await invoke('vme:list') as any[];
    expect(rows.find((r) => r.id === created.id).teamId).toBe(team.id);
    // teams carry the assignment back to the renderer
    const appData = await invoke('app:init') as any;
    expect(appData.teams.find((t: any) => t.id === team.id).virtual_machine).toBe(created.id);
    expect(appData.vmes.map((v: any) => v.id)).toContain(created.id);

    turnScripts.length = 0;
    turnIndex = 0;
    turnScripts.push('VM_WRITE: Documents/rapport.txt | Rapport de la machine', 'Le rapport est écrit dans la machine.');
    capturedBodies.length = 0;

    const mission = await invoke('mission:start', { teamId: team.id, task: 'Écris le rapport' }) as { id: string; result: string };
    expect(mission.result).toContain('Le rapport est écrit');
    // The VM intro reached the model, and the write really landed inside the machine.
    expect(capturedBodies[0]).toContain('Environnement virtuel assigné');
    expect(capturedBodies[1]).toContain('VM_WRITE_RESULT');
    const folder = machineFolder(dataDir, created.id);
    expect(fs.readFileSync(path.join(folder, 'Documents', 'rapport.txt'), 'utf8')).toBe('Rapport de la machine');
  }, 30000);

  it('refuses VM_RUN when the team toggle is off and rejects escaping commands', async () => {
    const created = await invoke('vme:create', { name: 'PC Strict' }) as { id: string };
    const agent = await invoke('agent:save', { name: 'Zélé', instructions: 'Tu agis.' }) as { id: string };
    const team = await invoke('team:save', {
      name: 'Équipe stricte VM', agentIds: [agent.id], virtualMachineId: created.id, vmAllowRun: false
    }) as { id: string };

    turnScripts.length = 0;
    turnIndex = 0;
    turnScripts.push('VM_RUN: node --eval "1"', 'Je m’arrête.');
    capturedBodies.length = 0;

    const mission = await invoke('mission:start', { teamId: team.id, task: 'Tentative' }) as { id: string; result: string };
    expect(capturedBodies[1]).toContain('l’exécution de commandes est désactivée');
    expect(mission.result).toContain('Je m’arrête.');
  }, 30000);

  it('blocks a VM_READ that escapes the machine', async () => {
    const outside = path.join(path.dirname(dataDir), 'prive-vme');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOPSECRET_VM');
    const created = await invoke('vme:create', { name: 'PC Confiné' }) as { id: string };
    const agent = await invoke('agent:save', { name: 'Fouineur', instructions: 'Tu lis tout.' }) as { id: string };
    const team = await invoke('team:save', {
      name: 'Équipe fouine', agentIds: [agent.id], virtualMachineId: created.id, vmAllowRun: true
    }) as { id: string };

    turnScripts.length = 0;
    turnIndex = 0;
    turnScripts.push('VM_READ: ../prive-vme/secret.txt', 'FIN');
    capturedBodies.length = 0;

    await invoke('mission:start', { teamId: team.id, task: 'Traverser' });
    expect(capturedBodies[1]).toMatch(/VM_FILE_CONTENT.*impossible|impossible : Chemin hors de l’environnement virtuel/);
    const allText = JSON.stringify(capturedBodies);
    expect(allText).not.toContain('TOPSECRET_VM');
  }, 30000);

  it('refuses to delete a machine still assigned to a team, then frees it by detaching', async () => {
    const created = await invoke('vme:create', { name: 'PC Occupé' }) as { id: string };
    const agent = await invoke('agent:save', { name: 'X', instructions: 'x' }) as { id: string };
    const team = await invoke('team:save', {
      name: 'Équipe occupée', agentIds: [agent.id], virtualMachineId: created.id
    }) as { id: string };
    await expect(invoke('vme:delete', { id: created.id })).rejects.toThrow('Détachez d’abord');
    // Deleting the team frees the machine (it survives, unassigned).
    await invoke('team:delete', { id: team.id });
    const rows = await invoke('vme:list') as any[];
    expect(rows.find((r) => r.id === created.id).teamId).toBeNull();
    await expect(invoke('vme:delete', { id: created.id })).resolves.toBe(true);
  });

  it('refuses to assign a machine owned by another team', async () => {
    const created = await invoke('vme:create', { name: 'PC Partagé' }) as { id: string };
    const agent = await invoke('agent:save', { name: 'A', instructions: 'a' }) as { id: string };
    const t1 = await invoke('team:save', { name: 'T1', agentIds: [agent.id], virtualMachineId: created.id }) as { id: string };
    await expect(invoke('team:save', {
      name: 'T2', agentIds: [agent.id], virtualMachineId: created.id
    })).rejects.toThrow('déjà assigné');
    expect(t1.id).toBeTruthy();
  });

  it('still accepts a plain team without a machine', async () => {
    const agent = await invoke('agent:save', { name: 'SansVM', instructions: 's' }) as { id: string };
    const team = await invoke('team:save', { name: 'Sans machine', agentIds: [agent.id] }) as { id: string };
    expect(team.id).toBeTruthy();
    const rows = await invoke('vme:list') as any[];
    expect(rows.every((r) => r.teamId !== team.id)).toBe(true);
  });
});
