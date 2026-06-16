# Plan: Sidebar Drawer Accessibility (Focus Trap + Escape)

**Change**: 260613-o20f-sidebar-drawer-a11y
**Intake**: `intake.md`

## Requirements

### Focus Trap Hook: `useFocusTrap`

#### R1: Shared focus-trap hook extraction
The codebase SHALL provide a shared `useFocusTrap(containerRef, active, onEscape)` hook in
`app/frontend/src/hooks/use-focus-trap.ts` that is behavior-equivalent to the focus-cycle logic
proven in `dialog.tsx` / `command-palette.tsx`. It MUST only attach its document `keydown` listener
and steal focus while `active` is `true`, and MUST clean up on deactivation/unmount. The latest
`onEscape` callback MUST be invoked even if the caller passes a fresh closure each render (stable
ref pattern).

- **GIVEN** a component holds a ref to a container element
- **WHEN** it calls `useFocusTrap(ref, true, onEscape)`
- **THEN** the first focusable element inside the container receives focus on activation
- **AND** a `keydown` listener is attached to `document`

#### R2: Activation focuses the first focusable element
WHEN the hook transitions to `active`, it SHALL move focus to the first element inside the container
matching the focusable selector (`button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`).

- **GIVEN** the container has ≥1 focusable descendant
- **WHEN** the hook activates
- **THEN** `document.activeElement` is the first focusable descendant

#### R3: Tab cycles within the container (both directions)
WHILE active, the hook SHALL confine Tab focus to the container: forward-Tab from the last focusable
wraps to the first, and Shift+Tab from the first wraps to the last. It MUST `preventDefault` only at
the wrap boundaries; Tab between interior elements proceeds natively.

- **GIVEN** the drawer is active and the last focusable has focus
- **WHEN** the user presses Tab (no shift)
- **THEN** focus moves to the first focusable and the default Tab is prevented
- **AND** GIVEN the first focusable has focus, WHEN the user presses Shift+Tab, THEN focus moves to the last focusable

#### R4: Escape invokes `onEscape`
WHILE active, the hook SHALL call the supplied `onEscape` callback when the Escape key is pressed.

- **GIVEN** the drawer is active
- **WHEN** the user presses Escape
- **THEN** `onEscape` is invoked exactly once

#### R5: Inactive hook is inert
WHEN `active` is `false`, the hook MUST NOT attach any listener and MUST NOT move focus. When
`active` transitions from `true` to `false` (or the component unmounts), the previously-attached
listener MUST be removed.

- **GIVEN** `active` is `false`
- **WHEN** the component mounts/renders
- **THEN** no `keydown` listener is attached and focus is not moved
- **AND** GIVEN it was active and then deactivates, the listener is removed

### Mobile Drawer: Shell Integration

#### R6: Drawer traps focus only on mobile + open
`Shell` SHALL attach a `drawerRef` to the mobile overlay `<aside>` and drive `useFocusTrap` with
`active = isMobile && sidebarOpen && !!sidebarChildren`, wiring `onEscape` to the existing
`setSidebarOpen(false)` dispatch. The trap MUST NOT activate on desktop or when the drawer is closed.

- **GIVEN** a mobile viewport with the drawer open and sidebar children present
- **WHEN** `Shell` renders
- **THEN** focus lands inside the `<aside role="dialog">` on mount
- **AND** GIVEN a desktop viewport (or mobile-closed), no focus is stolen and no trap listener fires

#### R7: Escape closes the mobile drawer
WHEN the mobile drawer is open and the user presses Escape, `Shell` SHALL close it via
`setSidebarOpen(false)` — matching `Dialog`/`CommandPalette`. Existing dismissals (backdrop tap,
destination-row auto-close, hamburger) remain intact; Escape is additive.

- **GIVEN** the mobile drawer is open
- **WHEN** the user presses Escape
- **THEN** the drawer closes (`sidebarOpen` becomes false / the overlay unmounts)

#### R8: Tab confinement in the live drawer
WHILE the mobile drawer is open, Tab/Shift+Tab SHALL cycle focus within the `<aside>` and never
escape to the content behind the backdrop.

- **GIVEN** the mobile drawer is open with ≥2 focusable controls
- **WHEN** the user Tabs past the last control
- **THEN** focus wraps to the first control (and Shift+Tab from the first wraps to the last)

