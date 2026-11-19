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
import { renderEvidenceNote, renderScorecard } from './render.js';
import { CLI_VERSION } from './version.js';

interface Opts {
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
  const spinner = quiet || !process.stderr.isTTY ? null : ora({ text: 'Scanning locally…', stream: process.stderr }).start();

  let input: ScanInput;
  let fingerprint: string;
  let gitResult: GitResult | null = null;
  let sessionLine = '';
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
    sessionLine = `Sessions: Claude Code ${claude.signals.sessions} · Cursor ${cursor.signals.sessions} · Codex ${codex.signals.sessions}`;
    fingerprint = await machineFingerprint();
  }
  const meta = { cliVersion: CLI_VERSION, machineFingerprint: fingerprint };
  const payload = await signPayload(computeScan(input, meta));
  spinner?.stop();

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(renderScorecard(payload));
  if (sessionLine) console.log(chalk.dim(sessionLine));
  if (opts.demo) {
    console.log(chalk.yellow('\nDemo mode: sample data, nothing uploaded.'));
    return;
  }
  if (gitResult?.unidentified) console.log(chalk.yellow(`\n${UNIDENTIFIED_WARNING}`));
  if (!input.commits.length) console.log(chalk.yellow('\nNo commits found here. Run inside a git repo, or use --all.'));
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (opts.upload === false || (!interactive && !opts.yes)) return;

  console.log('');
  if (!opts.yes && !(await ask('Upload to Perfstaq? (Y/n) '))) return;
  try {
    const auth = await browserLogin(api);
    console.log('');
    let share = opts.evidence;
    if (share === undefined && !interactive) share = false; // never share commit IDs without an explicit yes
    if (share === undefined) {
      share = await ask(
        'Share commit IDs from your PUBLIC GitHub repos so Perfstaq can verify them on GitHub? Nothing from private repos is sent. (Y/n) ',
      );
    }
    if (share && gitResult?.unidentified) {
      console.log(chalk.yellow('Skipping commit IDs: could not tell which commits are yours (see warning above).'));
      share = false;
    }
    let evidence: { nonce: string | null; commits: Awaited<ReturnType<typeof buildEvidence>>['commits'] } = {
      nonce: null,
      commits: [],
    };
    let publicRepos = 0;
    let checkFailed = false;
    if (share && gitResult) {
      const built = await buildEvidence(gitResult.repos);
      publicRepos = built.publicRepos;
      try {
        const { nonce } = await fetchNonce(api, auth.token);
        evidence = { nonce, commits: built.commits };
        if (built.commits.length) console.log(renderEvidenceNote(built.commits.length, publicRepos));
        else console.log(chalk.yellow('No commits in public GitHub repos found; this profile will be self-reported.'));
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) throw e;
        checkFailed = true;
        console.log(chalk.yellow(`Could not start GitHub verification: ${(e as Error).message}`));
      }
    }
    const finalPayload = await signPayload(computeScan(input, { ...meta, evidence }));
    const up = ora({ text: 'Uploading…' }).start();
    try {
      const r = await uploadScan(api, auth.token, finalPayload);
      up.succeed('Uploaded.');
      console.log(chalk.bold(`Profile: ${r.profileUrl ?? `${api}/u/${auth.username}`}`));
      const tier = r.trustTier ?? 'self-reported';
      console.log(`Trust tier: ${chalk.bold(TRUST_TIERS[tier].label)}`);
      if (tier === 'self-reported') {
        const flags = r.flags ?? [];
        const why = !share
          ? 'you declined to share commit IDs'
          : checkFailed
            ? 'the GitHub check could not run'
            : evidence.commits.length === 0
              ? 'no commits found in public GitHub repos'
              : flags.length
                ? `the server flagged: ${flags.join(', ')}`
                : 'the GitHub spot-check did not pass';
        console.log(chalk.yellow(`Self-reported because ${why}. Self-reported profiles aren't ranked on the leaderboard.`));
      } else if (r.flags?.length) {
        console.log(chalk.yellow(`Flags: ${r.flags.join(', ')}`));
      }
      if (typeof r.globalRank === 'number') console.log(`Global rank: #${r.globalRank}`);
    } catch (e) {
      up.fail((e as Error).message);
      process.exitCode = 1;
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error(chalk.red(e instanceof ApiError && e.status === 429 ? `Cooldown: ${msg}` : msg));
    process.exitCode = 1;
  }
}

const program = new Command();
program.name('perfstaq').description('Privacy-first developer scan').version(CLI_VERSION);
program
  .command('scan')
  .description('Scan local git + AI-tool metadata and show your Perfstaq scorecard')
  .option('--demo', 'use sample data (touches no local files)')
  .option('--all', 'also scan sibling git repos of the current repo')
  .option('--json', 'print the signed payload JSON only')
  .option('--no-upload', 'do not offer to upload')
  .option('-y, --yes', 'upload without asking (sign-in still happens in the browser)')
  .option('--evidence', 'share commit IDs from public GitHub repos for verification (skips the prompt)')
  .option('--no-evidence', 'do not share commit IDs (profile stays self-reported)')
  .option('--email <addr>', 'git author email that is yours (repeatable)', (v: string, prev: string[] = []) => [...prev, v])
  .option('--api <url>', 'Perfstaq API base URL', 'https://rank.perfstaq.com')
  .action(async (opts: Opts) => {
    try {
      await scan(opts);
    } catch (e) {
      console.error(chalk.red(`Scan failed: ${(e as Error).message}`));
      process.exitCode = 1;
    }
  });
program.parseAsync().then(() => process.exit(process.exitCode ?? 0));
