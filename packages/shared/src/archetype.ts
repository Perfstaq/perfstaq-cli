import type { Archetype, ArchetypeFeatures } from './internal-types.js';

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export interface ArchetypeInfo {
  name: Archetype;
  /** lucide-react icon name. */
  icon: 'Scissors' | 'Network' | 'FlaskConical' | 'Rocket' | 'Cpu' | 'Layers';
  tagline: string;
  traits: string[];
  /** Tailwind-friendly accent hue name. */
  accent: 'violet' | 'cyan' | 'emerald' | 'amber' | 'rose' | 'sky';
}

/** Order is the tie-break order. */
export const ARCHETYPES: readonly ArchetypeInfo[] = [
  {
    name: 'Surgical Architect',
    icon: 'Scissors',
    tagline: 'Deep, careful refactors that stick.',
    traits: ['High multi-file refactor depth', 'Very low 24h revert rate', 'Changes land once and stay landed'],
    accent: 'violet',
  },
  {
    name: 'Multi-Agent Orchestrator',
    icon: 'Network',
    tagline: 'Runs AI agents like a well-tuned build system.',
    traits: ['Runs several AI coding agents together', 'Efficient tool calls per agent session', 'AI output survives review'],
    accent: 'cyan',
  },
  {
    name: 'Test-Driven Purist',
    icon: 'FlaskConical',
    tagline: 'Tests first, tests always.',
    traits: ['High test-to-source line ratio', 'Tests ship in the same commits as code', 'Low regression churn'],
    accent: 'emerald',
  },
  {
    name: '10x Velocity Shipper',
    icon: 'Rocket',
    tagline: 'Ships a lot, and it survives.',
    traits: ['High net surviving lines', 'Commits on most days', 'Volume without slop'],
    accent: 'amber',
  },
  {
    name: 'Systems Craftsman',
    icon: 'Cpu',
    tagline: 'Lives close to the metal.',
    traits: ['Heavy Rust / Go / C++ footprint', 'Deep module hierarchies', 'Typed, structured codebases'],
    accent: 'rose',
  },
  {
    name: 'Full-Stack Polymath',
    icon: 'Layers',
    tagline: 'Strong across three or more stacks.',
    traits: ['3+ stacks rated 60 or higher', 'Balanced language spread', 'Moves between layers fluently'],
    accent: 'sky',
  },
] as const;

export function archetypeInfo(name: Archetype): ArchetypeInfo {
  return ARCHETYPES.find((a) => a.name === name) ?? ARCHETYPES[0]!;
}

/** Per-archetype affinity scores, 0-1. Exposed for tests and the profile page. */
export function archetypeScores(f: ArchetypeFeatures): Record<Archetype, number> {
  const strongStacks = f.stack.filter((s) => s.stackRating >= 60 && s.percentage >= 8);
  const top3 = [...strongStacks].sort((a, b) => b.stackRating - a.stackRating).slice(0, 3);
  const usesAgents = f.tools.claudeCode || f.tools.cursor || f.tools.codex;

  return {
    'Surgical Architect': 0.6 * clamp01(f.refactorRatio / 0.35) + 0.4 * (1 - clamp01(f.revertRate / 0.1)),
    'Multi-Agent Orchestrator': usesAgents
      ? (f.tools.primaryTool === 'Hybrid' ? 1 : 0.75) *
        (0.5 * clamp01(f.toolCallsPerSession / 25) + 0.5 * f.aiSurvival)
      : 0,
    'Test-Driven Purist': clamp01(f.testRatio / 0.4),
    '10x Velocity Shipper': 0.6 * clamp01(f.netSurvivingLines / 20_000) + 0.4 * f.consistency,
    'Systems Craftsman':
      clamp01((f.systemsShare + 0.4 * f.typescriptShare) / 0.6) * (0.6 + 0.4 * clamp01(f.avgDepth / 5)),
    'Full-Stack Polymath':
      top3.length >= 3 ? top3.reduce((s, e) => s + e.stackRating, 0) / 300 : 0,
  };
}

export function classifyArchetype(f: ArchetypeFeatures): Archetype {
  const scores = archetypeScores(f);
  let best: Archetype = ARCHETYPES[0]!.name;
  let bestScore = -1;
  for (const a of ARCHETYPES) {
    const s = Math.round(scores[a.name] * 1e6); // avoid float-noise flips
    if (s > bestScore) {
      best = a.name;
      bestScore = s;
    }
  }
  return best;
}
