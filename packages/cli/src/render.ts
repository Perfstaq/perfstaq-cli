/**
 * Everything the CLI prints, in plain words. Rule of thumb: someone who has never
 * heard of git should understand every line (the "mom test"). No jargon like
 * "payload", "nonce", "evidence", "rigor" or "archetype" in what people read.
 */
import chalk from 'chalk';
import { archetypeInfo, deriveAchievements, yearsBetween } from '@perfstaq/shared';
import type { ScanPayload } from '@perfstaq/shared';

const ORANGE = chalk.hex('#ff6a1a');
const fmt = (n: number) => n.toLocaleString('en-US');
const W = 58;

export const NOTHING_SENT = 'Nothing has left this computer. Your code, file names and AI chats are never sent.';

export function header(): string {
  return [
    '',
    `${ORANGE.bold('>_ perfstaq')}  ${chalk.dim('turns your real coding work into a profile people can trust')}`,
    '',
  ].join('\n');
}

export function step(n: number, total: number, title: string): string {
  return `\n${ORANGE.bold(`Step ${n} of ${total}`)}  ${chalk.bold(title)}`;
}

export const ok = (s: string) => `  ${chalk.green('✓')} ${s}`;
export const note = (s: string) => `  ${chalk.dim(s)}`;
export const warn = (s: string) => `  ${chalk.yellow('!')} ${s}`;
export const bad = (s: string) => `  ${chalk.red('✗')} ${s}`;

function meter(value: number, max: number, width = 20): string {
  const n = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return ORANGE('█'.repeat(n)) + chalk.dim('░'.repeat(width - n));
}

const VALUE_W = W - 21; // room for a value after the 20-char label

/** Join items with ", " but only as many as fit; never cut a word. */
function fitList(items: string[], width = VALUE_W): string {
  let out = '';
  for (const it of items) {
    const next = out ? `${out}, ${it}` : it;
    if (next.length > width) break;
    out = next;
  }
  return out || (items[0] ?? '').slice(0, width);
}

/** Wrap text into lines no wider than `width`, on word boundaries. */
function wrap(text: string, width = VALUE_W): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if (cur && `${cur} ${w}`.length > width) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function boxed(lines: [styled: string, plain: string][], title: string): string {
  const top = chalk.dim(`┌─ ${title} ${'─'.repeat(Math.max(0, W - title.length - 3))}┐`);
  const body = lines.map(([s, p]) => `${chalk.dim('│')} ${s}${' '.repeat(Math.max(0, W - p.length - 1))}${chalk.dim('│')}`);
  return [top, ...body, chalk.dim(`└${'─'.repeat(W)}┘`)].join('\n');
}

/** The plain-words summary of a scan. */
export function renderSummary(p: ScanPayload): string {
  const L: [string, string][] = [];
  const add = (label: string, value: string, styledValue = value) => L.push([`${chalk.dim(label.padEnd(20))}${styledValue}`, `${label.padEnd(20)}${value}`]);
  const blank = () => L.push(['', '']);

  const score = `${p.overallScore} out of 1000`;
  L.push([`${chalk.bold('Your score'.padEnd(20))}${ORANGE.bold(score.padEnd(17))}${meter(p.overallScore, 1000, 18)}`, `${'Your score'.padEnd(20)}${score.padEnd(17)}${'x'.repeat(18)}`]);
  blank();
  const parts: [string, number][] = [
    ['  Careful work', p.subScores.rigor],
    ['  AI code you kept', p.subScores.aiSurvival],
    ['  Range of skills', p.subScores.stackComplexity],
  ];
  for (const [label, v] of parts) {
    const num = String(v).padStart(4);
    L.push([`${chalk.dim(label.padEnd(20))}${num}  ${meter(v, 1000, 18)}`, `${label.padEnd(20)}${num}  ${'x'.repeat(18)}`]);
  }
  blank();

  const langs = p.languageTimeline.slice(0, 3).map((t) => {
    const yrs = yearsBetween(t.firstCommitAt, t.lastCommitAt);
    return `${t.language} (${yrs >= 1 ? `${yrs} yrs` : `${t.activeMonths} mo`})`;
  });
  add('You code in', langs.length ? fitList(langs) : '—');
  const t = p.aiToolsDetected;
  const tools = [t.claudeCode && 'Claude Code', t.cursor && 'Cursor', t.codex && 'Codex'].filter(Boolean).join(', ');
  add('AI helpers', tools || 'none found');
  const info = archetypeInfo(p.archetype);
  add('Your style', p.archetype, chalk.bold(p.archetype));
  for (const t of wrap(info.tagline)) L.push([chalk.dim(`${' '.repeat(20)}${t}`), `${' '.repeat(20)}${t}`]);
  const cards = deriveAchievements(p, { tier: 'self-reported' }).length;
  add('Cards earned', `${cards} shareable cards`);

  return [boxed(L, 'Your coding profile'), '', `  ${chalk.green(NOTHING_SENT)}`].join('\n');
}

