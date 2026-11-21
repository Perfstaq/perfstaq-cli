import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  topPercent,
  BENCHMARK_SCORES,
  BENCHMARK_SIZE,
  payloadConsistencyFlags,
  computeTrustTier,
  deriveAchievements,
  linesMatch,
  pickSample,
  canonicalize,
  computeScan,
  demoScanInput,
  DEMO_MACHINE_FINGERPRINT,
  isBoilerplatePath,
  isTestPath,
  languageFromPath,
  signPayload,
  validateScanPayload,
  verifyIntegrity,
  type ScanInput,
} from './index.js';

const meta = { cliVersion: '0.1.0', machineFingerprint: DEMO_MACHINE_FINGERPRINT };

test('demo scan is deterministic and in range', async () => {
  const a = computeScan(demoScanInput(), meta);
  const b = computeScan(demoScanInput(), meta);
  assert.deepEqual(a, b);
  assert.ok(a.overallScore > 0 && a.overallScore <= 1000);
  assert.ok(a.rolling30dScore > 0 && a.rolling30dScore <= 1000);
  assert.equal(a.aiToolsDetected.primaryTool, 'Hybrid');
  assert.equal(a.stackBreakdown[0]?.language, 'TypeScript');
  const signed = await signPayload(a);
  assert.equal(validateScanPayload(signed).ok, true);
});

test('integrity hash detects tampering', async () => {
  const signed = await signPayload(computeScan(demoScanInput(), meta));
  assert.equal(await verifyIntegrity(signed), true);
  assert.equal(await verifyIntegrity({ ...signed, overallScore: 999 }), signed.overallScore === 999);
  assert.equal(await verifyIntegrity({ ...signed, integrityHash: 'x' }), false);
});

