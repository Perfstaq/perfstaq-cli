# perfstaq

The open-source scanner behind [Perfstaq](https://rank.perfstaq.com): it turns your real git history and AI coding sessions into a developer profile a client can verify.

```bash
npx perfstaq scan
```

This repository is everything that runs on your machine, published so you can check our privacy claims instead of trusting them.

## What it reads, and what leaves your machine

| Read locally | Uploaded |
|---|---|
| Your own git commits (matched by `git config user.email`): per-file line counts, test-file share, reverts, churn | Scores, ratios, language shares and experience dates |
| Counts of Claude Code, Cursor and Codex sessions and tool calls; message text is never read | Session counts only |
| Commit IDs and line counts in **public** github.com repos | Only if you say yes, so the server can check them on GitHub |

Source code, file paths, commit messages and prompts are never uploaded. Search `packages/cli/src/collectors` to confirm.

## Layout

| Path | What it is |
|---|---|
| `packages/cli` | The `perfstaq` command: collectors, terminal scorecard, browser sign-in, upload |
| `packages/shared` | Scoring engine, archetypes, achievements, integrity hash, payload validation, trust-tier rules |

## Build from source

```bash
pnpm install
pnpm build
node packages/cli/bundle/perfstaq.js scan --demo
```

`packages/cli/bundle/perfstaq.js` is the exact file published to npm.

## How verification works

The server picks a random sample of the commits you shared and looks each one up on GitHub: it must exist, be authored by your GitHub account, and match the line counts you reported. The rules that turn that into a trust tier are in `packages/shared/src/trust.ts`.

## License

MIT
