import fs from 'node:fs';
import path from 'node:path';

/**
 * Read-only file access for team missions, confined to the folders explicitly
 * assigned to a team. All resolution happens in the main process against the
 * folders stored in the database — the renderer only ever sends relative names.
 */

const MAX_LIST_ENTRIES = 200;
const MAX_FILE_BYTES = 64 * 1024;

export interface WorkspaceEntry { name: string; type: 'file' | 'folder'; size?: number; }

export class PolicyError extends Error {}

function fail(message: string): never { throw new PolicyError(message); }
const isPolicy = (e: unknown) => e instanceof PolicyError;

/** Resolve a candidate path and verify it stays inside the given root (symlink-safe). */
function resolveInside(root: string, candidate: string): string {
  let real: string;
  let realRoot: string;
  try {
    real = fs.realpathSync.native(candidate);
    realRoot = fs.realpathSync.native(root);
  } catch {
    return ''; // path does not exist under this root
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) fail('Chemin hors des dossiers assignés.');
  return real;
}

export function listWorkspace(folders: string[]): { folder: string; entries: WorkspaceEntry[] }[] {
  return folders.map((folder) => {
    const entries: WorkspaceEntry[] = [];
    let names: string[] = [];
    try { names = fs.readdirSync(folder).sort(); } catch { fail(`Dossier illisible : ${folder}`); }
    for (const name of names.slice(0, MAX_LIST_ENTRIES)) {
      try {
        const stat = fs.statSync(path.join(folder, name));
        entries.push(stat.isDirectory() ? { name, type: 'folder' } : { name, type: 'file', size: stat.size });
      } catch {
        entries.push({ name, type: 'file' });
      }
    }
    return { folder, entries };
  });
}

export function readWorkspaceFile(folders: string[], relative: string): string {
  const clean = String(relative || '').trim().replace(/^[/\\]+/, '');
  if (!clean || clean.includes('..') || path.isAbsolute(clean)) fail('Chemin de fichier invalide.');
  for (const root of folders) {
    const real = resolveInside(root, path.resolve(root, clean));
    if (!real) continue; // not under this root; try the next assigned folder
    const stat = fs.statSync(real);
    if (stat.isDirectory()) fail('La cible est un dossier, pas un fichier.');
    if (stat.size > MAX_FILE_BYTES) fail(`Fichier trop volumineux (${Math.round(stat.size / 1024)} Ko, max 64 Ko).`);
    const buffer = fs.readFileSync(real);
    if (buffer.subarray(0, 8000).includes(0)) fail('Fichier binaire non lisible en tant que texte.');
    return buffer.toString('utf8');
  }
  fail('Fichier introuvable dans les dossiers assignés.');
}

/** Extract file requests the model expressed as "READ: <relative path>" lines. */
export function parseReadRequests(content: string, limit = 5): string[] {
  // [ \t] on purpose: \s* would cross newlines and swallow the next line.
  const marker = /^[ \t]*READ:[ \t]+(.+?)[ \t]*$/gim;
  return [...content.matchAll(marker)].slice(0, limit).map((m) => m[1].trim()).filter(Boolean);
}

export { isPolicy };
