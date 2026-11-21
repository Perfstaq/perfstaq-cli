#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { computeScan, DEMO_MACHINE_FINGERPRINT, demoScanInput, signPayload, TRUST_TIERS } from '@perfstaq/shared';
import type { ScanInput } from '@perfstaq/shared';
import { ApiError, browserLogin, fetchNonce, uploadScan } from './auth.js';
import { collectClaude } from './collectors/claude.js';
import type { TimeWindow } from './collectors/claude.js';
import { collectCodex } from './collectors/codex.js';
import { collectCursor } from './collectors/cursor.js';
import { buildEvidence } from './collectors/evidence.js';
import { collectGit, UNIDENTIFIED_WARNING } from './collectors/git.js';
import type { GitResult } from './collectors/git.js';
import { machineFingerprint } from './machine.js';
import { bad, explainNotVerified, header, note, ok, renderFound, renderNothingFound, renderSummary, step, warn } from './render.js';
import open from 'open';
import { CLI_VERSION } from './version.js';

interface Opts {
  key?: string; // one-line connect key from perfstaq.com/start
  demo?: boolean;
  all?: boolean;
  json?: boolean;
  upload?: boolean; // commander: --no-upload sets false
  yes?: boolean; // skip the upload prompt (also allows non-interactive runs)
  evidence?: boolean; // --evidence / --no-evidence; undefined = ask
  email?: string[];
  api: string;
}

async function ask(q: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(q)).trim().toLowerCase();
    return a === '' || a === 'y' || a === 'yes';
  } finally {
    rl.close();
  }
}

