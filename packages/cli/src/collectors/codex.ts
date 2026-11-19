import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { CodexSignals } from '@perfstaq/shared';
import type { TimeWindow } from './claude.js';

const MAX_FILES = 300;
const MAX_LINE = 1024 * 1024;
const BUDGET_MS = 5000;
const TOOL_TYPES = new Set(['function_call', 'local_shell_call', 'custom_tool_call']);
const MARKER = /"type":"(function_call|local_shell_call|custom_tool_call)"/;
const TS = /^\{"timestamp":"([^"]+)"/;

export interface CodexResult {
  signals: CodexSignals;
  windows: TimeWindow[];
}

const EMPTY: CodexResult = { signals: { detected: false, sessions: 0, toolCalls: 0 }, windows: [] };

async function walk(dir: string, out: { file: string; mtime: number }[], depth = 0): Promise<void> {
  if (depth > 5) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      try {
        out.push({ file: p, mtime: (await stat(p)).mtimeMs });
      } catch {
        // skip
      }
    }
  }
}

/** Only timestamps and tool-call event types are read; message text is never parsed or stored. */
async function scanFile(file: string): Promise<{ toolCalls: number; min: number; max: number }> {
  const s = { toolCalls: 0, min: Infinity, max: -Infinity };
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length > MAX_LINE || line.length < 2) continue;
    const t = TS.exec(line.slice(0, 80));
    if (t) {
      const ms = Date.parse(t[1]!);
      if (Number.isFinite(ms)) {
        const sec = Math.floor(ms / 1000);
        if (sec < s.min) s.min = sec;
        if (sec > s.max) s.max = sec;
      }
    }
    if (!MARKER.test(line)) continue;
    try {
      const o = JSON.parse(line) as { type?: unknown; payload?: { type?: unknown } };
      const ty = typeof o.type === 'string' ? o.type : undefined;
      const pty = typeof o.payload?.type === 'string' ? o.payload.type : undefined;
      if ((ty && TOOL_TYPES.has(ty)) || (pty && TOOL_TYPES.has(pty))) s.toolCalls++;
    } catch {
      // skip
    }
  }
  return s;
}

export async function collectCodex(home = homedir()): Promise<CodexResult> {
  try {
    const files: { file: string; mtime: number }[] = [];
    await walk(join(home, '.codex', 'sessions'), files);
    files.sort((a, b) => b.mtime - a.mtime);
    const newest = files.slice(0, MAX_FILES);
    if (newest.length === 0) return EMPTY;
    const signals: CodexSignals = { detected: true, sessions: 0, toolCalls: 0 };
    const windows: TimeWindow[] = [];
    const deadline = Date.now() + BUDGET_MS;
    for (const f of newest) {
      if (Date.now() > deadline) break;
      try {
        const r = await scanFile(f.file);
        signals.sessions++;
        signals.toolCalls += r.toolCalls;
        if (Number.isFinite(r.min) && Number.isFinite(r.max)) windows.push({ start: r.min, end: r.max });
      } catch {
        // skip
      }
    }
    return signals.sessions === 0 ? EMPTY : { signals, windows };
  } catch {
    return EMPTY;
  }
}
