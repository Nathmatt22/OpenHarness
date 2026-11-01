import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Virtual machine environments for teams.
 *
 * A VME is a private, self-contained workspace that lives inside the OS
 * user-data directory (`userData/vm-environments/<id>`), owned by exactly one
 * team and entirely isolated from the host layout:
 *
 *   - everything an agent touches must stay inside the machine root;
 *   - commands are executed with the machine root as working directory;
 *   - the web surface is a plain HTML desktop page opened in an isolated
 *     Electron window (no Node integration); links open in a dedicated,
 *     session-scoped browser window so the desktop stays home.
 *
 * Marker files are named `machine.lock` / `README.txt` (deliberately not
 * `vm.json`: some bundlers and sandboxes flag files literally called
 * `vm.json` — a harmless name, but an avoidable false positive).
 */

/** Machine root lives under the app user-data folder. */
export function machinesRoot(userDataDir: string): string {
  return path.join(userDataDir, 'vm-environments');
}

/** Folder that holds one machine. */
export function machineFolder(userDataDir: string, machineId: string): string {
  return path.join(machinesRoot(userDataDir), machineId);
}

export interface MachineInfo {
  id: string;
  /** True while `machine.lock` exists (a machine being provisioned or deleted). */
  busy: boolean;
  /** True when the on-disk workspace of this machine exists. */
  exists: boolean;
  folder: string;
}

const LOCK = 'machine.lock';

/** Machines known on disk, ready or still provisioning. */
export function listMachines(userDataDir: string): MachineInfo[] {
  const root = machinesRoot(userDataDir);
  if (!fs.existsSync(root)) return [];
  const out: MachineInfo[] = [];
  for (const id of fs.readdirSync(root)) {
    const folder = path.join(root, id);
    try {
      if (!fs.statSync(folder).isDirectory()) continue;
    } catch { continue; }
    out.push({
      id,
      busy: fs.existsSync(path.join(folder, LOCK)),
      exists: true,
      folder
    });
  }
  return out;
}

/** Create a fresh machine workspace: id/… plus folders, README and a lock file. */
export function createMachine(userDataDir: string, machineId: string): MachineInfo {
  const folder = machineFolder(userDataDir, machineId);
  fs.mkdirSync(folder, { recursive: true });
  const lock = path.join(folder, LOCK);
  if (!fs.existsSync(lock)) fs.writeFileSync(lock, new Date().toISOString());
  for (const sub of ['Desktop', 'Documents', 'Downloads', 'Bureau']) {
    fs.mkdirSync(path.join(folder, sub), { recursive: true });
  }
  const readme = path.join(folder, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme,
      'Environnement virtuel OpenHarness.\n' +
      'Tout ce que les agents de l\'équipe écrivent ici reste confiné dans ce dossier.\n');
  }
  return { id: machineId, busy: true, exists: true, folder };
}

/** Remove the lock file once provisioning (or teardown) is done. */
export function unlockMachine(userDataDir: string, machineId: string): void {
  try { fs.rmSync(path.join(machineFolder(userDataDir, machineId), LOCK), { force: true }); }
  catch { /* the machine row is removed anyway */ }
}

/** Whether a folder really is a machine workspace (it carries the marker file). */
export function isMachineFolder(folder: string): boolean {
  try { return fs.existsSync(path.join(folder, 'README.txt')) && fs.statSync(folder).isDirectory(); }
  catch { return false; }
}

/** Recursively delete a machine workspace (called only by the main process). */
export function destroyMachine(userDataDir: string, machineId: string): void {
  fs.rmSync(machineFolder(userDataDir, machineId), { recursive: true, force: true });
}

/** Resolve `userData/vm-environments` to an absolute real path (symlinks resolved). */
export function realMachinesRoot(userDataDir: string): string {
  const root = machinesRoot(userDataDir);
  fs.mkdirSync(root, { recursive: true });
  try { return fs.realpathSync.native(root); }
  catch { return path.resolve(root); }
}

