# Intake: Split architecture.md Memory into an architecture/ Sub-Domain

**Change**: 260910-ebgp-split-architecture-memory-subdomain
**Created**: 2026-09-11

## Origin

Conversational — raised during a `/fab-discuss` session, proposal presented and approved
("go ahead"), with a follow-up instruction to ship the PR when done.

> The memory file architecture.md is causing way too many conflicts. Can you look at how we can
> break that file down into smaller chunks or make a folder called architecture and then have
> smaller parts within it, to reduce the number of conflicts we get for parallel changes?

Key decisions from the discussion (all approved by the user):

1. Create a `run-kit/architecture/` sub-domain, following the existing `run-kit/ui/` split precedent.
2. Move `## Chrome Architecture` into `ui/routes-and-shell.md` (frontend shell content).
3. Distribute the 107 `## Design Decisions` entries into each topic file's own `## Design Decisions` section, including topic files that already exist outside `architecture/`.
4. Shrink `## Repository Structure` to top-level directories with pointers instead of relocating it — it duplicates the CLI table (every `cmd/rk/*.go`) and `api-and-sockets.md` (every `api/*.go`).
5. Sort the package and CLI tables alphabetically; shorten rows that already say "full contract in X.md".
6. Leave `architecture.md` as a map file (like `ui-patterns.md`) so `architecture.md § …` citations in `log.md` and code comments keep resolving.

## Why

**Pain**: `docs/memory/run-kit/architecture.md` is 1075 lines / 393 KB. Over the last 60 days it
was touched by 179 commits — the next-hottest memory file (`tmux-sessions.md`) saw 79. Nearly every
change adds a Go package row, a CLI verb row, a file in the repo tree, or a design decision, and
all four land in the same file, usually appended at the end of a table or list. Two branches
appending at the same anchor is the canonical git conflict, so parallel fab changes collide on this
file during rebase far more often than on any other.

Hunk distribution over the same window, by `##` section: Design Decisions 61, Backend Libraries 50,
CLI Subcommands 39, Repository Structure 36, Chrome Architecture 29. Several single table rows are
enormous — `internal/tmux` 22.8 KB and `internal/prstatus` 17.9 KB on ONE line each — so every
concurrent edit to those packages conflicts on the same line.

**Consequence of not fixing**: every hydrate that touches architecture (most of them) risks a
rebase conflict inside a 393 KB file where resolution is slow and error-prone, and the file keeps
attracting design decisions that belong in more specific files because it is the biggest catch-all.

**Why this approach**: the `ui/` sub-domain split is the proven pattern in this repo (16 topic files,
`ui-patterns.md` kept as a map file). Splitting along the axis parallel changes actually write along
(packages / CLI / tests / data model / prstatus / tmux runner) means concurrent changes usually land
in different files. Where they still meet (two changes both add a package), the conflict is inside a
short alphabetized table instead of a 393 KB file. Alphabetical ordering makes concurrent additions
land at different anchors instead of all at the end.

## What Changes

### 1. New sub-domain `docs/memory/run-kit/architecture/`

Seven topic files plus a generated `index.md`. Every new file carries FKF frontmatter
(`type: memory` + a change-id-free `description:`), an H1, body sections moved verbatim from
`architecture.md`, and a trailing `## Design Decisions` section holding the entries assigned to it
(entry shape unchanged: `### title` / **Decision** / **Why** / **Rejected** / *Introduced by*).

