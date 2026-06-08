# Plan: Conform repo to shll.ai README-extraction contract

**Change**: 260608-j6bs-shllai-readme-extraction-contract
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### README: Head & Image Conformance

#### R1: Absolute logo image in the H1
The README H1 logo image SHALL reference an absolute `https://…` URL, not a relative repo path. Head order (`# H1` → `>` toolkit blockquote → badges → prose) MUST be preserved unchanged.

- **GIVEN** the README H1 `<img src="assets/logo.svg" …>`
- **WHEN** the contract is applied
- **THEN** the `src` becomes `https://raw.githubusercontent.com/sahil87/run-kit/main/assets/logo.svg`
- **AND** nothing precedes the `#` H1 (no frontmatter, no HTML comment) and the `#`→`>`→badges→prose order is intact

#### R2: No mermaid fences, no gh-mode fragments
The README MUST contain no mermaid code fences and no `#gh-dark-mode-only` / `#gh-light-mode-only` URL fragments.

- **GIVEN** the current README
- **WHEN** verified via grep
- **THEN** zero matches for `mermaid`, `gh-dark-mode-only`, `gh-light-mode-only` (no edit needed — confirm only)

#### R3: Already-absolute links/images untouched
All existing absolute `https://…` links and images (github.com/sahil87/*, user-attachments screenshots, Tailscale admin links) SHALL remain unchanged.

- **GIVEN** the absolute URLs already in the README
- **WHEN** the change is applied
- **THEN** they are byte-for-byte unchanged

### README: Tail Denylist & Link Repointing

#### R4: Drop the Contributing section
The README `## Contributing` section SHALL be removed entirely (it sits at/below the contract tail denylist: Contributing/Development/Building/License/Acknowledgements). `## Architecture` is NOT on the denylist and MUST be retained.

- **GIVEN** the README ends with `## Architecture` then `## Contributing`
- **WHEN** the change is applied
- **THEN** `## Contributing` and its `just doctor`/`just setup`/`just dev`/`just prod` body are gone
- **AND** `## Architecture` remains as the final section

#### R5: Migrate developer content into docs/site/install.md
The developer prerequisites and `just` recipes previously under `## Contributing` MUST be preserved in a `## Development` section of `docs/site/install.md` so the content is not lost.

- **GIVEN** the Contributing body (Node 20+/pnpm/tmux/just/Go 1.22+/air/direnv prereqs + `just setup`/`just dev`/`just prod`)
- **WHEN** the change is applied
- **THEN** that content appears under a Development section in `docs/site/install.md`

#### R6: Repoint site-escaping relative links
The two `docs/wiki/*` relative links in the README SHALL be repointed into `docs/site/`.

- **GIVEN** `[riff guide](docs/wiki/riff.md)` and `[Tailscale guide](docs/wiki/tailscale.md)`
- **WHEN** the change is applied
- **THEN** they become `[riff guide](docs/site/workflows.md)` and `[Tailscale guide](docs/site/install.md)` respectively
- **AND** no `docs/wiki/` link remains in the README

### docs/site Tree (closed-set rules)

#### R7: docs/site/install.md authored
A new `docs/site/install.md` SHALL exist with: Homebrew install (`brew install sahil87/tap/rk`), upgrade (`rk update`), prerequisites / `rk doctor`, a Development section (R5 content), and a Tailscale HTTPS section migrating the FULL content of `docs/wiki/tailscale.md` (quickstart, custom hostname, Funnel, all admin-console links kept absolute).

- **GIVEN** the contract allows the `install` slug for the tool repo
- **WHEN** the change is applied
- **THEN** `docs/site/install.md` exists and covers all listed sections
- **AND** every image is absolute `https://…`, every site-escaping link is absolute `https://…`, no `..` escape

#### R8: docs/site/workflows.md authored
A new `docs/site/workflows.md` SHALL exist migrating the FULL content of `docs/wiki/riff.md` (pane array model, layouts table, presets, parallel `--count`, wt passthrough, exit codes, common patterns).

- **GIVEN** the contract allows the `workflows` slug for the tool repo
- **WHEN** the change is applied
- **THEN** `docs/site/workflows.md` exists with the full riff reference
- **AND** every image is absolute, every site-escaping link is absolute, no `..` escape

#### R9: Reserved-slug & wiki-retention rules
No `docs/site/` page may be named `overview`, `readme`, or `commands`. `docs/wiki/` files MUST NOT be deleted.

- **GIVEN** the reserved static slugs and wiki-retention decision
- **WHEN** the change is applied
- **THEN** docs/site contains only `install.md` and `workflows.md`
- **AND** `docs/wiki/riff.md` and `docs/wiki/tailscale.md` remain in place

### Non-Goals

- Touching `app/backend/` or `app/frontend/` — docs-only change.
- Deleting `docs/wiki/` — explicitly out of scope.
- The shll.ai repo — it pulls automatically.
- `help/run-kit.json` generation — already emitted at build time.

### Design Decisions

1. **Migrate wiki → docs/site rather than author net-new**: reuses curated prose, gives richest page depth, single source of truth — *Why*: user-chosen in intake — *Rejected*: "new docs/site, keep wiki separate" and "minimal: links only".
2. **Tailscale link repoints to install.md, riff link repoints to workflows.md**: Tailscale content folds into the install/access guide; riff content is the workflows deep-dive — *Why*: matches the section homes chosen for each migration target.

## Tasks

### Phase 1: Setup

- [x] T001 Create the `docs/site/` directory <!-- R7 R8 -->

### Phase 2: docs/site authoring (migration targets — must exist before README links point at them)

- [x] T002 Author `docs/site/workflows.md` migrating the full content of `docs/wiki/riff.md` (pane array model, layouts table, presets, parallel `--count`, wt passthrough, exit codes, common patterns); all links/images absolute, no `..` escape <!-- R8 -->
- [x] T003 Author `docs/site/install.md` with Homebrew install, `rk update` upgrade, prerequisites/`rk doctor`, a `## Development` section (migrated Contributing prereqs + `just setup`/`just dev`/`just prod`), and a `## Tailscale HTTPS` section migrating the full content of `docs/wiki/tailscale.md` (quickstart, custom hostname, Funnel, admin links absolute) <!-- R7 R5 -->

### Phase 3: README restructuring

- [x] T004 In `README.md` line 1, absolutize the H1 logo `src` to `https://raw.githubusercontent.com/sahil87/run-kit/main/assets/logo.svg`; preserve head order <!-- R1 -->
- [x] T005 In `README.md`, repoint `[riff guide](docs/wiki/riff.md)` → `docs/site/workflows.md` and `[Tailscale guide](docs/wiki/tailscale.md)` → `docs/site/install.md` <!-- R6 -->
- [x] T006 In `README.md`, remove the `## Contributing` section entirely; keep `## Architecture` as the final section <!-- R4 -->

### Phase 4: Verify

- [x] T007 Run the contract Verify checklist: README head order intact, no relative image in README or docs/site, README links point into docs/site or absolute https, no `docs/wiki/` link in README, no gh-mode fragments, no reserved-slug page names, `docs/wiki/` retained <!-- R1 R2 R3 R6 R9 -->

## Execution Order

- T001 blocks T002 and T003 (directory must exist)
- T002/T003 should precede T005 (links must point at existing files) but are otherwise independent of each other
- T004/T005/T006 all edit README.md — sequential
- T007 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: README H1 image `src` is `https://raw.githubusercontent.com/sahil87/run-kit/main/assets/logo.svg`; nothing precedes the `#` H1; `#`→`>`→badges→prose order intact
- [x] A-002 R4: `## Contributing` is removed; `## Architecture` is retained as the final section
- [x] A-003 R5: Contributing dev content (prereqs + `just setup`/`just dev`/`just prod`) is present under a Development section in `docs/site/install.md`
- [x] A-004 R6: README links are `docs/site/workflows.md` (riff) and `docs/site/install.md` (Tailscale); no `docs/wiki/` link remains
- [x] A-005 R7: `docs/site/install.md` exists with Homebrew install, `rk update`, prerequisites/`rk doctor`, Development, and full Tailscale HTTPS content (quickstart + custom hostname + Funnel)
- [x] A-006 R8: `docs/site/workflows.md` exists with full riff reference (pane array, layouts table, presets, `--count`, wt passthrough, exit codes, common patterns)
- [x] A-007 R9: docs/site contains only install.md and workflows.md; `docs/wiki/riff.md` and `docs/wiki/tailscale.md` still present

### Behavioral Correctness

- [x] A-008 R3: All pre-existing absolute URLs (github.com/sahil87/*, user-attachments screenshots, Tailscale admin links) are unchanged

### Scenario Coverage

- [x] A-009 R2: grep confirms zero `mermaid` / `gh-dark-mode-only` / `gh-light-mode-only` matches in README and docs/site
- [x] A-010 R7 R8: grep confirms no relative image (`src="assets`, relative `![`) and no `..` escape in docs/site/**

### Code Quality

- [x] A-011 Pattern consistency: docs/site pages follow existing repo markdown style (heading levels, fenced code blocks, tables)
- [x] A-012 No unnecessary duplication: migrated content reuses wiki prose rather than re-authoring; no content lost

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Absolute logo URL = `https://raw.githubusercontent.com/sahil87/run-kit/main/assets/logo.svg` | Specified verbatim in intake; standard raw-content form, `main` default branch | S:98 R:80 A:95 D:95 |
| 2 | Certain | Tailscale link → install.md; riff link → workflows.md | Specified verbatim in intake Part 1 step 3 | S:98 R:85 A:95 D:95 |
| 3 | Certain | install.md folds in the FULL tailscale.md content under a `## Tailscale HTTPS` section; workflows.md is the full riff.md migration | Specified verbatim in intake Part 2 | S:95 R:80 A:95 D:90 |
| 4 | Confident | docs/site/install.md gets its own top-level intro + sectioned layout (Install / Prerequisites / Development / Tailscale HTTPS); install content (Homebrew, rk update, rk doctor) lifted from the README Quick start / Command reference | Intake lists the sections but not exact prose; README already contains the canonical command forms to reuse | S:80 R:70 A:85 D:75 |
| 5 | Confident | Keep `docs/wiki/` files byte-for-byte (source of migration, not modified) | Intake says retain, not delete; no instruction to edit them | S:90 R:80 A:90 D:85 |

5 assumptions (3 certain, 2 confident, 0 tentative).
