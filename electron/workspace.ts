import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  parseFolderFlags,
  folderEmbeds
} from '../shared/workspace-flags';

/**
 * File access for team missions, confined to the folders explicitly assigned
 * to a team. All resolution happens in the main process against the folders
 * stored in the database — the renderer only ever sends relative names.
 *
 * Capabilities are opt-in per team:
 * - reads need at least one assigned folder;
 * - WRITE / DELETE / MKDIR need a folder marked writable;
 * - RUN / RUN_WAIT launch applications and need the team-level toggle.
 * The model expresses actions with full-line markers (see parseWorkspaceRequests).
 */

const MAX_LIST_ENTRIES = 200;
const MAX_FILE_BYTES = 64 * 1024;
/** Cap for a single WRITE payload (utf8 bytes). */
const MAX_WRITE_BYTES = 512 * 1024;
/** Cap for the total bytes written per agent turn, across WRITE actions. */
const MAX_TURN_WRITE_BYTES = 2 * 1024 * 1024;
/** Hard cap on captured process output kept per RUN action. */
const MAX_OUTPUT_BYTES = 8192;
/** Upper bound before a RUN_WAIT reports a timeout (milliseconds). */
const MAX_WAIT_MS = 120_000;
/** Upper bound before a still-running detached RUN stops being followed (milliseconds). */
const MAX_RUN_MS = 30_000;

export interface WorkspaceEntry { name: string; type: 'file' | 'folder'; size?: number; }

export class PolicyError extends Error {}

function fail(message: string): never { throw new PolicyError(message); }
const isPolicy = (e: unknown) => e instanceof PolicyError;

/** Deepest existing ancestor of a (possibly not yet existing) path, symlinks resolved. */
function existingAncestor(candidate: string): string {
  let current = candidate;
  for (let i = 0; i < 64; i++) {
    try { return fs.realpathSync.native(current); } catch { current = path.dirname(current); }
  }
  return '';
}

/**
 * Verify a write target (which may not exist yet) stays inside the writable
 * root. Tolerant to `..`: the lexical target must resolve inside the root, and
 * the deepest existing ancestor is re-checked through symlinks, so a symlinked
 * component cannot smuggle a path out.
 */
function resolveForWrite(root: string, candidate: string): string {
  const realRoot = fs.realpathSync.native(root);
  // Lexical check against the root as given: on Windows a short (8.3) root
  // path would never prefix-match its own long realpath form.
  const lexicalRoot = path.resolve(root);
  const lexical = path.resolve(candidate);
  if (lexical !== lexicalRoot && !lexical.startsWith(lexicalRoot + path.sep)) {
    fail('Chemin hors des dossiers en écriture.');
  }
  const anchor = existingAncestor(candidate);
  if (!anchor || (anchor !== realRoot && !anchor.startsWith(realRoot + path.sep))) {
    fail('Chemin hors des dossiers en écriture.');
  }
  return candidate;
}

/**
 * Clean a model-supplied relative path. Deliberately tolerant: decorated
 * markers (backticks, quotes), trailing punctuation and dots are stripped, and
 * a `..` is allowed as long as the resolved target stays inside the assigned
 * root — only escapes are refused.
 */
