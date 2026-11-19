import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isBoilerplatePath, isTestPath, languageFromPath, pathDepth } from '@perfstaq/shared';
import type { AnonCommit, CommitFile } from '@perfstaq/shared';
import type { TimeWindow } from './claude.js';

const DAY = 86_400;
const MAX_REPOS = 20;
const MAX_COMMITS_PER_REPO = 20_000;
const REPO_TIMEOUT_MS = 60_000;
const AI_TRAILER = /Co-Authored-By:.*(Claude|Cursor|Copilot)/i;

function git(cwd: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout, maxBuffer: 128 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => resolve(err ? '' : String(stdout)),
    );
  });
}

export async function repoRoot(cwd: string): Promise<string | null> {
  const out = (await git(cwd, ['rev-parse', '--show-toplevel'], 3000)).trim();
  return out || null;
}

export interface RawFile {
  path: string;
  added: number;
  deleted: number;
}
export interface RawCommit {
  sha: string;
  email: string;
  /** Raw numstat totals over ALL files (binary = 0). */
  additions: number;
  deletions: number;
  ts: number;
  subject: string;
  body: string;
  files: RawFile[];
}

/** Resolve numstat rename syntax `a/{old => new}/b` and `old => new` to the new path. */
function resolveRename(p: string): string {
  if (!p.includes(' => ')) return p;
  const braced = p.replace(/\{([^{}]*) => ([^{}]*)\}/, (_m, _a: string, b: string) => b).replace(/\/\//g, '/');
  if (braced !== p) return braced;
  return p.split(' => ').pop() ?? p;
}

function parseLog(out: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const rec of out.split('\x1e')) {
    if (!rec.trim()) continue;
    const parts = rec.split('\x1f');
    if (parts.length < 6) continue;
    const ts = Number(parts[1]);
    const sha = (parts[0] ?? '').trim();
    if (!Number.isFinite(ts) || !/^[0-9a-f]{40}$/.test(sha)) continue;
    const files: RawFile[] = [];
    let additions = 0;
    let deletions = 0;
    for (const line of (parts[5] ?? '').split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      if (m[1] === '-' || m[2] === '-') continue; // binary
      const added = Number(m[1]);
      const deleted = Number(m[2]);
      additions += added;
      deletions += deleted;
      files.push({ path: resolveRename(m[3]!), added, deleted });
    }
    commits.push({ sha, email: (parts[2] ?? '').trim().toLowerCase(), additions, deletions, ts, subject: parts[3] ?? '', body: parts[4] ?? '', files });
  }
  return commits;
}

/** Commits of one repo, raw (paths still present; used locally only). Merges excluded. */
async function readRepo(dir: string): Promise<RawCommit[]> {
  const out = await git(
    dir,
    [
      'log',
      '--numstat',
      '--no-color',
      '--no-merges',
      '-n',
      String(MAX_COMMITS_PER_REPO),
      '--pretty=format:%x1e%H%x1f%at%x1f%ae%x1f%s%x1f%b%x1f',
    ],
    REPO_TIMEOUT_MS,
  );
  return parseLog(out);
}

/** Emails configured for git in `cwd` (local + global), lowercased. */
async function configuredEmails(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['config', '--get-all', 'user.email'], 3000);
  return out
    .split('\n')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** `origin` remote URL of a repo, or null. */
async function originUrl(dir: string): Promise<string | null> {
  const out = (await git(dir, ['remote', 'get-url', 'origin'], 3000)).trim();
  return out || null;
}

