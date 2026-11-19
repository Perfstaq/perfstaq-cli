// Bundles the CLI with @perfstaq/shared inlined, so the published package has no
// workspace-only dependencies. Real npm deps stay external and install normally.
// (The shebang comes from src/index.ts; esbuild keeps it.)
import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'bundle/perfstaq.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: Object.keys(pkg.dependencies ?? {}),
  legalComments: 'none',
});
chmodSync('bundle/perfstaq.js', 0o755);
