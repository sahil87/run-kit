# Intake: Sessions-Pane Server-Group Header — Color-Picker and Close Buttons

**Change**: 260721-x4sf-sessions-header-color-close-actions
**Created**: 2026-07-21

## Origin

Promptless dispatch (`/fab-proceed` create-intake, `{questioning-mode} = promptless-defer`) from a user directive following the merge of PR #431 (change t1ca, `fab/changes/archive/260720-t1ca-sidebar-server-group-header-tint/` — the SESSIONS-pane server-group headers became tinted bars carrying each server's color).

> "add the color picker, and the close button on the server rows now. Order: Color palette, Plus, Close."

The directive is a follow-on: now that each server-group header is a tinted bar carrying the server's color, the header should also host the server's actions. Today the header has only the `+` (new session) button; the user wants a three-button cluster in this exact order (left to right): **color palette, plus, close**.

## Why

1. **Pain point**: The SESSIONS-pane server-group header (t1ca) now visually *represents* the server — its tint IS the server color — but the header offers no way to change that color or to kill the server. Both actions exist only on the SERVER panel tiles (`server-panel.tsx`), a separate collapsible panel that is collapsed to 56px by default; and since PR #428 the SESSIONS pane is scope-toggleable independently of SERVER-pane expansion, so a user working entirely in the SESSIONS pane has no direct affordance for server color or server kill on the very element that displays the color.
2. **Consequence of not fixing**: The tinted header invites a "click to change the color" interaction it cannot satisfy; server management stays split across two panels, and the most destructive server action (kill) plus the most identity-defining one (color) are hidden behind a panel most users keep collapsed.
3. **Approach**: Reuse the existing machinery wholesale — `SwatchPopover` + the `onServerColorChange` write seam for color, the lifted `onKillServer` → confirmation-dialog flow for kill. Frontend-only; zero new API surface; the header becomes the third consumer of already-proven seams rather than a parallel path.

## What Changes

### 1. Header action cluster in `ServerGroupInner` (`app/frontend/src/components/sidebar/index.tsx`)

The server-group header today (index.tsx `ServerGroupInner`, header bar at ~:1557–1614 — verify line numbers at apply, the file is actively evolving) is a full-width tinted container div (`data-server={server}`, `data-current-server`, tint from `rowTints`/`rowBorders` via `headerTintKey`/`headerBg`/`headerAccent` at ~:1550–1555) holding:

- the flex-1 expand/collapse toggle button (`aria-label` `Expand {server} sessions` / `Collapse {server} sessions`, id `server-header-{server}`), and
- the `+` new-session button (`aria-label` `New session on {server}`), always visible.

**Change**: replace the lone `+` with a three-button cluster at the right end of the header bar, in this fixed, user-specified order:

1. **Color palette** — `PaletteIcon` (from `sidebar/icons.tsx`, same glyph the SERVER tiles use). Toggles a `SwatchPopover` anchored at the header.
2. **Plus** — the existing `+` new-session button, unchanged behavior (`onCreateSession(server)`), same `aria-label` `New session on {server}`.
3. **Close** — `✕` (`&#x2715;`, the tile/session-row kill glyph). Calls the existing `onKillServer(server)` prop.

The toggle button keeps `flex-1` and remains the dominant click target; the cluster occupies only the right-end slot where `+` sits today (constraint: the expand/collapse target must not shrink meaningfully).

