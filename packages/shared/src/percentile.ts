/**
 * Standing as a percentile instead of a rank: "Top 3%".
 * Percentile rank = (rank - 0.5) / total, snapped UP to the nearest bucket so nobody is
 * shown better than they are. The bottom half gets no label (just "Verified").
 */
export const TOP_BUCKETS = [1, 3, 5, 10, 25, 50] as const;
export type TopBucket = (typeof TOP_BUCKETS)[number];

export function topPercent(rank: number, total: number): TopBucket | null {
  if (!(rank > 0) || !(total > 0) || rank > total) return null;
  const pct = ((rank - 0.5) / total) * 100;
  return TOP_BUCKETS.find((b) => pct <= b) ?? null;
}

export function formatTop(top: number | null | undefined): string | null {
  return top ? `Top ${top}%` : null;
}
