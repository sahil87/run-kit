# Intake: HexoKit brand prose (plan row C3a)

**Change**: 260911-mljj-hexokit-brand-prose
**Created**: 2026-09-12

## Origin

> Per fab/plans/sahil/26-09-10-hexokit-rebrand.md (updated 2026-09-12): split this PR (run-kit#950, change mvuv) into two. C3a ('hexokit-brand-prose', prose-only, zero runtime effect: README H1/tagline/identity prose -- badge URLs stay sahil87/run-kit until R2 -- docs/site/* identity lines + skill H1s, embedded cmd/rk/skill/*.md, docs/specs/* present-tense identity lines, memory hydrate) should be split out into its own PR and merged now. The remainder of #950 (app-identity half: command name, Electron name, bundle/asset prefix, config.yaml project name) becomes a new deferred item R0 for Phase 3 -- do not merge that half now, leave it on a separate branch/PR.

Split of an already-built and already-reviewed change. The content here is a strict subset of run-kit#950 (fab change `260911-mvuv-hexokit-brand-surfaces`), whose intake carries the full design, the token classification rule, and the SRAD record; that change's own pipeline review (0 must-fix) and Copilot review already covered these files. This intake records only what moved and what stayed behind. The plan doc's C3a row (2026-09-12) is the authority: *"Prose only, zero runtime effect … Nothing that changes a command name, an app name, a bundle, an asset, or a path."*

## Why

The app rename is the disruptive half of the rebrand (a new command name in `--version`/`--help`, a renamed macOS bundle, a renamed release asset, a moved Electron userData directory). Sahil deferred it to Phase 3 (row R0, sequenced immediately before the formula rename R1) so users are disrupted once, with the release bundle. The prose half has no runtime effect and is what Phase 2 needs now: X1's docs refresh pulls run-kit's README and `docs/site/**` into hexokit.com's `/docs/` tree, and C1 already changed the standards' mandated README blockquote and install-docs location, so this repo's README violates its governing standard until this lands.

## What Changes

Everything below is a byte-identical carry-over of the corresponding files from #950's head (`292c1488`), minus three app-identity fragments that were pulled back out and stay on #950 (see § Stays on R0). The token classification rule from `260911-mvuv-hexokit-brand-surfaces/intake.md` § What Changes governs every edit: product noun in prose → HexoKit; command/formula/roster tokens, paths, URLs, payload values, ASCII mockups, historical text → keep.

### 1. README.md
H1 → `HexoKit` (logo `alt="HexoKit logo"`, logo `src` URL unchanged); blockquote → `> Part of [HexoKit](https://hexokit.com) — see all projects there.` (C1's revised readme-extraction standard); badge lines untouched (`sahil87/run-kit`, → R2); tagline and every enumerated identity sentence → HexoKit (`## Why HexoKit?`, table header, hooks/HTTPS/desktop paragraphs, command-table descriptions); install one-liner `curl -fsSL https://hexokit.com/install | sh` + "Installs the entire HexoKit toolkit" per the revised install-composition Policy B. Command tokens, the `rk`-alias-of-`run-kit` formula fact, completion names, and the `shll.ai/run-kit/commands/` link stay.

### 2. docs/site/**
Identity prose → HexoKit in `install.md`, `agent-hooks.md`, `customizing-tmux.md`, `workflows.md`, `cron-schedule-kinds.md` (eyebrow `HexoKit · rk cron`); `install.md` curl host → `hexokit.com` (the `run-kit` tool argument is the roster name and stays). Every `run-kit <verb>` command line, path, URL, and the old-`rk`-formula history note stay. **`install.md` keeps `**Run Kit.app**` on both bundle-name lines** — the bundle is renamed by R0, not here.

### 3. Skill bundles (canonical + embedded)
`docs/site/skill.md` H1 → `# HexoKit skill`; each `docs/site/skill/<topic>.md` H1 → `# HexoKit skill: <topic>`; prose product mentions → HexoKit. `app/backend/cmd/rk/skill/*.md` are the byte-identical embedded copies (skill standard: `rk skill` stdout MUST equal the canonical file; `TestSkill*EmbedMatchesCanonical` drift-guards them), so they move with the canonical pages. No Go code changes.

### 4. docs/specs/**
The four H1s (`api`, `design`, `architecture`, `project-plan`), intro blockquotes, and "run-kit is/renders/owns…" identity sentences → HexoKit across 17 spec files plus `index.md` row descriptions. Build paths, JSON payload values, the `[run-kit request]` wire tag, repo-column table cells, ASCII mockups, and `docs/memory/run-kit/…` links stay.

### 5. Memory hydrate (prose-scoped)
- `docs/memory/run-kit/toolkit-standards.md`: the README-head section (HexoKit H1, mandated blockquote, badges pinned to `sahil87/run-kit`), the skill-bundle H1 note, and the Policy B install-location statements (hexokit.com bootstrap in README and install.md) — the version-line posture paragraph (`hexokit version …`) is NOT here.
- `docs/memory/run-kit/architecture/overview.md`: the product-identity sentence — HexoKit is the product; `rk` the binary; `run-kit` the still-installed long, roster, and formula name — without any claim about the cobra root command name.

### Stays on R0 (#950), deliberately not here
Cobra root `Use`/`Short`, help-dump `tool`, shell-init completion names, `rk desktop`/`rk update` strings, `internal/desktop/*` bundle + asset prefix, Electron `productName`/`artifactName`/`PRODUCT_NAME` + shell pages + userData carry-forward, `fab/project/config.yaml` `project.name`, `install.md`'s two `HexoKit.app` mentions, toolkit-standards' version-line paragraph, the overview's command-name clause, and the memory files `desktop-shell.md`, `architecture/cli.md`, `build-and-release.md`.

## Affected Memory

- `run-kit/toolkit-standards`: (modify) README head per the revised readme-extraction standard, Policy B install location, skill-bundle H1s.
- `run-kit/architecture/overview`: (modify) product-identity sentence.

## Impact

Docs/config only: `README.md`, 9 `docs/site/*.md` + 7 `docs/site/skill/*.md`, 8 embedded `app/backend/cmd/rk/skill/*.md`, 18 `docs/specs/*.md`, 2 memory files. No Go, TypeScript, YAML, or workflow file changes; no behavior change. Verification: `go test ./cmd/rk/ -run Skill` in `app/backend` (embed drift + ≤150-line budget), the prose-only grep audit (`grep -rnP '(?<![\`/\w.-])run-kit(?![\`/\w-])' README.md docs/site docs/specs` — every remaining hit is a command/roster/path/URL/payload/wire/mockup token), `fab docs-index docs/memory --check`.

## Open Questions

- None. The split rule is the plan row's own sentence.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Content is a byte-identical subset of #950 minus the three app-identity fragments (install.md bundle names, toolkit-standards version paragraph, overview command-name clause) | The plan row's exclusion sentence names commands, app names, bundles, assets, paths | S:95 R:90 A:95 D:95 |
| 2 | Certain | The embedded `cmd/rk/skill/*.md` copies ride with the canonical pages | Skill standard byte-identity + drift-guard tests | S:95 R:95 A:95 D:95 |
| 3 | Confident | No fresh dispatched review: the files were reviewed under #950 (pipeline review, 0 must-fix; Copilot, 4 comments all on R0 code); this change re-runs the mechanical checks only | Strict subset of reviewed content; a prose-only diff | S:70 R:85 A:80 D:75 |
| 4 | Confident | R0 keeps PR #950 and the `mvuv` change, rebased as a stacked branch on this one, retitled | Preserves #950's Copilot review history on the R0 code; the stacked base lets #950 show only the app diff | S:65 R:80 A:80 D:70 |

4 assumptions (2 certain, 2 confident, 0 tentative, 0 unresolved).
