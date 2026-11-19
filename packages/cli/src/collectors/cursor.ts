import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CursorSignals } from '@perfstaq/shared';
import type { TimeWindow } from './claude.js';

const DAY_MS = 86_400_000;
const NONE: CursorSignals = { detected: false, sessions: 0, suggestionsShown: 0, suggestionsAccepted: 0 };

export function cursorStorageDir(): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Cursor', 'User', 'workspaceStorage');
    default:
      return join(homedir(), '.config', 'Cursor', 'User', 'workspaceStorage');
  }
}

function run(bin: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/**
 * Best-effort: only key names and value LENGTHS are queried, never value contents.
 * Output is an estimate: each aiService/composer key counts as one "shown"; a key whose
 * value is non-trivial (> 64 bytes) counts as one "accepted".
 */
async function estimate(db: string): Promise<{ shown: number; accepted: number }> {
  const out = await run(
    'sqlite3',
    ['-readonly', db, "select key, length(value) from ItemTable where key like '%aiService%' or key like '%composer%'"],
    1500,
  );
  let shown = 0;
  let accepted = 0;
  for (const line of out.split('\n')) {
    const len = Number(line.split('|').pop());
    if (!Number.isFinite(len) || line.length === 0) continue;
    shown++;
    if (len > 64) accepted++;
  }
  return { shown, accepted };
}

async function hasBinary(): Promise<boolean> {
  const out = await run(process.platform === 'win32' ? 'where' : 'which', ['sqlite3'], 1000);
  return out.trim().length > 0;
}

export interface CursorResult {
  signals: CursorSignals;
  windows: TimeWindow[];
}

const MAX_TRANSCRIPTS = 1000;
/** Transcripts carry no timestamps we read; a session window is the file's mtime back at most this far. */
const MAX_WINDOW_SEC = 4 * 3600;

/**
 * ~/.cursor/projects/<project>/agent-transcripts/**\/*.jsonl. Files are only stat()ed:
 * content is never opened. Window = [max(birthtime, mtime - 4h), mtime].
 */
export async function collectAgentTranscripts(home = homedir()): Promise<TimeWindow[]> {
  const windows: TimeWindow[] = [];
  const root = join(home, '.cursor', 'projects');
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return windows;
  }
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > 2 || windows.length >= MAX_TRANSCRIPTS) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await visit(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl') && windows.length < MAX_TRANSCRIPTS) {
        try {
          const s = await stat(p);
          const end = Math.floor(s.mtimeMs / 1000);
          const birth = Math.floor(s.birthtimeMs / 1000);
          windows.push({ start: Math.max(Number.isFinite(birth) && birth > 0 ? birth : end, end - MAX_WINDOW_SEC), end });
        } catch {
          // skip
        }
      }
    }
  };
  for (const p of projects) if (p.isDirectory()) await visit(join(root, p.name, 'agent-transcripts'), 0);
  return windows;
}

export async function collectCursor(home = homedir()): Promise<CursorResult> {
  const windows = await collectAgentTranscripts(home);
  const base = await collectWorkspaceStorage();
  const signals: CursorSignals = {
    detected: base.detected || windows.length > 0,
    sessions: base.sessions + windows.length,
    suggestionsShown: base.suggestionsShown,
    suggestionsAccepted: base.suggestionsAccepted,
  };
  return { signals, windows };
}

async function collectWorkspaceStorage(): Promise<CursorSignals> {
  try {
    const root = cursorStorageDir();
    const entries = await readdir(root, { withFileTypes: true });
    const cutoff = Date.now() - 180 * DAY_MS;
    const dbs: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(root, e.name);
      try {
        const s = await stat(dir);
        if (s.mtimeMs < cutoff) continue;
        const db = join(dir, 'state.vscdb');
        await stat(db);
        dbs.push(db);
      } catch {
        // not a workspace with state
      }
    }
    if (dbs.length === 0) return NONE;
    const out: CursorSignals = { detected: true, sessions: dbs.length, suggestionsShown: 0, suggestionsAccepted: 0 };
    if (await hasBinary()) {
      const deadline = Date.now() + 3000;
      for (const db of dbs.slice(0, 60)) {
        if (Date.now() > deadline) break;
        const { shown, accepted } = await estimate(db);
        out.suggestionsShown += shown;
        out.suggestionsAccepted += accepted;
      }
    }
    return out;
  } catch {
    return NONE;
  }
}
