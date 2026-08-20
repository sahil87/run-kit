# Intake: Sidebar Section-Visibility Toggle Micro-Rail

**Change**: 260817-iha5-sidebar-section-visibility-rail
**Created**: 2026-08-17

## Origin

Synthesized from a `/fab-discuss` design session (2026-08-17); all decisions below were user-approved in that session. Dispatched promptless via `/fab-proceed` (Create-Intake Procedure, `{questioning-mode} = promptless-defer`).

> **Sidebar section-visibility toggle micro-rail** — Add a horizontal micro-rail of small icon-only toggle buttons at the very top of the left sidebar, controlling the visibility of the sidebar's optional sections: **Boards, Server, Pane, Host**. Modeled on Cursor's horizontal icon row above its left panel (VSCode activity-bar-on-top pattern).

## Why

1. **The pain point (primarily mobile-driven)**: the mobile drawer always renders the PANE (`WindowPanel`) and HOST (`HostPanel`) panels at its bottom (the `isMobile && <BottomPanels/>` render gate in `sidebar/index.tsx`, made drawer-only by change 260814-ldbs). Now that the coarse status rail + three-tier cards (merged PR #640, change ve5m) carry the register detail on mobile, drawer users want to hide those panels and keep the drawer as pure navigation — but there is no way to do so. Desktop has the mirror-image gap: 260814-ldbs moved Pane/Host readouts to the full-width status bar and removed the panels from the desktop sidebar entirely, with no way to opt back in.
2. **If we don't fix it**: the mobile drawer permanently spends vertical space on panels whose information is now duplicated by the rail cards; desktop users who preferred the old in-sidebar panels have no recourse short of re-litigating the 260814-ldbs status-bar split.
3. **Why this approach**: one visibility gate per section — a micro-rail of toggle buttons — replaces the hard `isMobile` render fork with user-controlled state that defaults to today's behavior on both viewports. Desktop symmetry ships as dormant, zero-default-cost capability (defaults keep desktop exactly as it looks today), which sidesteps re-litigating 260814-ldbs until a desktop user opts in. The rail also becomes the designated home for future sidebar-level controls, avoiding a third small-chip idiom beside the ALL/CUR scope chip.

**Motivation/demand honesty (captured verbatim from the session)**: primarily mobile-driven (drawer users want to hide the Pane/Host panels now that the rail cards carry detail); desktop symmetry is a byproduct that ships as dormant, zero-default-cost capability.

## What Changes

### 1. The micro-rail component (new)

A horizontal row of four icon-only toggle buttons at the very top of the left sidebar (above `BoardsSection` in `sidebar/index.tsx`'s `<nav>`), one per optional section, in order: **Boards · Server · Pane · Host**.

- **Toggle set is exactly these four.** Sessions is deliberately EXCLUDED — the session tree is the always-on core nav surface and must not be hideable (empty-sidebar footgun). This matches the existing code posture: the Sessions panel is a plain always-open `<div>`, intentionally not a `CollapsiblePanel`.
- **Geometry (validated in the design session with an HTML size-study mock using real theme tokens)**: 24×24px buttons with 13px stroke glyphs on fine pointers — exactly the existing sidebar row-icon-system geometry (`px-0.5 min-w-[24px] min-h-[24px]`, icons in the `sidebar/icons.tsx` idiom: `stroke="currentColor"`, `strokeWidth={2}`, 24-unit viewBox, `aria-hidden`, accessible name on the button). 30×30px on coarse pointers (the shared `TOP_BAR_BUTTON` coarse size token axis — 30px, per `top-bar-overflow-menu.tsx`). ~4px gap, ~8px side padding; rail row ~32px tall; four buttons occupy ~108px, fitting the 160px sidebar min width with slack.
- **States**: `aria-pressed` toggle buttons; pressed = subtle accent-tinted fill + inset accent ring, `text-text-primary`; unpressed = `text-text-secondary` at rest, `text-text-primary` on hover.
- **Labels**: identity-tip hover cards on fine pointers (the shared slim hover-card from change xb77, `sidebar/identity-tip.tsx` idiom); NO hover labels on coarse — tapping a toggle is self-revealing (the section appears/disappears).
- **Cohesion**: the micro-rail is the designated home for future sidebar-level controls (no third small-chip idiom beside the ALL/CUR scope chip). No existing control migrates into it in this change.

### 2. Semantics: visibility, orthogonal to collapse

- Toggle-off **fully unmounts** the section — header gone, height reclaimed (and, by unmounting, the section's effects/subscriptions stop).
- The `CollapsiblePanel` chevron remains the collapse mechanism **within** a visible section. The two states are orthogonal and independently persisted: toggling a section off does not touch its persisted collapse state (`CollapsiblePanel`'s private `storageKey`s such as `runkit-panel-server` and the `-height` keys), so re-toggling on restores the section exactly as left.
- Precedent cited in the session: VSCode Explorer sections have collapse chevrons AND view-visibility checkboxes coexisting.

### 3. Defaults and persistence

- **Defaults: Boards on, Server on, Pane off, Host off — identical on both viewports.** One shared localStorage key per section (no per-viewport fork), boolean visibility state (the `use-local-storage-boolean.ts` / `use-local-storage-enum.ts` pub/sub idiom keeps the rail, the sidebar render, and the palette entries in sync within a tab).
- **This REPLACES the current `isMobile && <BottomPanels/>` render gate** in `sidebar/index.tsx` (~line 1691; change 260814-ldbs made Window/PANE + Host drawer-only): the visibility gate becomes the single gate, removing an `isMobile` branch. `BottomPanels` (the file-private `WindowPanel` + `HostPanel` wrapper) splits under the two independent Pane/Host toggles.
- Desktop keeps today's behavior by default (Pane/Host off — the full-width status bar owns those readouts per 260814-ldbs); a desktop user can now opt back in.
- Mobile drawer becomes pure nav + footer by default; the coarse status rail + tier cards (PR #640, change ve5m) carry the register detail there — which is what makes hiding the PANE panel acceptable. The `SidebarFooter` (connection dot) is not a toggleable section and stays as-is.
- `BoardsSection` and `ServerPanel` gain the same visibility gating (both currently render unconditionally); their defaults (on) preserve today's rendering.

### 4. Global scope

One global answer per section — **NO per-route state**. The toggles govern the sidebar wherever it renders. The Sidebar mounts in two places — `app.tsx` (terminal/server routes) and `components/board/board-page.tsx` (`/board/$name`); the Host Overview `/` renders no sidebar, so the global answer trivially covers it. No route exemptions: hiding Boards applies on `/board/$name` too (the palette and the rail itself are the recovery paths).

### 5. Keyboard-first (Constitution V)

One command-palette entry per section: `Panel: Toggle Boards` / `Panel: Toggle Server` / `Panel: Toggle Pane` / `Panel: Toggle Host`. These are also the recovery path if a user toggles sections off and forgets the rail. (New palette actions must be documented per the palette-registration review rule.)

### 6. Known accepted consequences (user-approved)

- The board-route focused-tile PANE fallback (change 260720-zx4i — the PANE panel following the focused board tile) becomes **opt-in** (Pane defaults off).
- The PANE-header refresh button's function remains reachable via the palette's `PR: Refresh Status` (`lib/palette-status-refresh.ts`, id `status-refresh`) when the panel is hidden.

### Alternatives rejected (user-approved rationale, verbatim)

- **Including Sessions in the toggle set** — always-on nav; footgun.
- **Toggle-replaces-collapse semantics** — chevron and toggle control different things: collapse keeps a one-row header landmark, toggle removes the section.
- **Per-viewport defaults/keys** — default-off on both viewports is simpler; one shared key per section.
- **20px buttons** — cramped beside 24px panel headers, undershoots touch even with coarse override. **28px buttons** — visually competes with the SERVER panel header directly below.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) new § for the section-visibility micro-rail (geometry, states, orthogonality to collapse, defaults, storage keys); rewrite the `BottomPanels`/`isMobile` gate description and the BoardsSection/ServerPanel "always visible" language
- `run-kit/ui/keyboard-and-palette`: (modify) register the four `Panel: Toggle {Section}` palette actions
- `run-kit/ui/boards`: (modify) sidebar boards section is now visibility-gated (default on)
- `run-kit/ui/status-signals`: (modify) note that the PANE panel (and the board-route focused-tile fallback) is opt-in via the rail; the coarse rail cards are the default mobile register surface

## Impact

- **Frontend only** (`app/frontend/src/`): `components/sidebar/index.tsx` (rail mount, section gating, `BottomPanels` split), a new rail component + new icons in `components/sidebar/icons.tsx`, a small visibility hook (per-section boolean over the existing localStorage pub/sub idiom), palette action registration (`app.tsx` / `hooks/use-global-palette-actions.ts` neighborhood), `sidebar/identity-tip.tsx` consumption.
- **No backend, API, or route changes.** No new pages (Constitution IV); state is client-side localStorage (an existing accepted pattern for UI chrome preferences — not request-time server state, so Constitution II is untouched).
- **Render performance**: the rail must not disturb the sidebar memo tree (R6a invariants in `sidebar.md` § Render Performance) — visibility state is rail-local/hook-local, not new churning props through `ServerGroup`.
- **Tests**: unit tests for the rail + hook (Vitest, colocated); Playwright e2e for toggle → section unmount/remount + persistence, both viewports (375px + desktop), with `.spec.md` companions per Constitution. Existing mobile e2e specs that assume the drawer's PANE/HOST panels exist by default will need updating to the new defaults (or to toggle the section on first).

## Open Questions

- None — the design session resolved all decision points; remaining implementation choices are graded in Assumptions below. (Promptless dispatch: no questions were asked; no decision landed Unresolved.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Toggle set = Boards · Server · Pane · Host; Sessions excluded (always-on nav, empty-sidebar footgun) | Discussed — user-approved decision 1 | S:95 R:70 A:90 D:95 |
| 2 | Certain | Visibility is orthogonal to collapse: toggle-off fully unmounts (header gone, height reclaimed); chevron collapse and its persisted state untouched; re-toggle restores as left | Discussed — user-approved decision 2 (VSCode Explorer precedent) | S:95 R:75 A:90 D:90 |
| 3 | Certain | Defaults Boards on / Server on / Pane off / Host off, identical on both viewports; one shared localStorage key per section; replaces the `isMobile && <BottomPanels/>` gate as the single gate | Discussed — user-approved decision 3 | S:95 R:70 A:90 D:90 |
| 4 | Certain | Global scope: one answer per section, no per-route state; governs the sidebar wherever it renders | Discussed — user-approved decision 4 | S:90 R:75 A:85 D:90 |
| 5 | Certain | Geometry: 24×24 buttons / 13px stroke glyphs (sidebar row-icon-system + `sidebar/icons.tsx` idiom) on fine; 30×30 on coarse (shared TOP_BAR_BUTTON coarse size); ~4px gap, ~8px side padding, ~32px rail row | Discussed — user-approved decision 5, validated with HTML size-study mock; 20px/28px rejected | S:95 R:85 A:90 D:90 |
| 6 | Certain | States: `aria-pressed` toggles; pressed = accent-tinted fill + inset accent ring + text-primary; unpressed = text-secondary rest / text-primary hover | Discussed — user-approved decision 6 | S:90 R:90 A:85 D:85 |
| 7 | Certain | Labels: identity-tip hover cards (xb77 `sidebar/identity-tip.tsx` idiom) on fine pointers only; no hover labels on coarse (toggle is self-revealing) | Discussed — user-approved decision 7 | S:90 R:90 A:90 D:90 |
| 8 | Certain | Palette entries `Panel: Toggle Boards/Server/Pane/Host`, one per section — also the recovery path (Constitution V) | Discussed — user-approved decision 8; names given verbatim | S:95 R:90 A:90 D:90 |
| 9 | Certain | Rail is the designated home for future sidebar-level controls; nothing migrates into it now (no third small-chip idiom beside ALL/CUR) | Discussed — user-approved decision 9 | S:85 R:90 A:85 D:85 |
| 10 | Confident | Storage: four boolean keys named in the project's `runkit-*` convention (e.g. `runkit-sidebar-section-boards` etc.), implemented over the existing `use-local-storage-boolean`/`use-local-storage-enum` pub/sub idiom so rail, sidebar render, and palette stay in sync | Session fixed "one shared key per section" but not names/mechanism; existing hooks are the obvious project pattern | S:50 R:70 A:85 D:65 |
| 11 | Confident | "Host page" in the session's scope decision resolves to a no-op: the Sidebar mounts only in `app.tsx` and `board-page.tsx`; Host Overview `/` renders no sidebar (verified in code), so global scope needs no third mount | Code-verified; reconciles a session-note discrepancy without changing behavior | S:60 R:80 A:85 D:70 |
| 12 | Confident | Toggle glyphs: four new lucide-style stroke icons in `sidebar/icons.tsx` (one per section, e.g. boards-grid / server / pane-panel / host-activity silhouettes), exact shapes chosen at apply | Session fixed the icon idiom + size, not the specific glyph shapes; easily revised | S:45 R:85 A:70 D:50 |
| 13 | Confident | No route exemptions: hiding Boards applies on `/board/$name` too; palette + rail are the recovery. Rail itself is always visible (not self-hideable) | Follows from user-approved decisions 4 and 8; empty-rail footgun mirrors the Sessions rationale | S:70 R:80 A:80 D:70 |

13 assumptions (9 certain, 4 confident, 0 tentative, 0 unresolved).
