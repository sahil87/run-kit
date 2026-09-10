# Plan: Split architecture.md Memory into an architecture/ Sub-Domain

**Change**: 260910-ebgp-split-architecture-memory-subdomain
**Intake**: `intake.md`

## Requirements

### Memory: architecture/ sub-domain

#### R1: Seven topic files under `docs/memory/run-kit/architecture/`
The change MUST create `overview.md`, `repo-layout.md`, `backend-packages.md`, `tmux-runner.md`, `pr-status.md`, `cli.md`, and `testing.md`, each with FKF frontmatter (`type: memory`, change-id-free `description:` ≤ 500 chars), an H1, the body sections assigned by the intake's What Changes §1 table moved verbatim, and a trailing `## Design Decisions` section holding the assigned entries.

- **GIVEN** the current single `architecture.md`
- **WHEN** the split runs
- **THEN** every `##`/`###` body heading of the old file appears exactly once across the destination files
- **AND** every one of the 107 `### ` Design-Decision titles appears exactly once across all destination files (in `architecture/` or the existing files named in §2)

#### R2: Sections and decisions relocated into existing files
`## Chrome Architecture` MUST move to `ui/routes-and-shell.md` and `## Boards Feature` to `ui/boards.md` (as `## Architecture Placement`); the Design-Decision entries mapped in the intake's §2 table MUST be appended byte-for-byte to the `## Design Decisions` section of `ui/routes-and-shell.md`, `ui/top-bar.md`, `ui/compose-and-bottom-bar.md`, `ui/visual-design.md`, `ui/lenses-and-layout.md`, `configuration.md`, and `api-and-sockets.md` (creating the section as the last section when absent).