| New file | Body sections moved from architecture.md | Design Decisions moved in |
|---|---|---|
| `architecture/overview.md` | `## System Overview`, `## Data Model` (+ `### Performance Caching`), `## SPA Static Serving` (+ `### Two-tier cache policy`), `## Embedded Frontend Assets`, `## Security` | Go backend + Vite SPA over Next.js; Single port architecture; chi over stdlib ServeMux; TanStack Router over React Router; Vite proxy in dev; SPA fallback in Go; Every tmux session is a project; Config via env vars for deployment binding; Dedicated tmux server (`-L runkit`); embedded tmux.conf kitty CSI-u extended keys; Multi-server session enumeration; SPA handler dual-mode; Two-tier SPA cache policy + embedded ETag; Role as a tmux window option; Server-scoped `@rk_win_role` radio; Dual storage `@rk_ses_color`/`@rk_win_color`; Tmux user-defined options for web content state; layout option is a default-view HINT; Web-tab family density holds on every write path; `@rk_win_url` dual-reads; Legacy marker values normalized at every boundary; Flair settings normalize is a membership check; Per-window fab enrichment derived natively |
| `architecture/repo-layout.md` | `## Repository Structure` — TRIMMED (see §4) | — |
| `architecture/backend-packages.md` | `## Backend Libraries (Go Modules)` table (alphabetized, MINUS the `internal/tmux` and `internal/prstatus` rows, which move to their own files below), `### External Go Dependencies` | readiness state reader injected into `internal/inject`; layout verb port lives in `internal/layoutspec`; layout grammar lives in `internal/layoutspec`; One validator table, two writers; `layoutspec` surface kinds are exactly the frontend `ViewName` registry; Shared tmux install-hint helper; procfs direct reading; No HTTP probe on enumerated ports; Toolkit update-notify + one-click upgrade; managed code-server curated through launch flags; rk-owned profile in `~/.rk/code-server-profile`; dedicated `internal/codeserver` package; Long-lived spawns carry the version-stable rk path; install job runs the literal shell chain; Staged extract + rename promotion; Install is the migration verb; `sanitizeEnv` restores the pre-direnv PATH |
| `architecture/tmux-runner.md` | the `internal/tmux` package row (re-flowed into paragraphs, content verbatim) + `### tmux Runner Core` | One exported tmux runner core, per-site socket targeting; The runner core scrubs tmux client context from the child env |
| `architecture/pr-status.md` | the `internal/prstatus` package row (re-flowed into paragraphs, content verbatim) | PR-status collector wholesale-rebuild + three-layer split; Two-tier agent-state + branch-derived PR links; First-sight-only registration wake; collector pushes a STORED head-index; An index miss is never an authoritative negative; Origin identity is HOST-QUALIFIED; `parseOriginRepo` accepts EXACTLY two path segments; `BranchRefresher.refresh` is single-flighted; PR-status seed cache never a source of truth; Account-switch invalidation at the NEXT successful fetch; cache dedup key zeroes freshness-only stamps; Seeded entries restamp `observedAt`; Branch→PR presence continuity; Merged-PR durability derived statelessly |
| `architecture/cli.md` | `## CLI Subcommands (Cobra)` (table alphabetized by subcommand) | Argv after `--`; `--ready` requires `--json`; Separate seam for tab new's widened creation call; `rk tutorial` types its kickoff; `rk tutorial` singleton is session-scoped; `rk tutorial` defaults to `fast`; Operator launcher mechanics owned by rk; `rk operator` hard-refuses without fab; Same-origin present targets use site-relative slot URLs; Doctor's ephemeral-servers row always present; Tmux-option-derived serving for `rk present`; `rk present` keeps the URL as stdout data; `--show` on a full 3-tile layout replaces the last slot; `rk role` acts on the current window via `$TMUX_PANE`; Cobra over custom CLI parsing; `rk code-server update` skips when nothing is managed; Binary/server version drift is a doctor-only note |
| `architecture/testing.md` | `## Testing` (+ Go / Frontend / Playwright subsections) | e2e palette opener defocuses only on retry; Shared frontend test scaffolding imported per-test; `stubMatchMedia` covers only the predicate family; Shared Go test scaffolding is `internal/testutil`; Board e2e pin cleanup registry layer; Intent lives in a JSDoc block above each test; Valid-layout fixtures use surviving surface kinds |

