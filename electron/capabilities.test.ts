import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeWorkspaceFile, deleteWorkspaceEntry, mkdirWorkspace, runApplication,
  parseWorkspaceRequests, parseFolderFlags, PolicyError
} from './workspace';


describe('folder flags (shared decoder)', () => {
  it('decodes writable entries and cleans paths', () => {
    const { folders, writable } = parseFolderFlags([
      '/tmp/ro', '/tmp/rw [WRITABLE]', '[DIR WRITABLE] /tmp/legacy', ''
    ]);
    expect(folders).toEqual(['/tmp/ro', '/tmp/rw', '/tmp/legacy']);
    expect([...writable]).toEqual(['/tmp/rw', '/tmp/legacy']);
  });
});

describe('request parsing', () => {
  it('parses WRITE with pipe content and MKDIR/DELETE with tags', () => {
    const requests = parseWorkspaceRequests([
      'Je crée le fichier :',
      'WRITE: notes/out.md | # Titre\\nligne deux',
      'MKDIR: assets |a1',
      'DELETE: notes/old.txt |a2'
    ].join('\n'));
    expect(requests.map((r) => r.action)).toEqual(['WRITE', 'MKDIR', 'DELETE']);
    expect(requests[0].path).toBe('notes/out.md');
    // The literal "\n" sequence is kept as-is by the parser; the real newline
    // conversion happens in performWorkspaceAction before writing the file.
    expect(requests[0].content).toBe('# Titre\\nligne deux');
    expect(requests[1].tag).toBe('a1');
  });

  it('parses markers decorated with markdown around the action', () => {
    const content = [
      'Voici mes actions :',
      '- **WRITE**: `rapport/final.md` | # Titre',
      '3. WRITE: "notes/deux.md" | Contenu',
      '> "READ: notes.txt"',
      'Je lance aussi `RUN: node --version`.'
    ].join('\n');
    const requests = parseWorkspaceRequests(content);
    expect(requests.map((r) => r.action)).toEqual(['WRITE', 'WRITE', 'READ', 'RUN']);
    expect(requests[0].path).toBe('rapport/final.md');
    expect(requests[1].path).toBe('notes/deux.md');
    expect(requests[1].content).toBe('Contenu');
    expect(requests[2].path).toBe('notes.txt');
    expect(requests[3].path).toBe('node --version');
  });

  it('does not duplicate plain markers already parsed', () => {
    const content = 'RUN_WAIT: node --version | tools\nRUN: notepad.exe';
    const requests = parseWorkspaceRequests(content);
    expect(requests.map((r) => r.action)).toEqual(['RUN_WAIT', 'RUN']);
    expect(requests[0].path).toBe('node --version');
    expect(requests[0].tag).toBe('tools');
  });

  it('parses RUN and RUN_WAIT with cwd segment', () => {
    const requests = parseWorkspaceRequests('RUN_WAIT: node --version | tools\nRUN: notepad.exe');
    expect(requests.map((r) => r.action)).toEqual(['RUN_WAIT', 'RUN']);
    expect(requests[0].path).toBe('node --version');
    expect(requests[0].tag).toBe('tools');
  });

  it('keeps READ extraction backwards compatible', () => {
    const content = 'READ: a.txt\nWRITE: b.txt | x\nREAD: c/d.txt';
    const reads = parseWorkspaceRequests(content, 5).filter((r) => r.action === 'READ').map((r) => r.path);
    expect(reads).toEqual(['a.txt', 'c/d.txt']);
  });
});