- **GIVEN** a destination file with an existing `## Design Decisions` section
- **WHEN** entries are appended
- **THEN** the entries keep heading + **Decision**/**Why**/**Rejected**/*Introduced by* unchanged and the file's `description:` is updated only if the new content widens its scope

#### R3: `architecture.md` becomes a map file
`architecture.md` MUST be reduced to the `ui-patterns.md` shape: map-file `description:`, a do-not-add-content notice, and a table mapping every old body section and every Design-Decision title (groupable) to its new file.

- **GIVEN** a `log.md` entry citing `architecture.md § Testing`
- **WHEN** a reader opens `architecture.md`
- **THEN** the table names `architecture/testing.md` as the new home

#### R4: Repository tree trimmed without fact loss
`repo-layout.md` MUST hold the tree at directory granularity with pointers to `architecture/cli.md`, `architecture/backend-packages.md`, `api-and-sockets.md`, and `build-and-release.md`. Any per-file fact removed from the tree MUST already exist at (or be folded into) the pointer target.

- **GIVEN** every `.go`/`.md`/`.sh` filename present in the old tree
- **WHEN** the change is complete
- **THEN** each filename still appears somewhere under `docs/memory/run-kit/`

#### R5: Table hygiene
The package table and the CLI table MUST be sorted alphabetically by first column (root `(none)` row first in the CLI table). The `internal/tmux` and `internal/prstatus` rows MUST become body prose in `tmux-runner.md` / `pr-status.md` (content verbatim, re-flowed into lines at `**Bold** —` sentence boundaries), each replaced in the table by a one-row pointer. Pointer-bearing rows MAY be shortened only when every removed fact exists at the pointer target.

- **GIVEN** the alphabetized tables
- **WHEN** two future changes each add a row
- **THEN** the rows land at different anchors unless adjacent alphabetically

#### R6: Links and indexes
`log.md`/`log.seed.md` MUST NOT be edited by hand. `§`-anchored citations in sibling memory files and specs whose new home is unambiguous SHALL be retargeted; bare `[architecture](/run-kit/architecture.md)` links stay. A stub `architecture/index.md` (description-only frontmatter) MUST exist before `fab docs-index docs/memory` regenerates indexes and logs. After regeneration `fab docs-index docs/memory --check` MUST exit 0 or 1 and no `](/run-kit/...)` link may point at a missing file.

- **GIVEN** the regenerated tree
- **WHEN** `grep -rhoE '\]\(/run-kit/[^)#]+' docs/memory | sort -u` is checked against disk
- **THEN** every target exists

### Non-Goals
- Rewording or condensing any Design-Decision entry.
- Splitting `cli.md` or `backend-packages.md` further — they remain single hot tables by design.
- Touching `docs/specs/architecture.md` (a spec, not memory).

## Tasks

### Phase 1: Setup

- [x] T001 Write an extraction script in the scratchpad that parses `docs/memory/run-kit/architecture.md` into body sections (by `##`/`###` line ranges) and the 107 DD entries (by `### ` title within `## Design Decisions`), and records a title→destination mapping from intake §1–§2 <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Create `docs/memory/run-kit/architecture/{overview,repo-layout,backend-packages,tmux-runner,pr-status,cli,testing}.md` with frontmatter + H1 + assigned body sections + `## Design Decisions` (assigned entries) <!-- R1 -->
- [x] T003 Extract the `internal/tmux` and `internal/prstatus` table rows into `tmux-runner.md` / `pr-status.md` as re-flowed prose; leave one-row pointers in the package table <!-- R5 -->
- [x] T004 Alphabetize the package table (backend-packages.md) and the CLI table (cli.md); shorten pointer-bearing rows only where the pointer target covers every removed fact <!-- R5 -->
- [x] T005 Trim the repository tree in `repo-layout.md` to directory level with pointers; fold any unique per-file fact into the pointer target first <!-- R4 -->
- [x] T006 Move `## Chrome Architecture` into `ui/routes-and-shell.md` and `## Boards Feature` into `ui/boards.md` (`## Architecture Placement`); append the §2-mapped DDs to `ui/routes-and-shell.md`, `ui/top-bar.md`, `ui/compose-and-bottom-bar.md`, `ui/visual-design.md`, `ui/lenses-and-layout.md`, `configuration.md`, `api-and-sockets.md`; adjust their `description:` where scope widened <!-- R2 -->
- [x] T007 Rewrite `docs/memory/run-kit/architecture.md` as the map file (old section / DD title → new home) <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Retarget `§`-anchored `architecture` citations in sibling memory files and `docs/specs/*.md` where the new home is unambiguous; leave bare links and log files untouched <!-- R6 -->
- [x] T009 Create the `architecture/index.md` stub (description frontmatter only), run `fab docs-index docs/memory`, then `fab docs-index docs/memory --check` (exit 0/1 required) <!-- R6 -->
- [x] T010 Run the loss checks: DD-title census (107 = 107), body-heading census, filename census for the trimmed tree, and the no-dangling-link grep <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The seven `architecture/*.md` files exist with `type: memory` + change-id-free `description:` and the assigned sections
- [x] A-002 R2: `ui/routes-and-shell.md` contains `## Chrome Architecture`; `ui/boards.md` contains `## Architecture Placement`; the seven named existing files carry the appended DDs
- [x] A-003 R3: `architecture.md` is a map file whose table covers every old body section and DD title
- [x] A-004 R4: `repo-layout.md` is directory-level with the four pointers
- [x] A-005 R5: Both tables are alphabetized; `tmux-runner.md` and `pr-status.md` hold the former rows as multi-line prose; pointer rows remain in the table
- [x] A-006 R6: `architecture/index.md` exists; root, domain, and sub-domain indexes are regenerated; `fab docs-index docs/memory --check` exits 0 or 1

### Behavioral Correctness

- [x] A-007 R1: DD-title census — 107 titles in, 107 out, no duplicates, no rewording
- [x] A-008 R4: Every filename from the old tree still appears under `docs/memory/run-kit/`

### Scenario Coverage

- [x] A-009 R3: `architecture.md § Testing` and `architecture § internal/updatecheck` resolve via the map table to `architecture/testing.md` and `architecture/backend-packages.md`

### Edge Cases & Error Handling

- [x] A-010 R6: No `](/run-kit/...)` link in `docs/memory/` points at a missing file; `log.md`/`log.seed.md` differ from main only by `fab docs-index` regeneration

### Code Quality

- [x] A-011 Pattern consistency: New files follow the `ui/` sub-domain precedent (frontmatter shape, H1 style, `## Design Decisions` last)
- [x] A-012 No unnecessary duplication: No body section or DD entry exists in two files (note: a pre-existing `### \`--show\` on a full 3-tile layout…` title collision between the old architecture.md and `ui/lenses-and-layout.md` — two distinct decisions sharing a title — predates this change at HEAD; the moved copy lives in `architecture/cli.md`, the frontend-divergence copy stays in lenses-and-layout)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Re-flow of the two giant rows splits lines at `**Bold** —` lead-ins only; no other whitespace change | Renders identically; gives line-level merge granularity | S:75 R:85 A:85 D:80 |
| 2 | Confident | Destination files lacking `## Design Decisions` get one appended as the last section | FKF §3.3 shape; ui/ files already end with that section | S:80 R:90 A:90 D:85 |
| 3 | Tentative | Pointer-row shortening is applied only to rows whose pointer target demonstrably covers the removed text; otherwise verbatim | Intake assumption #10 carried forward | S:55 R:70 A:65 D:50 |

3 assumptions (0 certain, 2 confident, 1 tentative).
