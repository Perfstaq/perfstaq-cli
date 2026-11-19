import { classifyArchetype } from './archetype.js';
import { SYSTEMS_LANGUAGES } from './languages.js';
import type {
  AiMetrics,
  AiToolsDetected,
  AnonCommit,
  ArchetypeFeatures,
  LanguageTimeline,
  RigorMetrics,
  ScanEvidence,
  ScanInput,
  StackEntry,
  SubScores,
  UnsignedScanPayload,
} from './internal-types.js';

const DAY = 86_400;
export const WEIGHTS = { rigor: 0.4, aiSurvival: 0.3, stackComplexity: 0.3 } as const;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

interface WindowStats {
  commits: number;
  linesAdded: number;
  testLines: number;
  sourceLines: number;
  reverts: number;
  churned: number;
  refactorCommits: number;
  totalFileTouches: number;
  activeDays: number;
  spanDays: number;
  avgDepth: number;
  aiLinesAdded: number;
  aiChurned: number;
  humanLinesAdded: number;
  netSurvivingLines: number;
  byLanguage: Map<string, LangStats>;
}

interface LangStats {
  framework?: string;
  frameworkVotes: Map<string, number>;
  lines: number;
  testLines: number;
  commits: number;
}

/** A refactor touches 3+ files and deletes at least 30% as much as it adds. */
function isRefactor(c: AnonCommit): boolean {
  if (c.files.length < 3) return false;
  const added = c.files.reduce((s, f) => s + f.added, 0);
  const deleted = c.files.reduce((s, f) => s + f.deleted, 0);
  return deleted > 0 && deleted >= added * 0.3;
}

function windowStats(commits: AnonCommit[], now: number, windowDays: number): WindowStats {
  const days = new Set<number>();
  const byLanguage = new Map<string, LangStats>();
  let linesAdded = 0, testLines = 0, reverts = 0, churned = 0, refactorCommits = 0, totalFileTouches = 0;
  let depthSum = 0, depthN = 0, aiLinesAdded = 0, aiChurned = 0, humanLinesAdded = 0;
  let minTs = Infinity;

  const windowStart = now - windowDays * DAY;
  for (const c of commits) {
    if (c.timestamp >= windowStart) {
      days.add(Math.floor(c.timestamp / DAY));
      minTs = Math.min(minTs, c.timestamp);
    }
    const added = c.files.reduce((s, f) => s + f.added, 0);
    linesAdded += added;
    churned += Math.min(c.churnedLines24h, added);
    // A commit counts against the revert rate if it is a revert or >50% of its lines churned in 24h.
    if (c.isRevert || (added > 0 && c.churnedLines24h / added > 0.5)) reverts++;
    if (isRefactor(c)) refactorCommits++;
    totalFileTouches += c.files.length;
    if (c.aiAssisted) {
      aiLinesAdded += added;
      aiChurned += Math.min(c.churnedLines24h, added);
    } else {
      humanLinesAdded += added;
    }
    const langsInCommit = new Set<string>();
    for (const f of c.files) {
      depthSum += f.depth;
      depthN++;
      if (f.isTest) testLines += f.added;
      let ls = byLanguage.get(f.language);
      if (!ls) {
        ls = { lines: 0, testLines: 0, commits: 0, frameworkVotes: new Map() };
        byLanguage.set(f.language, ls);
      }
      ls.lines += f.added;
      if (f.isTest) ls.testLines += f.added;
      if (f.framework) ls.frameworkVotes.set(f.framework, (ls.frameworkVotes.get(f.framework) ?? 0) + f.added + 1);
      langsInCommit.add(f.language);
    }
    for (const l of langsInCommit) byLanguage.get(l)!.commits++;
  }

  for (const ls of byLanguage.values()) {
    let best: string | undefined, bestVotes = 0;
    for (const [fw, v] of [...ls.frameworkVotes].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (v > bestVotes) { best = fw; bestVotes = v; }
    }
    if (best && bestVotes >= ls.lines * 0.2) ls.framework = best;
  }

  const spanDays = Number.isFinite(minTs)
    ? Math.min(windowDays, Math.max(1, Math.ceil((now - minTs) / DAY)))
    : windowDays;

  return {
    commits: commits.length,
    linesAdded,
    testLines,
    sourceLines: linesAdded - testLines,
    reverts,
    churned,
    refactorCommits,
    totalFileTouches,
    activeDays: days.size,
    spanDays,
    avgDepth: safeDiv(depthSum, depthN),
    aiLinesAdded,
    aiChurned,
    humanLinesAdded,
    netSurvivingLines: linesAdded - churned,
    byLanguage,
  };
}