#### R10: Trap defers to a nested modal layer
WHILE the drawer trap is active, it MUST detect a nested modal — a `role="dialog"` element that is a
**descendant of the container but not the container itself** (e.g. `KillDialog`, which renders the
non-portaled `Dialog` inside the drawer's `<aside>`; or `PinPopover`). When such a nested layer is
present, the trap MUST stand down: (a) Escape MUST NOT invoke `onEscape` (the nested modal owns its
own Escape-close, so a single Escape dismisses only the topmost layer, not the whole drawer); and
(b) the Tab wrap MUST NOT run over the whole `<aside>` (the nested dialog's own focus trap contains
focus; running the drawer-wide wrap could move focus out of the dialog into the rows behind it).

- **GIVEN** the mobile drawer is open AND a `KillDialog`/`PinPopover` is open inside it
- **WHEN** the user presses Escape
- **THEN** only the nested modal closes; the drawer stays open (`onEscape` not fired)
- **AND** GIVEN the user presses Tab, THEN the drawer trap does not move focus (the nested modal's trap governs)

### Sidebar Bonus: Current-Row Focus on Open

#### R9: Current window row is scrolled into view and focused on drawer open
`Sidebar` SHALL attach a `navRef` to its existing `<nav aria-label="Sessions">` and run a
`useEffect` (reading `useIsMobile()` + chrome `sidebarOpen`) that, when the drawer is visible on
mobile, queries the nav for `[aria-current="page"]`, calls `scrollIntoView({ block: "nearest" })`,
and `focus()`es it — superseding the trap's first-focus. When no current row exists, the effect is a
no-op and the trap's first-focusable focus stands. If a same-tick race with the trap's first-focus
surfaces, the bonus focus MUST be deferred (e.g. `requestAnimationFrame`) so it runs after the trap.

- **GIVEN** the mobile drawer opens and a row carries `aria-current="page"`
- **WHEN** the `Sidebar` open-effect runs
- **THEN** that row is scrolled into view and receives focus, overriding the trap's first-focus
- **AND** GIVEN no `[aria-current="page"]` row exists, the effect does nothing and the trap's first-focusable focus stands

### Non-Goals

- Refactoring `Dialog` / `CommandPalette` to consume the new `useFocusTrap` hook — out of scope; widens blast radius beyond the two backlog files and risks regressing two working modals. The hook is written so a later change can adopt it with no API change.
- Focus-return on close (restoring focus to the pre-open element) — `Dialog`/`CommandPalette` do not implement it; matching them means no focus-return.
- Trapping the desktop sidebar — it is a grid region, never a modal; trapping it would break normal Tab navigation.
- Threading an `isDrawerOpen` prop from `Shell` through `app.tsx`/`board-page.tsx` — the bonus effect reads hooks/context inside `Sidebar` instead; the prop is the documented fallback if precise `Shell` mount-timing is ever required.
- Any backend / Go / tmux / API change — frontend-only.
- A Playwright `*.spec.ts` (and its `.spec.md` companion) — jsdom unit tests cover the focus/keydown logic, matching how `dialog`/`palette` are tested.

### Design Decisions

1. **Reuse the proven focus-cycle pattern, not a library**: extract a hook mirroring `dialog.tsx`/`command-palette.tsx`. — *Why*: backlog says "reusing Dialog/CommandPalette focus-cycle logic"; Constitution IV (minimal surface) + no-new-dependency posture. — *Rejected*: `focus-trap-react` or similar (adds a dependency for logic already in the repo twice).
2. **Extract `useFocusTrap` rather than a third inline copy**: — *Why*: "reusing logic" most literally means a shared hook; logic is identical across the two existing modals; cheaply reversible. — *Rejected*: a third inline replication in `shell.tsx`.
3. **Trap active only for the mobile overlay** (`isMobile && sidebarOpen && !!sidebarChildren`): — *Why*: only the mobile `<aside>` carries `role="dialog" aria-modal`; the desktop sidebar is a grid region. — *Rejected*: always-on trap (would break desktop Tab nav).
4. **Current-row focus supersedes the trap's first-focus when a current row exists**, falling back to first-focusable otherwise: — *Why*: decided with user — keeps the keyboard user on their current context on open. — *Rejected*: "first-focusable always wins" / scroll-only.
5. **`Sidebar` reads `useIsMobile()` + chrome `sidebarOpen` directly; no new prop**: — *Why*: decided with user — `Sidebar` already has hook/context access, avoids touching `app.tsx`/`board-page.tsx`. — *Rejected*: threading an explicit `isDrawerOpen` prop from `Shell` (kept as documented fallback).

## Tasks

### Phase 1: Core Hook

- [x] T001 Create `app/frontend/src/hooks/use-focus-trap.ts` exporting `useFocusTrap(containerRef, active, onEscape)` — verbatim-equivalent to the intake's hook source: a `FOCUSABLE` selector const, an `onEscapeRef` stable-ref, and a single `useEffect` gated on `active` that focuses the first focusable, attaches a `document` `keydown` handler (Escape → `onEscapeRef.current()`; Tab wrap both directions with `preventDefault` only at boundaries), and cleans up on deactivate/unmount <!-- R1 R2 R3 R4 R5 --> <!-- rework: must also implement R10 nested-modal deference — see T006 -->

- [x] T006 In `use-focus-trap.ts`, add a nested-modal guard helper (e.g. `hasNestedDialog(container)`) that returns true when `container.querySelector('[role="dialog"]')` finds an element that is NOT the container itself (the container — the drawer `<aside>` — itself carries `role="dialog"`, so match a descendant only). In `handleKeyDown`, early-return BEFORE acting on Escape and Tab when `hasNestedDialog(node)` is true, so the trap stands down while `KillDialog`/`PinPopover` is open inside the drawer. First-focus-on-activation is unaffected (a nested modal is not open at activation time). <!-- R10 -->

### Phase 2: Drawer Integration

- [x] T002 In `app/frontend/src/components/shell/shell.tsx`: import `useRef` + `useFocusTrap`; add `const drawerRef = useRef<HTMLElement>(null)`; compute `drawerActive = isMobile && sidebarOpen && !!sidebarChildren`; call `useFocusTrap(drawerRef, drawerActive, () => setSidebarOpen(false))`; attach `ref={drawerRef}` to the overlay `<aside>` (the existing `role="dialog" aria-modal="true" aria-label="Navigation"` element). Trap must be inactive on desktop / mobile-closed. <!-- R6 R7 R8 -->

### Phase 3: Sidebar Bonus

- [x] T003 In `app/frontend/src/components/sidebar/index.tsx`: import `useIsMobile` + `useChromeState`; add `const navRef = useRef<HTMLElement>(null)` and attach it to the existing `<nav aria-label="Sessions">` (line ~700); add a `useEffect` keyed on `[isMobile, sidebarOpen]` that — when `isMobile && sidebarOpen` — queries `navRef.current` for `[aria-current="page"]`, and if found calls `scrollIntoView({ block: "nearest" })` + `focus()` on it (no-op when absent). Defer the focus with `requestAnimationFrame` so it runs after the trap's first-focus, avoiding a same-tick race. Mirror the mount-scroll pattern in `server-panel.tsx:77-82`. <!-- R9 -->

- [x] T007 In `app/frontend/src/components/sidebar/index.tsx`, scope the bonus current-row selector so it matches a WINDOW row, not the active `BoardsSection` row (which also carries `aria-current="page"` and renders first inside `navRef`). Query within the Sessions tree region rather than the whole `<nav>` — e.g. give the window-tree wrapper a stable hook (a `data-` attr or scope the query to the `[data-window-id]` rows that carry `aria-current="page"`), or query `[data-window-id] [aria-current="page"]` / the row button under a `[data-window-id]` ancestor. On board routes (no window selected) the effect then correctly no-ops and the trap's first-focus stands, matching R9's documented intent. <!-- R9 -->

### Phase 4: Tests

- [x] T004 Add `app/frontend/src/hooks/use-focus-trap.test.tsx` (vitest + Testing Library `renderHook`): (a) activation focuses the first focusable; (b) Tab from last wraps to first and Shift+Tab from first wraps to last; (c) Escape fires `onEscape`; (d) inactive ⇒ no `document` `keydown` listener attached and focus not moved; (e) **R10**: when the container has a descendant with `role="dialog"`, Escape does NOT fire `onEscape` and Tab does NOT wrap (the trap stands down). Render a real container with ≥2 focusable buttons attached to the ref. <!-- R1 R2 R3 R4 R5 R10 -->
- [x] T005 Extend `app/frontend/src/components/shell/shell.test.tsx`: provide `sidebarChildren` with ≥2 focusable buttons; add cases — (a) mobile+open focuses inside the `<aside>` on mount; (b) Escape closes the drawer (overlay unmounts / `sidebarOpen` false); (c) Tab from last focusable wraps to first, Shift+Tab from first wraps to last; (d) desktop OR mobile-closed does not steal focus / attach the trap. <!-- R6 R7 R8 -->

## Execution Order

- T001 blocks T002 (Shell consumes the hook) and T004 (hook unit test).
- T002 blocks T005 (Shell test exercises the wired trap).
- T003 is independent of T001/T002 (different file) but shares the change's focus-timing concern; can run alongside T002.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `app/frontend/src/hooks/use-focus-trap.ts` exists and exports `useFocusTrap(containerRef, active, onEscape)` with an `onEscapeRef` stable-ref and an `active`-gated effect that cleans up on deactivate/unmount. (use-focus-trap.ts:15-53)
- [x] A-002 R2: On activation the hook focuses the first focusable descendant of the container. (use-focus-trap.ts:29; test "focuses the first focusable element on activation")
- [x] A-003 R3: Tab from the last focusable wraps to the first and Shift+Tab from the first wraps to the last; `preventDefault` fires only at the wrap boundaries. (use-focus-trap.ts:36-49 — preventDefault inside the two boundary branches only; tests cover both directions)
- [x] A-004 R4: Escape while active invokes the latest `onEscape` exactly once. (use-focus-trap.ts:32-35 via onEscapeRef; test "fires onEscape when Escape is pressed while active")
- [x] A-005 R5: When inactive, no `keydown` listener is attached and focus is not moved; deactivation removes a previously-attached listener. (use-focus-trap.ts:24 `if (!active) return` + cleanup return; tests "does not attach a listener or steal focus when inactive" and "removes the keydown listener when it deactivates")
- [x] A-006 R6: `Shell` attaches `drawerRef` to the `<aside>` and activates the trap only when `isMobile && sidebarOpen && !!sidebarChildren`; desktop / mobile-closed never activates it. (shell.tsx:90-91, ref at :140; tests "does not steal focus or attach the trap on desktop" / "does not steal focus when mobile but closed")
- [x] A-007 R7: Escape closes the mobile drawer via `setSidebarOpen(false)`; backdrop/destination/hamburger dismissals are preserved. (shell.tsx:91 onEscape → setSidebarOpen(false); backdrop onClick :137 and consumer destination-close unchanged; test "closes the drawer on Escape")
- [x] A-008 R8: Tab/Shift+Tab cycles within the live `<aside>` and does not escape to the content behind the backdrop. (shell.test.tsx Tab/Shift+Tab wrap cases)
- [x] A-009 R9: On mobile drawer open, the `[aria-current="page"]` WINDOW row (when present) is scrolled into view and focused, superseding the trap's first-focus; when absent (incl. board routes with no selected window), the effect is a no-op and the trap's first-focus stands. The selector is scoped to the Sessions window tree so the active BoardsSection row (also `aria-current="page"`) is NOT matched. (sidebar/index.tsx:719 — selector now `[data-window-id] [aria-current="page"]`; window rows carry `data-window-id` on their outer div with `aria-current` on the inner button per window-row.tsx:176,193, while the BoardsSection active row at boards-section.tsx:56 has no `[data-window-id]` ancestor.)

### Behavioral Correctness

- [x] A-010 R6: The trap's `active` flag is recomputed from `isMobile`/`sidebarOpen`/`sidebarChildren` each render, so toggling the drawer attaches/detaches the listener correctly (no stale listener after close). (shell.tsx:90 `drawerActive` recomputed each render; effect dep `[active, containerRef]` re-runs on transition; Escape-close test proves the listener detaches after the overlay unmounts)
- [x] A-011 R9: The bonus focus is deferred (`requestAnimationFrame`) so it runs after the trap's first-focus and wins the same-tick race when a current row exists. (sidebar/index.tsx:715 `requestAnimationFrame`, cancelled on cleanup :718)
- [x] A-021 R10: When a `role="dialog"` descendant is open inside the active drawer (`KillDialog`/`PinPopover`), the drawer trap stands down — Escape does not fire `onEscape` (only the nested modal closes) and Tab does not run the drawer-wide wrap. (use-focus-trap.ts:17-20 `hasNestedDialog` helper + :56 early-return in `handleKeyDown` before Escape/Tab; hook test case (e) "stands down while a nested role=dialog descendant is open (R10)".)
- [x] A-022 R9: The bonus current-row focus is exercised by a jsdom test that forces mobile + open drawer and a synchronous rAF, asserting the `[aria-current="page"]` window row (under a `[data-window-id]` wrapper) receives focus — locking in the scoped-selector fix (board-route exclusion follows from the selector's construction). (sidebar/index.test.tsx "Sidebar — mobile drawer current-row focus bonus (R9 / T007)") — added in review to close the outward reviewer's should-fix test-coverage gap

### Scenario Coverage

- [x] A-012 R1 R2 R3 R4 R5: `use-focus-trap.test.tsx` exercises activation-focus, Tab-wrap both directions, Escape→onEscape, and inactive-inert. (6 tests, all passing)
- [x] A-013 R6 R7 R8: `shell.test.tsx` exercises mobile+open first-focus, Escape-close, Tab-wrap both directions, and desktop/mobile-closed no-trap, with ≥2 focusable buttons in `sidebarChildren`. (trapChildren() supplies 3 buttons; "mobile drawer focus trap" describe block, all passing)

### Edge Cases & Error Handling

- [x] A-014 R2 R3: When the container has zero focusable descendants, the hook does not throw and Tab handling early-returns. (use-focus-trap.ts:29 optional-chains the focus; :40 `if (focusable.length === 0) return`. Verified by code inspection — not exercised by a dedicated test, but the empty-list guards are present and the `?.focus()` is null-safe.)
- [x] A-015 R9: When `navRef` is unmounted or no current row exists, the bonus effect early-returns without throwing. (sidebar/index.tsx:713 `navRef.current?.querySelector(...)` optional-chains; :714 `if (!row) return`; scrollIntoway guarded with a typeof check :716)

### Code Quality

- [x] A-016 Pattern consistency: New code follows naming and structural patterns of surrounding code (hook naming `use-*.ts`, the existing `onCloseRef`/`onEscapeRef` stable-ref idiom, the `server-panel.tsx` mount-scroll pattern). (use-focus-trap.ts mirrors dialog.tsx's FOCUSABLE selector + first/last wrap byte-for-byte; sidebar effect mirrors server-panel.tsx:77-82.)
- [x] A-017 No unnecessary duplication: The drawer reuses the extracted `useFocusTrap` hook rather than a third inline copy of the focus-cycle logic; existing hooks (`useIsMobile`, `useChromeState`/`useChromeDispatch`) are reused. (shell.tsx imports useFocusTrap; sidebar imports useIsMobile + useChromeState.)
- [x] A-018 Type narrowing over assertions: New code prefers `if` guards / typed refs over `as` casts (code-quality.md Frontend principle). (No `as` casts in any of the three touched source files; typed `useRef<HTMLElement>(null)` + `querySelector<HTMLElement>` generics.)
- [x] A-019 **N/A**: No client polling / no DB imports — the change is frontend a11y wiring (focus/keydown); no `setInterval`+fetch and no DB/ORM imports were introduced. Confirmed not violated.
- [x] A-020 Tests included: New/changed behavior is covered by `use-focus-trap.test.tsx` and the extended `shell.test.tsx` (code-quality.md: features/fixes MUST include tests). (17 tests pass.)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change is purely additive (a new shared hook + its `hasNestedDialog` R10 guard + a drawer ref/trap wiring + a sidebar mount-effect with a scoped `[data-window-id] [aria-current="page"]` selector). The intake explicitly scopes refactoring `dialog.tsx`/`command-palette.tsx` to consume the new `useFocusTrap` hook as a follow-up Non-Goal, so their inline focus-cycle copies are intentionally left in place and are NOT yet redundant (the hook has only one adopter today). The rework added only new code (the guard helper + a narrower query); it removed nothing and rendered no existing symbol, branch, or file unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Bonus focus is deferred with `requestAnimationFrame` (not `queueMicrotask`) to win the same-tick race with the trap's first-focus | Intake names both `queueMicrotask`/`requestAnimationFrame` as acceptable; rAF reliably runs after React's commit-phase effects (where the trap focuses), making the override deterministic; trivially reversible | S:78 R:88 A:82 D:75 |
| 2 | Confident | `useFocusTrap` typed as `useFocusTrap(containerRef: React.RefObject<HTMLElement \| null>, active: boolean, onEscape: () => void)` per the intake source verbatim | Intake gives the exact signature and body; React 19's `useRef<HTMLElement>(null)` produces `RefObject<HTMLElement \| null>`, matching the param type so `Shell`'s `drawerRef` and `Sidebar`'s `navRef` pass without casts | S:90 R:85 A:88 D:85 |

2 assumptions (0 certain, 2 confident, 0 tentative).
