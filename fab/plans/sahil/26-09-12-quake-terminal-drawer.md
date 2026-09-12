# Quake Terminal — Rename, Resize, Docked Compose

**Drafted**: 2026-09-12 · against `aba7f345` · from the 2026-09-12 `/fab-discuss` session on the operator console drawer
**Shape**: 3 changes, one repo (run-kit), strictly sequential — each starts from merged main
**Contract of record**: `docs/wiki/operator-console-drawer-studies.html` (Studies A–F + the recommendation table; Study C is a live resize mock) · pre-change truth in `docs/memory/run-kit/ui/operator-console.md` (plus `focus-ownership.md`, `top-bar.md`, `keyboard-and-palette.md`) · post-change truth lands in the renamed `docs/memory/run-kit/ui/quake-terminal.md`

## Decisions of record

- The feature currently called the **operator console** (the ⌘J drawer + the top-bar omnibox) is renamed **quake terminal**. The omnibox becomes the **quake launcher**. "Quake console" was offered as the more literal name (three of four drawer tabs are lists) and declined.
- The **one-input rule stands**: the compose seam in `lib/operator-console.ts` remains the single draft/send/error owner. Only *where its one view renders* moves — into the drawer while open.
- While the drawer is open, the launcher **collapses to glyph + chord** (state dot kept) — it does not disappear; the page heading returns to the top-bar center cell.
- Resize goes **independent-edge** (geometry gains `centerOffsetPx`); symmetric-about-center is retired because a corner cannot follow the pointer under it (Study C, "Today" mode).
- Hiding the operator session's tmux status bar is **parked**: tmux status is per-session, so `status off` on `_rk-operator` also strips it from full tty views.

## Standing context (carry into every change's intake)

- **Files**: `app/frontend/src/components/operator-console.tsx` (drawer + mobile tongue), `components/operator-omnibox.tsx` (top-bar input), `components/operator-context-chip.tsx`, `lib/operator-console.ts` (machine, compose seam, geometry/opacity stores, event seam), `lib/palette/operator-console.ts`, `components/top-bar.tsx` (center cell, `omniboxMorphed`), `app.tsx` (root mount, palette rows, `operator-console` action id), `lib/keybindings.ts:318` (⌘J builtin), e2e `tests/e2e/operator-console.spec.ts` (+ `window-heading.spec.ts`, `web-view-lens.spec.ts` reference the omnibox).
- **Load-bearing invariants to preserve** (memory § The ⌘J two-state machine): (a) focus-origin capture never records an element inside the compose's own wrapper; (b) the focus restore on `rest` runs only while the compose still owns focus. Both move with the compose, unchanged.
- **Esc ladder**: the console's document listener owns the release to `rest`; a nested `role="dialog"` inside the drawer (inline cron sheet) stands it down. The docked compose adds the compose strip's existing first rung — Esc blurs to the embedded terminal — *before* the drawer collapse rung.
- **Constitution**: IV (open/closed and pin are ephemeral component state; geometry/opacity are the localStorage carve-outs), V (every new control — pin — gets a palette entry), Test Intent Comments (e2e `test()` JSDoc updated in the same commit), no change-ID citations in code comments.
- **Verification per change**: `npx tsc --noEmit` + the affected Vitest suites + scoped e2e (`just test-e2e operator-console`, plus `window-heading` for changes 0 and 2) — never the full suite as a gate.
- **Memory hygiene**: a file rename breaks same-directory `](x.md)` links — resolve relative links across the whole `docs/memory/run-kit/ui/` folder, not only `](/run-kit/…)` forms (project memory: memory-split-relative-links).

## Sequencing & merge topology

Strictly **0 → 1 → 2**, each its own fab change + draft PR off fresh `origin/main`, merged on green CI. All three touch `operator-console.tsx` / `lib/operator-console.ts` and the same memory sections, so parallel branches would conflict. The rename goes first so changes 1 and 2 are authored in the new vocabulary and their review diffs carry no rename noise. The design study and its `docs/specs/index.md` wiki row landed on main with this plan.

Lane hints: 0 and 1 are light-lane candidates (mechanical / self-contained); 2 is the full lane.

---

## Change 0 — rename to quake terminal (slug: `quake-terminal-rename`)

