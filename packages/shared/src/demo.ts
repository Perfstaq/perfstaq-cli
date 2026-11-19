import type { AnonCommit, CommitFile, ScanInput } from './types.js';

/** mulberry32: tiny deterministic PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_MIX: { language: string; framework?: string; weight: number }[] = [
  { language: 'TypeScript', framework: 'React', weight: 0.46 },
  { language: 'Python', weight: 0.22 },
  { language: 'Rust', weight: 0.16 },
  { language: 'Go', weight: 0.1 },
  { language: 'SQL', weight: 0.06 },
];

/** Fixed demo clock so `--demo` output is identical on every run: 2026-11-01T00:00:00Z. */
export const DEMO_NOW = 1_793_491_200;

/**
 * Realistic, deterministic sample input for `perfstaq scan --demo`.
 * ~3 years (denser in the last 6 months) of a Hybrid (Claude Code + Cursor) polyglot developer.
 */
export function demoScanInput(seed = 42, now = DEMO_NOW): ScanInput {
  const rand = prng(seed);
  const pick = () => {
    let r = rand();
    for (const m of DEMO_MIX) {
      if ((r -= m.weight) <= 0) return m;
    }
    return DEMO_MIX[0]!;
  };

  const commits: AnonCommit[] = [];
  for (let day = 3 * 365; day >= 0; day--) {
    if (rand() < (day > 180 ? 0.75 : 0.28)) continue; // days off (sparser in older history)
    const perDay = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < perDay; k++) {
      const ts = now - day * 86_400 + Math.floor(rand() * 50_000);
      const nFiles = rand() < 0.25 ? 3 + Math.floor(rand() * 6) : 1 + Math.floor(rand() * 2);
      const isRefactor = nFiles >= 3 && rand() < 0.6;
      const files: CommitFile[] = [];
      for (let f = 0; f < nFiles; f++) {
        const m = pick();
        const added = 5 + Math.floor(rand() * 90);
        const isTest = rand() < 0.24;
        const file: CommitFile = {
          language: m.language,
          added,
          deleted: isRefactor ? Math.floor(added * (0.4 + rand() * 0.6)) : Math.floor(rand() * added * 0.2),
          isTest,
          depth: 1 + Math.floor(rand() * 5),
        };
        if (m.framework) file.framework = m.framework;
        files.push(file);
      }
      const added = files.reduce((s, f) => s + f.added, 0);
      const aiAssisted = rand() < 0.62;
      const churnedLines24h = aiAssisted && rand() < 0.18 ? Math.floor(added * (0.2 + rand() * 0.5)) : rand() < 0.05 ? Math.floor(added * 0.3) : 0;
      commits.push({ timestamp: ts, isRevert: rand() < 0.015, aiAssisted, churnedLines24h, files });
    }
  }

  return {
    commits,
    reposAnalyzed: 4,
    now,
    ai: {
      claudeCode: { detected: true, sessions: 214, toolCalls: 214 * 23, editToolCalls: 214 * 8, prompts: 214 * 6 },
      cursor: { detected: true, sessions: 131, suggestionsShown: 18_400, suggestionsAccepted: 6_900 },
      codex: { detected: true, sessions: 38, toolCalls: 38 * 14 },
    },
  };
}

/** Demo fingerprint: sha256("perfstaq-demo-machine"). Fixed so demo hashes are reproducible. */
export const DEMO_MACHINE_FINGERPRINT = '7bc532f42ffd0a6b5a9560a2a0619a543eac7cb4d145d57b07392c21a7444429';