/** Convert one repo's raw commits into anonymised commits (paths are dropped here). */
export function anonymise(raw: RawCommit[], windows: TimeWindow[]): AnonCommit[] {
  const sorted = [...raw].reverse().sort((a, b) => a.ts - b.ts);
  // path -> deletions in commit order, with prefix sums, for O(log n) later-churn lookup
  const index = new Map<string, { idx: number[]; ts: number[]; prefix: number[] }>();
  sorted.forEach((c, idx) => {
    for (const f of c.files) {
      if (isBoilerplatePath(f.path) || f.deleted === 0) continue;
      let e = index.get(f.path);
      if (!e) {
        e = { idx: [], ts: [], prefix: [0] };
        index.set(f.path, e);
      }
      e.idx.push(idx);
      e.ts.push(c.ts);
      e.prefix.push(e.prefix[e.prefix.length - 1]! + f.deleted);
    }
  });
  /** First position in a sorted numeric array with value > x. */
  const upper = (arr: number[], x: number): number => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid]! <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const result: AnonCommit[] = [];
  sorted.forEach((c, i) => {
    const files: CommitFile[] = [];
    let churned = 0;
    for (const f of c.files) {
      if (isBoilerplatePath(f.path)) continue;
      const lang = languageFromPath(f.path);
      if (!lang) continue;
      const file: CommitFile = {
        language: lang.language,
        added: f.added,
        deleted: f.deleted,
        isTest: isTestPath(f.path),
        depth: pathDepth(f.path),
      };
      if (lang.framework) file.framework = lang.framework;
      files.push(file);
      if (f.added > 0) {
        const e = index.get(f.path);
        if (e) {
          const lo = upper(e.idx, i);
          const hi = upper(e.ts, c.ts + DAY);
          const later = hi > lo ? e.prefix[hi]! - e.prefix[lo]! : 0;
          churned += Math.min(f.added, later);
        }
      }
    }
    const isRevert = c.subject.startsWith('Revert "') || c.body.includes('This reverts commit');
    const text = `${c.subject}\n${c.body}`;
    const aiAssisted =
      AI_TRAILER.test(text) ||
      text.includes('Generated with [Claude Code]') ||
      windows.some((w) => c.ts >= w.start && c.ts <= w.end);
    result.push({ timestamp: c.ts, isRevert, aiAssisted, churnedLines24h: churned, files });
  });
  return result;
}

async function siblingRepos(root: string): Promise<string[]> {
  const parent = dirname(root);
  const found: string[] = [];
  try {
    const names = (await readdir(parent)).sort();
    for (const n of names) {
      if (found.length >= MAX_REPOS - 1) break;
      const dir = join(parent, n);
      if (dir === root) continue;
      try {
        if ((await stat(join(dir, '.git'))).isDirectory() || (await stat(join(dir, '.git'))).isFile()) found.push(dir);
      } catch {
        // not a repo
      }
    }
  } catch {
    // unreadable parent
  }
  return found;
}

/** Own commits of one repo, kept locally for GitHub evidence. No paths. */
export interface OwnRepoCommit {
  sha: string;
  ts: number;
  additions: number;
  deletions: number;
}
export interface RepoScan {
  dir: string;
  origin: string | null;
  commits: OwnRepoCommit[];
}

export interface GitResult {
  commits: AnonCommit[];
  reposAnalyzed: number;
  /** Own commits per repo with origin remote (evidence input; never uploaded as-is). */
  repos: RepoScan[];
  /** True when no author email could be determined: every commit was counted. */
  unidentified: boolean;
  /** Emails used to identify the developer's commits. */
  emails: string[];
}

export const UNIDENTIFIED_WARNING =
  "Couldn't identify your commits — set git user.email or pass --email; counting every commit";

const EMPTY: GitResult = { commits: [], reposAnalyzed: 0, repos: [], unidentified: false, emails: [] };

export async function collectGit(opts: {
  cwd: string;
  all: boolean;
  windows: TimeWindow[];
  emails?: string[];
}): Promise<GitResult> {
  try {
    const root = await repoRoot(opts.cwd);
    if (!root) return EMPTY;
    const repos = [root];
    if (opts.all) repos.push(...(await siblingRepos(root)));
    const emailSet = new Set((opts.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
    const cfg = await Promise.all(repos.map((r) => configuredEmails(r)));
    for (const list of cfg) for (const e of list) emailSet.add(e);
    const unidentified = emailSet.size === 0;
    const lists = await Promise.all(
      repos.map(async (r) => {
        try {
          return { dir: r, raw: await readRepo(r), origin: await originUrl(r) };
        } catch {
          return { dir: r, raw: [] as RawCommit[], origin: null };
        }
      }),
    );
    const commits: AnonCommit[] = [];
    const repoScans: RepoScan[] = [];
    let reposAnalyzed = 0;
    for (const { dir, raw, origin } of lists) {
      const own = unidentified ? raw : raw.filter((c) => emailSet.has(c.email));
      if (own.length === 0) continue;
      reposAnalyzed++;
      commits.push(...anonymise(own, opts.windows));
      repoScans.push({
        dir,
        origin,
        commits: own.map((c) => ({ sha: c.sha, ts: c.ts, additions: c.additions, deletions: c.deletions })),
      });
    }
    commits.sort((a, b) => a.timestamp - b.timestamp);
    return { commits, reposAnalyzed, repos: repoScans, unidentified, emails: [...emailSet].sort() };
  } catch {
    return EMPTY;
  }
}
