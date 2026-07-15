# Intake: Host / tmux Server Vocabulary Rename

**Change**: 260715-zs1y-host-tmux-server-rename
**Created**: 2026-07-15

> **Sequencing hold — RELEASED (2026-07-15)**: this change was held for `260715-h1ck-top-bar-overflow-chevron-menu` (touches `top-bar.tsx`). h1ck squash-merged to main as PR #368; this worktree was rebased onto `origin/main` (4efef347) the same day, so h1ck's top-bar changes are present here. No sequencing constraint remains — file line references below were refreshed post-rebase.

## Origin

Conversational (`/fab-discuss` session, 2026-07-15). The user started from a copy-simplification request and iterated to a full vocabulary rename:

> "In the drop down from the top bar's middle section … the options are: 'Server Cabin: <TmuxServerName>' and 'CockPit'. Change this…" → *(iteration)* → "ok, what about changing to 'tmux Server' and 'Host' everywhere? (Drop the word Cockpit and Cabin). Within the page, make the page heading: 'tmux Server Overview' and 'Host Overview'. I would want to match the internal vocabulary also to this — (very soon I would myself forget what Cockpit is)"

Key decisions reached in discussion:

- **"Cockpit" → "Host"** and **"Server Cabin" → "tmux Server"**, dropping the old words entirely (an earlier "System"/"TMUX Server" candidate was revised to this).
- One canonical noun per page: nav short form (`Host`, `tmux Server: <name>`), in-page long form (`Host Overview`, `tmux Server Overview`).
- **Internal vocabulary follows the UI** — identifiers, comments, docs, constitution — not display copy alone. The user explicitly wants no residual "Cockpit"/"Cabin" to re-learn later.
- The rename *converges* UI copy with existing internals: the Cockpit page's code already says "host" (`host-metrics.tsx`, `HOST HEALTH` zone, "host-console" comments) and "server" already means tmux server (`/$server`, `serverCount`, `TMUX SERVERS` zone). "Cockpit"/"Cabin" were the outliers.
- One atomic change — splitting display copy from internal rename would leave mixed vocabulary in between.

## Why

