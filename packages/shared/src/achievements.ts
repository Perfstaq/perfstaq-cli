import { archetypeInfo } from './archetype.js';
import type { ScanPayload, TrustTier } from './types.js';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type AchievementKind =
  | 'archetype'
  | 'experience'
  | 'ai-survival'
  | 'orchestrator'
  | 'rigor'
  | 'polyglot'
  | 'consistency'
  | 'global-rank'
  | 'stack-master'
  | 'tests'
  | 'refactor'
  | 'shipping'
  | 'momentum';

export interface Achievement {
  /** Stable, URL-safe id, e.g. "archetype", "experience-typescript". */
  id: string;
  kind: AchievementKind;
  /** Small label above the value, e.g. "AI CODE SURVIVAL". */
  eyebrow: string;
  /** Big headline, e.g. "91.2%" or "3.1 yrs". */
  value: string;
  /** Title under the value, e.g. "of AI-written lines survive review". */
  title: string;
  /** One-line proof, e.g. "1,240 own commits · Mar 2023 → Nov 2026". */
  detail: string;
  rarity: Rarity;
  /** Trust tier of the scan this card came from: printed on the card as its seal. */
  tier: TrustTier;
  /** Pre-written share text (no URL; callers append the card URL). */
  shareText: string;
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

const slug = (s: string) => s.toLowerCase().replace(/\+/g, 'p').replace(/#/g, 'sharp').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmt = (n: number) => n.toLocaleString('en-US');
const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function rarity(value: number, thresholds: [number, number, number]): Rarity {
  if (value >= thresholds[2]) return 'legendary';
  if (value >= thresholds[1]) return 'epic';
  if (value >= thresholds[0]) return 'rare';
  return 'common';
}

/** Years between two YYYY-MM-DD days, one decimal. */
export function yearsBetween(first: string, last: string): number {
  const ms = Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`);
  return Math.max(0, Math.round((ms / (365.25 * 86_400_000)) * 10) / 10);
}

/**
 * Deterministic achievement cards for a scan. Order = display order.
 * Cards only state what the payload supports; the tier seal says how much was checked.
 */
export function deriveAchievements(
  p: ScanPayload,
  opts: { tier: TrustTier; topPercent?: number | null } = { tier: 'self-reported' },
): Achievement[] {
  const tier = opts.tier;
  const out: Achievement[] = [];

  if (opts.topPercent) {
    const t = opts.topPercent;
    out.push({
      id: 'percentile',
      kind: 'global-rank',
      eyebrow: 'STANDING',
      value: `Top ${t}%`,
      title: 'of verified developers on Perfstaq',
      detail: `Overall index ${p.overallScore}/1000`,
      rarity: t <= 1 ? 'legendary' : t <= 5 ? 'epic' : t <= 10 ? 'rare' : 'common',
      tier,
      shareText: `I'm in the top ${t}% of verified developers on Perfstaq (${p.overallScore}/1000), ranked on engineering rigor and AI code that survives review.`,
    });
  }

  const arch = archetypeInfo(p.archetype);
  out.push({
    id: 'archetype',
    kind: 'archetype',
    eyebrow: 'BUILDER ARCHETYPE',
    value: arch.name,
    title: arch.tagline,
    detail: arch.traits.slice(0, 2).join(' · '),
    rarity: rarity(p.overallScore, [600, 750, 880]),
    tier,
    shareText: `My Perfstaq builder archetype: ${arch.name}. ${arch.tagline}`,
  });

  // Experience: top 2 languages by own commits, with real date spans.
  for (const t of p.languageTimeline.slice(0, 2)) {
    const yrs = yearsBetween(t.firstCommitAt, t.lastCommitAt);
    if (t.commits < 10) continue;
    const span = yrs >= 1 ? `${yrs} yrs` : `${t.activeMonths} mo`;
    out.push({
      id: `experience-${slug(t.language)}`,
      kind: 'experience',
      eyebrow: `${t.language.toUpperCase()} EXPERIENCE`,
      value: span,
      title: `of ${t.language}, ${fmt(t.commits)} own commits`,
      detail: `${monthYear(t.firstCommitAt)} → ${monthYear(t.lastCommitAt)} · active ${t.activeMonths} months`,
      rarity: rarity(t.commits, [100, 500, 1500]),
      tier,
      shareText: `${span} of ${t.language} on record: ${fmt(t.commits)} of my own commits, ${monthYear(t.firstCommitAt)} to ${monthYear(t.lastCommitAt)}.`,
    });
  }

  const best = [...p.stackBreakdown].filter((st) => st.verifiedCommits >= 10).sort((x, y) => y.stackRating - x.stackRating)[0];
  if (best && best.stackRating >= 50) {
    const name = best.framework ? `${best.language} / ${best.framework}` : best.language;
    out.push({
      id: `stack-${slug(best.language)}`,
      kind: 'stack-master',
      eyebrow: 'BEST STACK',
      value: `${best.stackRating}/100`,
      title: `${name} rating on verified commits`,
      detail: `${fmt(best.verifiedCommits)} verified commits · ${best.percentage}% of your work`,
      rarity: rarity(best.stackRating, [75, 85, 93]),
      tier,
      shareText: `My ${name} is rated ${best.stackRating}/100 on Perfstaq, from ${fmt(best.verifiedCommits)} verified commits.`,
    });
  }

  const tools = p.aiToolsDetected;
  if (tools.primaryTool !== 'Git-Only') {
    out.push({
      id: 'ai-survival',
      kind: 'ai-survival',
      eyebrow: 'AI CODE SURVIVAL',
      value: `${p.aiMetrics.aiSurvivalRate}%`,
      title: 'of AI-assisted lines survive 24h',
      detail: `${p.aiMetrics.humanEditRatio}% human-written · anti-slop score ${p.subScores.aiSurvival}/1000`,
      rarity: rarity(p.aiMetrics.aiSurvivalRate, [80, 90, 96]),
      tier,
      shareText: `${p.aiMetrics.aiSurvivalRate}% of my AI-assisted code survives review. Shipping with AI, without the slop.`,
    });

    const used = [tools.claudeCode && 'Claude Code', tools.cursor && 'Cursor', tools.codex && 'Codex'].filter(Boolean) as string[];
    out.push({
      id: 'orchestrator',
      kind: 'orchestrator',
      eyebrow: 'AGENT ORCHESTRATION',
      value: fmt(p.aiMetrics.agentSessionsAnalyzed),
      title: 'AI agent sessions analyzed',
      detail: `${used.join(' + ')} · ${p.aiMetrics.toolCallsPerSession} tool calls/session`,
      rarity: rarity(p.aiMetrics.agentSessionsAnalyzed * (used.length >= 2 ? 1.5 : 1), [100, 300, 800]),
      tier,
      shareText: `${fmt(p.aiMetrics.agentSessionsAnalyzed)} AI agent sessions with ${used.join(' + ')}, measured locally with Perfstaq.`,
    });
  }

  out.push({
    id: 'rigor',
    kind: 'rigor',
    eyebrow: 'ENGINEERING RIGOR',
    value: `${p.subScores.rigor}`,
    title: 'rigor index out of 1000',
    detail: `${p.rigorMetrics.testCoverageDelta}% test lines · ${p.rigorMetrics.revertRate24h}% reverted in 24h`,
    rarity: rarity(p.subScores.rigor, [600, 750, 880]),
    tier,
    shareText: `Engineering rigor ${p.subScores.rigor}/1000 on Perfstaq: ${p.rigorMetrics.testCoverageDelta}% test lines, ${p.rigorMetrics.revertRate24h}% reverts.`,
  });

  const r = p.rigorMetrics;
  if (r.testCoverageDelta >= 5) {
    out.push({
      id: 'tests',
      kind: 'tests',
      eyebrow: 'TEST DISCIPLINE',
      value: `${r.testCoverageDelta}%`,
      title: 'test lines for every 100 lines shipped',
      detail: `${r.revertRate24h}% of commits reverted within 24h`,
      rarity: rarity(r.testCoverageDelta, [15, 25, 40]),
      tier,
      shareText: `I write ${r.testCoverageDelta} lines of tests for every 100 lines I ship, measured on my own commits with Perfstaq.`,
    });
  }

  if (r.refactorRatio >= 8) {
    out.push({
      id: 'refactor',
      kind: 'refactor',
      eyebrow: 'LEAVES IT CLEANER',
      value: `${r.refactorRatio}%`,
      title: 'of commits are multi-file refactors',
      detail: `${r.avgFilesPerCommit} files touched per commit on average`,
      rarity: rarity(r.refactorRatio, [15, 22, 30]),
      tier,
      shareText: `${r.refactorRatio}% of my commits are refactors. I leave codebases cleaner than I found them.`,
    });
  }

  if (p.commitsAnalyzed >= 50) {
    out.push({
      id: 'shipping',
      kind: 'shipping',
      eyebrow: 'SHIPPED',
      value: fmt(p.commitsAnalyzed),
      title: 'own commits on record',
      detail: `${p.reposAnalyzed} ${p.reposAnalyzed === 1 ? 'repo' : 'repos'} · ${p.languageTimeline.length} languages`,
      rarity: rarity(p.commitsAnalyzed, [500, 1500, 4000]),
      tier,
      shareText: `${fmt(p.commitsAnalyzed)} of my own commits across ${p.reposAnalyzed} repos, measured locally with Perfstaq.`,
    });
  }

  if (p.rolling30dScore >= 500) {
    const delta = p.rolling30dScore - p.overallScore;
    out.push({
      id: 'momentum',
      kind: 'momentum',
      eyebrow: 'LAST 30 DAYS',
      value: `${p.rolling30dScore}`,
      title: 'score from this month alone',
      detail: delta >= 0 ? `+${delta} above the all-time index` : `All-time index ${p.overallScore}/1000`,
      rarity: rarity(p.rolling30dScore, [700, 820, 900]),
      tier,
      shareText: `My last 30 days on Perfstaq: ${p.rolling30dScore}/1000.`,
    });
  }

  const strong = p.stackBreakdown.filter((s) => s.stackRating >= 60 && s.percentage >= 5);
  if (strong.length >= 3) {
    out.push({
      id: 'polyglot',
      kind: 'polyglot',
      eyebrow: 'POLYGLOT',
      value: `${strong.length} stacks`,
      title: 'rated 60+ on verified commits',
      detail: strong.slice(0, 4).map((s) => `${s.language} ${s.stackRating}`).join(' · '),
      rarity: rarity(strong.length, [3, 4, 6]),
      tier,
      shareText: `${strong.length} stacks rated 60+ on Perfstaq: ${strong.slice(0, 4).map((s) => s.language).join(', ')}.`,
    });
  }

  return out;
}
