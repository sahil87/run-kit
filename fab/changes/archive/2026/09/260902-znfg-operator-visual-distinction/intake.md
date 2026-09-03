# Intake: Operator Visual Distinction

**Change**: 260902-znfg-operator-visual-distinction
**Created**: 2026-09-02

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a user-approved synthesized description. The design was worked out in a prior discussion session around an HTML design study ("Operator Distinction — Design Study", `operator-distinction-studies.html`, session scratchpad); the user confirmed the framing (role is identity, not status), chose the headset glyph, and approved all four surfaces from the mock's variant **A1 + B1**. The louder alternatives (A2 sidebar micro-header, B2 `[ OPERATOR ]` bracket tag) and every status-channel encoding were explicitly considered and rejected.

> **Operator visual distinction** — give the operator window a legible identity across the UI. The pinned operator row (260813-ifya) was deliberately placement-only; that stance is stale now that the operator is a functional actuation target (fix-tab-name 260822-fih1, compose 260822-wyn3, update-annotations) and `hasOperator` gates other rows' affordances. Today nothing tells the user they are typing at the coordinator vs a worker. Role gets the one free identity channel: **glyph-before-name** — a headset stroke SVG on four surfaces: WindowRow, top-bar center heading (quiet B1), window switcher ▾ dropdown, command palette window rows.

## Why

1. **The pain point**: the operator window has become a functional role — it receives actuation requests (`fix-tab-name`, compose/spawn, update-annotations) and its presence (`hasOperator`) gates affordances on *other* rows — yet it is visually indistinguishable from any worker window. The top-bar heading reads `Tab: <name>` identically for the coordinator and a worker, so a user can type a task into the wrong pane. The pinned sidebar row (260813-ifya) reads as an unexplained orphan floating above the session groups: placement alone signals "special" without saying *what*.

2. **If we don't fix it**: mis-addressed input at the coordinator vs a worker (the operator executes what it's told — a worker prompt pasted there actuates the wrong machinery), and the pinned row stays illegible to anyone who didn't read the changelog. As more operator actuation surfaces ship, the missing identity compounds.

3. **Why this approach**: the signal channels are already budgeted — hue belongs to the status dot's two-family model, the marker well to mode×stage, the rest-state trailing glyph to PR state, motion to flairs. Role is *identity*, not *status*: it does not change over a window's life the way status does, so it takes the one free identity channel — a **glyph before the name** — the same channel a filetype icon uses in an editor tab. Every status-channel alternative (reserved hue, accent-green name, row-wide wash, dot/marker encoding, persistent flair) is a channel-discipline violation and was rejected in the design session. The user confirmed this framing.

## What Changes

### 1. `HeadsetIcon` in `app/frontend/src/components/sidebar/icons.tsx`

A new shared stroke-SVG icon in the file's existing idiom (`stroke="currentColor"`, `strokeWidth={2}`, round caps/joins, 24-unit viewBox, `aria-hidden="true"`, `size` prop defaulting to 13 — the `PaletteIcon`/`GearIcon`/`BotIcon`/`ComposeIcon` precedent). A headset is the literal "operator" metaphor. Exact approved geometry (verbatim from the design mock):

```tsx
<svg width={size} height={size} viewBox="0 0 24 24" fill="none"
     stroke="currentColor" strokeWidth={2} strokeLinecap="round"
     strokeLinejoin="round" aria-hidden="true">
  <path d="M4 14v-2a8 8 0 0 1 16 0v2" />                     {/* headband arc */}
  <rect x="3" y="13" width="4.5" height="6" rx="1.8" />       {/* left earcup */}
  <rect x="16.5" y="13" width="4.5" height="6" rx="1.8" />    {/* right earcup */}
  <path d="M21 19v.5a3 3 0 0 1-3 3h-4" />                     {/* mic boom */}
</svg>
```

Color treatment everywhere it renders: `text-text-secondary` at rest, brightening to `text-text-primary` with row hover / current state (via the row's existing group-hover/current classes). The **same token in both themes** — no per-theme special case.

### 2. `WindowRow` — glyph between the status dot and the window name (mock variant A1)

`app/frontend/src/components/sidebar/window-row.tsx`: when `win.role === "operator"`, render the 13px `HeadsetIcon` between the `<StatusDot win={win} />` and the name span (`window-row.tsx` ~line 877–893). Keyed off the **row's own data** (`win.role`), not the mount site — so it rides every `WindowRow` mount for free: the pinned operator row on the terminal-route sidebar AND the board-route multi-server pinned rows, plus the defensive in-session mount cases (mixed-content `_rk-operator`, legacy cosmetic-era operator in a work session). Ordinary rows (`role !== "operator"`) render exactly as today — **no layout shift**: the glyph is conditionally mounted, not a reserved slot. The glyph is decorative (`aria-hidden` per the icons idiom) and non-interactive (no pointer handlers; it must not affect the rename hit-area or the row's drag/click behavior).

### 3. Top-bar center heading — quiet glyph (mock variant B1)