**Intake seed**: Rename the operator console feature to *quake terminal* and the omnibox to *quake launcher* across code, test ids, labels, storage keys, memory, and the tutorial topic — a mechanical rename with zero behavior change.

Footprint measured 2026-09-12:

| Surface | Count | Notes |
|---|---|---|
| Source/test files named `operator-console*` / `operator-omnibox*` | 9 | components (4), `lib/operator-console.{ts,test.ts}`, `lib/palette/operator-console.{ts,test.ts}`, e2e spec |
| Files referencing the console/omnibox in `app/` | 42 | `grep -rli "operator-console\|OperatorConsole\|operator console\|omnibox"` |
| Distinct `data-testid="operator-(console\|omnibox)…"` | 16 | e2e + Vitest selectors move with them |
| localStorage keys | 2 | `runkit-operator-console-geometry`, `-opacity` → `runkit-quake-terminal-*`; read the old key once as a fallback so viewers keep their geometry (change 1 then extends the geometry shape) |
| Palette / keybinding labels | 2 | `keybindings.ts:318` "Operator console" (action id `operator-console`) → "Quake terminal" (id `quake-terminal`); `app.tsx` "Operator: Open console" → "Operator: Open quake terminal"; `aria-label="Operator console"` / "Collapse operator console" |
| Memory files | 6 | `ui/operator-console.md` → `ui/quake-terminal.md` (41 omnibox mentions), `focus-ownership.md`, `top-bar.md`, `keyboard-and-palette.md`, `visual-design.md`, `ui/index.md` (regenerate via `fab docs-index`) |
| Specs / skill text | 2 | `docs/specs/cron.md` (2 omnibox mentions), `app/backend/cmd/rk/skill/tutorial.md` ("operator console") — the tutorial is user-facing rk text; check `shll standards` for the skill surface |

Naming map: `OperatorConsole` → `QuakeTerminal`, `OperatorConsoleTongue` → `QuakeTerminalTongue`, `OperatorOmnibox` → `QuakeLauncher`, `requestOperatorConsole` → `requestQuakeTerminal`, `rk:operator-console` event → `rk:quake-terminal`, `ConsoleMachineState`/`ConsoleSegment`/`ConsoleGeometry` → `Quake*`, `.rk-console-*` CSS classes → `.rk-quake-*`, `data-operator-console` root marker → `data-quake-terminal`. The *operator* remains the addressee in user-facing copy ("Ask the operator…", "→ operator", `Operator: …` palette rows) — the rename is of the surface, not of who you talk to.

Non-goals: any layout, focus, or geometry change; the mobile arm's behavior (renamed only). Do not touch `operator-compose-dialog.tsx` / `operator-compose.spec.ts` (the templated request dialog is a different surface).

Risk surface: e2e specs select by test id and aria-label; palette rows are matched by label substring in several specs (the standing substring-collision rule); the `rk:operator-console` document event may be dispatched by the `?tab=` deep-link handoff in `app.tsx:964` and the ◷ cron chip — grep for every dispatcher.

## Change 1 — edge and corner resize (slug: `quake-terminal-resize`)

**Intake seed**: Every exposed edge of the quake terminal resizes — full bottom edge, both sides, both bottom corners (two axes at once) — with a hover cue on the grabbed edge, independent-edge geometry so a corner tracks the pointer, and double-click reset.

1. **Geometry**: `{heightVh, widthPx}` → `{heightVh, widthPx, centerOffsetPx}`; the reader defaults a missing offset to 0 (stored geometry survives). Clamps stay 25–85vh / 420px–96vw; the offset is clamped so the drawer never leaves the viewport (`|offset| ≤ (viewport − width)/2 − pad`), re-clamped on live viewport resize (the existing `maxWidth: 96vw` idiom plus a resize listener).
2. **Drag model**: replace `kind: "height" | "left" | "right"` with an edge mask `{x: -1|0|1, y: 0|1}` and one pointer handler: `y` → `heightVh += dy/innerHeight·100`; `x=−1` → `widthPx −= dx`, `offset += dx/2`; `x=+1` → `widthPx += dx`, `offset += dx/2`. Corners set both. Pointer capture, `.rk-quake-dragging` transition suspension, store write on pointer-up — unchanged.
3. **Grips**: bottom edge full width (the tongue stays as the visual pull tab and remains a valid grab), sides full height, two 16px bottom corners; zones extend 4–6px outside the border; cursors `ns` / `ew` / `nesw` / `nwse`. Hover or active tints that edge accent-green (the hover vocabulary: animated elements turn green; static under `prefers-reduced-motion`).
4. **Reset**: double-click any grip → `CONSOLE_GEOMETRY_DEFAULT` (55vh × 760px, offset 0).
5. **Tests**: `lib` clamp/offset unit tests (incl. old-shape read), component pointer tests for each edge and corner, e2e: drag the bottom-right corner and assert the drawer's right edge lands under the pointer.