test('canonicalize sorts keys recursively', () => {
  assert.equal(canonicalize({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
});

test('empty input scores zero without NaN', () => {
  const input: ScanInput = {
    commits: [],
    reposAnalyzed: 0,
    now: 1_800_000_000,
    ai: {
      claudeCode: { detected: false, sessions: 0, toolCalls: 0, editToolCalls: 0, prompts: 0 },
      cursor: { detected: false, sessions: 0, suggestionsShown: 0, suggestionsAccepted: 0 },
      codex: { detected: false, sessions: 0, toolCalls: 0 },
    },
  };
  const p = computeScan(input, meta);
  assert.equal(p.overallScore, 0);
  assert.equal(p.aiToolsDetected.primaryTool, 'Git-Only');
  // No NaN/Infinity anywhere (JSON turns those into null); evidence.nonce is legitimately null.
  assert.equal(JSON.stringify({ ...p, evidence: undefined }).includes('null'), false);
});

test('path helpers', () => {
  assert.equal(languageFromPath('src/app/page.tsx')?.framework, 'React');
  assert.equal(languageFromPath('Makefile'), null);
  assert.ok(isTestPath('src/foo.test.ts'));
  assert.ok(isTestPath('pkg/foo_test.go'));
  assert.ok(isTestPath('tests/test_api.py'));
  assert.ok(!isTestPath('src/contest.ts'));
  assert.ok(isBoilerplatePath('pnpm-lock.yaml'));
  assert.ok(isBoilerplatePath('node_modules/x/index.js'));
  assert.ok(!isBoilerplatePath('src/index.ts'));
});

test('test-heavy input classifies as Test-Driven Purist', () => {
  const now = 1_800_000_000;
  const commits = Array.from({ length: 40 }, (_, i) => ({
    timestamp: now - i * 86_400,
    isRevert: false,
    aiAssisted: false,
    churnedLines24h: 0,
    files: [
      { language: 'Python', added: 20, deleted: 2, isTest: false, depth: 1 },
      { language: 'Python', added: 40, deleted: 0, isTest: true, depth: 1 },
    ],
  }));
  const p = computeScan({ commits, reposAnalyzed: 1, now, ai: demoScanInput().ai }, meta);
  assert.equal(p.archetype, 'Test-Driven Purist');
});

test('trust tiers', () => {
  assert.equal(computeTrustTier({ checked: 12, matched: 12, signed: 10, flags: [] }), 'signed');
  assert.equal(computeTrustTier({ checked: 12, matched: 11, signed: 2, flags: [] }), 'github-verified');
  assert.equal(computeTrustTier({ checked: 12, matched: 8, signed: 0, flags: [] }), 'self-reported');
  assert.equal(computeTrustTier({ checked: 3, matched: 3, signed: 3, flags: [] }), 'self-reported');
  assert.equal(computeTrustTier({ checked: 12, matched: 12, signed: 12, flags: ['commit-mismatch'] }), 'self-reported');
  assert.ok(linesMatch(100, 101) && !linesMatch(100, 140));
  // Coverage: 12/12 matched but evidence covers only 40 of 500 claimed commits -> self-reported.
  assert.equal(computeTrustTier({ checked: 12, matched: 12, signed: 0, flags: [], evidenceCommits: 40, commitsAnalyzed: 500 }), 'self-reported');
  assert.equal(computeTrustTier({ checked: 12, matched: 12, signed: 0, flags: [], evidenceCommits: 400, commitsAnalyzed: 500 }), 'github-verified');
  assert.equal(computeTrustTier({ checked: 12, matched: 12, signed: 0, flags: [], evidenceCommits: 1000, commitsAnalyzed: 9000 }), 'github-verified');
  // Tiny evidence can't verify even at 100% "coverage" (client claims 8 commits total).
  assert.equal(computeTrustTier({ checked: 8, matched: 8, signed: 0, flags: [], evidenceCommits: 8, commitsAnalyzed: 8 }), 'self-reported');
  // Any lookup GitHub couldn't answer blocks a verified tier.
  assert.equal(computeTrustTier({ checked: 12, matched: 11, signed: 0, flags: ['github-unavailable'], evidenceCommits: 400, commitsAnalyzed: 500 }), 'self-reported');
});

test('sample is seeded by nonce and stable', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  assert.deepEqual(pickSample(items, 'nonce-a'), pickSample(items, 'nonce-a'));
  assert.notDeepEqual(pickSample(items, 'nonce-a'), pickSample(items, 'nonce-b'));
  assert.equal(new Set(pickSample(items, 'x')).size, 12);
});

test('demo has timeline and achievements', async () => {
  const p = await signPayload(computeScan(demoScanInput(), meta));
  assert.ok(p.languageTimeline.length >= 3);
  assert.ok(p.languageTimeline[0]!.firstCommitAt < p.languageTimeline[0]!.lastCommitAt);
  assert.equal(p.aiToolsDetected.codex, true);
  const cards = deriveAchievements(p, { tier: 'github-verified', topPercent: 3 });
  const ids = cards.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('percentile') && ids.includes('archetype') && ids.some((i) => i.startsWith('experience-')));
  assert.equal(validateScanPayload(p).ok, true);
});

test('consistency: shrunk commit total contradicts per-language counts', () => {
  const base = { evidence: { commits: [] as unknown[] }, stackBreakdown: [{ verifiedCommits: 40 }], languageTimeline: [{ commits: 300 }] };
  assert.deepEqual(payloadConsistencyFlags({ ...base, commitsAnalyzed: 500 }), []);
  assert.deepEqual(payloadConsistencyFlags({ ...base, commitsAnalyzed: 20 }), ['evidence-inconsistent']);
});

test('percentile: exact, against benchmark + real developers', () => {
  assert.equal(BENCHMARK_SIZE, 1000);
  assert.equal(topPercent(1000), 1);
  assert.equal(topPercent(0), null);
  assert.equal(topPercent(100), null); // below the top half: no label
  const median = BENCHMARK_SCORES[500]!;
  assert.ok((topPercent(median + 1) ?? 0) >= 45 && (topPercent(median + 1) ?? 0) <= 50);
  // Being the only real user doesn't make you Top 1%.
  assert.equal(topPercent(median + 1, [median + 1]), topPercent(median + 1));
  // Real developers above you push you down.
  const p90 = BENCHMARK_SCORES[900]!;
  const alone = topPercent(p90)!;
  assert.ok(topPercent(p90, Array(200).fill(999))! > alone);
  // Monotonic: higher score, never a worse label.
  for (let s = 600; s < 1000; s += 7) assert.ok((topPercent(s + 7) ?? 99) <= (topPercent(s) ?? 99));
});