/* ───────────────────────── command execution ───────────────────────── */

/** Hard cap on captured command output. */
const MAX_OUTPUT_BYTES = 8192;
/** Upper bound before VM_RUN_WAIT reports a timeout (milliseconds). */
const MAX_WAIT_MS = 120_000;
/** Upper bound before a detached VM_RUN stops being followed (milliseconds). */
const MAX_RUN_MS = 30_000;

export class VmPolicyError extends Error {}

function fail(message: string): never { throw new VmPolicyError(message); }

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
  if (quote) fail('Commande mal formée (guillemet non fermé).');
  if (current) parts.push(current);
  return parts;
}

/** Deepest existing ancestor of a (possibly not yet existing) path, symlinks resolved. */
function existingAncestor(candidate: string): string {
  let current = candidate;
  for (let i = 0; i < 64; i++) {
    try { return fs.realpathSync.native(current); } catch { current = path.dirname(current); }
  }
  return '';
}

/**
 * Verify a write target (which may not exist yet) stays inside the machine.
 * Lexical check against the root as given, then re-check through the deepest
 * existing ancestor so a symlinked component cannot smuggle a path out.
 */
function resolveForWrite(root: string, candidate: string): string {
  const realRoot = fs.realpathSync.native(root);
  const lexicalRoot = path.resolve(root);
  const lexical = path.resolve(candidate);
  if (lexical !== lexicalRoot && !lexical.startsWith(lexicalRoot + path.sep)) {
    fail('Chemin hors de l’environnement virtuel.');
  }
  const anchor = existingAncestor(candidate);
  if (!anchor || (anchor !== realRoot && !anchor.startsWith(realRoot + path.sep))) {
    fail('Chemin hors de l’environnement virtuel.');
  }
  return candidate;
}

/**
 * Resolve `candidate` under `root`, allowing `..` as long as the final target
 * stays inside the machine. The leaf may not exist yet (lexical check already
 * guaranteed confinement of the existing prefix).
 */
function resolveTolerant(root: string, candidate: string, realRoot: string): string {
  const joined = path.resolve(root, candidate);
  const lexicalRoot = path.resolve(root);
  if (joined !== lexicalRoot && !joined.startsWith(lexicalRoot + path.sep)) {
    fail('Chemin hors de l’environnement virtuel.');
  }
  try {
    const real = fs.realpathSync.native(joined);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      fail('Chemin hors de l’environnement virtuel.');
    }
    return real;
  } catch {
    return joined;
  }
}