Non-goals: any change to what the drawer contains; the mobile tongue.

Memory: rewrite § Mouse resize with per-viewer geometry persistence; Design Decisions gain "Independent edges replace symmetric-about-center" with the corner-tracking rationale.

## Change 2 — docked compose (slug: `quake-terminal-docked-compose`)

**Intake seed**: The quake terminal's compose docks at the drawer's bottom edge while open — the launcher collapses to its glyph and the page heading returns — with one header row, a pin that suspends click-away, and a 0.95 glass default.

1. **Docked compose**: while `machine === "open"` the compose seam renders as a strip at the drawer's bottom (`border-t`, header row: `◉ → operator` + `OperatorContextChip` + key hints; textarea; the `sending…`/error status line directly above it, replacing the top-edge status line). Same store (`useOperatorCompose`, `setOperatorComposeText`, `sendOperatorMessage`, `attachOperatorFiles`), same Enter semantics as the launcher today (Enter sends, focus retained). Focus-on-open targets this textarea; both focus invariants move here.
2. **Launcher**: at `rest` unchanged (standing box ≥ lg, ghost md–lg, "Ask…"/"Ask the operator…" placeholders, first keystroke opens with the draft already in the docked strip). At `open` it renders **collapsed**: glyph with state dot + chord keycap, accent border while the console owns input (`engaged`), click re-focuses the docked textarea. `omniboxMorphed` in `top-bar.tsx` stops hiding the heading — the center cell shows `PageType: name` again.
3. **Esc ladder**: Esc in the docked textarea blurs to the embedded terminal (compose strip rung); Esc with focus elsewhere in the drawer collapses (existing document listener); the nested-dialog stand-down is unchanged.
4. **One header row**: segments left; `server · agentState idleDur · tick Nm ago · ⌖ · ▼` right. Test ids `operator-console-state` / `-tick` (renamed in change 0) keep their semantics.
5. **Pin** (`⌖`, `aria-pressed`): ephemeral component state; while pinned the outside-click capture listener is not attached (Esc / chord / ▼ still collapse). Palette entry `Operator: Pin quake terminal` (toggle label). Pinned-and-unfocused, the docked compose drops its accent border (`engaged` false) so chrome never claims focus it lacks.
6. **Glass default**: `CONSOLE_OPACITY_DEFAULT` 0.90 → 0.95; settings-row test updated.
7. **Tests**: launcher tests (collapsed state, click re-focus), console tests (docked compose renders only at `open`, status line placement, pin gating the listener), top-bar test (heading visible while open), e2e `operator-console.spec.ts` (Enter from the docked strip sends once; click into the pane collapses unpinned / holds pinned; heading present while open) and `window-heading.spec.ts` (no longer hidden at `open`).

Non-goals: mobile (navigation arm unchanged — the operator route's own compose strip stays the mobile input); the tmux status bar (parked); any change to the templated-vs-direct send fork.

Memory: rewrite § The omnibox (→ § The quake launcher), § Anatomy, § The ⌘J two-state machine (focus target), § Affordance pair; Design Decisions: "Compose docks in the drawer; the launcher is a launcher" (supersedes "The omnibox is the console's compose relocated" — keep the one-seam rationale, move the location), "Pin suspends click-away", "Glass default 0.95"; `focus-ownership.md` § The Operator Console's Own Focus Return retargets to the docked textarea; `top-bar.md` center-cell section drops the heading-hides-when-morphed rule.

Known e2e risk surface: every spec that types into the omnibox at `open` (the ⌘J → type → Enter flows) now types into the docked textarea — update selectors, not flows; the outside-click settle-timeout tests gain a pinned variant.
