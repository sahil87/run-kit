# Quake Terminal — Rename, Resize, Docked Compose

**Drafted**: 2026-09-12 · against `aba7f345` · from the 2026-09-12 `/fab-discuss` session on the operator console drawer
**Shape**: 6 changes, one repo (run-kit) — 0→1→2→3→4 strictly sequential (each starts from merged main); 5 (data table) is file-disjoint and may run in parallel from its own worktree
**Contract of record**: `docs/wiki/operator-console-drawer-studies.html` (Studies A–F + the recommendation table; Study C is a live resize mock) · pre-change truth in `docs/memory/run-kit/ui/operator-console.md` (plus `focus-ownership.md`, `top-bar.md`, `keyboard-and-palette.md`) · post-change truth lands in the renamed `docs/memory/run-kit/ui/quake-terminal.md`

## Decisions of record

- The feature currently called the **operator console** (the ⌘J drawer + the top-bar omnibox) is renamed **quake terminal**. The omnibox becomes the **quake launcher**. "Quake console" was offered as the more literal name (three of four drawer tabs are lists) and declined.
- The **one-input rule stands**: the compose seam in `lib/operator-console.ts` remains the single draft/send/error owner. Only *where its one view renders* moves — into the drawer while open.
- While the drawer is open, the launcher **collapses to glyph + chord** (state dot kept) — it does not disappear; the page heading returns to the top-bar center cell.
- Resize goes **independent-edge** (geometry gains `centerOffsetPx`); symmetric-about-center is retired because a corner cannot follow the pointer under it (Study C, "Today" mode).
- Hiding the operator session's tmux status bar is **parked**: tmux status is per-session, so `status off` on `_rk-operator` also strips it from full tty views.
- (2026-09-12, second round) The **operator window's route wears the quake surface on desktop** too — mobile already does (`operatorConsoleTabs = isMobile && role === "operator"` in `app.tsx`); the desktop drawer becomes a peek of the same component. **No synthetic route**: an always-present Operator sidebar row is wanted, but its empty state opens the drawer (an overlay needs no URL) rather than inventing `/$server/operator` (Constitution IV fixed route set; a window-less row would have to redirect once the operator exists).
- **Cron is ungated from the operator.** Today no operator window ⇒ no cron tabs on either form factor, though cron needs no operator (agents `rk cron add`; entries target any role/session). Cron List / Cron Log render whenever the server resolves; only Operator Terminal / Operator Tasks keep the operator dependency.
- **Tables move to TanStack Table**, not shadcn/Radix: Radix has no table primitive and shadcn's data table is TanStack underneath plus a dependency tree (Radix, cva, tailwind-merge, a generated `components/ui/`) the project deliberately does not carry. Headless model, our rendering.

## Standing context (carry into every change's intake)

- **Files**: `app/frontend/src/components/operator-console.tsx` (drawer + mobile tongue), `components/operator-omnibox.tsx` (top-bar input), `components/operator-context-chip.tsx`, `lib/operator-console.ts` (machine, compose seam, geometry/opacity stores, event seam), `lib/palette/operator-console.ts`, `components/top-bar.tsx` (center cell, `omniboxMorphed`), `app.tsx` (root mount, palette rows, `operator-console` action id), `lib/keybindings.ts:318` (⌘J builtin), e2e `tests/e2e/operator-console.spec.ts` (+ `window-heading.spec.ts`, `web-view-lens.spec.ts` reference the omnibox).
- **Load-bearing invariants to preserve** (memory § The ⌘J two-state machine): (a) focus-origin capture never records an element inside the compose's own wrapper; (b) the focus restore on `rest` runs only while the compose still owns focus. Both move with the compose, unchanged.
- **Esc ladder**: the console's document listener owns the release to `rest`; a nested `role="dialog"` inside the drawer (inline cron sheet) stands it down. The docked compose adds the compose strip's existing first rung — Esc blurs to the embedded terminal — *before* the drawer collapse rung.
- **Constitution**: IV (open/closed and pin are ephemeral component state; geometry/opacity are the localStorage carve-outs), V (every new control — pin — gets a palette entry), Test Intent Comments (e2e `test()` JSDoc updated in the same commit), no change-ID citations in code comments.
- **Verification per change**: `npx tsc --noEmit` + the affected Vitest suites + scoped e2e (`just test-e2e operator-console`, plus `window-heading` for changes 0 and 2) — never the full suite as a gate.
- **Memory hygiene**: a file rename breaks same-directory `](x.md)` links — resolve relative links across the whole `docs/memory/run-kit/ui/` folder, not only `](/run-kit/…)` forms (project memory: memory-split-relative-links).

## Sequencing & merge topology

