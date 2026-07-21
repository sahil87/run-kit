# Intake: Server Tile Diet — Window Counts & Hover-Action Removal

**Change**: 260721-bylc-server-tile-diet-window-counts
**Created**: 2026-07-21

## Origin

Synthesized from a fab-discuss session (2026-07-21/22) in which the user reviewed 5 rendered
mockup options for slimming the sidebar SERVER panel and chose **Option 1: tighten the existing
two-line tile in place**. Dispatched promptlessly (`/fab-proceed` create-intake dispatch,
`{questioning-mode} = promptless-defer`) — no questions were asked; the discussion itself
resolved the major decisions.

> Sidebar SERVER Panel — Tighten Tiles In Place, Window Counts, Remove Hover Actions.
> Decisions: (1) keep the two-line tile shape but tighten ≈48px → ≈38px (stripe `h-1`→`h-0.5`,
> body `pt-1`→`pt-0.5`, count-row reserve `h-4`→`h-3.5`, reserve stays fixed-height); the TOP
> edge remains the server signature/active marker — top border = server, left border = window
> rows. (2) Count shows WINDOWS, not sessions: bare number on the tile, full wording in the
> `title` tooltip. (3) Backend window count via `#{session_windows}` in the tmux layer, summed
> per server in `handleServersList`, surfaced as `windowCount` on the servers response.
> (4) Remove the hover-revealed palette/✕ action cluster from server tiles (these actions live
> in the SESSIONS-pane server-group headers since PR #432 / x4sf). (5) Add a command-palette
> `Server: Kill…` listing all servers as the escape hatch for the SESSIONS pane's `current`
> scope mode. (6) Grid floor 88px → 72px. (7) Delete the redundant server name from the SERVER
> panel header. (8) Lower the panel height constants (56 → ~50).
>
> Rejected alternatives (from the mockup comparison): single-line chips (~26px), dense
> name-fold (`runKit·5`, ~24px), fixed switcher strip — user explicitly chose "tightened in
> place". Left-border active marker on tiles — rejected; breaks the server-vs-window visual
> distinction. Color-only waiting dot — rejected; the waiting rollup keeps its numeric pill.

## Why

1. **Pain point**: the SERVER panel spends ≈48px of tile height plus a 56px panel floor on
   low-information ink. "N sess" is the weakest signal on the tile (windows are the unit users
   actually navigate); the hover palette/✕ cluster duplicates actions that moved to the
   SESSIONS-pane server-group headers in PR #432 (x4sf); and the panel header repeats the server
   name already shown by the highlighted tile and the top-bar page heading. Every pixel the
   SERVER panel holds is a pixel the SESSIONS tree below cannot use.
2. **If we don't fix it**: the sidebar stays dominated by a panel whose content is one row of
   tiles; the desktop tile keeps a hover-action cluster inconsistent with mobile (which never
   had it) and redundant with the SESSIONS headers; and the `current` scope mode keeps a latent
   gap — after cluster removal, non-current servers would lose their only kill affordance if no
   palette escape hatch is added.
3. **Why this approach**: the user compared 5 rendered mockups and explicitly chose "tighten in
   place" (Option 1) over single-line chips, name-folds, and a fixed switcher strip — it keeps
   the established two-line anatomy (name line + count line) and the top-stripe server signature
   while reclaiming ~10px per tile and ~6px of panel floor. Windows-not-sessions was judged the
   higher-information count; the bare number plus tooltip keeps the tile narrow enough for a
   72px grid floor.

## What Changes

### 1. Tile tightening in place (`app/frontend/src/components/sidebar/server-panel.tsx`)

Keep the two-line tile shape (name line + count line); tighten from ≈48px to ≈38px total:

- **Top color stripe**: `h-1` (4px) → `h-0.5` (2px), currently `server-panel.tsx:311`. The TOP
  edge remains the server signature/active marker — explicit user decision: **top border =
  server, left border = window rows**; the visual distinction between the two element classes is
  the point. (Left-border active-marker mockups were explicitly rejected for this reason.)
- **Body padding**: `pt-1` → `pt-0.5` on the body div (currently
  `className="px-1.5 pt-1 pb-1.5"`, line 313). The horizontal `px-1.5` and bottom `pb-1.5` MAY
  tighten slightly if it looks right — target ≈38px total tile height; default is to keep them.
- **Count row reserve**: `h-4` (16px) → `h-3.5` (14px) on the flex row (line 327). The reserve
  MUST remain a **fixed height**: agents flipping between waiting/busy must never change tile
  height or the whole grid row jumps — this is the current `h-4`'s documented purpose (see the
  code comment at lines 323–326); preserve that comment's intent at the smaller size.

### 2. Count shows WINDOWS, not sessions