interface Computed {
  rigor: number;
  aiSurvival: number;
  stackComplexity: number;
  overall: number;
  survival: number;
  humanEditRatio: number;
  testRatio: number;
  revertRate: number;
  refactorRatio: number;
  consistency: number;
  stats: WindowStats;
}

function compute(stats: WindowStats): Computed {
  // --- Engineering rigor ---------------------------------------------------
  const testRatio = safeDiv(stats.testLines, stats.linesAdded);
  const revertRate = safeDiv(stats.reverts, stats.commits);
  const refactorRatio = safeDiv(stats.refactorCommits, stats.commits);
  const consistency = clamp01(safeDiv(stats.activeDays, stats.spanDays * 0.5));
  const rigor = stats.commits === 0 ? 0 :
    0.3 * clamp01(testRatio / 0.3) +
    0.25 * (1 - clamp01(revertRate / 0.15)) +
    0.25 * clamp01(refactorRatio / 0.35) +
    0.2 * consistency;

  // --- AI survival & anti-slop ---------------------------------------------
  // Use AI-assisted lines when there are any; otherwise fall back to all lines.
  const aiScoped = stats.aiLinesAdded > 0;
  const survival = aiScoped
    ? 1 - safeDiv(stats.aiChurned, stats.aiLinesAdded)
    : 1 - safeDiv(stats.churned, stats.linesAdded);
  const humanEditRatio = safeDiv(stats.humanLinesAdded, stats.linesAdded);
  // Best refinement is a healthy human share (~45%), not 0% (pure slop) or 100% (no AI leverage).
  const refine = clamp01(1 - Math.abs(humanEditRatio - 0.45) / 0.55);
  const aiSurvival = stats.linesAdded === 0 ? 0 : 0.7 * clamp01(survival) + 0.3 * refine;

  // --- Stack complexity ----------------------------------------------------
  const shares = [...stats.byLanguage.values()].map((l) => safeDiv(l.lines, stats.linesAdded)).filter((s) => s > 0);
  const meaningful = shares.filter((s) => s >= 0.05).length;
  const entropy = -shares.reduce((s, p) => s + p * Math.log2(p), 0);
  const diversity = 0.5 * clamp01(meaningful / 4) + 0.5 * clamp01(entropy / 2);
  const depth = clamp01(stats.avgDepth / 5);
  const volume = clamp01(Math.log10(1 + Math.max(0, stats.netSurvivingLines)) / 5);
  const stackComplexity = stats.linesAdded === 0 ? 0 : 0.4 * diversity + 0.3 * depth + 0.3 * volume;

  const overall = WEIGHTS.rigor * rigor + WEIGHTS.aiSurvival * aiSurvival + WEIGHTS.stackComplexity * stackComplexity;
  return { rigor, aiSurvival, stackComplexity, overall, survival: clamp01(survival), humanEditRatio, testRatio, revertRate, refactorRatio, consistency, stats };
}

function stackBreakdown(stats: WindowStats, survival: number): StackEntry[] {
  return [...stats.byLanguage.entries()]
    .map(([language, l]) => {
      const testScore = clamp01(safeDiv(l.testLines, l.lines) / 0.3);
      const rating = Math.round(100 * (
        0.35 * clamp01(Math.log10(1 + l.lines) / 4) +
        0.25 * clamp01(l.commits / 50) +
        0.2 * testScore +
        0.2 * survival
      ));
      const entry: StackEntry = {
        language,
        percentage: round1(100 * safeDiv(l.lines, stats.linesAdded)),
        stackRating: rating,
        verifiedCommits: l.commits,
      };
      if (l.framework) entry.framework = l.framework;
      return entry;
    })
    .filter((e) => e.percentage > 0 || e.verifiedCommits > 0)
    .sort((a, b) => b.percentage - a.percentage || b.stackRating - a.stackRating || a.language.localeCompare(b.language))
    .slice(0, 8);
}

export function detectTools(input: ScanInput): AiToolsDetected {
  const counts: [AiToolsDetected['primaryTool'], number][] = [
    ['Claude Code', input.ai.claudeCode.detected ? input.ai.claudeCode.sessions : 0],
    ['Cursor', input.ai.cursor.detected ? input.ai.cursor.sessions : 0],
    ['Codex', input.ai.codex?.detected ? input.ai.codex.sessions : 0],
  ];
  const used = counts.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  let primaryTool: AiToolsDetected['primaryTool'] = 'Git-Only';
  if (used.length === 1) primaryTool = used[0]![0];
  else if (used.length > 1) {
    // One tool dominates (3x the runner-up) -> that tool; otherwise Hybrid.
    primaryTool = used[0]![1] > 3 * used[1]![1] ? used[0]![0] : 'Hybrid';
  }
  return {
    claudeCode: counts[0]![1] > 0,
    cursor: counts[1]![1] > 0,
    codex: counts[2]![1] > 0,
    primaryTool,
  };
}

