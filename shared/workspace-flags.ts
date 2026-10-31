/**
 * Capability flags carried by stored team folder entries, shared by the main
 * process (enforcement) and the renderer (Settings UI). A stored entry may be:
 *   - `path`             → read-only access
 *   - `path [WRITABLE]`  → read + write/delete/create access
 * Legacy context-embed prefixes (`[DIR WRITABLE] path`) are normalized too.
 */

export const FOLDER_FLAG = /\s*\[(READ_ONLY|WRITABLE)\]$/i;
export const FOLDER_EMBED_PREFIX = /^\[(?:DIR )?(READ_ONLY|WRITABLE)\]\s*/i;

/** Decode stored entries into clean paths plus the writable subset. */
export function parseFolderFlags(entries: string[]): { folders: string[]; writable: Set<string> } {
  const folders: string[] = [];
  const writable = new Set<string>();
  for (const entry of entries) {
    let value = String(entry || '').trim();
    if (!value) continue;
    let flag = '';
    const suffix = FOLDER_FLAG.exec(value);
    if (suffix) { flag = suffix[1].toUpperCase(); value = value.slice(0, suffix.index).trim(); }
    const prefix = FOLDER_EMBED_PREFIX.exec(value);
    if (prefix) { flag = flag || prefix[1].toUpperCase(); value = value.slice(prefix[0].length).trim(); }
    if (!value) continue;
    if (!folders.includes(value)) folders.push(value);
    if (flag === 'WRITABLE') writable.add(value);
  }
  return { folders, writable };
}

/** Encode folders + writable subset back into stored entries. */
export function encodeFolderFlags(folders: string[], writable: Set<string>): string[] {
  return folders.map((folder) => (writable.has(folder) ? `${folder} [WRITABLE]` : folder));
}

/** Per-folder capability summary (renderer-friendly). */
export function folderEmbeds(entries: string[]): { folder: string; writable: boolean }[] {
  const { folders, writable } = parseFolderFlags(entries);
  return folders.map((folder) => ({ folder, writable: writable.has(folder) }));
}

export type ParsedFolderFlags = ReturnType<typeof parseFolderFlags>;