Replace the `{sessionCount} sess` text (line 328–330) with a **bare window-count number**
(e.g. `5`), sourced from the new `windowCount` field (§3). Full wording moves into the tile
button's `title` tooltip — currently `title={name}` (line 306); extend it to include e.g.
`"5 windows across 2 sessions"` (singular-aware: `"1 window across 1 session"`). "sess" was
judged the lowest-information ink on the tile.

The **WaitingBadge stays on the count row** in its numeric-pill form — right-aligned on the same
flex row, exactly as today. (The old comment justifying count-row placement by collision
avoidance with the hover cluster becomes obsolete once the cluster is removed — the badge stays
on the count row regardless; it's the right place. Update the comment, keep the placement.)

### 3. Backend window count

`handleServersList` (`app/backend/api/servers.go:24`) already fans out
`s.tmux.ListSessions(ctx, name)` per server. tmux `list-sessions` exposes `#{session_windows}` —
add it to the format string in `ListSessions` (`app/backend/internal/tmux/tmux.go:657`):

```go
// current (5 fields):
format := fmt.Sprintf("#{session_name}%s#{session_grouped}%s#{session_group}%s#{session_group_size}%s#{@session_color}", ...)
// add: %s#{session_windows} as a 6th field, parsed into a new SessionInfo field (e.g. Windows int)
```

- Parse the new field in `parseSessions` (`tmux.go:536`) into `SessionInfo` (tmux.go:527).
  Summation happens over the sessions `parseSessions` **keeps** — its session-group-copy filter
  means grouped duplicates are already excluded, so no double counting of shared windows.
- Sum `Windows` per server inside the existing `handleServersList` fan-out (no new subprocess;
  works for unattached servers, unlike the SSE-derived window stream which only covers attached
  servers).
- Surface as a new field on the `serverInfo` response struct (`servers.go:14`) —
  `WindowCount int \`json:"windowCount"\`` — and on the frontend `ServerInfo` type
  (`app/frontend/src/api/client.ts:591`): `windowCount: number`.
- **Keep `sessionCount` alongside** — verified consumer: the Host overview page tiles
  (`app/frontend/src/components/host-overview-page.tsx:331,363`) render `{sessionCount} sess`.
  Keeping both is the safe default; no rename.
- Note: `SessionInfo` is JSON-tagged and flows into session-list responses; the new field is
  additive (extra JSON key), which no existing consumer breaks.

### 4. Remove the hover-revealed action cluster from server tiles

Delete the `showActions` block in `ServerTile` (`server-panel.tsx:340–366`: the palette button
and the ✕ kill button), plus the now-dead plumbing **on the tile and panel**: `onColorClick`,
`onKill`, `colorPickerOpen`/`colorPickerNode`, the portalled `SwatchPopover` + `popoverPos`
`useLayoutEffect`, and — since nothing else in the panel uses them — the `ServerPanel` props
`onKillServer` / `onServerColorChange` and their `colorPickerFor` state. These actions live in
the SESSIONS-pane server-group headers since PR #432 (x4sf). The cluster is already desktop-only
(`!isMobile`), so removal makes desktop consistent with mobile. Callers threading those props
into `ServerPanel` (`components/sidebar/index.tsx`) shed the dead wiring; the SESSIONS-pane
group-header kill/color paths are untouched.

### 5. Command-palette `Server: Kill…` listing all servers

Escape hatch for the SESSIONS pane's `current` scope mode, where non-current servers have no
group header and would otherwise lose their kill affordance entirely after §4.

Grounding correction from source: a `Server: Kill` palette entry **already exists**
(`app/frontend/src/app.tsx:2153–2157`) but targets only the **current** server
(`setKillServerTarget(server)`). Replace it with per-server entries following the existing
`Server: Switch to ${name}` enumeration pattern (`app.tsx:2179–2183`), e.g.
`Server: Kill ${name}` with the current server labeled `(current)`. Reuse the existing
kill-server flow: `setKillServerTarget(name)` → the inline confirmation Dialog in `app.tsx`
(~line 2882, including its `DAEMON_SERVER` warning) → `executeKillServer`. (The change
discussion pointed at `kill-dialog.tsx`, but that dialog handles only session/window kills —
the server-kill confirm is the inline `killServerTarget` Dialog; use that.) Board mode's palette
carries no server entries today and is out of scope.

### 6. Grid floor 88px → 72px

`server-panel.tsx:107–120`: desktop `gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))"`
→ `minmax(72px, 1fr)`; mobile `gridAutoColumns: "88px"` → `"72px"` to match. The 88px floor
existed only to fit "N sess" + waiting badge side by side (see the comment at lines 116–119);
a bare number + badge fits at 72px. Update that comment to explain the new floor.

### 7. Delete the redundant server name from the panel header

`headerRight` in `ServerPanel` (`server-panel.tsx:100–105`): remove the
`<span …>{server}</span>` — the highlighted tile and the top-bar page heading already show it.
**Keep the refresh spinner** (`{refreshing && <LogoSpinner size={10} />}`) behavior.

### 8. Lower the panel height constants

`server-panel.tsx:140–142`: `defaultHeight={56}` / `minHeight={56}` / `mobileHeight={56}` → `50`
to match the shrunken one-row height, so saved pixels actually go to the SESSIONS tree below.
Exact value verified visually during apply (target: one tile row + padding, no clipping).

### 9. Host overview page — explicitly unchanged

`host-overview-page.tsx` / `host-panel.tsx` consume `ServerInfo` too. This change keeps their
tiles rendering `{sessionCount} sess` unchanged (the `windowCount` field is available to them
but not displayed) — minimal scope, nothing silently breaks.
<!-- assumed: host overview tiles keep "N sess" and do NOT gain a window count this change — the discussion left this open ("decide or defer"); deferring display there is the minimal-scope safe default and trivially reversible -->

### Tests (required by code-quality.md; constitution § Test Companion Docs)

- `server-panel.test.tsx` — update: bare window-count rendering (replaces the `"N sess"`
  assertions at lines 80–82 etc.), absence of the hover action cluster (rework/remove the
  existing kill/palette-button tests at lines 134–151), layout constants (stripe/reserve/grid
  floor/heights as asserted), tooltip wording.
- Backend — window-count summation: `parseSessions` 6-field parsing in
  `internal/tmux/tmux_test.go` and per-server summation in `api/servers_test.go`.
- Palette entry — test the per-server `Server: Kill ${name}` listing; front-runner pattern is an
  extracted testable builder in `src/lib/` mirroring `palette-version.ts` / `palette-move.ts`
  (both have colocated unit tests).
- Playwright: `app/frontend/tests/e2e/server-panel-grid.spec.ts:59` asserts
  `text=/\d+ sess/` in the grid — this changes with §2, so its sibling
  `server-panel-grid.spec.md` MUST be updated in the same commit.

## Affected Memory

- `run-kit/ui-patterns`: (modify) sidebar SERVER panel section — tile anatomy (stripe/padding/
  reserve sizes), windows-not-sessions count semantics + tooltip, hover-action removal (actions
  now exclusively in SESSIONS-pane group headers + palette), 72px grid floor, panel heights,
  palette `Server: Kill {name}` listing
- `run-kit/architecture`: (modify) API response shape — `windowCount` on the GET /api/servers
  `serverInfo` entry; `SessionInfo` gains a windows field in the tmux layer

## Impact

- **Frontend**: `app/frontend/src/components/sidebar/server-panel.tsx` (+ its test),
  `app/frontend/src/components/sidebar/index.tsx` (dead prop threading),
  `app/frontend/src/api/client.ts` (`ServerInfo`), `app/frontend/src/app.tsx` (palette
  `serverActions`; possibly a new `src/lib/palette-*.ts` builder + test),
  `app/frontend/tests/e2e/server-panel-grid.spec.ts` + `.spec.md`.
- **Backend**: `app/backend/internal/tmux/tmux.go` (`ListSessions` format, `SessionInfo`,
  `parseSessions`) + `tmux_test.go`; `app/backend/api/servers.go` (`serverInfo`, summation)
  + `servers_test.go`.
- **Constraints honored**: WaitingBadge keeps its numeric pill + count-row placement;
  Constitution V — the palette listing keeps kill keyboard-reachable; Constitution IX — kill
  stays the existing POST endpoint, no API-verb changes; Constitution II — window count derived
  from tmux at request time, no caching.
- **Untouched**: SESSIONS-pane server-group headers (x4sf), Host overview tile display,
  board-page palette, kill-dialog.tsx.

## Open Questions

- None blocking. The single deliberately-open item — whether Host overview tiles should also
  display window counts — is recorded as Tentative assumption #16 (default: unchanged this
  change) and can be revisited via /fab-clarify or a follow-up change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Keep two-line tile; tighten in place to ≈38px: stripe `h-1`→`h-0.5`, body `pt-1`→`pt-0.5`, count reserve `h-4`→`h-3.5`, reserve stays fixed-height | Discussed — user chose Option 1 from 5 rendered mockups; exact values specified | S:95 R:85 A:90 D:95 |
