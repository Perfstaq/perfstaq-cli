export * from './types.js';
import type { AiToolsDetected, StackEntry } from './types.js';

/** Signals the archetype classifier works from (all 0-1 ratios unless noted). */
export interface ArchetypeFeatures {
  refactorRatio: number;
  revertRate: number;
  testRatio: number;
  consistency: number;
  /** Absolute line count. */
  netSurvivingLines: number;
  aiSurvival: number;
  /** Absolute count. */
  toolCallsPerSession: number;
  tools: AiToolsDetected;
  systemsShare: number;
  typescriptShare: number;
  /** Absolute directory depth. */
  avgDepth: number;
  stack: StackEntry[];
}