Strictly **0 → 1 → 2 → 3 → 4**, each its own fab change + draft PR off fresh `origin/main`, merged on green CI. All five touch `operator-console.tsx` (→ `quake-terminal.tsx`) / `lib/operator-console.ts` and the same memory sections, so parallel branches would conflict. The rename goes first so the rest are authored in the new vocabulary and their review diffs carry no rename noise. **Change 5 is the exception**: it edits `watched-table.tsx`, `cron-list.tsx`, `cron-log.tsx` (+ a new `data-table.tsx`) — none of which 0–4 touch — so it runs from its own worktree at any point; if it lands mid-ladder, the next ladder change rebases over it trivially. The design study and its `docs/specs/index.md` wiki row landed on main with this plan.

Lane hints: 0, 1 and 4 are light-lane candidates (mechanical / self-contained / small); 2, 3 and 5 are the full lane.

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

## Change 3 — the operator page (slug: `quake-terminal-operator-page`)

**Intake seed**: The operator window's terminal route renders the quake terminal full-screen on desktop — segment strip above the tty tile, docked compose below, non-terminal segments swapping the body — so the drawer is a peek of the same surface; a server without an operator gets a **Start operator** button in the Operator Terminal segment and a placeholder pinned row that opens the drawer.

1. **One component, two variants**: `QuakeTerminal` gains `variant: "drawer" | "page"`. The page variant is what the mobile operator route already renders (`operatorConsoleTabs` in `app.tsx:946` + `TerminalActivityTabs` at `:5313` + the compose strip): drop the `isMobile` term from the gate so desktop takes the same treatment — strip above the tty tile, `?tab=terminal|tasks|list|log` as the segment state (the mobile deep-link contract, `router-url.ts`), non-terminal tabs **hide** (never unmount) the terminal column, the route's compose strip docked below (change 2's docked compose is this same strip in the drawer). The tty tile stays the ordinary `TerminalClient` — the operator page is the tty lens of a `role === "operator"` window wearing the strip, not a fifth lens; `surface-layout` / `?layout=` semantics are untouched.
2. **Drawer ⇄ page**: the recorded rule "desktop openers are inert on the resolved operator route" (memory § Desktop openers) stays — on the operator route ⌘J focuses the page's docked compose instead of opening a duplicate drawer; the toast is retired in favor of the focus. A drawer segment click while on another route keeps opening the drawer (peek); the drawer header gains an `⤢ open as tab` control navigating to `/$server/@N?tab=<segment>` (mobile's navigation arm, now also on desktop).
3. **Start operator**: with no `role === "operator"` window on the resolved server, the Operator Terminal segment (drawer and page) renders a `Start operator` button (`Control` primitive, wide variant) in place of the `NO_OPERATOR_HINT` line, plus the hint as its sub-line. Click → `POST /api/operator/start` `{server}` (new route, `api/operator.go`): argv-exec `rk operator -L <server>` via `exec.CommandContext` with a 30 s timeout (Constitution I; the cron respawn path already invokes `rk operator -L` this way — verify it resolves for a server the daemon did not create), 202 with `{windowId}` on success, structured 409 when an operator already exists (race), 5xx with the CLI's stderr line otherwise. The client navigates to `/$server/<windowId>` on success (page) or retargets the drawer's terminal (drawer). Palette: `Operator: Start operator` (gated on absence — degrade to absent, never disabled). `rk` skill/tutorial text mentions the button where it names `rk operator`.
4. **Always-present pinned row**: `sidebar/index.tsx` `operatorEntry === null` currently renders nothing (memory § Operator Pinned Row → Carrier resolution). Render a **placeholder row** instead — `HeadsetIcon` + `operator` + a `not running` sub-label in `text-text-secondary`, no status dot, `draggable=false`, not selectable, no kill/pin cluster, `data-testid="operator-placeholder-row"` — whose activation dispatches `requestQuakeTerminal({ action: "open", segment: "terminal" })` (the drawer, where the Start button sits). Roving-tabindex: it joins the tree as the group's leading row exactly as the real pinned row does. Once a carrier appears the placeholder is replaced by the ordinary pinned `WindowRow` (no animation). Board-route sidebars (no console handler wired) omit the placeholder.
5. **Tests**: app-shell gate test (desktop operator route shows the strip), e2e `operator-console.spec.ts` (⌘J on the operator route focuses the page compose; `open as tab` lands on `?tab=`), new `operator-page.spec.ts` (Start operator against a fresh e2e tmux server: button → window appears → route navigates; placeholder row opens the drawer), Go tests for the route (argv shape, 409 on existing operator, timeout).

Non-goals: mobile behavior changes (it already has the page); any change to the operator's launcher resolution (`fab agent operator -o yaml` stays inside `rk operator`); auto-starting the operator (strictly user-initiated — the `rk operator` help text's opt-in posture).

Memory: `ui/quake-terminal.md` gains § The operator page (variant table, the drawer⇄page rule, Start operator), `ui/sidebar.md` § Operator Pinned Row gains the placeholder; `api-and-sockets.md` + `docs/specs/api.md` gain `POST /api/operator/start`; `routes-and-shell.md` § global overlay notes the page variant. Constitution IV check in the intake: no new route — `/$server/$window` with `?tab=` is the existing shape.

## Change 4 — cron tabs ungated (slug: `cron-tabs-ungated`)

