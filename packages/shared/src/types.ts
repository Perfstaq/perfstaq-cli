/**
 * Perfstaq shared contracts.
 *
 * Two layers:
 *  - ScanInput: anonymised, local-only data produced by the CLI collectors.
 *    It never leaves the machine. It holds no file paths, no source, no prompts.
 *  - ScanPayload: the only thing uploaded. Scores, ratios, language shares, and
 *    an integrity hash.
 */

export type PrimaryTool = 'Claude Code' | 'Cursor' | 'Codex' | 'Hybrid' | 'Git-Only';

/**
 * How much of a profile the server could check for itself.
 *  - signed: commits checked on GitHub AND most are cryptographically signed (GitHub "Verified").
 *  - github-verified: a random sample of commits exists on GitHub, is authored by this account,
 *    and matches the reported line counts.
 *  - self-reported: nothing the server could check (private repos, too few public commits,
 *    or the check failed). Signed locally only.
 */
export type TrustTier = 'signed' | 'github-verified' | 'self-reported';

export type Archetype =
  | 'Surgical Architect'
  | 'Multi-Agent Orchestrator'
  | 'Test-Driven Purist'
  | '10x Velocity Shipper'
  | 'Systems Craftsman'
  | 'Full-Stack Polymath';

/** Leaderboard "By Stack" filter buckets. */
export type StackCategory = 'typescript-nextjs' | 'python-ai' | 'systems' | 'mobile' | 'other';

// ---------------------------------------------------------------------------
// Local-only input (CLI -> scoring engine)
// ---------------------------------------------------------------------------

export interface CommitFile {
  /** Language name from languageFromPath(), e.g. "TypeScript". */
  language: string;
  framework?: string;
  added: number;
  deleted: number;
  isTest: boolean;
  /** Directory depth of the file (src/a/b.ts -> 2). The path itself is discarded. */
  depth: number;
}

export interface AnonCommit {
  /** Unix seconds. */
  timestamp: number;
  /** Commit is a revert ("Revert ..." subject or `This reverts commit`). */
  isRevert: boolean;
  /** Commit was AI-assisted (Co-Authored-By trailer, or inside an AI session window). */
  aiAssisted: boolean;
  /** Lines added by this commit that were deleted again within 24h (computed locally). */
  churnedLines24h: number;
  /** Non-boilerplate files only (no lockfiles, generated, vendored, or binary files). */
  files: CommitFile[];
}

export interface ClaudeCodeSignals {
  detected: boolean;
  sessions: number;
  /** Total tool_use blocks across sessions. */
  toolCalls: number;
  /** Edit / Write / MultiEdit / NotebookEdit tool calls. */
  editToolCalls: number;
  /** User turns (counted, never read). */
  prompts: number;
}

export interface CursorSignals {
  detected: boolean;
  sessions: number;
  suggestionsShown: number;
  suggestionsAccepted: number;
}

export interface CodexSignals {
  detected: boolean;
  sessions: number;
  toolCalls: number;
}

export interface AiSignals {
  claudeCode: ClaudeCodeSignals;
  /** Cursor sessions include both workspaceStorage chats and ~/.cursor/projects agent transcripts. */
  cursor: CursorSignals;
  codex: CodexSignals;
}

export interface ScanInput {
  /** Only the developer's OWN commits (filtered by their git author emails). */
  commits: AnonCommit[];
  ai: AiSignals;
  reposAnalyzed: number;
  /** Unix seconds; "now" is injected so scoring is deterministic. */
  now: number;
}

// ---------------------------------------------------------------------------
// Uploaded payload
// ---------------------------------------------------------------------------

export interface StackEntry {
  language: string;
  framework?: string;
  /** Share of non-boilerplate lines added, 0-100 (one decimal). */
  percentage: number;
  /** 0-100. */
  stackRating: number;
  verifiedCommits: number;
}

export interface AiToolsDetected {
  claudeCode: boolean;
  cursor: boolean;
  codex: boolean;
  primaryTool: PrimaryTool;
}

