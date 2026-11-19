import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ClaudeCodeSignals } from '@perfstaq/shared';

export interface TimeWindow {
  start: number; // unix seconds
  end: number;
}

export interface ClaudeResult {
  signals: ClaudeCodeSignals;
  windows: TimeWindow[];
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_FILES = 300;
const MAX_LINE = 1024 * 1024;

const EMPTY: ClaudeResult = {
  signals: { detected: false, sessions: 0, toolCalls: 0, editToolCalls: 0, prompts: 0 },
  windows: [],
};

async function listJsonl(root: string): Promise<{ file: string; mtime: number }[]> {
  const out: { file: string; mtime: number }[] = [];
  const projects = await readdir(root, { withFileTypes: true });
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = join(root, p.name);
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const file = join(dir, n);
      try {
        const s = await stat(file);
        if (s.isFile()) out.push({ file, mtime: s.mtimeMs });
      } catch {
        // skip
      }
    }
  }
  return out;
}

interface SessionStats {
  toolCalls: number;
  editToolCalls: number;
  prompts: number;
  min: number;
  max: number;
}

async function scanFile(file: string): Promise<SessionStats> {
  const s: SessionStats = { toolCalls: 0, editToolCalls: 0, prompts: 0, min: Infinity, max: -Infinity };
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length > MAX_LINE || line.length < 2) continue;
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.timestamp === 'string' || typeof o.timestamp === 'number') {
      const t = typeof o.timestamp === 'number' ? o.timestamp : Date.parse(o.timestamp);
      if (Number.isFinite(t)) {
        const sec = Math.floor(t > 1e12 ? t / 1000 : t);
        if (sec < s.min) s.min = sec;
        if (sec > s.max) s.max = sec;
      }
    }
    const msg = o.message as { content?: unknown } | undefined;
    const content = msg?.content;
    if (o.type === 'user') {
      // Count real user turns only (not tool_result carriers). Content is never stored.
      const isToolResult =
        Array.isArray(content) && content.some((c) => (c as { type?: string } | null)?.type === 'tool_result');
      if (!isToolResult && !o.isMeta) s.prompts++;
    }
    if (o.type === 'assistant' && Array.isArray(content)) {
      for (const c of content) {
        const b = c as { type?: string; name?: string } | null;
        if (b && b.type === 'tool_use') {
          s.toolCalls++;
          if (typeof b.name === 'string' && EDIT_TOOLS.has(b.name)) s.editToolCalls++;
        }
      }
    }
  }
  return s;
}

export async function collectClaude(home = homedir()): Promise<ClaudeResult> {
  try {
    const root = join(home, '.claude', 'projects');
    const files = (await listJsonl(root)).sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES);
    if (files.length === 0) return EMPTY;
    const signals: ClaudeCodeSignals = { detected: true, sessions: 0, toolCalls: 0, editToolCalls: 0, prompts: 0 };
    const windows: TimeWindow[] = [];
    const deadline = Date.now() + 5000;
    for (const f of files) {
      if (Date.now() > deadline) break;
      try {
        const s = await scanFile(f.file);
        signals.sessions++;
        signals.toolCalls += s.toolCalls;
        signals.editToolCalls += s.editToolCalls;
        signals.prompts += s.prompts;
        if (Number.isFinite(s.min) && Number.isFinite(s.max)) windows.push({ start: s.min, end: s.max });
      } catch {
        // skip unreadable file
      }
    }
    if (signals.sessions === 0) return EMPTY;
    return { signals, windows };
  } catch {
    return EMPTY;
  }
}