describe('write/delete/mkdir confinement', () => {
  let root: string;
  let outside: string;
  let writable: Set<string>;

  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-write-'));
    root = path.join(base, 'rw');
    outside = path.join(base, 'prive');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOPSECRET');
    writable = new Set([root]);
  });

  afterAll(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  });

  it('writes and reads back a file', () => {
    expect(writeWorkspaceFile([root], writable, 'notes/new.md', '# Bonjour')).toContain('écrits');
    expect(fs.readFileSync(path.join(root, 'notes', 'new.md'), 'utf8')).toBe('# Bonjour');
  });

  it('creates folders', () => {
    expect(mkdirWorkspace([root], writable, 'a/b/c')).toBe('dossier prêt');
    expect(fs.statSync(path.join(root, 'a', 'b', 'c')).isDirectory()).toBe(true);
  });

  it('refuses writes when no writable folder is assigned', () => {
    expect(() => writeWorkspaceFile([root], new Set(), 'x.txt', 'y')).toThrow(PolicyError);
  });

  it('refuses traversal, absolute paths and control characters', () => {
    expect(() => writeWorkspaceFile([root], writable, '../outside/evil.txt', 'x')).toThrow(PolicyError);
    expect(() => writeWorkspaceFile([root], writable, outside + '/evil.txt', 'x')).toThrow(PolicyError);
    expect(() => writeWorkspaceFile([root], writable, 'a<b>.txt', 'x')).toThrow(PolicyError);
  });

  it('does not follow symlinked parents out of the writable root', () => {
    try { fs.symlinkSync(outside, path.join(root, 'lien'), 'dir'); } catch { return; }
    expect(() => writeWorkspaceFile([root], writable, 'lien/evil.txt', 'x')).toThrow(PolicyError);
    expect(fs.existsSync(path.join(outside, 'evil.txt'))).toBe(false);
  });

  it('deletes a file and refuses deleting the root or a non-empty folder', () => {
    fs.writeFileSync(path.join(root, 'victime.txt'), 'au revoir');
    expect(deleteWorkspaceEntry([root], writable, 'victime.txt')).toBe('fichier supprimé');
    expect(fs.existsSync(path.join(root, 'victime.txt'))).toBe(false);
    expect(() => deleteWorkspaceEntry([root], writable, '.')).toThrow(PolicyError);
    expect(() => deleteWorkspaceEntry([root], writable, 'a')).toThrow(/Windows|EPERM|ENOTEMPTY|impossible/i);
  });

  it('never touches read-only folders even when listed first', () => {
    const ro = path.join(path.dirname(root), 'ro');
    fs.mkdirSync(ro);
    expect(() => writeWorkspaceFile([ro, root], new Set(ro), 'x.txt', 'y')).toThrow(PolicyError);
    expect(writeWorkspaceFile([ro, root], writable, 'x.txt', 'y')).toContain('écrits');
  });
});

describe('runApplication', () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-run-'));
    root = path.join(base, 'projet');
    outside = path.join(base, 'prive');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
  });

  afterAll(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  });

  it('runs a program from PATH and waits for its exit code', async () => {
    const result = await runApplication([root], 'node --eval "process.exit(0)"', { wait: true });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Code de sortie : 0');
  });

  it('captures process output', async () => {
    const script = path.join(root, 'echo.js');
    fs.writeFileSync(script, 'process.stdout.write("coucou-run");');
    const result = await runApplication([root], 'node echo.js', { wait: true });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('coucou-run');
  });

  it('refuses programs outside the assigned folders', async () => {
    const script = path.join(outside, 'evil.js');
    fs.writeFileSync(script, 'process.exit(0)');
    const relative = path.relative(root, script).split(path.sep).join('/');
    await expect(runApplication([root], `node ${relative}`, { wait: true })).rejects.toThrow(PolicyError);
    await expect(runApplication([root], `node "${script}"`, { wait: true })).rejects.toThrow(PolicyError);
  });

  it('runs quoted scripts inside the assigned folders', async () => {
    // A quoted path arg is legitimate: the quotes are shell syntax, not a policy issue.
    const script = path.join(root, 'hello world.js');
    fs.writeFileSync(script, 'process.stdout.write("salut");');
    const result = await runApplication([root], `node "${path.basename(script)}"`, { wait: true });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('salut');
  });

  it('accepts a long command line with many arguments', async () => {
    const args = Array.from({ length: 60 }, (_, i) => `mot${i}=valeur-${i}`).join(' ');
    const result = await runApplication([root], `node --eval "process.exit(0)" ${args}`, { wait: true });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Code de sortie : 0');
  });

  it('refuses shell metacharacters', async () => {
    await expect(runApplication([root], 'node a && rm -rf /', { wait: true })).rejects.toThrow(PolicyError);
    await expect(runApplication([root], 'node a ; node b', { wait: true })).rejects.toThrow(PolicyError);
  });

  it('fails cleanly when the program does not exist', async () => {
    await expect(runApplication([root], 'definitely-not-a-real-app-xyz', { wait: true })).rejects.toThrow(PolicyError);
  });
});
