// Generates the standing benchmark: 1,000 synthetic developer histories across sectors,
// AI tools and experience levels, scored with the real engine. Only scores are kept —
// no names, no profiles. Percentiles are measured against benchmark + real developers.
//   node scripts/generate-benchmark.mjs   (from packages/shared, after `pnpm build`)
import { writeFileSync } from 'node:fs';
import { computeScan, prng, stackCategory } from '../dist/index.js';

const N = 1000;
const NOW = 1_795_000_000;
const rand = prng(20261121);
const r = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const SECTORS = [
  { name: 'web', mix: [['TypeScript', 'React', 0.55], ['JavaScript', null, 0.2], ['CSS', null, 0.15], ['SQL', null, 0.1]], w: 0.34 },
  { name: 'backend', mix: [['Go', null, 0.4], ['TypeScript', null, 0.3], ['SQL', null, 0.2], ['Shell', null, 0.1]], w: 0.14 },
  { name: 'python-ai', mix: [['Python', null, 0.75], ['TypeScript', null, 0.15], ['SQL', null, 0.1]], w: 0.2 },
  { name: 'systems', mix: [['Rust', null, 0.5], ['C++', null, 0.25], ['Go', null, 0.15], ['Python', null, 0.1]], w: 0.1 },
  { name: 'mobile', mix: [['Swift', null, 0.45], ['Kotlin', null, 0.35], ['Dart', 'Flutter', 0.2]], w: 0.12 },
  { name: 'data', mix: [['Python', 'Jupyter', 0.5], ['SQL', null, 0.4], ['Shell', null, 0.1]], w: 0.1 },
];
const LEVELS = [
  { name: 'junior', days: [60, 400], active: [0.15, 0.45], tests: [0, 0.12], churn: [0.08, 0.3], refactor: [0.02, 0.12], w: 0.35 },
  { name: 'mid', days: [300, 1100], active: [0.3, 0.65], tests: [0.05, 0.25], churn: [0.04, 0.18], refactor: [0.06, 0.22], w: 0.42 },
  { name: 'senior', days: [900, 2600], active: [0.45, 0.8], tests: [0.12, 0.4], churn: [0.01, 0.1], refactor: [0.12, 0.35], w: 0.23 },
];
const TOOLS = [
  ['Claude Code', { claude: [40, 400], cursor: [0, 0], codex: [0, 15] }, 0.32],
  ['Cursor', { claude: [0, 0], cursor: [40, 300], codex: [0, 0] }, 0.28],
  ['Hybrid', { claude: [30, 250], cursor: [30, 200], codex: [0, 60] }, 0.2],
  ['Codex', { claude: [0, 20], cursor: [0, 0], codex: [40, 250] }, 0.06],
  ['Git-Only', { claude: [0, 0], cursor: [0, 0], codex: [0, 0] }, 0.14],
];
const weighted = (items, wOf) => { let x = rand() * items.reduce((s, i) => s + wOf(i), 0); for (const i of items) if ((x -= wOf(i)) <= 0) return i; return items[0]; };

const out = [];
for (let n = 0; n < N; n++) {
  const sector = weighted(SECTORS, (s) => s.w);
  const level = weighted(LEVELS, (l) => l.w);
  const [toolName, sess] = weighted(TOOLS, (t) => t[2]);
  const days = Math.round(r(...level.days));
  const active = r(...level.active);
  const testShare = r(...level.tests);
  const churnP = r(...level.churn);
  const refactorP = r(...level.refactor);
  const aiShare = toolName === 'Git-Only' ? 0 : r(0.3, 0.85);
  const commits = [];
  for (let d = days; d >= 0; d--) {
    if (rand() > active * (d < 120 ? 1.1 : 0.7)) continue;
    const per = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < per; k++) {
      const multi = rand() < refactorP * 2;
      const nFiles = multi ? 3 + Math.floor(rand() * 5) : 1 + Math.floor(rand() * 2);
      const files = [];
      for (let f = 0; f < nFiles; f++) {
        const [language, framework] = weighted(sector.mix, (m) => m[2]);
        const added = 4 + Math.floor(rand() * 90);
        const file = { language, added, deleted: multi ? Math.floor(added * r(0.35, 1)) : Math.floor(added * r(0, 0.2)), isTest: rand() < testShare, depth: 1 + Math.floor(rand() * 5) };
        if (framework) file.framework = framework;
        files.push(file);
      }
      const added = files.reduce((s, f) => s + f.added, 0);
      const ai = rand() < aiShare;
      commits.push({ timestamp: NOW - d * 86400 + Math.floor(rand() * 50000), isRevert: rand() < churnP * 0.15, aiAssisted: ai, churnedLines24h: rand() < churnP ? Math.floor(added * r(0.2, 0.7)) : 0, files });
    }
  }
  const sc = (k) => Math.round(r(...sess[k]));
  const claude = sc('claude'), cursor = sc('cursor'), codex = sc('codex');
  const tc = Math.round(r(8, 30));
  const p = computeScan(
    {
      commits, reposAnalyzed: 1 + Math.floor(rand() * 6), now: NOW,
      ai: {
        claudeCode: { detected: claude > 0, sessions: claude, toolCalls: claude * tc, editToolCalls: claude * 6, prompts: claude * 5 },
        cursor: { detected: cursor > 0, sessions: cursor, suggestionsShown: cursor * 80, suggestionsAccepted: cursor * 30 },
        codex: { detected: codex > 0, sessions: codex, toolCalls: codex * tc },
      },
    },
    { cliVersion: 'benchmark', machineFingerprint: '0'.repeat(64) },
  );
  if (p.overallScore <= 0) { n--; continue; }
  const top = p.stackBreakdown[0];
  out.push([p.overallScore, p.rolling30dScore, top ? stackCategory(top.language, top.framework) : 'other', p.aiToolsDetected.primaryTool]);
}

const scores = out.map((o) => o[0]).sort((a, b) => a - b);
const q = (f) => scores[Math.floor(f * (scores.length - 1))];
console.log(`n=${scores.length} min=${scores[0]} p10=${q(0.1)} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)} p97=${q(0.97)} p99=${q(0.99)} max=${scores.at(-1)}`);
writeFileSync(
  new URL('../src/benchmark-data.ts', import.meta.url),
  `// GENERATED by scripts/generate-benchmark.mjs — do not edit.\n// 1,000 synthetic developer histories scored with the real engine: [overall, rolling30d, stackCategory, primaryTool].\n// No names or profiles; used only as the reference population for "Top X%".\nexport const BENCHMARK: readonly (readonly [number, number, string, string])[] = ${JSON.stringify(out)};\n`,
);
