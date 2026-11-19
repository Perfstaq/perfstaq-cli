import { MAX_EVIDENCE_COMMITS } from '@perfstaq/shared';
import type { CommitEvidence } from '@perfstaq/shared';
import type { RepoScan } from './git.js';

/** Minimal fetch shape so tests can inject a fake and never hit the network. */
export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number }>;

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `owner/repo` for a github.com remote (https, http, ssh, scp-like), else null. */
export function parseGithubRemote(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  let host: string;
  let path: string;
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(u);
  if (/^[a-z+]+:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  } else if (scp) {
    host = scp[1]!;
    path = scp[2]!;
  } else return null;
  if (host.toLowerCase() !== 'github.com') return null;
  const slug = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  return SLUG.test(slug) ? slug : null;
}

/** Unauthenticated check: 200 means public. Anything else (404, 403, timeout) means excluded. */
export async function isPublicRepo(slug: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<boolean> {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${slug}`, {
      headers: { 'User-Agent': 'perfstaq-cli', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(3000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

export interface EvidenceResult {
  commits: CommitEvidence[];
  publicRepos: number;
}

/**
 * Evidence for own commits in PUBLIC github.com repos only. SHAs from private, unknown or
 * non-GitHub repos are never included. Newest MAX_EVIDENCE_COMMITS across repos.
 */
export async function buildEvidence(
  repos: RepoScan[],
  opts: { fetchFn?: FetchLike } = {},
): Promise<EvidenceResult> {
  const slugs = new Map<string, RepoScan[]>();
  for (const r of repos) {
    const slug = parseGithubRemote(r.origin);
    if (!slug) continue;
    const key = slug.toLowerCase();
    slugs.set(key, [...(slugs.get(key) ?? []), r]);
  }
  const entries = [...slugs.entries()];
  const visible = await Promise.all(entries.map(([key]) => isPublicRepo(key, opts.fetchFn)));
  const all: (CommitEvidence & { ts: number })[] = [];
  const seen = new Set<string>();
  entries.forEach(([key, group], i) => {
    if (!visible[i]) return;
    for (const g of group) {
      for (const c of g.commits) {
        if (seen.has(c.sha)) continue;
        seen.add(c.sha);
        all.push({ repo: key, sha: c.sha, additions: c.additions, deletions: c.deletions, ts: c.ts });
      }
    }
  });
  all.sort((a, b) => b.ts - a.ts || a.sha.localeCompare(b.sha));
  const commits = all.slice(0, MAX_EVIDENCE_COMMITS).map(({ repo, sha, additions, deletions }) => ({ repo, sha, additions, deletions }));
  return { commits, publicRepos: new Set(commits.map((c) => c.repo)).size };
}