`app/frontend/src/components/top-bar.tsx`: when `mode === "terminal"` and `currentWindow?.role === "operator"`, render a ~14px `HeadsetIcon` between the page-type prefix span and the window name. Decisions fixed by the user:

- The page-type prefix is **KEPT** — explicitly NOT an `Operator:` page type. The page-type axis means *surface kind*, not *window role*. (Note: the shipped prefix constant is `Tab:` — `WINDOW_PREFIX`, renamed from the lens-following prefixes by 260714-uco1; the discussion's "`Terminal:` prefix is kept" statement maps to this shipped `Tab:` prefix unchanged.)
- **NO `[ OPERATOR ]` bracket tag** — the louder B2 variant was considered and not chosen.
- The glyph is a **static sibling OUTSIDE the window name's inline-rename hit-area** (the `WindowHeading` rename button/input), and outside the boot-sweep cell string — the sweep continues to render over `prefix + " " + name` exactly as today; the glyph is not a sweep cell and does not animate.
- Same rest/hover token treatment as the sidebar (`text-text-secondary`, matching the prefix's secondary tone).

### 4. Window switcher ▾ dropdown — glyph on the operator row

The terminal-route window switcher is `BreadcrumbDropdown` fed by `windowItems` (`top-bar.tsx` ~line 535, built from `currentSession?.windows`). Thread the role through: extend `BreadcrumbDropdownItem` (`app/frontend/src/contexts/chrome-context.tsx` — today `{ label, href, current? }`) with an optional field so the operator window's row renders the `HeadsetIcon` before its label in `breadcrumb-dropdown.tsx`. Non-operator rows unchanged. (In practice the operator window appears in this per-session list only when the current session is its carrier — typically `_rk-operator` while viewing the operator — but the rendering is data-keyed, not surface-special-cased.)

### 5. Command palette window rows — glyph + plain `operator` meta hint

The palette's per-window switch entries (`windowSwitchActions` in `app/frontend/src/app.tsx`, `Tab: Switch to {session} › {name}`) get, for `fw.window.role === "operator"`:

- the `HeadsetIcon` rendered on the row, and
- a plain-text `operator` meta hint (the `PaletteAction.description` secondary-text idiom — it joins the filter haystack, so typing "operator" finds the row; this is also the accessible text channel for the role, since the glyph is `aria-hidden`).

`PaletteAction` (`command-palette.tsx`) has no icon slot today (`{ id, label, description?, shortcut?, … }`) — add a minimal optional glyph seam (e.g. `icon?: ReactNode` rendered before the label in the palette row) rather than special-casing operator entries in the palette renderer. Scope: **window-navigation entries only** — the existing operator-actuation palette entries (compose etc.) are not in scope for glyph decoration.

### Explicitly out of scope / rejected (recorded so review doesn't re-litigate)

- `[ OPERATOR ]` sidebar micro-header above the pinned row (mock variant A2) — **HOLD**; judge after this ships.
- Reserved hue / accent-green name / row-wide wash — channel-discipline violations (green = health semantics; wash = T4 marker-well texture).
- Encoding role in the status dot or marker well; persistent flair/motion; an `Operator:` page-type prefix.
- No new user-facing *action* — purely visual identity, so nothing new to register in the command palette (Constitution V is satisfied by the existing action registry; the palette change here decorates existing rows).
- No backend/API/tmux changes — `win.role` (from `@rk_win_role`) already reaches every surface's data.

### Tests

- **Unit (Vitest)**: `window-row.test.tsx` — glyph renders iff `win.role === "operator"`; ordinary rows have no glyph node. `top-bar.test.tsx` — heading glyph conditional on `currentWindow.role`; prefix text unchanged; glyph outside the rename button. Switcher item + palette row rendering (breadcrumb-dropdown / command-palette tests).
- **e2e (Playwright)**: extend `app/frontend/tests/e2e/operator-pinned-row.spec.ts` (the existing rig already marks a real `@rk_win_role=operator` window) — assert the pinned row carries the headset glyph and, on navigating to the operator window, the heading carries it; per the Test Intent Comments constitution rule, update the intent comments in the same commit.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) § Operator Pinned Row — the "Placement is the ONLY visual treatment: no badge, frame, label, divider, or any new chrome" claim becomes stale; document the glyph-before-name treatment and its data-keyed gating. Sweep sibling placement-only claims.
- `run-kit/ui/top-bar`: (modify) center page heading — the operator glyph sibling (outside rename hit-area and boot sweep); `BreadcrumbDropdownItem` extension for the window switcher.
- `run-kit/ui/keyboard-and-palette`: (modify) palette window-switch entries — glyph + `operator` meta hint; the `PaletteAction` icon seam.
- `run-kit/ui/visual-design`: (modify) channel budget — role = identity, carried by the glyph-before-name channel; record the rejected status-channel encodings so the discipline is discoverable.

## Impact

Frontend-only; no backend, API, route, or tmux changes.

- `app/frontend/src/components/sidebar/icons.tsx` — new `HeadsetIcon`
- `app/frontend/src/components/sidebar/window-row.tsx` (+ `window-row.test.tsx`) — surface 1
- `app/frontend/src/components/top-bar.tsx` (+ `top-bar.test.tsx`) — surfaces 2 & 4 (heading + `windowItems`)
- `app/frontend/src/contexts/chrome-context.tsx` + `app/frontend/src/components/breadcrumb-dropdown.tsx` (+ test) — `BreadcrumbDropdownItem` glyph seam
- `app/frontend/src/components/command-palette.tsx` (+ test) — `PaletteAction.icon` seam + row rendering
- `app/frontend/src/app.tsx` — `windowSwitchActions` operator decoration
- `app/frontend/tests/e2e/operator-pinned-row.spec.ts` — e2e assertions

Small, additive, reversible. No layout shift for non-operator rows; no new settings, routes, or state.

## Open Questions

- Should the design mock (`operator-distinction-studies.html`, session scratchpad) be committed to `docs/wiki/` with a specs-index Wiki entry, per the repo's design-study convention (8 precedents)? Deferred — promptless dispatch; resolve via `/fab-clarify`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Role is identity, not status — rendered as a glyph-before-name channel only; never hue, dot, marker well, wash, or motion | User-confirmed framing in the design discussion; rejections recorded in-intake | S:95 R:70 A:90 D:95 |
| 2 | Certain | All four surfaces (WindowRow, top-bar heading B1, window switcher ▾, palette window rows), headset SVG geometry verbatim from the mock | User approved variants A1 + B1 from the mock; exact path extracted from the approved artifact | S:95 R:75 A:90 D:95 |
| 3 | Certain | The kept page-type prefix is the shipped static `Tab:` (`WINDOW_PREFIX`, 260714-uco1); the discussion's "`Terminal:` prefix" is that same prefix by its pre-uco1 name — no `Operator:` page type, no bracket tag | Code shows `WINDOW_PREFIX = "Tab:"`; the decision (keep the page-type axis, glyph between prefix and name) transfers unchanged | S:90 R:85 A:95 D:90 |
| 4 | Certain | Icon lands as `HeadsetIcon` in `sidebar/icons.tsx`, 13px default, `aria-hidden`, sibling-icon idiom; brightening via existing row hover/current classes, same token both themes | File's established icon idiom (PaletteIcon/GearIcon/BotIcon precedent) determines every parameter; treatment stated in the approved description | S:90 R:90 A:90 D:90 |
| 5 | Confident | Top-bar glyph is a static sibling between the prefix span and the `WindowHeading` rename button, NOT a boot-sweep cell — the sweep string stays `prefix + " " + name` | Description fixes "static sibling outside the inline-rename hit-area"; keeping it out of the sweep cell list is the minimal mechanic that preserves the animation contract <!-- assumed: glyph excluded from boot-sweep cells — sweep renders text cells only; a non-text glyph cell would need new sweep machinery for no design gain --> | S:75 R:80 A:75 D:70 |
| 6 | Confident | `BreadcrumbDropdownItem` gains a minimal optional field (glyph/operator flag) rendered by `breadcrumb-dropdown.tsx` before the label | Only seam available — items are `{label, href, current?}` plain text today; board/session dropdown consumers unaffected by an optional field | S:70 R:85 A:80 D:65 |
| 7 | Confident | `PaletteAction` gains an optional `icon?: ReactNode` slot rendered before the label; the `operator` meta hint rides the existing `description` field (joins the filter haystack) | Palette rows are text-only today; a generic optional slot beats special-casing operator rows in the renderer; `description` is the established secondary-text + filter idiom | S:70 R:80 A:75 D:60 |
| 8 | Confident | Accessibility: glyph stays `aria-hidden` per the icons idiom on all surfaces; the palette's plain-text `operator` hint is the accessible/searchable channel; no sr-only spans added to rows in v1 | Matches every sibling icon; role identity remains discoverable by text via the palette; low-risk to revisit <!-- assumed: no sr-only "operator" span on WindowRow/heading — decorative-icon idiom kept; palette text is the a11y channel --> | S:60 R:90 A:70 D:65 |
| 9 | Confident | e2e lands as an extension of `operator-pinned-row.spec.ts` (existing operator rig with a real `@rk_win_role=operator` window): pinned-row glyph + heading glyph; remaining matrix is Vitest | code-quality "UI changes SHOULD include e2e where possible"; the spec's rig already provisions the operator role, so extension beats a new spec file | S:55 R:85 A:75 D:60 |
| 10 | Unresolved | Whether to commit `operator-distinction-studies.html` to `docs/wiki/` with a Wiki index entry (the repo's design-study convention) | Deferred — promptless dispatch; user explicitly left it undecided despite knowing the convention, so it is their call | S:15 R:85 A:20 D:35 |

10 assumptions (4 certain, 5 confident, 0 tentative, 1 unresolved).