async function scan(opts: Opts): Promise<void> {
  const api = (process.env.PERFSTAQ_API_URL ?? opts.api).replace(/\/+$/, '');
  const quiet = Boolean(opts.json);
  const say = (s = '') => {
    if (!quiet) console.log(s);
  };
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  // The command copied from perfstaq.com/start carries a single-use key: no questions, no browser.
  const key = (opts.key ?? process.env.PERFSTAQ_KEY ?? '').trim() || null;
  if (key && !/^pq_[A-Za-z0-9_-]{32,64}$/.test(key)) {
    say(bad('That key looks wrong. Copy your command again from perfstaq.com/start.'));
    process.exitCode = 1;
    return;
  }

  // ---------- Step 1: look at the work, on this computer only ----------
  say(header());
  say(step(1, key ? 2 : 3, 'Looking at your work on this computer'));
  // Spinners only in a real terminal with a known width (CI and some editors report 0 columns).
  const canSpin = !quiet && Boolean(process.stderr.isTTY) && (process.stderr.columns ?? 0) >= 20;
  const spinner = canSpin ? ora({ text: 'Reading your projects…', stream: process.stderr, indent: 2 }).start() : null;

  let input: ScanInput;
  let fingerprint: string;
  let gitResult: GitResult | null = null;
  let sessions: Record<string, number> = {};
  if (opts.demo) {
    input = demoScanInput();
    fingerprint = DEMO_MACHINE_FINGERPRINT;
  } else {
    const [claude, cursor, codex] = await Promise.all([collectClaude(), collectCursor(), collectCodex()]);
    const windows: TimeWindow[] = [...claude.windows, ...cursor.windows, ...codex.windows];
    gitResult = await collectGit({ cwd: process.cwd(), all: Boolean(opts.all), windows, emails: opts.email });
    input = {
      commits: gitResult.commits,
      reposAnalyzed: gitResult.reposAnalyzed,
      now: Math.floor(Date.now() / 1000),
      ai: { claudeCode: claude.signals, cursor: cursor.signals, codex: codex.signals },
    };
    sessions = { 'Claude Code': claude.signals.sessions, Cursor: cursor.signals.sessions, Codex: codex.signals.sessions };
    fingerprint = await machineFingerprint();
  }
  const meta = { cliVersion: CLI_VERSION, machineFingerprint: fingerprint };
  const payload = await signPayload(computeScan(input, meta));
  spinner?.stop();

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Nothing of yours here: stop before anything can be uploaded.
  if (!opts.demo && input.commits.length === 0) {
    say(renderNothingFound(gitResult?.mode ?? 'folder', gitResult?.reposFound ?? 0));
    process.exitCode = 1;
    return;
  }

  if (opts.demo) say(note('Demo mode: this is sample data, not your work.'));
  else
    for (const l of renderFound({
      projects: gitResult?.reposAnalyzed ?? 0,
      commits: input.commits.length,
      mode: gitResult?.mode ?? 'project',
      sessions,
    }))
      say(l);
  if (gitResult?.unidentified) say(warn(UNIDENTIFIED_WARNING));
  say('');
  say(renderSummary(payload));

  if (opts.demo) {
    say('');
    say(note('That was a demo. To see your own profile, run this in the folder with your projects:'));
    say(`      npx perfstaq scan`);
    say('');
    return;
  }
  if (opts.upload === false || (!interactive && !opts.yes && !key)) {
    say('');
    say(note('Want a public profile and shareable cards? Run  npx perfstaq scan  again and say yes.'));
    say('');
    return;
  }

  // ---------- Step 2: optional public profile ----------
  if (!key) {
    say(step(2, 3, 'Make it a public profile? (optional)'));
    say(note('You get a page like perfstaq.com/u/yourname and cards you can post on LinkedIn, X or Instagram.'));
    say(note('Only your scores are sent. Never your code, file names or AI chats.'));
    say('');
  }
  if (!key && !opts.yes && !(await ask('  Make my profile? (Y/n) '))) {
    say('');
    say(note('No problem. Nothing was sent.'));
    say('');
    return;
  }

  try {
    say('');
    let auth: { token: string; username: string };
    if (key) {
      // Signed in on the website already; the key says who you are.
      auth = { token: key, username: '' };
    } else {
      say(note('A browser window will open. Sign in with GitHub, then click "Yes, this is me".'));
      auth = await browserLogin(api, (url) => {
        say(note('If nothing opens, copy this link into your browser:'));
        say(`      ${url}`);
        say('');
      });
      say(ok(`Signed in as @${auth.username}`));
    }
    if (!key && interactive && !opts.yes && !(await ask(`  Is @${auth.username} your GitHub account? (Y/n) `))) {
      say('');
      say(note('Then let\'s use yours. In your browser, sign out of GitHub (github.com → your picture → Sign out),'));
      say(note('then run  npx perfstaq scan  again and sign in with your own account. Nothing was saved.'));
      say('');
      return;
    }

    let share = opts.evidence;
    // The /start page told you about the public-commit check; --no-evidence opts out.
    if (share === undefined && key) share = true;
    if (share === undefined && interactive) {
      say('');
      say(note('Want the ✓ Verified badge? We look up a few of your PUBLIC GitHub changes to confirm they are really yours.'));
      say(note('Private projects are never checked or shared.'));
    }
    if (share === undefined && !interactive) share = false; // never share without an explicit yes
    if (share === undefined) share = await ask('  Check my public work? (Y/n) ');
    if (share && gitResult?.unidentified) {
      say(warn("Skipping the check: we couldn't tell which changes are yours (see the tip above)."));
      share = false;
    }

    // ---------- Step 3: save ----------
    say(key ? step(2, 2, 'Saving your profile') : step(3, 3, 'Saving your profile'));
    let evidence: { nonce: string | null; commits: Awaited<ReturnType<typeof buildEvidence>>['commits'] } = { nonce: null, commits: [] };
    let checkFailed = false;
    let publicCommits = 0;
    if (share && gitResult) {
      const built = await buildEvidence(gitResult.repos);
      publicCommits = built.commits.length;
      try {
        const { nonce } = await fetchNonce(api, auth.token);
        evidence = { nonce, commits: built.commits };
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) throw e;
        checkFailed = true;
      }
    } else {
      // Uploads always carry a one-time code, even without a check.
      evidence = { nonce: (await fetchNonce(api, auth.token)).nonce, commits: [] };
    }
    const finalPayload = await signPayload(computeScan(input, { ...meta, evidence }));
    const saving = share ? 'Saving and checking your work on GitHub…' : 'Saving…';
    const up = canSpin ? ora({ text: saving, stream: process.stderr, indent: 2 }).start() : null;
    if (!up) say(note(saving));
    const r = await uploadScan(api, auth.token, finalPayload);
    up?.stop();

    const url = r.profileUrl ?? `${api}/u/${auth.username}`;
    const tier = r.trustTier ?? 'self-reported';
    say(ok(chalk.bold('Done! Your profile is live.')));
    say('');
    say(`  ${chalk.dim('Your profile'.padEnd(14))}${chalk.bold(url)}`);
    if (tier === 'self-reported') {
      const [why, fix] = explainNotVerified({ shared: Boolean(share), checkFailed, publicCommits, flags: r.flags ?? [] });
      say(`  ${chalk.dim('Badge'.padEnd(14))}${chalk.yellow('Not verified yet')} ${chalk.dim('(you won\'t show on the leaderboard until you are)')}`);
      say(`  ${chalk.dim('Why'.padEnd(14))}${why}`);
      say(`  ${chalk.dim('To fix'.padEnd(14))}${fix}`);
    } else {
      say(`  ${chalk.dim('Badge'.padEnd(14))}${chalk.green(tier === 'signed' ? '✓ Verified and signed' : '✓ Verified')} ${chalk.dim('(we checked your work on GitHub)')}`);
      if (typeof r.topPercent === 'number') say(`  ${chalk.dim('Standing'.padEnd(14))}${chalk.bold(`Top ${r.topPercent}%`)} of verified developers on Perfstaq`);
    }
    say('');
    say(note('Opening your profile now. Click any card to share it on LinkedIn, X or Instagram.'));
    say('');
    if (process.env.PERFSTAQ_NO_OPEN !== '1') open(url).catch(() => undefined);
  } catch (e) {
    say('');
    say(bad(friendly(e)));
    say('');
    process.exitCode = 1;
  }
}

