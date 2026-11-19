import { ARCHETYPES } from './archetype.js';
import type { ScanPayload } from './types.js';

const TOOLS = ['Claude Code', 'Cursor', 'Codex', 'Hybrid', 'Git-Only'];
export const MAX_EVIDENCE_COMMITS = 1000;
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ValidationResult = { ok: true; payload: ScanPayload } | { ok: false; errors: string[] };

/** Structural validation for an uploaded payload (no deps; server and client safe). */
export function validateScanPayload(input: unknown): ValidationResult {
  const errors: string[] = [];
  const p = input as Record<string, any>;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, errors: ['payload must be an object'] };

  const num = (path: string, v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) errors.push(`${path} must be a number in [${min}, ${max}]`);
  };
  const str = (path: string, v: unknown, max = 200) => {
    if (typeof v !== 'string' || v.length === 0 || v.length > max) errors.push(`${path} must be a non-empty string (max ${max})`);
  };

  if (p.schemaVersion !== 2) errors.push('schemaVersion must be 2 (update the CLI: npx perfstaq@latest scan)');
  str('cliVersion', p.cliVersion, 32);
  if (typeof p.machineFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(p.machineFingerprint)) errors.push('machineFingerprint must be sha256 hex');
  if (typeof p.integrityHash !== 'string' || !/^[0-9a-f]{64}$/.test(p.integrityHash)) errors.push('integrityHash must be sha256 hex');
  if (typeof p.generatedAt !== 'string' || Number.isNaN(Date.parse(p.generatedAt))) errors.push('generatedAt must be an ISO date');
  num('overallScore', p.overallScore, 0, 1000);
  num('rolling30dScore', p.rolling30dScore, 0, 1000);
  num('reposAnalyzed', p.reposAnalyzed, 0, 10_000);
  num('commitsAnalyzed', p.commitsAnalyzed, 0, 1_000_000);

  const ss = p.subScores ?? {};
  for (const k of ['rigor', 'aiSurvival', 'stackComplexity']) num(`subScores.${k}`, ss[k], 0, 1000);

  if (!Array.isArray(p.stackBreakdown) || p.stackBreakdown.length > 20) {
    errors.push('stackBreakdown must be an array of at most 20 entries');
  } else {
    p.stackBreakdown.forEach((s: any, i: number) => {
      str(`stackBreakdown[${i}].language`, s?.language, 40);
      if (s?.framework !== undefined) str(`stackBreakdown[${i}].framework`, s.framework, 40);
      num(`stackBreakdown[${i}].percentage`, s?.percentage, 0, 100);
      num(`stackBreakdown[${i}].stackRating`, s?.stackRating, 0, 100);
      num(`stackBreakdown[${i}].verifiedCommits`, s?.verifiedCommits, 0, 1_000_000);
    });
  }

  const t = p.aiToolsDetected ?? {};
  if (typeof t.claudeCode !== 'boolean' || typeof t.cursor !== 'boolean' || typeof t.codex !== 'boolean') errors.push('aiToolsDetected.claudeCode/cursor/codex must be booleans');
  if (!TOOLS.includes(t.primaryTool)) errors.push(`aiToolsDetected.primaryTool must be one of ${TOOLS.join(', ')}`);

  const r = p.rigorMetrics ?? {};
  num('rigorMetrics.testCoverageDelta', r.testCoverageDelta, 0, 10_000);
  num('rigorMetrics.revertRate24h', r.revertRate24h, 0, 100);
  num('rigorMetrics.avgFilesPerCommit', r.avgFilesPerCommit, 0, 10_000);
  num('rigorMetrics.refactorRatio', r.refactorRatio, 0, 100);

  const a = p.aiMetrics ?? {};
  num('aiMetrics.aiSurvivalRate', a.aiSurvivalRate, 0, 100);
  num('aiMetrics.humanEditRatio', a.humanEditRatio, 0, 100);
  num('aiMetrics.agentSessionsAnalyzed', a.agentSessionsAnalyzed, 0, 10_000_000);
  num('aiMetrics.toolCallsPerSession', a.toolCallsPerSession, 0, 100_000);

  if (!ARCHETYPES.some((x) => x.name === p.archetype)) errors.push('archetype is not a known archetype');

  if (!Array.isArray(p.languageTimeline) || p.languageTimeline.length > 20) {
    errors.push('languageTimeline must be an array of at most 20 entries');
  } else {
    p.languageTimeline.forEach((l: any, i: number) => {
      str(`languageTimeline[${i}].language`, l?.language, 40);
      if (!DAY_RE.test(l?.firstCommitAt ?? '') || !DAY_RE.test(l?.lastCommitAt ?? '') || l.firstCommitAt > l.lastCommitAt) {
        errors.push(`languageTimeline[${i}] dates must be YYYY-MM-DD with first <= last`);
      }
      num(`languageTimeline[${i}].activeMonths`, l?.activeMonths, 0, 1200);
      num(`languageTimeline[${i}].commits`, l?.commits, 0, 1_000_000);
    });
  }

  const ev = p.evidence;
  if (!ev || typeof ev !== 'object') {
    errors.push('evidence must be an object');
  } else {
    if (ev.nonce !== null && (typeof ev.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(ev.nonce))) errors.push('evidence.nonce must be null or a token');
    if (!Array.isArray(ev.commits) || ev.commits.length > MAX_EVIDENCE_COMMITS) {
      errors.push(`evidence.commits must be an array of at most ${MAX_EVIDENCE_COMMITS}`);
    } else {
      const seen = new Set<string>();
      ev.commits.forEach((c: any, i: number) => {
        if (!REPO_RE.test(c?.repo ?? '')) errors.push(`evidence.commits[${i}].repo must be owner/repo`);
        if (!SHA_RE.test(c?.sha ?? '')) errors.push(`evidence.commits[${i}].sha must be a 40-char hex sha`);
        else if (seen.has(c.sha)) errors.push(`evidence.commits[${i}].sha is duplicated`);
        else seen.add(c.sha);
        num(`evidence.commits[${i}].additions`, c?.additions, 0, 10_000_000);
        num(`evidence.commits[${i}].deletions`, c?.deletions, 0, 10_000_000);
      });
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, payload: p as ScanPayload };
}
