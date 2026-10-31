import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listWorkspace, readWorkspaceFile, PolicyError } from './workspace';

describe('workspace confinement', () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-ws-'));
    root = path.join(base, 'inside');
    outside = path.join(base, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, 'notes.txt'), 'contenu interne');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'deep.txt'), 'fichier profond');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  });

  afterAll(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  });

  it('lists the assigned folder', () => {
    const result = listWorkspace([root]);
    expect(result).toHaveLength(1);
    const names = result[0].entries.map((e) => e.name);
    expect(names).toContain('notes.txt');
    expect(names).toContain('sub');
  });

  it('reads a file inside the assigned folder', () => {
    expect(readWorkspaceFile([root], 'notes.txt')).toBe('contenu interne');
    expect(readWorkspaceFile([root], 'sub/deep.txt')).toBe('fichier profond');
  });

  it('rejects path traversal attempts', () => {
    expect(() => readWorkspaceFile([root], '../outside/secret.txt')).toThrow(PolicyError);
    expect(() => readWorkspaceFile([root], 'a/../../outside/secret.txt')).toThrow(PolicyError);
  });

  it('rejects absolute paths', () => {
    expect(() => readWorkspaceFile([root], outside + '/secret.txt')).toThrow(PolicyError);
  });

  it('rejects symlinks escaping the folder', () => {
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    } catch {
      return; // symlink privileges unavailable on this platform
    }
    expect(() => readWorkspaceFile([root], 'link.txt')).toThrow(PolicyError);
  });

  it('fails cleanly when the file does not exist', () => {
    expect(() => readWorkspaceFile([root], 'missing.txt')).toThrow(PolicyError);
  });

  it('reads across multiple assigned folders', () => {
    const other = path.join(path.dirname(root), 'inside2');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'other.txt'), 'autre dossier');
    expect(readWorkspaceFile([root, other], 'other.txt')).toBe('autre dossier');
    expect(readWorkspaceFile([root, other], 'notes.txt')).toBe('contenu interne');
  });
});
