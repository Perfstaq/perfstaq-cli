# perfstaq

Turn your real git history and AI coding sessions into a developer profile a client can verify.

```bash
npx perfstaq scan
```

Run it in the folder that holds your repos (add `--all` to include sibling repos). It takes about 10 seconds and needs Node 20+.

## What it does

- Reads **your own** git commits (matched by `git config user.email`) across full history.
- Counts your Claude Code, Cursor and Codex sessions. Message text is never read.
- Prints a scorecard: engineering rigor, AI code survival, stack complexity, years of experience per language, and achievement cards.
- If you choose to upload, you sign in with GitHub in the browser. With your OK, commit IDs from your **public** GitHub repos are sent so the server can check them on GitHub. That check decides your trust seal.

No source code, file paths, commit messages or prompts leave your machine.

## Options

| Flag | What it does |
|---|---|
| `--all` | Also scan sibling git repos |
| `--demo` | Sample data; reads nothing, uploads nothing |
| `--no-upload` | Scorecard only |
| `--evidence` / `--no-evidence` | Share public commit IDs for verification, or don't (skips the question) |
| `--email <addr>` | Another git email that is yours (repeatable) |
| `--json` | Print the signed payload |
| `-y, --yes` | Upload without the first question |

## Privacy

See the privacy page on the Perfstaq site for the full list of what is read and what is uploaded. You can delete your profile and every scan from your profile page at any time.