**Presentation** follows the established sidebar row convention (session rows, `session-row.tsx` ~:223–251): the palette button is hover-revealed with touch fallback (`opacity-0 group-hover:opacity-100 coarse:opacity-100` — the PR #257 vocabulary), while `+` and `✕` are always visible (exactly like the session row's `+ ×` pair). This requires the header container to carry `group` (or a scoped `group/…` variant if `group` is already claimed in the subtree). Do NOT copy the SERVER-tile behavior of hiding actions on mobile (`showActions = !isMobile …`, server-panel.tsx ~:262) — coarse pointers have no hover, and the user constraint requires palette/close to be reachable on touch (as the window-row Label picker is).

**Icon legibility on the tinted fill (t1ca)**: buttons follow the header's existing text treatment — the contrast-guarded `headerAccent` (`rowBorders`) for non-current headers / `text-text-primary` for the current one — rather than the flat `text-text-secondary` the old `+` used, so icons stay legible on the tinted fill in all themes. The close button hover goes `hover:text-red-400` (tile + session-row precedent).

### 2. Color picker — reuse `SwatchPopover` + the existing write seam

The SERVER tiles' pattern (server-panel.tsx ~:73, ~:184–202) is the model: a `colorPickerFor: string | null` state, toggled by the palette affordance, rendering

```tsx
<SwatchPopover
  selectedColor={serverColors[name]}
  onSelect={(c) => { onServerColorChange(name, c); setColorPickerFor(null); }}
  onClose={() => setColorPickerFor(null)}
/>
```

`SwatchPopover` (`app/frontend/src/components/swatch-popover.tsx`) is explicitly documented as "the single write seam every color-picking surface … funnels through" — it maps the picked family to the legacy descriptor before invoking `onSelect`; pass NO `onSelectMarker` (pure color grid, same as tiles/sessions). The write handler is the existing inline `onServerColorChange` currently passed to `ServerPanel` at index.tsx ~:1104–1113 (optimistic `setServerColors` update + `setServerColorApi` POST + toast on failure). Lift or share that handler so `ServerGroup` and `ServerPanel` funnel through ONE implementation — do not duplicate the optimistic-update/POST logic.

**Popover clipping**: the tiles portal the popover to `document.body` with `position: fixed` coordinates (server-panel.tsx, `createPortal` block) precisely to escape the panel's `overflow-y: auto` clip. The sessions list scrolls the same way — the header popover needs the same portal treatment (anchor rect measured from the palette button).

**Row-color repaint latency note (plan-relevant, not in scope to fix)**: per memory `row-color-safety-poll-latency`, server user-option color mutations emit no control-mode event and covered servers repaint on the 12s safety poll — the optimistic `serverColors` state update is what makes the local UI (header tint included) repaint immediately. Reusing the shared handler preserves this.

### 3. Close button — reuse the lifted kill confirmation flow

`onKillServer: (name: string) => void` is already a prop of `Sidebar` (index.tsx :71/:92) and is currently forwarded only to `ServerPanel` (:1101). Both parents map it to a confirmation flow:

- `app.tsx` :2513 → `setKillServerTarget(name)` → confirmation `Dialog` at :2875 ("Kill tmux server?" / "Kill server **{name}** and all its sessions? This cannot be undone.", plus the `DAEMON_SERVER` dashboard-suicide warning) → `handleKillServer` → `executeKillServer` → `killServer` (`app/frontend/src/api/client.ts:668`).
- `board-page.tsx` :1055 → its own `killServerTarget` dialog at :1191 (same wording).

**Change**: forward the same `onKillServer` prop into `ServerGroup`/`ServerGroupInner` and call it from the `✕` button. The confirmation dialog, daemon warning, navigation-after-kill, and API call are all inherited for free — tile-kill and header-kill share one path. No new dialog, no `kill-dialog.tsx` involvement (that component serves session/window rows; server kill has its own lifted dialog).

### 4. Accessibility & selectors

- New `aria-label`s follow the existing SERVER-tile wording for the same actions: `Set color for server {name}` (tile: server-panel.tsx ~:344) and `Kill server {name}` (tile: ~:355). This intentionally duplicates the tile labels in the same document — no e2e spec selects them today (verified: no hits in `app/frontend/tests/`), and unit-test queries must scope within the header container (e.g. via `[data-server="…"]`) to avoid `getByRole` duplicate-match ambiguity with the tiles.
- Existing selectors must keep working unchanged: `data-server` on the header container, `New session on {server}`, `Expand/Collapse {server} sessions` (used by `multi-server-sidebar.spec.ts`, `sessions-scope-toggle.spec.ts`, and the index.test.tsx suites).
- All three buttons are real `<button>`s in tab order (keyboard-reachable per Constitution V). Touch targets follow the header's existing `coarse:` sizing idiom.

### 5. Command palette — no work needed (verified)

`Server: Kill` already exists in the palette (app.tsx ~:2154–2157 → `setKillServerTarget(server)`). Server color-set has NO palette action anywhere today (only `Session: Set Color` / `Window: Set Color` exist) — the tile palette affordance is mouse-only, so this change introduces no *new* action class; it adds a second mouse affordance for an existing one, and the buttons themselves are keyboard-focusable. The missing `Server: Set Color` palette action is a pre-existing parity gap — note it as a plan consideration / follow-up candidate, do not silently expand scope into it.

### 6. Tests

- **Unit** (`app/frontend/src/components/sidebar/index.test.tsx`): extend using the t1ca describe-block pattern ("Sidebar — tinted server-group header fill (t1ca)", ~:946, incl. its `renderWithColors` helper ~:976). Cover: cluster renders in palette→plus→close DOM order; palette toggle opens `SwatchPopover` and a swatch pick invokes the shared color-change seam (optimistic state + API call); `✕` invokes `onKillServer(server)` (confirmation itself is the parent's, already covered by existing app-level behavior); existing toggle/`+` labels unchanged; coarse/hover visibility classes present.
- **e2e**: no new Playwright spec planned (see Assumptions #10); existing specs' selectors are untouched. If the plan does add/modify a `.spec.ts`, its sibling `.spec.md` must be updated in the same commit (constitution, Test Companion Docs).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Sidebar section — server-group header now hosts the server action cluster (palette/plus/close), sharing the SERVER-tile color write seam and lifted kill-confirmation flow; presentation follows the session-row hover-reveal + coarse fallback convention.

## Impact

- `app/frontend/src/components/sidebar/index.tsx` — `ServerGroupInner` header cluster, `ServerGroupProps` additions (`onKillServer`, color-change seam, possibly `serverColors` value already available as `serverColor` prop), sharing/lifting the `onServerColorChange` inline handler, memo-comparator note at ~:1795 (new identity-arg callbacks must respect the existing `memo` contract).
- `app/frontend/src/components/sidebar/index.test.tsx` — new unit tests (t1ca pattern).
- Read-only touchpoints (no changes expected): `swatch-popover.tsx`, `server-panel.tsx`, `kill-dialog.tsx`, `api/client.ts` (`killServer` :668, `setServerColor`), `app.tsx` / `board-page.tsx` kill dialogs, `sidebar/icons.tsx` (`PaletteIcon`).
- No backend, no new endpoints, no route changes. Frontend-only.
- Verification gates per code-quality.md: `just test-frontend`, `cd app/frontend && npx tsc --noEmit`; e2e suite must stay green (selector-compatibility assertion above).

## Open Questions

- None — the directive plus code grounding resolved all decision points (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Button order is palette, plus, close (left→right), at the right end of the header bar where `+` sits today | User-specified verbatim: "Order: Color palette, Plus, Close" | S:95 R:90 A:95 D:95 |
| 2 | Certain | Color picker reuses `SwatchPopover` + the existing `onServerColorChange` seam (index.tsx ~:1104), shared — not duplicated — between ServerPanel and the header | SwatchPopover self-documents as the single color write seam; directive explicitly forbids a parallel path | S:90 R:85 A:95 D:90 |
| 3 | Certain | Close routes through the existing `onKillServer` prop → parents' `killServerTarget` confirmation dialogs (app.tsx :2875, board-page.tsx :1191); no new dialog or handler | Kill is destructive; the lifted confirmed flow already exists and both parents implement it — reuse is free and mandated by the directive | S:90 R:85 A:95 D:90 |
| 4 | Certain | Frontend-only; no new API endpoints | `killServer` (client.ts:668) and the server-color POST already exist; constraint stated in directive | S:95 R:90 A:90 D:95 |
| 5 | Confident | Presentation follows the session-row convention: palette hover-revealed with `coarse:opacity-100` touch fallback; `+` and `✕` always visible (not the SERVER-tile `!isMobile` hide) | Session rows (session-row.tsx :223–251) are the same-pane row precedent and match the directive's touch-reachability constraint; header `+` is already always-visible | S:70 R:80 A:85 D:75 |
| 6 | Confident | aria-labels reuse tile wording — `Set color for server {name}`, `Kill server {name}`; unit queries scoped to the header container to avoid duplicate-label ambiguity with tiles | Consistent wording for identical actions; verified no e2e spec selects these labels today | S:60 R:85 A:75 D:70 |
| 7 | Confident | Icon color treatment follows the header text: `headerAccent` (non-current) / `text-text-primary` (current), close hover `text-red-400` | Directive requires legibility on the tinted fill "following the header's text treatment"; hover-red matches tile/session kill affordances | S:55 R:85 A:70 D:60 |
| 8 | Confident | Header `SwatchPopover` is portalled to `document.body` with fixed positioning anchored at the palette button | Direct precedent: server-panel portals for the same overflow-clip reason; the sessions list scrolls identically | S:55 R:80 A:80 D:70 |
| 9 | Confident | No command-palette work: `Server: Kill` exists (app.tsx ~:2156); the missing `Server: Set Color` is a pre-existing gap (tiles are mouse-only too) — recorded as a plan consideration/follow-up, not scope | Directive: "if the palette already has them, no palette work needed … do not silently expand scope"; kill verified present, color verified absent everywhere | S:60 R:85 A:70 D:65 |
| 10 | Confident | Test coverage is unit-only (index.test.tsx, t1ca pattern); no new Playwright spec | code-quality mandates unit tests (SHOULD for e2e); server-kill e2e is destructive on the shared test server and `multi-server-sidebar.spec.ts` carries a known pre-existing async race; adding e2e later is cheap if review asks | S:45 R:75 A:55 D:50 |

10 assumptions (4 certain, 6 confident, 0 tentative, 0 unresolved).
