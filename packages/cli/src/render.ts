import chalk from 'chalk';
import { archetypeInfo, deriveAchievements, RARITY_LABEL, yearsBetween } from '@perfstaq/shared';
import type { ScanPayload } from '@perfstaq/shared';

export const PRIVACY_LINE =
  'Privacy Check: 0 lines of source code or prompts read. Only anonymized metrics ready to upload.';

const fmtNum = (n: number) => n.toLocaleString('en-US');
const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const W = 62; // inner width

function bar(value: number, max: number, width: number): string {
  const n = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return chalk.cyan('█'.repeat(n)) + chalk.dim('░'.repeat(width - n));
}

function pad(s: string, visible: number): string {
  return s + ' '.repeat(Math.max(0, W - visible));
}

/** Render a row; `plain` is the unstyled text used to measure width. */
function row(styled: string, plain: string): string {
  return chalk.dim('│ ') + pad(styled, plain.length) + chalk.dim('│');
}

function rule(l: string, r: string): string {
  return chalk.dim(l + '─'.repeat(W + 1) + r);
}

function line(label: string, value: string): string {
  const plain = `${label.padEnd(24)}${value}`;
  return row(`${chalk.dim(label.padEnd(24))}${chalk.bold(value)}`, plain);
}

export function renderScorecard(p: ScanPayload): string {
  const out: string[] = [];
  const blank = () => out.push(row('', ''));
  const title = 'PERFSTAQ  ·  Local Scan';
  out.push(rule('┌', '┐'));
  out.push(row(chalk.bold.magenta(title), title));
  out.push(rule('├', '┤'));
  blank();
  const overall = `${p.overallScore} / 1000`;
  out.push(row(`${chalk.dim('Overall Score'.padEnd(24))}${chalk.bold.green(overall.padEnd(12))}${bar(p.overallScore, 1000, 24)}`, `${'Overall Score'.padEnd(24)}${overall.padEnd(12)}${'x'.repeat(24)}`));
  out.push(line('30-day Score', `${p.rolling30dScore} / 1000`));
  blank();
  out.push(row(chalk.bold('Sub-scores'), 'Sub-scores'));
  const subs: [string, number, string][] = [
    ['Rigor (40%)', p.subScores.rigor, ''],
    ['AI Survival (30%)', p.subScores.aiSurvival, ''],
    ['Stack Complexity (30%)', p.subScores.stackComplexity, ''],
  ];
  for (const [name, v] of subs) {
    const num = String(v).padStart(4);
    out.push(row(`  ${name.padEnd(24)}${num}  ${bar(v, 1000, 24)}`, `  ${name.padEnd(24)}${num}  ${'x'.repeat(24)}`));
  }
  blank();
  out.push(row(chalk.bold('Top Stack'), 'Top Stack'));
  const stacks = p.stackBreakdown.slice(0, 5);
  if (stacks.length === 0) out.push(row(chalk.dim('  (no scored languages found)'), '  (no scored languages found)'));
  for (const s of stacks) {
    const name = (s.framework ? `${s.language}/${s.framework}` : s.language).slice(0, 20).padEnd(20);
    const tail = `${String(Math.round(s.stackRating)).padStart(3)}  ${String(s.verifiedCommits).padStart(4)} commits`;
    out.push(row(`  ${name} ${bar(s.stackRating, 100, 20)} ${tail}`, `  ${name} ${'x'.repeat(20)} ${tail}`));
  }
  blank();
  out.push(row(chalk.bold('Experience (own commits, full history)'), 'Experience (own commits, full history)'));
  if (p.languageTimeline.length === 0) out.push(row(chalk.dim('  (no language history found)'), '  (no language history found)'));
  for (const e of p.languageTimeline.slice(0, 5)) {
    const yrs = yearsBetween(e.firstCommitAt, e.lastCommitAt);
    const span = yrs >= 1 ? `${yrs} yrs` : `${e.activeMonths} mo`;
    const name = e.language.slice(0, 12).padEnd(13);
    const commits = `${fmtNum(e.commits)} commits`.padStart(14);
    const range = `${monthYear(e.firstCommitAt)} → ${monthYear(e.lastCommitAt)}`;
    const plain = `  ${name}${span.padEnd(9)}${commits}  ${range}`;
    out.push(row(`  ${chalk.cyan(name)}${chalk.bold(span.padEnd(9))}${commits}  ${chalk.dim(range)}`, plain));
  }
  blank();
  const info = archetypeInfo(p.archetype);
  out.push(line('Builder Archetype', p.archetype));
  out.push(row(chalk.italic.dim('  ' + info.tagline), '  ' + info.tagline));
  blank();
  out.push(line('AI Survival Rate', `${p.aiMetrics.aiSurvivalRate}%`));
  out.push(line('Primary AI tool', p.aiToolsDetected.primaryTool));
  const t = p.aiToolsDetected;
  const tools = [t.claudeCode && 'Claude Code', t.cursor && 'Cursor', t.codex && 'Codex'].filter(Boolean).join(', ');
  out.push(line('AI tools', tools || 'none detected'));
  out.push(line('Commits analyzed', String(p.commitsAnalyzed)));
  out.push(line('Repos analyzed', String(p.reposAnalyzed)));
  out.push(line('Integrity hash', `${p.integrityHash.slice(0, 8)}…${p.integrityHash.slice(-6)}`));
  blank();
  out.push(row(chalk.bold('Achievements (local preview)'), 'Achievements (local preview)'));
  for (const a of deriveAchievements(p, { tier: 'self-reported' })) {
    const head = `  [${RARITY_LABEL[a.rarity]}] ${a.value} · ${a.title}`.slice(0, W - 1);
    out.push(row(head.replace(/\[[^\]]+\]/, (m) => chalk.yellow(m)), head));
    const detail = `      ${a.detail}`.slice(0, W - 1);
    out.push(row(chalk.dim(detail), detail));
  }
  const seal = '  Seal is set after the GitHub check on the server.';
  out.push(row(chalk.dim(seal), seal));
  blank();
  out.push(rule('└', '┘'));
  out.push('');
  out.push(chalk.green(PRIVACY_LINE));
  return out.join('\n');
}

export function renderEvidenceNote(commits: number, repos: number): string {
  return chalk.green(
    `Evidence: sharing ${fmtNum(commits)} commit IDs from ${fmtNum(repos)} public GitHub repo${repos === 1 ? '' : 's'} (no code, no paths, no private repos).`,
  );
}