/** Clean a machine-relative path; absolute paths and escapes are refused. */
function cleanRelative(relative: string): string {
  let clean = String(relative || '').trim();
  clean = clean.replace(/^[`'"<{(\[]+/, '').replace(/[`'"<>)\],.;:!]+$/, '').trim();
  if (!clean || /[<>"|\u0000-\u001f]/.test(clean)) fail('Chemin de fichier invalide.');
  if (path.isAbsolute(clean) || /^[\\/]/.test(clean) || /^[a-zA-Z]:[\\/]/.test(clean)) {
    fail('Chemin hors de l’environnement virtuel.');
  }
  return clean;
}

const MAX_LIST_ENTRIES = 200;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_WRITE_BYTES = 512 * 1024;

export interface MachineEntry { name: string; type: 'file' | 'folder'; size?: number; }

/**
 * List a folder inside the machine (`relative` defaults to the machine root).
 * The target is confined like every other machine path.
 */
export function listMachineFiles(folder: string, relative = '.'): MachineEntry[] {
  const realRoot = fs.realpathSync.native(folder);
  const raw = String(relative ?? '').trim();
  // `.` (and empty) mean the machine root — cleanRelative would strip the dot.
  const target = resolveTolerant(folder, raw === '' || raw === '.' || raw === './' ? '.' : cleanRelative(raw), realRoot);
  let names: string[] = [];
  try { names = fs.readdirSync(target).sort(); }
  catch { fail('Dossier illisible dans l’environnement virtuel.'); }
  const entries: MachineEntry[] = [];
  for (const name of names.slice(0, MAX_LIST_ENTRIES)) {
    try {
      const stat = fs.statSync(path.join(target, name));
      entries.push(stat.isDirectory() ? { name, type: 'folder' } : { name, type: 'file', size: stat.size });
    } catch {
      entries.push({ name, type: 'file' });
    }
  }
  return entries;
}

/** Read a text file inside the machine. */
export function readMachineFile(folder: string, relative: string): string {
  const clean = cleanRelative(relative);
  const realRoot = fs.realpathSync.native(folder);
  const real = resolveTolerant(folder, clean, realRoot);
  if (!fs.existsSync(real) || fs.statSync(real).isDirectory()) {
    fail('Fichier introuvable dans l’environnement virtuel.');
  }
  const stat = fs.statSync(real);
  if (stat.size > MAX_FILE_BYTES) {
    fail(`Fichier trop volumineux (${Math.round(stat.size / 1024)} Ko, max 64 Ko).`);
  }
  const buffer = fs.readFileSync(real);
  if (buffer.subarray(0, 8000).includes(0)) fail('Fichier binaire non lisible en tant que texte.');
  return buffer.toString('utf8');
}

/** Write a text file inside the machine (parents are created). */
export function writeMachineFile(folder: string, relative: string, content: string): string {
  const clean = cleanRelative(relative);
  const data = Buffer.from(String(content ?? ''), 'utf8');
  if (data.length > MAX_WRITE_BYTES) {
    fail(`Contenu trop volumineux (${Math.round(data.length / 1024)} Ko, max 512 Ko).`);
  }
  const target = resolveForWrite(folder, path.resolve(folder, clean));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return `${data.length} octet(s) écrits`;
}

/** Delete a file or an empty folder inside the machine (never the root). */
export function deleteMachineEntry(folder: string, relative: string): string {
  const clean = cleanRelative(relative);
  const realRoot = fs.realpathSync.native(folder);
  const candidate = resolveTolerant(folder, clean, realRoot);
  if (candidate === realRoot) fail('Impossible de supprimer la racine de l’environnement.');
  let real = '';
  try { real = fs.realpathSync.native(candidate); }
  catch { fail('Fichier introuvable dans l’environnement virtuel.'); }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    fail('Chemin hors de l’environnement virtuel.');
  }
  if (!fs.existsSync(real)) fail('Fichier introuvable dans l’environnement virtuel.');
  if (fs.statSync(real).isDirectory()) {
    fs.rmdirSync(real); // refuses when not empty: no recursive destruction
    return 'dossier supprimé';
  }
  fs.unlinkSync(real);
  return 'fichier supprimé';
}

/** Create a folder (and parents) inside the machine. */
export function mkdirMachine(folder: string, relative: string): string {
  const clean = cleanRelative(relative);
  const target = resolveForWrite(folder, path.resolve(folder, clean));
  fs.mkdirSync(target, { recursive: true });
  return 'dossier prêt';
}

/** Accumulates bounded process output. */
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

/**
 * Resolve the program to launch inside the machine: a bare name (resolved on
 * the host PATH) or a path inside the machine. A path pointing outside the
 * machine is refused.
 */
function resolveProgram(program: string, folder: string): string {
  const absolute = path.isAbsolute(program) || /^[a-zA-Z]:[\\/]/.test(program);
  if (absolute || program.includes('/') || program.includes('\\')) {
    let real = '';
    try { real = fs.realpathSync.native(path.resolve(folder, program)); }
    catch { fail('Chemin hors de l’environnement virtuel.'); }
    const realRoot = fs.realpathSync.native(folder);
    if (real === realRoot || real.startsWith(realRoot + path.sep)) return real;
    fail('Chemin hors de l’environnement virtuel.');
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

/** Refuse arguments that look like filesystem paths escaping the machine. */
function assertArgsInsideMachine(args: string[], folder: string): void {
  for (const arg of args) {
    const looksLikePath = /^[a-zA-Z]:[\\/]/.test(arg) || arg.startsWith('/')
      || arg.startsWith('\\') || arg.startsWith('./') || arg.startsWith('.\\')
      || arg.startsWith('../') || arg.startsWith('..\\') || arg === '.' || arg === '..';
    if (!looksLikePath) continue;
    const realRoot = fs.realpathSync.native(folder);
    try {
      const real = fs.realpathSync.native(path.resolve(folder, arg));
      if (real === realRoot || real.startsWith(realRoot + path.sep)) continue;
    } catch { /* not an existing path under the machine root */ }
    fail('Argument de commande hors de l’environnement virtuel.');
  }
}

/** VM_RUN working directory: the requested subfolder of the machine, else the root. */
function resolveRunCwd(folder: string, cwd?: string): string {
  if (!cwd) return folder;
  const clean = cleanRelative(cwd);
  try {
    const realRoot = fs.realpathSync.native(folder);
    const real = resolveTolerant(folder, clean, realRoot);
    if (fs.existsSync(real) && fs.statSync(real).isDirectory()) return real;
  } catch { return folder; }
  return folder;
}

export interface MachineRunResult { ok: boolean; summary: string; }

/**
 * Launch a command inside the machine. The program must be a bare name
 * (resolved on the host PATH) or a path inside the machine; arguments are
 * passed as an argv array — no shell interpolation.
 */
export async function runInMachine(
  folder: string,
  command: string,
  opts: { wait: boolean; cwd?: string }
): Promise<MachineRunResult> {
  const raw = String(command || '').trim();
  if (!raw) fail('Commande vide.');
  if (raw.length > 2000) fail('Commande trop longue (2000 caractères max).');
  if (/[&|;<>`\r\n$]/.test(raw)) fail('Caractères de shell interdits.');

  const parts = splitCommand(raw);
  const program = parts[0];
  if (!program) fail('Commande vide.');
  if (parts.length > 1) assertArgsInsideMachine(parts.slice(1), folder);
  const cwd = resolveRunCwd(folder, opts.cwd);
  const resolved = resolveProgram(program, folder);
  // .bat/.cmd need cmd.exe; everything else runs directly (no shell injection surface).
  const useShell = process.platform === 'win32' && /\.(bat|cmd)$/i.test(resolved);

  return await new Promise<MachineRunResult>((resolve) => {
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

/* ─────────────────────────── web desktop ─────────────────────────── */

/**
 * Write the machine desktop page (pure HTML/CSS/JS, no external resource).
 * `pages` are shortcuts rendered on the desktop; the page itself only opens
 * same-origin links (about:blank with a hash) — nothing is fetched from the
 * network by the desktop itself.
 */
export function writeDesktopPage(folder: string, machineName: string, pages: { label: string; url: string }[]): string {
  const shortcuts = pages.map((p, i) =>
    `    { label: ${JSON.stringify(p.label)}, url: ${JSON.stringify(p.url)} }${i === pages.length - 1 ? '' : ','}`
  ).join('\n');
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>OpenHarness — Environnement virtuel</title>
<style>
  :root { color-scheme: dark; --bg:#0b0d12; --panel:#14161c; --line:#272932; --text:#e8e9ee; --muted:#8e93a3; --accent:#8b7bf7; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, 'Segoe UI', sans-serif; background:
    radial-gradient(1200px 600px at 20% -10%, #1c1830 0%, transparent 60%),
    radial-gradient(900px 500px at 100% 110%, #10233a 0%, transparent 55%), var(--bg);
    color:var(--text); height:100vh; display:flex; flex-direction:column; }
  header { display:flex; align-items:center; gap:10px; padding:12px 18px; background:color-mix(in srgb, var(--panel) 88%, transparent); border-bottom:1px solid var(--line); }
  header .dot { width:10px; height:10px; border-radius:99px; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  header h1 { font-size:14px; margin:0; font-weight:600; }
  header .tag { font-size:10px; color:var(--muted); border:1px solid var(--line); padding:2px 8px; border-radius:99px; }
  main { flex:1; overflow:auto; padding:34px 40px; }
  .hero h2 { font-size:24px; margin:0 0 6px; }
  .hero p { color:var(--muted); font-size:13px; margin:0 0 26px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:12px; max-width:860px; }
  a.app { display:block; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; text-decoration:none; color:var(--text); transition:border-color .15s, transform .15s; }
  a.app:hover { border-color:var(--accent); transform:translateY(-2px); }
  a.app .glyph { width:38px; height:38px; border-radius:10px; background:linear-gradient(135deg,#8b7bf7,#5a8bd4); display:grid; place-items:center; font-size:18px; margin-bottom:10px; }
  a.app .label { font-weight:600; font-size:13px; }
  a.app .host { display:block; color:var(--muted); font-size:10.5px; margin-top:3px; word-break:break-all; }
  .tip { margin-top:26px; color:var(--muted); font-size:11.5px; max-width:640px; line-height:1.6; }
</style>
</head>
<body>
<header><span class="dot"></span><h1 id="name"></h1><span class="tag">environnement virtuel</span></header>
<main>
  <div class="hero">
    <h2>Bureau de l’environnement virtuel</h2>
    <p>Cette machine est confinée dans son propre dossier ; les agents de l’équipe y travaillent.</p>
  </div>
  <div class="grid" id="apps"></div>
  <p class="tip">Astuce : les agents utilisent les marqueurs VM_READ / VM_WRITE / VM_LS / VM_RUN / VM_RUN_WAIT pour agir ici.
  Ce bureau web reste dans sa fenêtre dédiée et ne charge aucune ressource externe.</p>
</main>
<script>
  var pages = [
${shortcuts}
  ];
  document.getElementById('name').textContent = ${JSON.stringify(machineName)};
  var grid = document.getElementById('apps');
  pages.forEach(function (p) {
    var a = document.createElement('a');
    a.className = 'app';
    a.href = p.url;
    a.target = '_self';
    var g = document.createElement('div');
    g.className = 'glyph';
    g.textContent = '🌐';
    var l = document.createElement('div');
    l.className = 'label';
    l.textContent = p.label;
    var h = document.createElement('div');
    h.className = 'host';
    h.textContent = p.url;
    a.appendChild(g); a.appendChild(l); a.appendChild(h);
    grid.appendChild(a);
  });
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(folder, 'bureau.html'), html, 'utf8');
  return path.join(folder, 'bureau.html');
}

/**
 * Parse the machine desktop shortcuts from the team settings payload
 * (`https://…` and `http://…` lines only, everything else is dropped).
 */
export function parseMachinePages(raw: unknown): { label: string; url: string }[] {
  const pages: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  const items = Array.isArray(raw) ? raw : [];
  for (const item of items.slice(0, 12)) {
    const text = String(item ?? '').trim();
    if (!text) continue;
    // Accept `https://…` and the optional `label | url` / `url | label` forms.
    const parts = text.includes('|') ? text.split('|').map((p) => p.trim()) : [text];
    const url = parts.find((p) => /^https?:\/\//i.test(p));
    if (!url || !/^https?:\/\/[^\s|]+$/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    let label = parts.find((p) => p !== url && p.length <= 40) || hostLabel(url);
    pages.push({ label, url });
  }
  return pages;
}

/** Pretty label from a URL host (`https://fr.wikipedia.org` → `Wikipedia`). */
function hostLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const base = host.split('.').slice(0, -1).join(' ') || host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return url;
  }
}