Sub-domain stub `architecture/index.md` is created BEFORE regeneration with only a `description:`
frontmatter block, e.g.:

```yaml
---
description: "System architecture split by write-axis: overview (system, data model, SPA serving, security), repo layout, backend packages, the tmux runner, PR-status collector, CLI subcommands, and testing layers."
---
```

### 2. Sections and decisions moved to EXISTING files outside `architecture/`

| Content | Destination | Placement |
|---|---|---|
| `## Chrome Architecture` (whole section, 96 lines) | `ui/routes-and-shell.md` | new `## Chrome Architecture` section before that file's `## Design Decisions` |
| `## Boards Feature` (+ Route Placement / Backend Surface / Constitution Alignment) | `ui/boards.md` | new `## Architecture Placement` section before its `## Design Decisions` |
| DDs: Derived chrome; Single-view layout; Dashboard as inline component in app.tsx; Sidebar + drawer pattern on mobile; Active window sync; `isActiveWindow` event-derived; `currentWindowEverSeen` gate; CSS Grid topology; Sidebar collapses to 0px; Single `sidebarOpen` boolean; `<Shell>` as shared wrapper; `Shell` owns the desktop sidebar aside; `FocusedTerminalContext` separate context; Read-only setter pair (`setSidebarWidth`/`persistSidebarWidth`); Mobile sidebar overlay via grid | `ui/routes-and-shell.md` `## Design Decisions` | appended |
| DDs: Hamburger statically rendered at TopBar.left; Open-in-app wraps `wt`; Derived `${sshUser}@hostname` deeplink host | `ui/top-bar.md` `## Design Decisions` | appended |
| DDs: Sticky modifier state via useRef + forceUpdate; Docked compose strip as native textarea; Armed modifiers bridge to physical keyboard | `ui/compose-and-bottom-bar.md` `## Design Decisions` | appended |
| DDs: Full ANSI palette over minimal color set; Static tmux.conf with ANSI indices | `ui/visual-design.md` `## Design Decisions` | appended |
| DDs: The code lens keys on the derived folder; The code lens widens `deriveGitRoot` | `ui/lenses-and-layout.md` `## Design Decisions` | appended |
| DD: Backend settings file over localStorage-only | `configuration.md` `## Design Decisions` | appended |
| DD: The code-server embed rides a stable `/code/*` route | `api-and-sockets.md` `## Design Decisions` | appended |

If a destination file has no `## Design Decisions` section, create one as its last section.
Entries are moved byte-for-byte (heading + four fields); no rewording.

### 3. `architecture.md` becomes a map file

Replace the body with the `ui-patterns.md` shape: frontmatter
`description: "Map file — the architecture content moved to the architecture/ sub-domain (plus ui/routes-and-shell, ui/boards); routes old architecture.md section references (historical logs, code comments) to their new homes."`,
a short notice ("Do not add content here — write to the topic file instead"), and a table mapping
every old `##`/`###` section name and every Design-Decision title to its new file. The
Design-Decision rows may be grouped ("Design Decisions — prstatus collector (14 entries) → architecture/pr-status") but each old body section must have a row.

### 4. Repository Structure trimmed

`architecture/repo-layout.md` keeps the tree at directory granularity only: `app/backend/{cmd/rk,internal,api,frontend,build}`,
`app/frontend`, `app/code-bridge`, `app/desktop`, `config/`, `scripts/`, `.github/`, `fab/`, `docs/`,
`VERSION`, `justfile`, each with a one-line purpose and a pointer: `cmd/rk/` → `architecture/cli.md`,
`internal/` → `architecture/backend-packages.md`, `api/` → `api-and-sockets.md`, `scripts/` and
`.github/` → `build-and-release.md`. Before deleting a per-file line, check that its fact exists at the
pointer target; a fact that exists nowhere else (e.g. a `cmd/rk/skill/*.md` embed note, an `api/*.go`
handler not named in `api-and-sockets.md`) is folded into the pointer target's table or prose in the
same change rather than dropped. Loss check: every `.go`/`.md` filename present in the old tree must
appear somewhere in `docs/memory/run-kit/` after the change.