function cleanRelative(relative: string): string {
  let clean = String(relative || '').trim();
  // Strip decorations models like to add around paths.
  clean = clean.replace(/^[`'"<{(\[]+/, '').replace(/[`'"<>)\],.;:!]+$/, '').trim();
  if (!clean || /[<>"|\u0000-\u001f]/.test(clean)) fail('Chemin de fichier invalide.');
  // Absolute paths and drive letters are refused outright.
  if (path.isAbsolute(clean) || /^[\\/]/.test(clean) || /^[a-zA-Z]:[\\/]/.test(clean)) {
    fail('Chemin hors des dossiers assignés.');
  }
  return clean;
}

/**
 * Resolve `candidate` under `root`, allowing `..` as long as the final target
 * stays inside the root. Symlinks are re-checked through the real filesystem
 * when the lexical check passes but the leaf does not exist yet.
 */
function resolveTolerant(root: string, candidate: string, realRoot: string): string {
  const joined = path.resolve(root, candidate);
  // Lexical check against the root as given (same short/long form as `joined`),
  // then symlink check through the real filesystem against the resolved root.
  const lexicalRoot = path.resolve(root);
  if (joined !== lexicalRoot && !joined.startsWith(lexicalRoot + path.sep)) {
    fail('Chemin hors des dossiers assignés.');
  }
  try {
    const real = fs.realpathSync.native(joined);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      fail('Chemin hors des dossiers assignés.');
    }
    return real;
  } catch {
    // Leaf (or part of the path) does not exist yet: the lexical check above
    // already guaranteed confinement of the existing prefix.
    return joined;
  }
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
  const clean = cleanRelative(relative);
  for (const root of folders) {
    let real = '';
    try {
      const realRoot = fs.realpathSync.native(root);
      const candidate = resolveTolerant(root, clean, realRoot);
      real = fs.realpathSync.native(candidate);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) continue; // not under this root
    } catch (e) {
      if (isPolicy(e)) throw e; // explicit policy refusal: no fallback
      continue;                 // not resolvable under this root: try the next
    }
    if (!fs.existsSync(real)) continue; // try the next assigned folder
    const stat = fs.statSync(real);
    if (stat.isDirectory()) fail('La cible est un dossier, pas un fichier.');
    if (stat.size > MAX_FILE_BYTES) fail(`Fichier trop volumineux (${Math.round(stat.size / 1024)} Ko, max 64 Ko).`);
    const buffer = fs.readFileSync(real);
    if (buffer.subarray(0, 8000).includes(0)) fail('Fichier binaire non lisible en tant que texte.');
    return buffer.toString('utf8');
  }
  fail('Fichier introuvable dans les dossiers assignés.');
}

/** Write `content` into the first writable assigned folder that can host `relative`. */
export function writeWorkspaceFile(folders: string[], writable: Set<string>, relative: string, content: string): string {
  const clean = cleanRelative(relative);
  const data = Buffer.from(String(content ?? ''), 'utf8');
  if (!writable.size) fail('Aucun dossier en écriture pour cette équipe.');
  if (data.length > MAX_WRITE_BYTES) fail(`Contenu trop volumineux (${Math.round(data.length / 1024)} Ko, max 512 Ko).`);
  for (const root of folders) {
    if (!writable.has(root)) continue;
    const target = resolveForWrite(root, path.resolve(root, clean));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    return `${data.length} octet(s) écrits`;
  }
  fail('Chemin hors des dossiers en écriture.');
}

/** Delete an empty folder or a file inside a writable assigned folder (never the root itself). */
export function deleteWorkspaceEntry(folders: string[], writable: Set<string>, relative: string): string {
  const clean = cleanRelative(relative);
  if (!writable.size) fail('Aucun dossier en écriture pour cette équipe.');
  for (const root of folders) {
    if (!writable.has(root)) continue;
    let real = '';
    let realRoot = '';
    try {
      realRoot = fs.realpathSync.native(root);
      const candidate = resolveTolerant(root, clean, realRoot);
      if (candidate === realRoot) fail('Impossible de supprimer la racine du dossier.');
      real = fs.realpathSync.native(candidate);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) continue; // not under this root
    } catch (e) {
      if (isPolicy(e)) throw e; // explicit policy refusal: no fallback
      continue;                 // not resolvable under this root: try the next
    }
    if (!fs.existsSync(real)) continue;
    if (real === realRoot) fail('Impossible de supprimer la racine du dossier.');
    if (fs.statSync(real).isDirectory()) {
      fs.rmdirSync(real); // refuses when not empty: no recursive destruction
      return `dossier supprimé`;
    }
    fs.unlinkSync(real);
    return 'fichier supprimé';
  }
  fail('Fichier introuvable dans les dossiers en écriture.');
}

/** Create a folder (and parents) inside a writable assigned folder. */
export function mkdirWorkspace(folders: string[], writable: Set<string>, relative: string): string {
  const clean = cleanRelative(relative);
  if (!writable.size) fail('Aucun dossier en écriture pour cette équipe.');
  for (const root of folders) {
    if (!writable.has(root)) continue;
    const target = resolveForWrite(root, path.resolve(root, clean));
    fs.mkdirSync(target, { recursive: true });
    return 'dossier prêt';
  }
  fail('Chemin hors des dossiers en écriture.');
}

/* ------------------------------- RUN ------------------------------- */

export interface RunResult { ok: boolean; summary: string; }

/** Accumulates bounded process output for RUN summaries. */
class OutputBuffer {
  private total = 0;
  private text = '';
  push(chunk: Buffer) {
    this.total += chunk.length;
    if (this.total > MAX_OUTPUT_BYTES) return;
    if (this.text === '' && chunk.includes(0)) { this.text = '(sortie binaire — non affichée)'; return; }
    this.text += chunk.toString('utf8');
  }
  value() { return this.text; }
}

/** Tokenize a command line supporting double quotes (and single quotes off Windows). */
function splitCommand(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || (ch === "'" && process.platform !== 'win32')) {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) { parts.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (quote) fail('Commande RUN mal formée (guillemet non fermé).');
  if (current) parts.push(current);
  return parts;
}

/**
 * Resolve the program to launch: a bare name (resolved on PATH), or a path
 * inside the assigned folders. Tolerant to `..` as long as the resolved file
 * stays inside an assigned folder. `runCwd` (when provided) is tried first for
 * relative programs, so `./tools/x.bat` matches the folder the agent runs in.
 */
function resolveProgram(program: string, folders: string[], runCwd?: string): string {
  const absolute = path.isAbsolute(program) || /^[a-zA-Z]:[\\/]/.test(program);
  if (absolute || program.includes('/') || program.includes('\\')) {
    const bases = runCwd ? [runCwd, ...folders] : folders;
    for (const root of bases) {
      let real = '';
      try { real = fs.realpathSync.native(path.resolve(root, program)); } catch { continue; }
      const realRoot = fs.realpathSync.native(root);
      if (real === realRoot || real.startsWith(realRoot + path.sep)) return real;
    }
    fail('Chemin hors des dossiers assignés.');
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  for (const dir of dirs) {
    const withExt = exts.map((e) => program + e);
    const tries = exts.includes(path.extname(program).toUpperCase()) ? [program, ...withExt] : withExt;
    for (const name of tries) {
      let real = '';
      try { real = fs.realpathSync.native(path.join(dir, name)); } catch { continue; }
      try { fs.accessSync(real, fs.constants.X_OK); } catch { continue; }
      return real;
    }
  }
  fail(`Application introuvable : ${program}`);
}

/**
 * Refuse arguments that look like filesystem paths escaping the assigned
 * folders: `node ../prive/evil.js` must not launder an out-of-root read.
 * Paths inside the folders are fine (explicit `./`, `../`, `/x` forms are
 * resolved against each root); bare tokens (flags, urls, package names) pass.
 */
function assertArgsInsideFolders(args: string[], folders: string[]): void {
  for (const arg of args) {
    const looksLikePath = /^[a-zA-Z]:[\\/]/.test(arg) || arg.startsWith('/')
      || arg.startsWith('\\') || arg.startsWith('./') || arg.startsWith('.\\')
      || arg.startsWith('../') || arg.startsWith('..\\') || arg === '.' || arg === '..';
    if (!looksLikePath) continue;
    let inside = false;
    for (const root of folders) {
      try {
        const realRoot = fs.realpathSync.native(root);
        const real = fs.realpathSync.native(path.resolve(root, arg));
        if (real === realRoot || real.startsWith(realRoot + path.sep)) { inside = true; break; }
      } catch { continue; } // not an existing path under this root
    }
    if (!inside) fail('Argument de commande hors des dossiers assignés.');
  }
}

/** RUN working directory: the requested subfolder of an assigned folder, else the first folder. */
function resolveRunCwd(folders: string[], cwd?: string): string {
  const first = folders[0];
  if (!cwd || !folders.length) return first;
  const clean = cleanRelative(cwd);
  for (const root of folders) {
    try {
      const realRoot = fs.realpathSync.native(root);
      const real = resolveTolerant(root, clean, realRoot); // `..` allowed while staying inside
      if (fs.existsSync(real) && fs.statSync(real).isDirectory()) return real;
    } catch { continue; } // refused or invalid for this root: try the next one
  }
  return first;
}

/**
 * Launch an application. The program must be a bare name (resolved on PATH) or
 * a path inside the assigned folders. Arguments are passed as an argv array —
 * no shell interpolation. RUN captures a bounded output snapshot; RUN_WAIT
 * also waits for exit (bounded by MAX_WAIT_MS) and reports the exit code.
 */
export async function runApplication(
  folders: string[],
  command: string,
  opts: { wait: boolean; cwd?: string }
): Promise<RunResult> {
  const raw = String(command || '').trim();
  if (!raw) fail('Commande RUN vide.');
  if (raw.length > 2000) fail('Commande RUN trop longue (2000 caractères max).');
  if (/[&|;<>`\r\n$]/.test(raw)) fail('Caractères de shell interdits dans RUN.');

  const parts = splitCommand(raw);
  const program = parts[0];
  if (!program) fail('Commande RUN vide.');
  if (parts.length > 1) assertArgsInsideFolders(parts.slice(1), folders);
  const cwd = resolveRunCwd(folders, opts.cwd);
  const resolved = resolveProgram(program, folders, cwd);
  // .bat/.cmd need cmd.exe; everything else runs directly (no shell injection surface).
  const useShell = process.platform === 'win32' && /\.(bat|cmd)$/i.test(resolved);

  return await new Promise<RunResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(resolved, parts.slice(1), {
        cwd, windowsHide: true, shell: useShell,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ ok: false, summary: `Lancement impossible : ${e instanceof Error ? e.message : e}` });
      return;
    }
    const base = `${path.basename(resolved)} (pid ${child.pid ?? '?'})`;
    const out = new OutputBuffer();
    child.stdout?.on('data', (c: Buffer) => out.push(c));
    child.stderr?.on('data', (c: Buffer) => out.push(c));
    let settled = false;
    const finish = (ok: boolean, prefix: string) => {
      if (settled) return;
      settled = true;
      const tail = out.value() ? `\nSortie :\n${out.value()}` : '';
      resolve({ ok, summary: `${prefix} — ${base}${tail}` });
    };
    child.on('error', (e: Error) => finish(false, `Lancement impossible : ${e.message}`));
    const timer = setTimeout(() => {
      if (opts.wait) {
        try { child.kill(); } catch { /* already gone */ }
        finish(false, `Délai dépassé (${Math.round(MAX_WAIT_MS / 1000)} s), processus interrompu`);
      } else {
        finish(true, `Toujours en cours après ${Math.round(MAX_RUN_MS / 1000)} s (lancement réussi)`);
      }
    }, opts.wait ? MAX_WAIT_MS : MAX_RUN_MS);
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (opts.wait) finish(code === 0, `Code de sortie : ${code ?? 'signal'}`);
      else finish(true, `Processus terminé (code ${code ?? 'signal'})`);
    });
  });
}

/* --------------------------- markers & flags --------------------------- */

export interface ParsedRequest {
  /** Uppercase action name: READ | WRITE | DELETE | MKDIR | RUN | RUN_WAIT. */
  action: string;
  /** Relative path — or the full command line for RUN / RUN_WAIT. */
  path: string;
  /** File content for WRITE (everything after the first `|`). */
  content: string;
  /** Optional caller tag echoed back so the model can pair request and answer. */
  tag?: string;
}

/** Full-line action markers, in document order (first occurrence first). */
const REQUEST_LINE = /^[ \t]*(READ|WRITE|DELETE|MKDIR|RUN_WAIT|RUN):[ \t]+(.+?)[ \t]*$/gim;
const TRAILING_TAG = /^(.*?)\s*\|\s*([A-Za-z0-9-]{1,64})$/;

/** Strip the decorations models like to wrap markers in (quotes, backticks, list bullets, bold). */
function unwrapDecorations(raw: string): string {
  let value = raw.trim();
  for (let i = 0; i < 4; i++) {
    const before = value;
    value = value
      .replace(/^[-*•\d.)\s]*\s*/, '')      // "- item", "1. item", "• item"
      .replace(/^[*_~`]+/, '')               // bold/italic/code openers
      .replace(/[*_~`]+$/, '')
      .replace(/^["'«»“”]+/, '')             // quotes
      .replace(/["'«»“”]+$/, '')
      .replace(/^(?:READ|WRITE|DELETE|MKDIR|RUN_WAIT|RUN)[:：]\s*/i, '')
      .trim();
    if (value === before) break;
  }
  return value;
}

function parseRequestLine(action: string, raw: string): ParsedRequest {
  // RUN / RUN_WAIT carry a full command line: quotes are shell syntax, keep them.
  if (action === 'RUN' || action === 'RUN_WAIT') {
    // Strip a trailing sentence terminator or stray wrapping backtick only when
    // quotes stay balanced; an unbalanced quote means the `"` was shell syntax.
    let command = raw.trim().replace(/[.!?,;:]+$/u, '').replace(/`+$/, '').trim();
    if ((command.match(/"/g) || []).length % 2 === 1) command = raw.trim();
    const m = TRAILING_TAG.exec(command);
    if (m) return { action, path: m[1].trim(), content: '', tag: m[2] };
    return { action, path: command.trim(), content: '' };
  }
  // WRITE keeps everything after the first `|` as content (pipes allowed inside);
  // every other action treats a trailing `|tag` segment as the caller tag.
  if (action === 'WRITE') {
    const idx = raw.indexOf('|');
    if (idx === -1) return { action, path: unwrapDecorations(raw), content: '' };
    return { action, path: unwrapDecorations(raw.slice(0, idx).trim()), content: raw.slice(idx + 1).replace(/^ /, '') };
  }
  const m = TRAILING_TAG.exec(raw);
  if (m) return { action, path: unwrapDecorations(m[1].trim()), content: '', tag: m[2] };
  return { action, path: unwrapDecorations(raw), content: '' };
}

/** Extract action requests from model output, in document order, bounded. */
export function parseWorkspaceRequests(content: string, limit = 8): ParsedRequest[] {
  const requests: ParsedRequest[] = [];
  for (const match of content.matchAll(REQUEST_LINE)) {
    const raw = match[2].replace(/\r$/, '').trim();
    if (!raw) continue;
    requests.push(parseRequestLine(match[1].toUpperCase(), raw));
  }
  // Tolerant pass: markers wrapped in markdown decorations (bold, code spans,
  // quotes, bullets) are still honored — the model should not lose its write
  // because it pretty-printed the marker.
  const seen = new Set(requests.map((r) => `${r.action}:${r.path}`));
  if (requests.length < limit) {
    for (const match of content.matchAll(/(?:^|\n)[^\n]*?\b(READ|WRITE|DELETE|MKDIR|RUN_WAIT|RUN)[`*_~'"]*[:：][ \t]+([^\n]+)/g)) {
      // Decorations are judged outside the keyword itself (RUN_WAIT contains `_`).
      const decorated = /[`*_~"'«»“”]|\d+\.\s/.test(match[0].replace(/(READ|WRITE|DELETE|MKDIR|RUN_WAIT|RUN)[`*_~'"]*[:：]/i, ''));
      if (!decorated) continue; // plain full-line markers are handled above
      const rest = match[2].trim();
      if (!rest) continue;
      const request = parseRequestLine(match[1].toUpperCase(), rest);
      const key = `${request.action}:${request.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      requests.push(request);
      if (requests.length >= limit) break;
    }
  }
  return requests.slice(0, limit);
}

/** Backwards-compatible helper: READ-only extraction, document order. */
export function parseReadRequests(content: string, limit = 5): string[] {
  return parseWorkspaceRequests(content, limit)
    .filter((r) => r.action === 'READ')
    .map((r) => r.path);
}

/** WRITE content is single-line; `\n` and `\t` escapes become real characters. */
function unescapeLiteral(text: string): string {
  return String(text).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

export { parseFolderFlags, folderEmbeds };

export interface WorkspaceFolders { folders: string[]; writable: Set<string>; allowRun: boolean; }

/**
 * Execute one parsed workspace action and return the result as text for the
 * model. Never throws: policy refusals and I/O errors come back as tagged
 * messages so a hostile or buggy request cannot leak more than its refusal.
 */
export async function performWorkspaceAction(
  ws: WorkspaceFolders,
  req: ParsedRequest,
  budget: { writeBytes: number }
): Promise<string> {
  const tag = req.tag ? ` [${req.tag}]` : '';
  try {
    switch (req.action) {
      case 'READ':
        return `FILE_CONTENT${tag} ${req.path}\n${readWorkspaceFile(ws.folders, req.path)}`;
      case 'WRITE': {
        const content = unescapeLiteral(req.content);
        const size = Buffer.byteLength(content, 'utf8');
        if (budget.writeBytes + size > MAX_TURN_WRITE_BYTES) {
          return `WRITE_RESULT${tag} ${req.path} — refusé : quota d'écriture de l'étape atteint.`;
        }
        const result = writeWorkspaceFile(ws.folders, ws.writable, req.path, content);
        budget.writeBytes += size;
        return `WRITE_RESULT${tag} ${req.path} — ${result}.`;
      }
      case 'DELETE':
        return `DELETE_RESULT${tag} ${req.path} — ${deleteWorkspaceEntry(ws.folders, ws.writable, req.path)}.`;
      case 'MKDIR':
        return `MKDIR_RESULT${tag} ${req.path} — ${mkdirWorkspace(ws.folders, ws.writable, req.path)}.`;
      case 'RUN':
      case 'RUN_WAIT': {
        if (!ws.allowRun) return `RUN_RESULT${tag} refusé — le lancement d’applications est désactivé pour cette équipe.`;
        const result = await runApplication(ws.folders, req.path, {
          wait: req.action === 'RUN_WAIT',
          cwd: req.tag
        });
        return `RUN_RESULT${tag} ${result.ok ? '' : 'échec — '}${result.summary}`;
      }
      default:
        return `ACTION_RESULT${tag} action inconnue : ${req.action}.`;
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const label = req.action === 'READ' ? 'FILE_CONTENT' : `${req.action}_RESULT`;
    return `${label}${tag} impossible : ${reason}`;
  }
}

export { isPolicy };