/** Turn any failure into one plain sentence with what to do next. */
function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return e.detail || 'Your sign-in expired. Get a fresh command at perfstaq.com/start.';
    if (e.status === 429) {
      const iso = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/.exec(e.message)?.[0];
      const when = iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'tomorrow';
      return `You can update your profile once a day. Try again after ${when}.`;
    }
    if (e.status === 409) return 'This exact scan was already saved. Your profile is up to date.';
    if (e.status === 403) return e.detail || 'This GitHub account is not allowed to save this profile.';
    if (e.status === 422 || e.status === 400) return e.detail || 'Perfstaq could not read this scan. Update and try again:  npx perfstaq@latest scan';
    if (e.status >= 500) return 'Perfstaq is having trouble right now. Nothing was lost; try again in a few minutes.';
  }
  const m = (e as Error).message ?? '';
  if (/Timed out waiting/.test(m)) return 'We stopped waiting for the browser. Run  npx perfstaq scan  again when you are ready.';
  if (/reach|fetch failed|ENOTFOUND|ECONN/i.test(m)) return "Couldn't reach Perfstaq. Check your internet and try again.";
  return m || 'Something went wrong. Run  npx perfstaq scan  again.';
}

const program = new Command();
program.name('perfstaq').description('Turn your real coding work into a profile people can trust. Your code never leaves your computer.').version(CLI_VERSION);
program
  .command('scan')
  .description('Look at your coding work on this computer and turn it into a profile people can trust')
  .option('--demo', 'use sample data (touches no local files)')
  .option('--all', 'also scan sibling git repos of the current repo')
  .option('--json', 'print the signed payload JSON only')
  .option('--no-upload', 'do not offer to upload')
  .option('-y, --yes', 'upload without asking (sign-in still happens in the browser)')
  .option('--key <key>', 'your one-line key from perfstaq.com/start (signs you in, no browser needed)')
  .option('--evidence', 'share commit IDs from public GitHub repos for verification (skips the prompt)')
  .option('--no-evidence', 'do not share commit IDs (profile stays self-reported)')
  .option('--email <addr>', 'git author email that is yours (repeatable)', (v: string, prev: string[] = []) => [...prev, v])
  .option('--api <url>', 'Perfstaq API base URL', 'https://perfstaq.com')
  .action(async (opts: Opts) => {
    try {
      await scan(opts);
    } catch (e) {
      console.error(chalk.red(`  ✗ ${friendly(e)}`));
      process.exitCode = 1;
    }
  });
program.parseAsync().then(() => process.exit(process.exitCode ?? 0));
