# Intake: Install Docs Policy B Conformance

**Change**: 260720-ec6i-install-docs-policy-b
**Created**: 2026-07-20

## Origin

One-shot `/fab-new` invocation:

> Conform this repo's install documentation to the shll toolkit's install-composition standard, Policy B. Read the authoritative standard first: /home/sahil/code/sahil87/shll/docs/site/standards/install-composition.md (rendered on https://shll.ai). Policy B: per-tool READMEs and doc pages must not carry per-formula "brew install sahil87/tap/<tool>" install instructions; installation points to https://shll.ai (curl bootstrap: curl -fsSL https://shll.ai/install | sh; subset installs remain supported via shll install <tool>). Task: audit README.md and docs/site/ for per-formula install instructions and replace them with the shll.ai pointer. IMPORTANT distinction: replace install *instructions* (sections telling the user how to install), but KEEP incidental mentions such as actionable error-hint examples in standards/conformance text (Policy A mandates those hints) and historical/changelog references. Mechanical docs-only change; keep all usage and feature content intact.

The intake agent read the authoritative standard and completed the audit at intake time (grep of `README.md` + `docs/site/` for `brew install|sahil87/tap|shll.ai`), so the What Changes section below is the **complete, verified hit list** — not a plan to audit later. Sibling toolkit repos (`wt`, `hop`, `idea`, `tu`) were inspected and their READMEs already carry the conformant install pattern; their wording is the reference for the replacements.

## Why

1. **Pain point**: run-kit's README and `docs/site/install.md` carry per-formula `brew install sahil87/tap/run-kit` / `sahil87/tap/wt` install instructions, plus two references to the **retired** `sahil87/tap/all` meta-formula. Policy B of the toolkit's `install-composition` standard (which binds this repo via constitution § Toolkit Standards) prohibits documenting per-formula installs per-repo: seven copies of the install dance drift, and every change to the install story (tap-trust requirement, bootstrap change) has to be chased across every repo plus the tap.
2. **Consequence of not fixing**: run-kit stays non-conformant with a published binding standard; the already-stale `sahil87/tap/all` references actively misdirect users to a retired formula.
3. **Approach**: replace install *instructions* with the centralized shll.ai pointer (curl bootstrap + `shll install <tool>`), exactly matching the pattern already shipped in the conformant sibling READMEs (wt/hop/idea/tu). Individual formula installs remain *supported* — only *documenting* them per-repo is prohibited — so nothing about actual install behavior changes.

## What Changes

Complete audit hit list and the disposition of each. Docs-only; no code, no tests, no behavior change.

### README.md — Install section (line 17)

The section already leads with the conformant curl bootstrap (`curl -fsSL https://shll.ai/install | sh -s -- run-kit`) and the full-toolkit variant. The one violation is the per-formula escape hatch sentence. Current:

> Installs run-kit (plus the shll meta-CLI) via Homebrew, handling tap trust automatically. Prefer plain Homebrew? `brew install sahil87/tap/run-kit` does the same. To install the entire shll toolkit instead:

Replace with (verbatim wt/hop/idea/tu wording):

> Installs run-kit (plus the shll meta-CLI) via Homebrew, handling tap trust automatically. To install the entire shll toolkit instead:

Both curl blocks stay unchanged.

### README.md — Quick start prose (line 36)

Current:

> `run-kit riff` also needs [`wt`](https://github.com/sahil87/wt) on your `PATH` — included with the full-toolkit install, or `brew install sahil87/tap/wt` — and your agent CLI available.

Replace the per-formula fragment with the subset-install form:

> `run-kit riff` also needs [`wt`](https://github.com/sahil87/wt) on your `PATH` — included with the full-toolkit install, or `shll install wt` — and your agent CLI available.

### README.md — Troubleshooting (line 267)

Current:

> - **`run-kit riff` fails with "wt not found"** — install `wt` via `brew install sahil87/tap/wt`, or via the toolkit meta-formula `brew install sahil87/tap/all`.

Replace with (also removes the retired `all` meta-formula):

> - **`run-kit riff` fails with "wt not found"** — install `wt` via `shll install wt`, or install the full toolkit from [https://shll.ai](https://shll.ai).

The troubleshooting *entry* stays — only its install pointer changes. This is doc-carried install guidance, not the Policy-A binary error hint (which lives in the binary's own output and is out of scope here).

### docs/site/install.md — Install section (lines 5–13)

Current:

```markdown
run-kit ships as a Homebrew formula:

​```bash
brew install sahil87/tap/run-kit
​```

This puts the `run-kit` binary on your `PATH`. The formula also installs `rk` as a fully interchangeable short alias, ...
```

Replace the formula lead-in + brew block with the curl bootstrap, keeping everything from "This puts the `run-kit` binary on your `PATH`..." onward intact:

```markdown
Install via the [shll toolkit](https://shll.ai) bootstrap:

​```bash
curl -fsSL https://shll.ai/install | sh -s -- run-kit
​```

This installs run-kit (plus the shll meta-CLI) via Homebrew, handling tap trust automatically, and puts the `run-kit` binary on your `PATH`. The formula also installs `rk` as a fully interchangeable short alias, ...
```

(Exact splice: the sentence "This puts the `run-kit` binary on your `PATH`." merges into the new lead sentence as shown; the rest of the paragraph and the quick-start block below it are untouched.)

### docs/site/install.md — Prerequisites (line 43)

Current:

> - [`wt`](https://github.com/sahil87/wt) on your `PATH` — install via `brew install sahil87/tap/wt`, or via the toolkit meta-formula `brew install sahil87/tap/all`.

Replace with (also removes the retired `all` meta-formula):

> - [`wt`](https://github.com/sahil87/wt) on your `PATH` — included with the [full-toolkit install](https://shll.ai), or `shll install wt`.

### Explicitly KEPT (audited, conformant or out of scope)

- **All curl bootstrap blocks** (`curl -fsSL https://shll.ai/install | sh [-s -- run-kit]`) — they ARE the centralized install pointer; all four conformant sibling READMEs carry them inline.
- **README line 3** toolkit banner link and **line 262** command-reference link (`https://shll.ai/tools/run-kit/commands/`) — pointers, not install instructions.
- **README/install.md Upgrade content** (`run-kit update` "pulls the latest version via Homebrew...") — usage/behavior description, not install instructions.
- **Binary error hints in Go source** (`app/backend/cmd/rk/upgrade.go:183` prints `brew install sahil87/tap/run-kit` on a non-brew install) — Policy A *mandates* actionable per-formula hints in binary output; binary surface is out of this docs-only scope.
- **`docs/site/skill.md:97`** ("run-kit may not be installed... gate every step") — a gating instruction, not an install instruction.
- **Historical references** in `fab/changes/`, `docs/memory/` requirement provenance, and changelogs — untouched per the task's KEEP carve-out.
- **No other hits**: `docs/site/status-dot.md`, `workflows.md`, `notifications.md`, `skill.md`, `skill/display.md` contain no per-formula install lines (verified by grep).

## Affected Memory

- `run-kit/toolkit-standards`: (modify) Add the `install-composition` standard's conformance posture — Policy B PASS after this change (install docs centralized to shll.ai pointer; retired `all` meta-formula references removed); note Policy A's binary-half (probe + hint) was not audited here (docs-only scope).

## Impact

- **Files**: `README.md` (3 line-level edits), `docs/site/install.md` (2 section-level edits). No source code, no tests, no API surface.
- **Systems**: docs/site pages render on shll.ai (the toolkit site extracts them) — the edits keep heading structure intact so extraction anchors (e.g. the README link to `docs/site/install.md`) are unaffected.
- **Verification**: re-run the audit grep (`grep -rn -iE 'brew install|sahil87/tap' README.md docs/site/`) — expect zero hits after the change; `just build` / tests unaffected (docs-only).

## Open Questions

None — the standard is explicit, the audit is complete, and conformant sibling repos fix the replacement wording.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Keep the inline curl bootstrap blocks (subset + full-toolkit forms) as the install content; Policy B prohibits per-formula brew lines, not the bootstrap | All four conformant sibling READMEs (wt/hop/idea/tu) carry exactly this pattern; the task names the bootstrap as the pointer mechanism | S:90 R:90 A:95 D:90 |
| 2 | Certain | Remove both retired `sahil87/tap/all` meta-formula references (README:267, install.md:43) | The standard's Precedent states verbatim: "the `all` meta-formula is retired in favor of `shll install`" | S:85 R:90 A:95 D:95 |
| 3 | Confident | The README Troubleshooting wt-not-found entry is an install instruction to replace (`shll install wt` + shll.ai), NOT a Policy-A error-hint example to keep | The KEEP carve-out targets standards/conformance text quoting the binary's hint; this is user-facing install guidance in a per-tool README — exactly the drift Policy B kills. The entry itself stays | S:75 R:85 A:70 D:65 |
| 4 | Certain | `docs/site/` pages are "install documentation" bound by Policy B, though the standard's verification bullet names only "the README's install section" | Policy B's heading is "Install documentation is centralized"; scope binds the six roster-tool repos; the task explicitly directs the docs/site audit | S:90 R:85 A:80 D:80 |
| 5 | Confident | `shll install wt` is the replacement wording for sibling-tool (wt) install mentions, alongside a shll.ai link — not a bare link only | Task: "subset installs remain supported via shll install <tool>"; keeps the prerequisite actionable in one line | S:80 R:90 A:75 D:70 |
| 6 | Certain | Upgrade/update documentation (`run-kit update`, Homebrew behavior descriptions, updatecheck prose) stays untouched | Task: "keep all usage and feature content intact"; these describe behavior, they don't instruct installation | S:85 R:90 A:85 D:85 |
| 7 | Certain | Hydrate records the posture in the existing `run-kit/toolkit-standards` memory file rather than a new file | That file is the designated per-standard conformance ledger ("the baseline a future re-audit diffs against") | S:70 R:95 A:80 D:75 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
