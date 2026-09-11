# Plan: HexoKit brand prose (plan row C3a)

**Change**: 260911-mljj-hexokit-brand-prose
**Intake**: `intake.md`

> Split change — the prose half of `260911-mvuv-hexokit-brand-surfaces` (run-kit#950), carried over byte-identical minus three app-identity fragments. Apply and the dispatched review happened under #950; this plan records the subset's requirements for hydrate and the mechanical re-verification.

## Requirements

### Brand prose

#### R1: README head and identity prose
`README.md` keeps the head order H1 → toolkit blockquote → badges; H1 reads `HexoKit` (logo URL unchanged); the blockquote is `> Part of [HexoKit](https://hexokit.com) — see all projects there.`; badges stay `sahil87/run-kit`; identity prose names HexoKit; the install one-liner uses `https://hexokit.com/install`; command/formula/completion tokens and the commands link stay.

- **GIVEN** the README
- **WHEN** the prose-only `run-kit` grep runs
- **THEN** every remaining hit is a command, formula/completion fact, or URL

#### R2: docs/site and skill bundles
Identity prose → HexoKit across `docs/site/*.md`; `install.md` curl host → hexokit.com with the `run-kit` tool argument kept; **bundle names stay `Run Kit.app`**; skill H1s → `# HexoKit skill[: topic]`; embedded `app/backend/cmd/rk/skill/*.md` byte-identical to canonical; every page ≤150 lines.

- **GIVEN** `cd app/backend && go test ./cmd/rk/ -run Skill`
- **WHEN** it runs
- **THEN** every embed drift-guard and line-budget test passes
- **GIVEN** `grep -c 'HexoKit.app' docs/site/install.md`
- **WHEN** it runs
- **THEN** the count is 0

#### R3: Specs identity lines
Spec H1s, intro blockquotes, and identity sentences → HexoKit; build paths, payload values, wire tokens, repo-column cells, mockups, memory links unchanged.

- **GIVEN** the prose-only grep over `docs/specs/`
- **WHEN** it runs
- **THEN** every remaining hit is a path, payload value, wire token, repo-column cell, or mockup frame

#### R4: Zero runtime effect
No file under `app/backend/**/*.go`, `app/desktop/`, `app/frontend/`, `.github/`, or `fab/project/config.yaml` changes; no `hexokit version`, `Usage: hexokit`, `HexoKit.app`, or `hexokit-desktop-` string appears in the diff.

- **GIVEN** `git diff --stat origin/main...HEAD`
- **WHEN** inspected
- **THEN** only `README.md`, `docs/site/**`, `docs/specs/**`, `app/backend/cmd/rk/skill/*.md`, `docs/memory/**`, and `fab/**` appear

#### R5: Memory hydrate (prose-scoped)
`toolkit-standards.md` records the HexoKit README head, the Policy B hexokit.com install location, and the skill-bundle H1s, without the version-line posture paragraph; `architecture/overview.md`'s identity sentence names HexoKit/`rk`/`run-kit` without a cobra command-name claim.

- **GIVEN** `grep -n 'hexokit version' docs/memory/run-kit/toolkit-standards.md`
- **WHEN** it runs
- **THEN** no match

### Non-Goals
- Everything the intake's § Stays on R0 lists — command name, app/bundle/asset names, config.yaml, the three memory files for those surfaces.

## Tasks

### Phase 1: Carry-over
- [x] T001 Branch from `origin/main`; `git checkout <mvuv-head> -- README.md docs/site docs/specs app/backend/cmd/rk/skill docs/memory/run-kit/toolkit-standards.md docs/memory/run-kit/architecture/overview.md` <!-- R1, R2, R3, R5 -->
- [x] T002 Pull the app-identity fragments back out: `install.md` two `HexoKit.app` → `Run Kit.app`; toolkit-standards version-line hunk reverted and its posture paragraph removed; overview sentence rewritten without the command-name clause; provenance citations re-pointed at this change <!-- R2, R4, R5 -->

### Phase 2: Verification
- [x] T003 `cd app/backend && go test ./cmd/rk/ -run Skill`; prose-only grep audit over README/docs/site/docs/specs; `git diff --stat origin/main...HEAD` scope check; `fab docs-index docs/memory --check` then regenerate <!-- R1, R2, R3, R4, R5 -->

## Acceptance

### Functional Completeness
- [x] A-001 R1: README head order and blockquote conform; badges unchanged; install host is hexokit.com
- [x] A-002 R2: docs/site prose flipped, bundle names still `Run Kit.app`, skill H1s flipped, embedded copies byte-identical, ≤150 lines
- [x] A-003 R3: spec identity lines flipped; tokens/paths/mockups unchanged
- [x] A-004 R4: diff touches no code, config, or workflow file; no app-identity strings in the diff
- [x] A-005 R5: memory records the prose posture only

### Code Quality
- [x] A-006 No comment narration or change-history prose introduced in memory bodies; descriptions ≤500 chars and change-id-free

## Notes

- Check items as you review: `- [x]`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Apply is the carry-over itself; no dispatched worker | The content pre-exists on #950 | S:95 R:95 A:95 D:95 |

1 assumptions (1 certain, 0 confident, 0 tentative).
