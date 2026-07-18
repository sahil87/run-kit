# Intake: Conform Repo to the "shll toolkit" Name

**Change**: 260718-oa9b-shll-toolkit-rename
**Created**: 2026-07-18

## Origin

One-shot `/fab-new` invocation with a fully-specified task brief. Raw input:

> Task: Conform this repo to the toolkit's standardized name — "shll toolkit".
>
> The toolkit formerly named "sahil87 toolkit" is now the **shll toolkit** (sahil87/shll#56). The readme-extraction standard's canonical README blockquote changed accordingly. This repo's constitution already binds it to revised standards without amendment — this task is the conformance work.
>
> Precondition: `shll standards readme-extraction` runs on this machine and shows the new blockquote (below). If not, run `shll update`; if it still shows the old line, stop and report — do not proceed from memory.
>
> Make this change:
>
> 1. **README blockquote** — replace the toolkit blockquote with this exact line, byte-identical, keeping the mandated head order (H1 -> blockquote -> badges): `> Part of the [shll toolkit](https://shll.ai) — see all projects there.`
> 2. **Prose sweep** — replace remaining `sahil87 toolkit` -> `shll toolkit` and `sahil87 tool(s)` -> `shll tool(s)` wherever they appear as prose: README, `docs/site/**` (including the skill bundle `docs/site/skill.md` if present), CLI help text and user-visible strings (update their test goldens), and `fab/project/` files. If this repo embeds docs in the binary (skill bundle or similar), re-run its sync step so drift-guard tests pass.
> 3. **Constitution (cosmetic, same PR)** — in the Toolkit Standards article, change "part of the sahil87 toolkit" to "part of the shll toolkit" and bump `Last Amended` per the file's governance line. Nothing else in the article changes.
> 4. **Do NOT touch identifiers**: `sahil87/tap` formula names, `github.com/sahil87/…` and `raw.githubusercontent.com/sahil87/…` URLs, the `sahil87/shll` canonical-source reference in the constitution article, and any GitHub-owner constants in code. Historical artifacts (`fab/changes/` archives) stay untouched.
>
> Ship per this repo's normal flow (one fab change -> PR). Tests green; if help text changed, the help-dump JSON shape is unchanged (text-only edits — no `schema_version` bump).

**Precondition verified at intake time (2026-07-18)**: `shll standards readme-extraction` runs on this machine and its README-structure section shows the new canonical blockquote verbatim: `> Part of the [shll toolkit](https://shll.ai) — see all projects there.` No `shll update` was needed. The standard also confirms the mandated head order (H1 → blockquote → badges) and that the blockquote must be "this exact line in all seven repos".

**Occurrence map established at intake time.** A repo-wide sweep (multiline-aware — catches phrases wrapped across comment lines; excludes `fab/changes/` archives, `node_modules/`, `.git/`) found exactly **8 occurrences** of `sahil87 toolkit` / `sahil87 tool(s)` / the possessive blockquote form. This map is exhaustive and is the work list for apply (see What Changes).

## Why

1. **The pain point**: The toolkit was renamed from "sahil87 toolkit" to "shll toolkit" (sahil87/shll#56), and the readme-extraction standard's canonical blockquote changed with it. This repo still carries the old name in its README blockquote (in the older possessive form `[@sahil87's open source toolkit](https://shll.ai)`), README prose, three Go source comments, the constitution's Toolkit Standards article, and one memory file. The README blockquote is a **mechanical contract**: the standard requires it to be "this exact line in all seven repos" so shll.ai can slice the README deterministically.

2. **Consequence of not fixing**: the repo is nonconformant with a published toolkit standard the constitution explicitly binds it to — "Standards added or revised there bind this repo without further amendment to this constitution" (§ Toolkit Standards). The site-facing blockquote diverges from the other toolkit repos, and stale prose keeps propagating the retired name.

3. **Why this approach**: a single narrow fab change (docs type) doing the byte-exact blockquote replacement plus a complete, verified prose sweep — with identifiers (formula names, GitHub URLs, owner constants) explicitly excluded — is the smallest conformant change. The occurrence map was established up front so apply is a checklist, not a search.

## What Changes

### 1. README.md — blockquote (byte-identical) + two prose lines

- **Line 3** (the toolkit blockquote, currently `> Part of [@sahil87's open source toolkit](https://shll.ai) — see all projects there.`) becomes exactly, byte-identical:

  ```markdown
  > Part of the [shll toolkit](https://shll.ai) — see all projects there.
  ```

  Head order is already conformant (line 1 H1 → line 3 blockquote → line 5 badges) — do not reorder anything, replace the one line only.

- **Line 17**: `To install the entire sahil87 toolkit instead:` → `To install the entire shll toolkit instead:` (the surrounding sentence, including `brew install sahil87/tap/run-kit`, stays — that's a formula name).
- **Line 243**: `> 💡 Have other sahil87 tools? [\`shll shell-install\`](…)` → `> 💡 Have other shll tools? …` (the `github.com/sahil87/shll#…` link URL stays).

### 2. Go source comments — three files (comments only, no string literals)

The sweep found **zero** occurrences in CLI help text, user-visible strings, or test goldens — the only Go hits are doc comments. Text-only comment edits; no behavior, no golden updates, no help-dump change, no `schema_version` bump:

- `app/backend/cmd/rk/exit_code.go:8`: `// Exit-code convention (sahil87 toolkit Principle 4, https://shll.ai/shll/standards/principles):` → `(shll toolkit Principle 4, …)` (URL unchanged).
- `app/backend/cmd/rk/root.go:13-14`: the phrase wraps across two comment lines — `…to match the sahil87` / `// toolkit standard…` → `…to match the shll` / `// toolkit standard…` (re-wrap naturally if line length allows).
- `app/backend/internal/riff/riff.go:62`: `// The numeric values conform to the sahil87 toolkit exit-code convention` → `…the shll toolkit exit-code convention`.

### 3. fab/project/constitution.md — Toolkit Standards article (cosmetic)

In § Toolkit Standards (line 50), change only the opening clause: `This tool is part of the sahil87 toolkit and MUST conform…` → `This tool is part of the shll toolkit and MUST conform…`. Everything else in the article stays byte-identical — in particular the `sahil87/shll` canonical-source reference ("the canonical sources are the sahil87/shll repository's docs/site/standards/ tree") is an identifier and MUST NOT change.

Governance line: set `Last Amended` to today, 2026-07-18 — it already reads 2026-07-18 (the article landed via PR #379 with that date), so the bump is a **no-op**; leave the line as-is. `Version` stays **1.6.0**: the task says nothing else changes, and the file's own history has precedent for amendment-without-version-bump (1.3.0 was re-amended 2026-05-29 → 2026-07-02 at the same version).

### 4. docs/memory/run-kit/toolkit-standards.md — prose fix (hydrate)

Line 11: `run-kit is one of the sahil87 toolkit CLIs` → `…one of the shll toolkit CLIs`. Handled at the hydrate stage together with recording this conformance change in the same memory file (it is the toolkit-standards memory).

### 5. Explicitly OUT of scope (verified no-ops)

- **`docs/site/**`**: sweep found **zero** occurrences of the phrase (all `sahil87` hits there are `github.com/sahil87/…` / `raw.githubusercontent.com/sahil87/…` URLs and `sahil87/tap/…` formula names — identifiers, untouched). Includes `docs/site/skill.md` and `docs/site/skill/display.md`.
- **Skill bundle embed**: the embedded copies (`app/backend/cmd/rk/skill/skill.md`, `skill/display.md`, synced by `scripts/sync-skill.sh`) contain no occurrence either — canonical and embedded copies are already in sync and unaffected, so **no re-sync is required** (running `scripts/sync-skill.sh` anyway is harmless and idempotent; the drift-guard tests `TestSkillEmbedMatchesCanonical` / `TestSkillDisplayEmbedMatchesCanonical` stay green).
- **Test goldens / help-dump JSON**: no user-visible string changes → nothing to update; the help-dump contract is untouched.
- **Identifiers everywhere**: `sahil87/tap` formula names (README, `docs/site/install.md`, `cmd/rk/upgrade.go`, `api/update.go`), `github.com/sahil87/…` and `raw.githubusercontent.com/sahil87/…` URLs, `api.github.com/repos/sahil87/run-kit` (`internal/updatecheck`), the `sahil87/shll.ai` references in `help_dump.go` comments, and the vapidSubscriber URL (`internal/push/send.go`).
- **Historical artifacts**: everything under `fab/changes/` (including prior intakes/reports mentioning "sahil87 toolkit") stays untouched.
- **`fab/project/` other files**: config.yaml, context.md, code-quality.md, code-review.md contain no occurrence — constitution.md is the only fab/project file touched.

### Verification for apply

After edits, re-run the sweep and expect zero remaining matches outside `fab/changes/`:

```sh
grep -rlZ --binary-files=without-match 'sahil87' . --exclude-dir=node_modules --exclude-dir=.git \
  | grep -zv '^\./fab/changes/' \
  | xargs -0 perl -0777 -ne 'while (/sahil87[\x27`"]?s?\s*(?:\n\s*(?:\/\/|#|>)?\s*)?(?:open source\s+)?tool(?:kit|s)?\b/gi) { $s=$`; $n=()=($s=~/\n/g); print "$ARGV:".($n+1)."\n" }'
```

Byte-check the blockquote: `sed -n 3p README.md` must equal `> Part of the [shll toolkit](https://shll.ai) — see all projects there.` exactly. Then the standard's conformance checklist (head order, no relative images introduced — trivially true, no content moved). Tests: `cd app/backend && go test ./...` (compile + drift guards) and `cd app/frontend && npx tsc --noEmit`; nothing behavioral changed, so the standard gates suffice.

## Affected Memory

- `run-kit/toolkit-standards`: (modify) update "one of the sahil87 toolkit CLIs" → "shll toolkit CLIs" and record the toolkit-rename conformance (blockquote now matches the revised readme-extraction standard; constitution article wording updated).

## Impact

- `README.md` — 3 lines (blockquote + 2 prose lines)
- `app/backend/cmd/rk/exit_code.go`, `app/backend/cmd/rk/root.go`, `app/backend/internal/riff/riff.go` — one doc-comment phrase each; no behavior, recompiles identically
- `fab/project/constitution.md` — one clause in § Toolkit Standards; governance line already carries today's date
- `docs/memory/run-kit/toolkit-standards.md` — one prose line (hydrate)
- No API, CLI surface, help output, test golden, embed, or dependency changes. `docs/site/**` unchanged.

## Open Questions

None — the brief is fully specified (exact blockquote bytes, explicit scope and exclusions), the precondition was verified live, and the occurrence map is exhaustive.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | README blockquote replaced byte-identically with the given line; head order (H1 → blockquote → badges) already conformant, nothing reordered | Exact bytes supplied in the brief and verified against the live `shll standards readme-extraction` output | S:100 R:90 A:100 D:100 |
| 2 | Confident | The three Go doc comments (`exit_code.go:8`, `root.go:13-14`, `riff.go:62`) are in-scope for the prose sweep even though the brief enumerates "CLI help text and user-visible strings" | "Wherever they appear as prose" governs; comments are prose mentions of the retired name, not identifiers; trivially reversible text-only edits | S:65 R:95 A:75 D:65 |
| 3 | Certain | Constitution: word swap only; `Version` stays 1.6.0 and `Last Amended` stays 2026-07-18 (already today's date — the mandated bump is a no-op) | Brief says nothing else changes; file history has amendment-without-version-bump precedent (1.3.0 twice); today's date already present | S:85 R:95 A:90 D:80 |
| 4 | Certain | No test-golden, help-dump, or skill-bundle sync work: sweep (multiline-aware) found zero occurrences in user-visible strings, goldens, `docs/site/**`, or the embedded skill copies | Verified empirically at intake; conditional clauses in the brief ("if help text changed", "if this repo embeds docs") resolve to no-ops | S:80 R:90 A:95 D:90 |
| 5 | Confident | `docs/memory/run-kit/toolkit-standards.md:11` is updated at hydrate (with the conformance record), not in the apply sweep | Memory updates are hydrate-stage work by pipeline convention; same PR either way | S:55 R:95 A:80 D:70 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