/** What the score parts mean, for people who ask "what is careful work?". */
export const SCORE_HELP = [
  'Careful work: you add tests, rarely undo your changes, and clean up code.',
  'AI code you kept: how much of what AI wrote for you was still there a day later.',
  'Range of skills: how many languages and how deep your projects go.',
];

export function renderFound(opts: { projects: number; commits: number; mode: 'project' | 'folder'; sessions: Record<string, number> }): string[] {
  const out: string[] = [];
  out.push(ok(opts.mode === 'project' ? 'Found your project' : `Found ${opts.projects} project${opts.projects === 1 ? '' : 's'} in this folder`));
  out.push(ok(`${fmt(opts.commits)} changes you saved with git`));
  const used = Object.entries(opts.sessions).filter(([, n]) => n > 0);
  if (used.length) out.push(ok(`AI helpers you use: ${used.map(([k, n]) => `${k} (${fmt(n)} sessions)`).join(', ')}`));
  else out.push(note('No AI helpers found (Claude Code, Cursor, Codex). That is fine.'));
  return out;
}

export function renderNothingFound(mode: 'project' | 'folder', projects: number): string {
  const lines = [
    '',
    bad(projects > 0 ? "Found projects here, but none of the changes in them are yours." : "We couldn't find any of your code here."),
    '',
    note('Perfstaq needs to run in the folder where your projects are.'),
    note('For example, if your projects are in a folder called "code":'),
    '',
    `      ${ORANGE('cd ~/code')}`,
    `      ${ORANGE('npx perfstaq scan')}`,
    '',
  ];
  if (projects > 0) {
    lines.push(note("If they are yours, git may know you by another email. Tell us which one:"));
    lines.push(`      ${ORANGE('npx perfstaq scan --email you@example.com')}`);
    lines.push('');
  }
  lines.push(note('Nothing was sent anywhere.'));
  return lines.join('\n');
}

/** Why a profile ended up "not verified", and the one thing to do about it. */
export function explainNotVerified(opts: { shared: boolean; checkFailed: boolean; publicCommits: number; flags: string[] }): [why: string, fix: string] {
  const f = opts.flags;
  if (!opts.shared) return ['you chose not to let us check your GitHub work.', 'Run the scan again and answer yes to the check.'];
  if (opts.checkFailed || f.includes('github-unavailable')) return ["GitHub didn't answer while we were checking.", 'Nothing is wrong. Run the scan again tomorrow.'];
  if (opts.publicCommits === 0) return ['none of your projects here are public on GitHub, so nobody can check them.', 'Put at least one project on GitHub as public, then scan again.'];
  if (f.includes('commit-not-found')) return ["some of your work isn't on GitHub yet.", 'Push your latest changes to GitHub (git push), then scan again tomorrow.'];
  if (f.includes('commit-mismatch')) return ["some of the work we checked doesn't belong to your GitHub account.", 'Make sure git uses the same email as your GitHub account, then scan again tomorrow.'];
  if (f.includes('low-evidence-coverage')) return ['most of your work is private, so we could only check a small part.', 'Make a few more of your projects public on GitHub, then scan again tomorrow.'];
  if (f.includes('evidence-inconsistent')) return ["the numbers from this scan didn't add up.", 'Scan again tomorrow with the latest version: npx perfstaq@latest scan'];
  return ["we couldn't confirm enough of your work.", 'Make sure your projects are public on GitHub, then scan again tomorrow.'];
}