/** Per-language experience span, from the developer's own commits across full history. */
export interface LanguageTimeline {
  language: string;
  /** YYYY-MM-DD (UTC) of the first own commit touching this language. */
  firstCommitAt: string;
  lastCommitAt: string;
  /** Distinct calendar months with at least one own commit in this language. */
  activeMonths: number;
  commits: number;
}

/**
 * One commit the server can look up on GitHub. Only commits in repos whose
 * origin is github.com are included, and only when the user opts in.
 */
export interface CommitEvidence {
  /** "owner/repo" from the github.com origin remote. */
  repo: string;
  /** Full 40-char SHA. */
  sha: string;
  /** Raw numstat totals over ALL files (binary = 0), to compare with GitHub's commit stats. */
  additions: number;
  deletions: number;
}

export interface ScanEvidence {
  /** One-time code from POST /api/scans/nonce. null for offline / demo scans. */
  nonce: string | null;
  /** Every own commit in public-origin GitHub repos (capped). The server spot-checks a random sample. */
  commits: CommitEvidence[];
}

/** Server-side verification outcome (stored with the scan; never sent by the CLI). */
export interface VerificationResult {
  tier: TrustTier;
  /** Commits the server looked up on GitHub. */
  checked: number;
  /** Of those: exist, authored by this GitHub account, and line counts match. */
  matched: number;
  /** Of matched: GitHub marks them "Verified" (GPG/SSH signed). */
  signed: number;
  githubAccountCreatedAt: string | null;
  /** Machine-readable warnings, e.g. "new-github-account", "score-jump", "commit-mismatch". */
  flags: string[];
  verifiedAt: string;
}

export interface RigorMetrics {
  /** Test lines added per 100 source lines added, as a percentage (0-100+, one decimal). */
  testCoverageDelta: number;
  /** Share of commits reverted or heavily churned within 24h, 0-100 (one decimal). */
  revertRate24h: number;
  avgFilesPerCommit: number;
  /** Share of commits that are multi-file refactors, 0-100 (one decimal). */
  refactorRatio: number;
}

export interface AiMetrics {
  /** Share of AI-assisted lines still present after 24h, 0-100 (one decimal). */
  aiSurvivalRate: number;
  /** Share of lines added by human-only commits, 0-100 (one decimal). */
  humanEditRatio: number;
  agentSessionsAnalyzed: number;
  toolCallsPerSession: number;
}

export interface SubScores {
  /** Each 0-1000. */
  rigor: number;
  aiSurvival: number;
  stackComplexity: number;
}

export interface ScanPayload {
  schemaVersion: 2;
  cliVersion: string;
  /** SHA-256 of a random per-machine salt. The salt itself never leaves the machine. */
  machineFingerprint: string;
  /** ISO timestamp. */
  generatedAt: string;
  overallScore: number;
  rolling30dScore: number;
  subScores: SubScores;
  stackBreakdown: StackEntry[];
  aiToolsDetected: AiToolsDetected;
  rigorMetrics: RigorMetrics;
  aiMetrics: AiMetrics;
  archetype: Archetype;
  reposAnalyzed: number;
  commitsAnalyzed: number;
  /** Own-commit experience span per language (top 8 by commits). */
  languageTimeline: LanguageTimeline[];
  evidence: ScanEvidence;
  integrityHash: string;
}

export type UnsignedScanPayload = Omit<ScanPayload, 'integrityHash'>;

// ---------------------------------------------------------------------------
// Product constants
// ---------------------------------------------------------------------------

export const LEADERBOARD_SIZE = 100;
/** Ranks every visitor can see. */
export const PUBLIC_RANK_LIMIT = 10;
/** Ranks shown blurred to locked visitors (11..PREVIEW_RANK_LIMIT). */
export const PREVIEW_RANK_LIMIT = 20;
export const CLI_CALLBACK_PORT = 54321;