const isoDay = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

/** Own-commit experience span per language, over the full history given. */
export function languageTimeline(commits: AnonCommit[]): LanguageTimeline[] {
  const by = new Map<string, { first: number; last: number; months: Set<string>; commits: number }>();
  for (const c of commits) {
    const month = isoDay(c.timestamp).slice(0, 7);
    for (const lang of new Set(c.files.filter((f) => f.added + f.deleted > 0).map((f) => f.language))) {
      const e = by.get(lang) ?? { first: c.timestamp, last: c.timestamp, months: new Set<string>(), commits: 0 };
      e.first = Math.min(e.first, c.timestamp);
      e.last = Math.max(e.last, c.timestamp);
      e.months.add(month);
      e.commits++;
      by.set(lang, e);
    }
  }
  return [...by.entries()]
    .map(([language, e]) => ({
      language,
      firstCommitAt: isoDay(e.first),
      lastCommitAt: isoDay(e.last),
      activeMonths: e.months.size,
      commits: e.commits,
    }))
    .sort((a, b) => b.commits - a.commits || a.language.localeCompare(b.language))
    .slice(0, 8);
}

const to1000 = (n: number) => Math.round(1000 * clamp01(n));

/**
 * Deterministic scoring. Same ScanInput -> same payload (minus hash/fingerprint fields
 * that the caller fills in).
 */
export function computeScan(
  input: ScanInput,
  meta: { cliVersion: string; machineFingerprint: string; evidence?: ScanEvidence },
): UnsignedScanPayload {
  const commits = [...input.commits].sort((a, b) => a.timestamp - b.timestamp);
  const all = compute(windowStats(commits, input.now, 90));
  const recent = compute(windowStats(commits.filter((c) => c.timestamp >= input.now - 30 * DAY), input.now, 30));

  const tools = detectTools(input);
  const cc = input.ai.claudeCode;
  const codex = input.ai.codex ?? { detected: false, sessions: 0, toolCalls: 0 };
  const sessions = cc.sessions + input.ai.cursor.sessions + codex.sessions;
  const stack = stackBreakdown(all.stats, all.survival);

  const rigorMetrics: RigorMetrics = {
    testCoverageDelta: round1(100 * safeDiv(all.stats.testLines, all.stats.sourceLines)),
    revertRate24h: round1(100 * all.revertRate),
    avgFilesPerCommit: round1(safeDiv(all.stats.totalFileTouches, all.stats.commits)),
    refactorRatio: round1(100 * all.refactorRatio),
  };
  const aiMetrics: AiMetrics = {
    aiSurvivalRate: round1(100 * all.survival),
    humanEditRatio: round1(100 * all.humanEditRatio),
    agentSessionsAnalyzed: sessions,
    toolCallsPerSession: round1(safeDiv(cc.toolCalls + codex.toolCalls, cc.sessions + codex.sessions)),
  };
  const subScores: SubScores = {
    rigor: to1000(all.rigor),
    aiSurvival: to1000(all.aiSurvival),
    stackComplexity: to1000(all.stackComplexity),
  };

  const systemsShare = stack.filter((s) => SYSTEMS_LANGUAGES.has(s.language)).reduce((s, e) => s + e.percentage, 0) / 100;
  const tsShare = stack.filter((s) => s.language === 'TypeScript').reduce((s, e) => s + e.percentage, 0) / 100;
  const features: ArchetypeFeatures = {
    refactorRatio: all.refactorRatio,
    revertRate: all.revertRate,
    testRatio: all.testRatio,
    consistency: all.consistency,
    netSurvivingLines: all.stats.netSurvivingLines,
    aiSurvival: all.survival,
    toolCallsPerSession: aiMetrics.toolCallsPerSession,
    tools,
    systemsShare,
    typescriptShare: tsShare,
    avgDepth: all.stats.avgDepth,
    stack,
  };

  return {
    schemaVersion: 2,
    cliVersion: meta.cliVersion,
    machineFingerprint: meta.machineFingerprint,
    generatedAt: new Date(input.now * 1000).toISOString(),
    overallScore: to1000(all.overall),
    rolling30dScore: to1000(recent.overall),
    subScores,
    stackBreakdown: stack,
    aiToolsDetected: tools,
    rigorMetrics,
    aiMetrics,
    archetype: classifyArchetype(features),
    reposAnalyzed: input.reposAnalyzed,
    commitsAnalyzed: commits.length,
    languageTimeline: languageTimeline(commits),
    evidence: meta.evidence ?? { nonce: null, commits: [] },
  };
}