| 2 | Certain | Top edge remains the server signature/active marker; no left-border marker | Discussed — explicit user decision (top=server, left=window rows); left-border mockups rejected | S:95 R:80 A:90 D:95 |
| 3 | Certain | Tile count shows bare window-count number; full wording moves to the `title` tooltip | Discussed — "sess" judged lowest-information ink; windows are the navigation unit | S:90 R:90 A:90 D:90 |
| 4 | Confident | Tooltip wording: `"{N} windows across {M} sessions"`, singular-aware | User said "or similar" — exact phrasing delegated; matches existing tooltip conventions | S:65 R:95 A:80 D:70 |
| 5 | Certain | Backend: append `#{session_windows}` to the `ListSessions` format string, sum per server in `handleServersList`, expose `windowCount` on `serverInfo`/`ServerInfo` | Discussed with mechanism named; verified the fan-out exists at servers.go:41–71 — no new subprocess | S:95 R:85 A:95 D:90 |
| 6 | Certain | Keep `sessionCount` alongside `windowCount` (no rename) | Verified consumer: host-overview-page.tsx:331,363 renders `{sessionCount} sess`; discussion named keeping both as the safe default | S:80 R:90 A:95 D:85 |
| 7 | Confident | `SessionInfo` gains an additive `Windows` field (6th parsed field); per-server sum counts only `parseSessions`-kept sessions, so group-copy filtering prevents double counting; extra JSON key is additive for session-list consumers | Inference from tmux.go:527–623 mechanics — the group filter already dedupes; additive JSON breaks no consumer | S:70 R:80 A:85 D:75 |
| 8 | Certain | Remove the hover palette/✕ cluster (`showActions` block, server-panel.tsx:340–366) | Discussed — actions live in SESSIONS-pane group headers since PR #432 (x4sf); cluster is desktop-only, removal matches mobile | S:95 R:85 A:90 D:95 |
| 9 | Confident | Dead plumbing removed through the panel surface: tile props `onKill`/`onColorClick`/color-picker portal AND `ServerPanel`'s `onKillServer`/`onServerColorChange` props + `colorPickerFor` state + caller threading | Verified nothing else in the panel uses them post-removal; description says "if nothing else uses it" — it doesn't | S:70 R:80 A:80 D:75 |
| 10 | Confident | Palette: replace the existing single current-server `Server: Kill` entry (app.tsx:2153) with per-server `Server: Kill {name}` entries following the `Server: Switch to {name}` pattern; current server labeled `(current)` | Existing entry discovered during grounding; enumeration pattern is established in the same `serverActions` block | S:70 R:90 A:80 D:65 |
| 11 | Certain | Server-kill confirmation reuses the inline `killServerTarget` Dialog in app.tsx (~2882, incl. DAEMON_SERVER warning) — not `kill-dialog.tsx` (session/window only) | Verified in source; corrects the discussion's `kill-dialog.tsx` pointer to the actual flow | S:80 R:90 A:95 D:90 |
| 12 | Certain | Grid floor 88px→72px on BOTH desktop `minmax` and mobile `gridAutoColumns`; update the explanatory comment | Discussed — floor existed only for "N sess"+badge width; bare number+badge fits 72px | S:95 R:90 A:90 D:95 |
| 13 | Certain | Delete the server name from `headerRight`; keep the refresh spinner | Discussed — name duplicated by highlighted tile + top-bar heading | S:95 R:95 A:95 D:95 |
| 14 | Confident | Panel height constants `defaultHeight`/`minHeight`/`mobileHeight` 56→50 | Discussion gave "~50"; exact value visually verified during apply | S:75 R:95 A:70 D:70 |
| 15 | Confident | Horizontal `px-1.5` / bottom `pb-1.5` padding kept unless needed to hit ≈38px ("may tighten slightly if it looks right") | Discussion delegated to visual judgment with a keep-default; verified via Playwright screenshots during apply | S:50 R:95 A:55 D:50 |
| 16 | Tentative | Host overview tiles unchanged this change (keep `{sessionCount} sess`; no window-count display there) | Discussion explicitly left this open ("decide or defer"); minimal-scope default, trivially reversible, revisit via /fab-clarify or follow-up | S:30 R:80 A:40 D:30 |
| 17 | Certain | Test surface: server-panel.test.tsx (count rendering, no hover actions, layout), tmux_test.go 6-field parse, servers_test.go summation, palette-entry test, server-panel-grid.spec.ts `\d+ sess` regex + sibling `.spec.md` in the same commit | code-quality.md requires tests for changed behavior; constitution § Test Companion Docs binds the `.spec.md`; verified spec.ts:59 asserts the old text | S:90 R:85 A:95 D:90 |
| 18 | Confident | Palette-entry test via an extracted builder in `src/lib/` (mirroring `palette-version.ts`/`palette-move.ts` + colocated tests); plan may choose app-level testing instead | Established pattern verified in src/lib; front-runner but not the only valid placement | S:60 R:90 A:80 D:65 |

18 assumptions (10 certain, 7 confident, 1 tentative, 0 unresolved).
