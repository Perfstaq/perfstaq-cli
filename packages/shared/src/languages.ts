import type { StackCategory } from './types.js';

const EXT: Record<string, { language: string; framework?: string }> = {
  ts: { language: 'TypeScript' },
  tsx: { language: 'TypeScript', framework: 'React' },
  mts: { language: 'TypeScript' },
  cts: { language: 'TypeScript' },
  js: { language: 'JavaScript' },
  jsx: { language: 'JavaScript', framework: 'React' },
  mjs: { language: 'JavaScript' },
  cjs: { language: 'JavaScript' },
  vue: { language: 'JavaScript', framework: 'Vue' },
  svelte: { language: 'JavaScript', framework: 'Svelte' },
  py: { language: 'Python' },
  ipynb: { language: 'Python', framework: 'Jupyter' },
  rs: { language: 'Rust' },
  go: { language: 'Go' },
  c: { language: 'C' },
  h: { language: 'C' },
  cc: { language: 'C++' },
  cpp: { language: 'C++' },
  cxx: { language: 'C++' },
  hpp: { language: 'C++' },
  zig: { language: 'Zig' },
  java: { language: 'Java' },
  kt: { language: 'Kotlin' },
  kts: { language: 'Kotlin' },
  swift: { language: 'Swift' },
  m: { language: 'Objective-C' },
  mm: { language: 'Objective-C' },
  dart: { language: 'Dart', framework: 'Flutter' },
  rb: { language: 'Ruby' },
  php: { language: 'PHP' },
  cs: { language: 'C#' },
  scala: { language: 'Scala' },
  ex: { language: 'Elixir' },
  exs: { language: 'Elixir' },
  hs: { language: 'Haskell' },
  ml: { language: 'OCaml' },
  lua: { language: 'Lua' },
  sql: { language: 'SQL' },
  sh: { language: 'Shell' },
  bash: { language: 'Shell' },
  zsh: { language: 'Shell' },
  css: { language: 'CSS' },
  scss: { language: 'CSS' },
  html: { language: 'HTML' },
  sol: { language: 'Solidity' },
};

/** Map a file path to a language. Returns null for files we don't score. */
export function languageFromPath(path: string): { language: string; framework?: string } | null {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT[ext] ?? null;
}

const TEST_RE = /(\.|_)(test|spec)\.[a-z0-9]+$|(^|[\\/])(__tests__|tests?|spec)[\\/]|_test\.(go|py)$|^test_.*\.py$/i;

export function isTestPath(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? path;
  return TEST_RE.test(path) || /^test_.*\.py$/i.test(base);
}

const BOILERPLATE_RE =
  /(^|[\\/])(node_modules|vendor|dist|build|out|\.next|target|coverage|__generated__|generated|Pods|\.venv|venv)[\\/]|(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock)$|\.min\.(js|css)$|\.(map|snap|lock|pb\.go|g\.dart|freezed\.dart)$|_pb2\.py$/i;

/** Lockfiles, vendored, generated, and minified files. Excluded from all scoring. */
export function isBoilerplatePath(path: string): boolean {
  return BOILERPLATE_RE.test(path);
}

/** Directory depth of a path: "src/a/b.ts" -> 2. */
export function pathDepth(path: string): number {
  return Math.max(0, path.split(/[\\/]/).filter(Boolean).length - 1);
}

export const SYSTEMS_LANGUAGES = new Set(['Rust', 'Go', 'C', 'C++', 'Zig']);
const MOBILE_LANGUAGES = new Set(['Swift', 'Kotlin', 'Dart', 'Objective-C']);

export function stackCategory(language: string, framework?: string): StackCategory {
  if (framework === 'Flutter' || MOBILE_LANGUAGES.has(language)) return 'mobile';
  if (SYSTEMS_LANGUAGES.has(language)) return 'systems';
  if (language === 'Python') return 'python-ai';
  if (language === 'TypeScript' || language === 'JavaScript') return 'typescript-nextjs';
  return 'other';
}

export const STACK_CATEGORY_LABELS: Record<StackCategory, string> = {
  'typescript-nextjs': 'TypeScript / Next.js',
  'python-ai': 'Python / AI',
  systems: 'Systems (Rust/Go/C++)',
  mobile: 'Mobile',
  other: 'Other',
};