**Intake seed**: Cron List and Cron Log render whenever a server resolves — the operator gate stays only on the two operator segments — so a server with no operator still has its cron registry and log in the drawer and on the operator page.

1. **Gate split**: in the drawer body the `target && server` guard applies to `terminal` (and the Start button of change 3) and `tasks` only; `list` / `log` render on `server` alone (`useCronData(server)` needs nothing else). `CronStaleBanner` keeps its own `operatorStale` gate (it renders nothing without an operator tick — already degrade-to-absent).
2. **Mobile**: the mobile cron tabs live on the operator route, so an operator-less server has no mobile home for them (the drawer renders nothing on mobile, and a `?tab=list` deep-link needs the operator window's route). Proposed placement, to be confirmed in the intake: the tmux Server page's WATCHED zone footer (`server-watched-zone`) gains a `Cron` disclosure carrying `CronList` inline — the Server page already hosts the fleet view and the one watched-list component (memory routes-and-shell § One watched-list component), and no route is added. If the intake rejects that placement, park mobile operator-less cron explicitly and ship the desktop half.
3. **Copy**: the `◷` status-bar chip and the `Operator: Show cron list / log` palette rows stop requiring an operator (their availability derivation drops the operator term); `no server resolved — cron list unavailable` stays the only hint.
4. **Tests**: console unit test (list/log render with `target === null`), e2e `operator-console.spec.ts` (◷ chip on an operator-less server opens Cron List), `mobile-cron-tabs.spec.ts` unchanged, plus the mobile placement's own spec.

Memory: cron-console-tabs § One four-segment strip / § Mobile parity reworded; `cron.md` § Dashboard (spec `docs/specs/cron.md` lines ~359–434 describe the operator-gated strip) — update the spec's gating sentence too.

## Change 5 — one data table (slug: `data-table-tanstack`) — parallel-capable

**Intake seed**: Operator Tasks, Cron List and Cron Log render through one shared `DataTable` over `@tanstack/react-table` — sortable on every column, resizable columns, per-viewer sort/width persistence — replacing the hand-rolled `<table>` and the two div-row lists.

1. **Dependency**: `@tanstack/react-table` (headless, zero deps, ~14 kB gz; same family as the router already in `dependencies`). No shadcn, no Radix, no `components/ui/`.
2. **`components/data-table.tsx`**: generic `DataTable<Row>({ columns, rows, initialSort, storageKey, dense, inline, rowProps })` — renders `<table>` inside an `overflow-x-auto` wrapper (the constitution's table exception), header cells as `Control`-primitive buttons carrying `aria-sort` and the sort glyph, `columnResizeMode: "onChange"` with widths as CSS variables on `<col>`, `enableColumnResizing` off on coarse pointers (touch has no resize gesture — sorting by header tap stays), min column widths so six columns survive the 420px drawer floor and the 375px mobile route with horizontal scroll rather than wrapping. Row rendering is delegated per surface (the cell renderers keep `StatusDot`, chips, `NoteLine`, dimming via `rowProps`), so nothing visual changes at rest.
3. **Three consumers**: `watched-table.tsx` (six columns: status, session, change, awaiting, note, repo — today the only real `<table>`) keeps `dense`; `cron-list.tsx` becomes columns label · target · schedule · rung · deliver · next · flags, **initial sort = `sortCronEntries`** (soonest-fire-first, no-`nextFire` last) expressed as the table's default sorting so the recorded scenario holds at rest; `cron-log.tsx` becomes columns entry · outcome · when, **initial sort = API order** (most-recent-first) — a user sort is an additive client override. Row dimming (`isCronDimmed`, `data-done`), the inert deleted-entry row, `+ New entry`, the empty/no-server hints, and the row-click → detail sheet / navigate behaviors are unchanged.
4. **Persistence**: sort + column widths per table in localStorage (`runkit-table-<id>` — one JSON key each; the `use-local-storage-enum.ts` pub/sub idiom with numeric clamping, as the console geometry store does), Constitution IV carve-out. Palette: `Table: Reset columns` (resets the focused/visible table's widths + sort — Constitution V's keyboard path for the mouse-only resize).
5. **Tests**: `data-table.test.tsx` (sort toggling, `aria-sort`, resize writes widths, storage round-trip with corrupt-value fallback), updated `cron-list.test.tsx` (default order unchanged; header click re-sorts), `watched-table` tests, e2e `mobile-cron-tabs.spec.ts` + `operator-console.spec.ts` selectors (rows keep their `data-testid`s).

Non-goals: virtualization (row counts are small; revisit if `deliveries` grows), column visibility toggles (TanStack supports it — leave off until asked), any change to the data hooks.

Memory: cron-console-tabs § Cron List is the registry / § Cron Log is deliveries only (sorting sentences: default order + user override), routes-and-shell § One watched-list component (now over `DataTable`), a new `ui/data-table.md` or a section in `visual-design.md` (the intake decides), `architecture/repo-layout.md` dependency list.
