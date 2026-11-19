import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildEvidence, parseGithubRemote } from './evidence.js';
import type { FetchLike } from './evidence.js';
import { collectGit } from './git.js';

function sh(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

test('git collector anonymises commits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'perfstaq-git-'));
  try {
    sh(dir, 'init', '-q');
    sh(dir, 'config', 'user.email', 't@example.com');
    sh(dir, 'config', 'user.name', 'T');
    sh(dir, 'config', 'commit.gpgsign', 'false');
    mkdirSync(join(dir, 'src', 'secretdir'), { recursive: true });
    writeFileSync(join(dir, 'src', 'secretdir', 'app.ts'), 'export const a = 1;\nexport const b = 2;\n');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lock: 1\n'.repeat(50));
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'feat: app');
    writeFileSync(join(dir, 'src', 'secretdir', 'app.test.ts'), 'test("a", () => {});\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'test: add', '-m', 'Co-Authored-By: Claude <noreply@anthropic.com>');
    writeFileSync(join(dir, 'src', 'secretdir', 'app.ts'), 'export const a = 1;\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'Revert "feat: app"', '-m', 'This reverts commit abc.');

    const out = await collectGit({ cwd: dir, all: false, windows: [] });
    assert.equal(out.reposAnalyzed, 1);
    assert.equal(out.commits.length, 3);
    const files = out.commits.flatMap((c) => c.files);
    assert.ok(files.length >= 2);
    assert.ok(files.every((f) => f.language === 'TypeScript'), 'lockfile (yaml) excluded');
    assert.ok(files.some((f) => f.isTest), 'test detected');
    assert.equal(out.commits.filter((c) => c.isRevert).length, 1);
    assert.equal(out.commits.filter((c) => c.aiAssisted).length, 1);
    assert.ok(out.commits[0]!.churnedLines24h >= 1, 'later deletion counted as churn');
    const json = JSON.stringify(out);
    assert.ok(!/secretdir|app\.ts|pnpm-lock|src\//.test(json), 'no paths in output');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function commitAs(dir: string, email: string, file: string, content: string, msg: string) {
  writeFileSync(join(dir, file), content);
  sh(dir, 'add', '-A');
  sh(dir, '-c', `user.email=${email}`, '-c', 'user.name=X', 'commit', '-q', '-m', msg);
}

function twoAuthorRepo(origin?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'perfstaq-own-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'Me@Example.com');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  if (origin) sh(dir, 'remote', 'add', 'origin', origin);
  commitAs(dir, 'me@example.com', 'a.ts', 'export const a = 1;\nexport const b = 2;\n', 'one');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lock: 1\n'.repeat(30));
  commitAs(dir, 'other@example.com', 'o.ts', 'export const o = 1;\n', 'theirs');
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lock: 1\n'.repeat(60));
  commitAs(dir, 'me@example.com', 'b.ts', 'export const c = 3;\n', 'two + lock');
  // a merge commit authored by me
  sh(dir, 'checkout', '-q', '-b', 'side');
  commitAs(dir, 'me@example.com', 's.ts', 'export const s = 1;\n', 'side');
  sh(dir, 'checkout', '-q', 'main');
  commitAs(dir, 'me@example.com', 'm.ts', 'export const m = 1;\n', 'main work');
  sh(dir, '-c', 'user.email=me@example.com', '-c', 'user.name=X', 'merge', '--no-ff', '-q', '-m', 'merge side', 'side');
  return dir;
}

test('only the configured author, no merges', async () => {
  const dir = twoAuthorRepo();
  try {
    const out = await collectGit({ cwd: dir, all: false, windows: [] });
    assert.equal(out.unidentified, false);
    assert.equal(out.commits.length, 4); // one, two, side, main work (not theirs, not the merge)
    assert.equal(out.repos[0]!.commits.length, 4);
    const out2 = await collectGit({ cwd: dir, all: false, windows: [], emails: ['other@example.com'] });
    assert.equal(out2.commits.length, 5); // plus theirs
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evidence: github.com origin + public only, raw numstat totals incl. lockfile', async () => {
  const dir = twoAuthorRepo('git@github.com:Me/Proj.git');
  try {
    const out = await collectGit({ cwd: dir, all: false, windows: [] });
    const urls: string[] = [];
    const pub: FetchLike = async (u) => (urls.push(u), { status: 200 });
    const ev = await buildEvidence(out.repos, { fetchFn: pub });
    assert.equal(ev.publicRepos, 1);
    assert.equal(ev.commits.length, 4);
    assert.deepEqual(urls, ['https://api.github.com/repos/me/proj']);
    assert.ok(ev.commits.every((c) => c.repo === 'me/proj' && /^[0-9a-f]{40}$/.test(c.sha)));
    const two = ev.commits.find((c) => c.additions === 31)!; // 1 source line + 30 lockfile lines
    assert.ok(two, 'lockfile counted in raw totals');
    assert.equal(two.deletions, 0);
    const priv = await buildEvidence(out.repos, { fetchFn: async () => ({ status: 404 }) });
    assert.equal(priv.commits.length, 0);
    const boom = await buildEvidence(out.repos, { fetchFn: async () => { throw new Error('net'); } });
    assert.equal(boom.commits.length, 0);
    const json = JSON.stringify(out.commits);
    assert.ok(!/\.ts|pnpm-lock|a\.ts/.test(json), 'no paths in anonymised output');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evidence: non-github origin excluded without any fetch', async () => {
  const dir = twoAuthorRepo('https://gitlab.com/me/proj.git');
  try {
    const out = await collectGit({ cwd: dir, all: false, windows: [] });
    let called = 0;
    const ev = await buildEvidence(out.repos, { fetchFn: async () => (called++, { status: 200 }) });
    assert.equal(ev.commits.length, 0);
    assert.equal(called, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseGithubRemote forms', () => {
  assert.equal(parseGithubRemote('https://github.com/o/r.git'), 'o/r');
  assert.equal(parseGithubRemote('https://tok@github.com/o/r'), 'o/r');
  assert.equal(parseGithubRemote('git@github.com:o/r.git'), 'o/r');
  assert.equal(parseGithubRemote('ssh://git@github.com/o/r.git'), 'o/r');
  assert.equal(parseGithubRemote('https://github.com.evil.com/o/r'), null);
  assert.equal(parseGithubRemote('git@gitlab.com:o/r.git'), null);
  assert.equal(parseGithubRemote(null), null);
});
