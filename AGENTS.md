# Project Rules

## Goal

Maintain a GitHub profile README and a privacy-conscious Codex activity heatmap generated from local `ccusage` data.

## Safety

- Never commit `codex.json`, Codex session logs, credentials, tokens, private URLs, or machine-specific secrets.
- Commit only the generated `codex-heatmap.svg`; exact token counts must remain hidden unless the owner explicitly opts in.
- Keep Git automation limited to staging `codex-heatmap.svg`, creating a normal commit, and pushing the current branch.
- Do not use destructive Git commands or force pushes.

## Maintenance

- Keep the generator dependency-free and compatible with current Node.js LTS.
- Pin the `ccusage` version used by automation and document how to update it.
- Any failure message must state the likely cause and the next corrective action.
- Validate generated SVG and scan public files for sensitive content before delivery.

