import type { TrustTier } from './types.js';

/** How many evidence commits the server looks up on GitHub per scan. */
export const VERIFY_SAMPLE_SIZE = 12;
/** Fewer matched commits than this can't earn a verified tier. */
export const MIN_MATCHED_FOR_VERIFIED = 5;
/** Share of looked-up commits that must match. */
export const MIN_MATCH_RATE = 0.8;
/** Share of matched commits that must be GitHub-"Verified" (signed) for the signed tier. */
export const MIN_SIGNED_RATE = 0.5;
/** Line-count tolerance when comparing reported vs GitHub stats. */
export const LINE_TOLERANCE = 0.02;
/**
 * Verified tiers need public GitHub evidence for at least this share of the scanned commits
 * (evidence is capped at the newest 1000). Stops "a few real public commits + inflated private
 * history" from earning a verified seal.
 */
export const MIN_EVIDENCE_COVERAGE = 0.5;
/** Verified tiers need at least this many public commits submitted, whatever the scan claims. */
export const MIN_EVIDENCE_COMMITS = 10;
/** A GitHub account younger than this is flagged. */
export const NEW_ACCOUNT_DAYS = 30;
/** Overall score rising more than this between scans within 7 days is flagged. */
export const SCORE_JUMP = 250;
/** One accepted scan per user per this many hours. */
export const SCAN_COOLDOWN_HOURS = 20;

export const TRUST_TIERS: Record<TrustTier, { label: string; short: string; description: string; rank: number }> = {
  signed: {
    label: 'Signed & GitHub-verified',
    short: 'Signed',
    description: 'A random sample of this developer’s commits was checked on GitHub: they exist, are authored by this account, match the reported line counts, and most are cryptographically signed.',
    rank: 3,
  },
  'github-verified': {
    label: 'GitHub-verified',
    short: 'Verified',
    description: 'A random sample of this developer’s commits was checked on GitHub: they exist, are authored by this account, and match the reported line counts.',
    rank: 2,
  },
  'self-reported': {
    label: 'Self-reported',
    short: 'Self-reported',
    description: 'Scanned and signed on the developer’s machine, but the server could not check the commits (private repos or too few public commits). Treat the numbers as claims.',
    rank: 1,
  },
};

/** Does `actual` match `reported` within tolerance (absolute slack of 2 lines for tiny commits)? */
export function linesMatch(reported: number, actual: number): boolean {
  return Math.abs(reported - actual) <= Math.max(2, actual * LINE_TOLERANCE);
}

/**
 * Deterministic tier from the server's GitHub spot-check.
 * A commit-mismatch flag (someone submitted commits that aren't theirs or edited counts) always
 * drops to self-reported: one bad sample is evidence of tampering, not noise.
 */
export function computeTrustTier(r: {
  checked: number;
  matched: number;
  signed: number;
  flags: string[];
  /** Evidence commits submitted, and own commits the scan claims. Omit both to skip the coverage rule. */
  evidenceCommits?: number;
  commitsAnalyzed?: number;
}): TrustTier {
  if (r.flags.includes('commit-mismatch') || r.flags.includes('evidence-inconsistent')) return 'self-reported';
  if (r.flags.includes('github-unavailable')) return 'self-reported'; // couldn't check everything: re-scan later
  if (r.evidenceCommits !== undefined && r.commitsAnalyzed !== undefined) {
    if (r.evidenceCommits < MIN_EVIDENCE_COMMITS) return 'self-reported';
    if (evidenceCoverage(r.evidenceCommits, r.commitsAnalyzed) < MIN_EVIDENCE_COVERAGE) return 'self-reported';
  }
  if (r.checked === 0 || r.matched < MIN_MATCHED_FOR_VERIFIED || r.matched / r.checked < MIN_MATCH_RATE) return 'self-reported';
  if (r.signed / r.matched >= MIN_SIGNED_RATE) return 'signed';
  return 'github-verified';
}

/** Share of claimed commits backed by public evidence (evidence is capped at 1000). */
export function evidenceCoverage(evidenceCommits: number, commitsAnalyzed: number): number {
  const denom = Math.min(commitsAnalyzed, 1000);
  return denom > 0 ? Math.min(1, evidenceCommits / denom) : 0;
}

/**
 * Pick which evidence commits to check from a seed. The SERVER must pass fresh randomness
 * generated after the evidence arrives (never anything the client knew in advance, such as the
 * nonce), so a client can't arrange real commits at the sampled positions.
 */
export function pickSample<T>(items: T[], seed: string, n = VERIFY_SAMPLE_SIZE): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const idx = items.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, n).map((i) => items[i]!);
}

/**
 * Internal consistency of a payload's own numbers. A client can't shrink `commitsAnalyzed`
 * to make a few public commits look like full coverage without contradicting the per-language
 * counts it also reports. Returns flags; any flag means the scan can't be verified.
 */
export function payloadConsistencyFlags(p: {
  commitsAnalyzed: number;
  evidence: { commits: unknown[] };
  stackBreakdown: { verifiedCommits: number }[];
  languageTimeline: { commits: number }[];
}): string[] {
  const flags: string[] = [];
  const total = p.commitsAnalyzed;
  const perLanguage = [...p.stackBreakdown.map((s) => s.verifiedCommits), ...p.languageTimeline.map((t) => t.commits)];
  if (p.evidence.commits.length > total || perLanguage.some((n) => n > total)) flags.push('evidence-inconsistent');
  return flags;
}
