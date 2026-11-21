import { BENCHMARK } from './benchmark-data.js';

/**
 * Standing as an exact percentile instead of a rank: "Top 1%", "Top 2%", "Top 17%".
 *
 * Measured against a fixed reference population (BENCHMARK: 1,000 synthetic developer
 * histories across web, backend, AI, systems, mobile and data; junior to senior; every AI
 * tool, scored with the same engine) PLUS every real verified developer. So the first person
 * to sign up is placed where their work actually lands, not at "#1 of 1".
 *
 * Top X% = share of the pool that scored strictly higher, plus half of you, rounded UP so
 * nobody is shown better than they are. Below the top half there's no label.
 */
export const BENCHMARK_SCORES: readonly number[] = BENCHMARK.map((b) => b[0]).sort((a, b) => a - b);
export const BENCHMARK_SIZE = BENCHMARK_SCORES.length;
export const MAX_LABELLED_PERCENT = 50;

/** How many sorted-ascending scores are strictly greater than `score`. */
function countAbove(sorted: readonly number[], score: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= score) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length - lo;
}

/**
 * @param score  the developer's overall score (0-1000)
 * @param realScores  overall scores of real verified developers (may include this developer)
 */
export function topPercent(score: number, realScores: readonly number[] = []): number | null {
  if (!(score > 0)) return null;
  const above = countAbove(BENCHMARK_SCORES, score) + realScores.filter((s) => s > score).length;
  const pool = BENCHMARK_SIZE + realScores.length + (realScores.includes(score) ? 0 : 1);
  const pct = Math.max(1, Math.ceil(((above + 0.5) / pool) * 100));
  return pct <= MAX_LABELLED_PERCENT ? pct : null;
}

export function formatTop(top: number | null | undefined): string | null {
  return top ? `Top ${top}%` : null;
}