### 5. Table hygiene

- Both tables (`backend-packages.md` packages, `cli.md` subcommands) are sorted alphabetically by
  their first column (`(none)` root row stays first in the CLI table; `mux init-conf`/`mux reap`/`mux snapshot` sort under `m`).
- Rows whose description already ends with a "full contract in [X](/run-kit/X.md)" pointer are
  cut to one or two sentences that keep: the package/verb's one-line purpose, the pointer, and any
  fact that the pointer target does NOT contain (verify by grep before cutting). Rows without a
  pointer are moved verbatim.
- The two extracted rows (`internal/tmux`, `internal/prstatus`) become body prose in their new
  files: content verbatim, but the single 20 KB line is re-flowed into paragraphs at the row's
  own `**Bold lead** —` sentence boundaries so future edits hit different lines. A short
  one-row entry stays in the packages table pointing at the new file.

### 6. Links and indexes

- Memory links are bundle-relative (`](/run-kit/architecture.md)`). `log.md` and `log.seed.md` are
  NOT edited (log.md is generated; both resolve via the map file).
- In sibling memory files and `docs/specs/*.md`, a link or `§` citation whose section is now
  unambiguous (e.g. `architecture.md § Testing`, `architecture § internal/updatecheck`,
  `architecture.md § Design Decisions → Open-in-app`) is retargeted to its new file/section.
  Bare `[architecture](/run-kit/architecture.md)` links with no section context stay as-is
  (they resolve to the map file).
- After all moves: create the sub-domain stub index, then run `fab docs-index docs/memory` once
  to regenerate root/domain/sub-domain indexes and logs. Then `fab docs-index docs/memory --check`
  must exit 0 or 1 (no destructive loss).
- No-dangling-link guard: `grep -rhoE '\]\(/run-kit/[^)#]+' docs/memory | sort -u` — every target
  must exist on disk.

### 7. Verification (loss checks)

- Heading census: the multiset of `###` Design-Decision titles across all destination files equals
  the 107 titles in the old `## Design Decisions` (script: extract, sort, diff).
- Body census: every old `##`/`###` body heading appears exactly once in a destination file.
- Byte census: total bytes of moved DD entries and moved body sections are within the trim budget —
  only §4 (tree) and §5 pointer-row cuts may shrink content; log which rows were cut and by how much.
- `fab docs-index docs/memory --check` clean or benign drift only.

## Affected Memory

- `run-kit/architecture`: (modify) becomes a map file — old section → new home table
- `run-kit/architecture/index`: (new) sub-domain index (stub description, then generated)
- `run-kit/architecture/overview`: (new) system overview, data model, SPA serving, embedded assets, security + architecture-level DDs
- `run-kit/architecture/repo-layout`: (new) trimmed directory-level repository tree with pointers
- `run-kit/architecture/backend-packages`: (new) alphabetized `internal/` package table + external Go deps + package DDs
- `run-kit/architecture/tmux-runner`: (new) `internal/tmux` package + tmux runner core + runner DDs
- `run-kit/architecture/pr-status`: (new) `internal/prstatus` collector + 14 prstatus DDs
- `run-kit/architecture/cli`: (new) alphabetized Cobra subcommand table + CLI DDs
- `run-kit/architecture/testing`: (new) testing layers + test-scaffolding DDs
- `run-kit/ui/routes-and-shell`: (modify) gains `## Chrome Architecture` + 15 shell DDs
- `run-kit/ui/boards`: (modify) gains `## Architecture Placement` (route placement, backend surface, constitution alignment)
- `run-kit/ui/top-bar`: (modify) gains 3 DDs
- `run-kit/ui/compose-and-bottom-bar`: (modify) gains 3 DDs
- `run-kit/ui/visual-design`: (modify) gains 2 DDs
- `run-kit/ui/lenses-and-layout`: (modify) gains 2 DDs
- `run-kit/configuration`: (modify) gains 1 DD
- `run-kit/api-and-sockets`: (modify) gains 1 DD
- `run-kit/index`: (modify) regenerated — architecture row description + `architecture/` sub-domain row
- `run-kit/log`, `run-kit/architecture/log`: (modify) regenerated by `fab docs-index`