1. **Pain point**: "Cockpit" and "Server Cabin" are invented metaphors that map to nothing else in the system. The internals already use "host" and "server" for the same concepts, so the codebase carries two vocabularies for one thing. The user (the project's sole operator) expects to forget what "Cockpit" means.
2. **Consequence of not fixing**: every future conversation, doc, and code comment pays a translation tax between UI words and internal words; the drift compounds as more features reference these pages.
3. **Why this approach**: renaming to "Host" / "tmux Server" is not a third vocabulary — it promotes the *existing internal* names to the UI, eliminating the split rather than moving it. Alternatives rejected: "System" (first-draft candidate, less precise than "Host" given the page's zones are all host-scoped); display-copy-only rename (leaves the internal vocabulary the user wants gone).

## What Changes

### 1. Top-bar heading constants (the load-bearing edit)

`app/frontend/src/components/top-bar.tsx:1199-1200` (post-#368 rebase) — the page-type prefix constants drive both the center heading and the hierarchy dropdown (`HierarchyDropdown`, items built from the same constants at `top-bar.tsx:288-293`, so dropdown and headings cannot drift):

```ts
// before
const CABIN_PREFIX = "Server Cabin:";
const COCKPIT_SOLO = "Cockpit";
// after (renamed identifiers AND values)
const TMUX_SERVER_PREFIX = "tmux Server:";
const HOST_SOLO = "Host";
```

`WINDOW_PREFIX = "Window:"` and `BOARD_PREFIX = "Board:"` are unchanged. Resulting copy:

- Terminal-route hierarchy dropdown items: `tmux Server: <server>`, `Host`.
- `/$server` center heading: `tmux Server: <server>` (with `▾` before the colon, unchanged mechanics).
- `/` center heading: solo `Host`.

### 2. Command palette navigation entries

`app/frontend/src/lib/palette-nav.ts:60,67`: `Go: Server Cabin` → `Go: tmux Server`, `Go: Cockpit` → `Go: Host` (labels only; targets unchanged).

### 3. Titles and aria-labels

`top-bar.tsx`: brand home link `title="Cockpit"` (:689) → `"Host"`; left server crumb `title="Server Cabin"` (:745) → `"tmux Server"`; heading `ariaLabel={`Server Cabin ${server}`}` (:875) → `` `tmux Server ${server}` ``; `ariaLabel="Cockpit"` (:888) → `"Host"`. Note: PR #368's overflow chevron menu may carry additional old-vocabulary strings — the apply sweep must re-grep rather than trust this enumeration.

### 4. In-page headings (the only new UI)

- `/` (host page): heading **"Host Overview"** at the top of the page, above the `HOST HEALTH` zone.
- `/$server` (`ServerShell` tiles area): heading **"tmux Server Overview"** at the top of the main content.
- Visual treatment: reuse the existing heading vocabulary (`SectionHeading` / typed-sweep family from `globals.css` `rk-*` utilities) — exact treatment decided at apply; no new heading style may be invented. Must respect `prefers-reduced-motion` like all existing treatments.

### 5. Internal identifier rename

- Mode strings: `"cockpit"` → `"host"`, `"root"` → `"server"` in every mode union/switch (`TopBarProps.mode`, `HierarchyDropdown`'s `mode` prop, `app.tsx` mode derivation, palette-nav mode params, and all `mode === …` comparisons). `"terminal"` / `"board"` unchanged. Note: `"root"` was not literally old vocabulary but names the same page ("root" sounds like `/` yet means `/$server`) — renamed for coherence with the new nouns.
- Component: `ServerListPage` → `HostOverviewPage`; file `server-list-page.tsx` → `host-overview-page.tsx` (and `server-list-page.test.tsx` → `host-overview-page.test.tsx`). `ServerShell` keeps its name — already correct under the new vocabulary.
- Constants per §1 (`TMUX_SERVER_PREFIX`, `HOST_SOLO`).

### 6. Comment/prose sweep in code

All "Cockpit"/"Cabin" occurrences in comments across `app/frontend/src/` (~23 files incl. `app.tsx`, `top-bar.tsx`, `server-list-page.tsx`, `router.tsx`, `session-context.tsx`, `use-server-reorder.ts`, `waiting.ts`, `sidebar/server-panel.tsx`) and `app/backend/` (comments only: `api/boards.go`, `api/servers.go`, `api/sse_test.go`, `api/sse_subscriber_test.go`) → new vocabulary ("Host page" / "host overview" for Cockpit; "tmux Server page"/"server view" for Server Cabin, per surrounding context).

### 7. Documentation sweep

- `fab/project/constitution.md` Principle IV route names ("Cockpit `/`, Server Cabin `/$server`" → "Host Overview `/`, tmux Server `/$server`") — governance amendment: bump version 1.4.0 → **1.5.0**, update Last Amended to the apply date.
- `fab/project/context.md` — top-bar/heading descriptions.
- Specs: `docs/specs/status-pyramid.md`, `docs/specs/window-views.md`; wiki: `docs/wiki/competitive-landscape.md`.
- Memory: see Affected Memory. Regenerate the memory index with `fab memory-index` after edits (index is generated — never hand-edit).

### 8. Tests

- Unit: `top-bar.test.tsx`, `palette-nav.test.ts`, `server-list-page.test.tsx` (renamed per §5) — update copy assertions and mode-string literals.
- E2E: 10 files under `app/frontend/tests/` reference the old vocabulary (heading-text assertions and prose). Update each `.spec.ts` AND its sibling `.spec.md` companion in the same commit (constitution: Test Companion Docs). No e2e files need renaming (none are named after cockpit/cabin).
- New coverage: assertions for the two new in-page headings ("Host Overview", "tmux Server Overview") in the relevant page specs.

### Out of scope (explicit)

- **URLs/routes unchanged**: `/` and `/$server` (and the `$server` param name) stay — vocabulary rename, not a route change.
- **`fab/changes/` archives untouched** — historical artifacts keep their era's vocabulary.
- Git history / old PR titles — unavoidable, not rewritten.
- `Window:` / `Board:` prefixes and Board vocabulary — unchanged.
- `TMUX SERVERS` zone label — stays (style-uppercased section heading; lowercase "tmux" applies to title/sentence-case copy).
- `RK_HOST` env var — unrelated ("host" = bind address there); do not touch.

## Affected Memory

- `run-kit/architecture`: (modify) route/page vocabulary — Cockpit/Server Cabin references → Host Overview / tmux Server
- `run-kit/ui-patterns`: (modify) top-bar heading + hierarchy-dropdown copy, page-heading additions
- `run-kit/agent-state`: (modify) incidental Cockpit/Cabin mentions → new vocabulary

## Impact

- ~431 occurrences of cockpit/cabin (302 + 129) across ~40 files: frontend/backend source files (bulk is comment prose), 10 e2e spec files + companions, 7 docs files, constitution + context.md. Measured 2026-07-15 post-rebase onto origin/main 4efef347 (includes PR #368's top-bar overflow chevron menu).
- Behavior change is nil except the two new in-page headings; everything else is copy/identifier/prose.
- Risk concentrates in e2e heading-text assertions (they hard-code the old copy) and in the mode-string rename (`"root"` → `"server"` touches mode unions across app.tsx/top-bar/palette).
- No API, no backend behavior, no route changes.

## Open Questions

- None — decisions were resolved in the originating discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Canonical names: "Host" (was Cockpit), "tmux Server" (was Server Cabin), old words dropped entirely | User chose explicitly after iterating past "System"/"TMUX Server" | S:95 R:60 A:90 D:95 |
| 2 | Certain | In-page headings "Host Overview" (`/`) and "tmux Server Overview" (`/$server`) | User verbatim | S:95 R:90 A:85 D:90 |
| 3 | Confident | Internal vocabulary (identifiers, comments, docs, constitution) renamed too, in one atomic change | User explicit ("match the internal vocabulary also"); R lowered by sweep breadth (~430 occurrences) | S:90 R:55 A:85 D:90 |
| 4 | Confident | Mode strings `"cockpit"` → `"host"`, `"root"` → `"server"`; `"terminal"`/`"board"` unchanged | Proposed in discussion, unopposed; "root" renamed for coherence though not literally old vocabulary | S:70 R:80 A:80 D:70 |
| 5 | Confident | `ServerListPage` → `HostOverviewPage` (+ file renames); `ServerShell` kept | Proposed in discussion; ServerShell already matches new vocabulary | S:65 R:85 A:85 D:75 |
| 6 | Certain | Constants `TMUX_SERVER_PREFIX`/`HOST_SOLO`; palette `Go: Host` / `Go: tmux Server`; title/aria-label sweep | Direct consequence of §1 naming; single-source constants already drive dropdown + heading | S:75 R:90 A:90 D:85 |
| 7 | Certain | URLs and route params unchanged (`/`, `/$server`) | Discussed and pinned; rename ≠ route change | S:70 R:85 A:90 D:85 |
| 8 | Certain | Constitution Principle IV amended, version 1.4.0 → 1.5.0 | Governance block requires version/date on amendment | S:75 R:90 A:90 D:85 |
| 9 | Certain | `fab/changes/` archives keep old vocabulary | Historical artifacts record their era; rewriting them falsifies history | S:60 R:95 A:90 D:80 |
| 10 | Confident | Page-heading visual treatment reuses existing heading vocabulary (SectionHeading / typed-sweep family); exact pick at apply | Style unspecified by user; constitution/context mandate the shared hover/heading vocabulary; easily reversible | S:55 R:90 A:75 D:60 |
| 11 | Certain | Lowercase "tmux" in all title/sentence-case copy incl. heading start; all-caps `TMUX SERVERS` zone label stays | User wrote the lowercase forms; official tmux styling; zone label is style-uppercase | S:90 R:95 A:85 D:85 |
| 12 | Certain | E2E `.spec.ts` edits ship with `.spec.md` companion updates in the same commit | Constitution: Test Companion Docs | S:85 R:90 A:95 D:95 |

12 assumptions (8 certain, 4 confident, 0 tentative, 0 unresolved).