## Impact

- **Files**: `docs/memory/run-kit/**` only. No source code, no specs body changes (at most link
  retargets in `docs/specs/project-plan.md`).
- **Tooling**: `fab docs-index docs/memory` (index + log regeneration). No new dependencies.
- **Downstream**: future hydrates route architecture content by the new `description:` frontmatter;
  the map file absorbs legacy citations. `_preamble` § Memory File Lookup already supports the
  3-part `{domain}/{sub-domain}/{file}` form (ui/ precedent).
- **Risk**: content loss during the 107-entry redistribution — mitigated by the census scripts in §7.
- **Scale**: one ~393 KB file → seven files of roughly 8–120 KB plus edits to 8 existing files.

## Open Questions

- None blocking. See Assumptions #10 for the pointer-row trim depth.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Sub-domain `run-kit/architecture/` (not a new top-level domain) | User asked for "a folder called architecture"; `ui/` sub-domain is the in-repo precedent; `_preamble` supports 3-part addressing | S:95 R:70 A:95 D:95 |
| 2 | Confident | Seven topic files: overview, repo-layout, backend-packages, tmux-runner, pr-status, cli, testing | Derived from per-section hunk counts and the two 18–23 KB single rows; below the soft ≥8 sub-domain bound but the cluster is genuine | S:80 R:75 A:85 D:70 |
| 3 | Confident | Chrome Architecture → `ui/routes-and-shell`; Boards Feature → `ui/boards` | Discussed and approved; hydrate routes by description and "shell"/"boards" already point there | S:85 R:75 A:85 D:80 |
| 4 | Confident | DD destination mapping as tabulated in What Changes §1–§2 | Assigned by reading each title; a handful (e.g. `FocusedTerminalContext`, `sanitizeEnv`) have two plausible homes — chosen by nearest existing section | S:75 R:80 A:75 D:65 |
| 5 | Confident | Repo tree trimmed to directory level with pointers; per-file facts folded into pointer targets before deletion | Approved item 4; loss check by filename census | S:80 R:70 A:80 D:75 |
| 6 | Certain | Alphabetize package and CLI tables | Approved item 5; mechanical | S:90 R:95 A:95 D:95 |
| 7 | Confident | `internal/tmux` and `internal/prstatus` rows become own files, content verbatim, re-flowed at `**Bold** —` sentence boundaries | Single 20 KB lines defeat line-level merging; re-flow is whitespace-only in rendered output | S:70 R:80 A:85 D:75 |
| 8 | Confident | `architecture.md` kept as a map file; log.md/log.seed.md links untouched | Approved item 6; `ui-patterns.md` precedent | S:90 R:85 A:90 D:85 |
| 9 | Certain | Indexes/logs regenerated once via `fab docs-index docs/memory`; stub index before regen | `/docs-reorg-memory` apply contract | S:90 R:95 A:95 D:95 |
| 10 | Tentative | Pointer-bearing rows cut to 1–2 sentences only when the pointer target contains every fact being removed; otherwise moved verbatim | "Shorten" was approved but the depth was not specified; erring toward keeping facts | S:55 R:70 A:65 D:50 |
| 11 | Confident | Only `§`-anchored citations in sibling files are retargeted; bare `[architecture](/run-kit/architecture.md)` links stay | Un-anchored links have no dominant target once the file is a map; map file keeps them valid | S:70 R:85 A:80 D:70 |

11 assumptions (3 certain, 7 confident, 1 tentative, 0 unresolved).
