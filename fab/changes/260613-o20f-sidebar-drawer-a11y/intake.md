# Intake: Sidebar Drawer Accessibility (Focus Trap + Escape)

**Change**: 260613-o20f-sidebar-drawer-a11y
**Created**: 2026-06-13

## Origin

> Sidebar Wave 1 change B (sidebar-drawer-a11y) from backlog o20f. Mobile overlay declares role=dialog aria-modal=true (shell.tsx:131-132) but traps nothing — Tab leaks to terminal behind, Escape no-ops, no focus-on-open. Add focus-into-drawer + Tab trap + Escape-close reusing Dialog/CommandPalette focus-cycle logic; bonus: scrollIntoView+focus the aria-current row (window-row.tsx:193) on sidebar open, mirroring server-panel.tsx:77-82. Files: shell/shell.tsx, sidebar/index.tsx. This change is orthogonal to Wave 1 changes A and C. Context: docs/memory/run-kit/ui-patterns.md "## Sidebar".

One-shot creation from the WAVE 1 backlog parent item `[o20f]`, which splits into three orthogonal changes. This is change **[B]**. Changes **[A]** (`sidebar-triage-signal`) and **[C]** (`palette-window-switch`) are tracked separately; per the backlog COORDINATION note, **B and C are fully orthogonal** (no shared files) and ship independently as each lands. The two files this change touches — `shell/shell.tsx` and `sidebar/index.tsx` — are not touched by A or C.

## Why

The mobile sidebar drawer (`app/frontend/src/components/shell/shell.tsx`, the `isMobile && sidebarOpen` overlay) announces itself to assistive tech as a modal dialog:

```tsx
<aside
  role="dialog"
  aria-modal="true"
  aria-label="Navigation"
  className="absolute inset-y-0 left-0 z-50 w-[88%] max-w-[320px] ..."
>
  {sidebarChildren}
</aside>
```

But the contract `aria-modal="true"` promises is **not honored**:

1. **No focus-on-open.** Opening the drawer leaves focus wherever it was — typically the xterm hidden helper textarea or the hamburger button. A screen-reader / keyboard user has no signal that a modal appeared and must hunt for it.
2. **Tab leaks to the content behind.** There is no focus trap, so `Tab` walks straight out of the `<aside>` into the terminal/board content rendered behind the backdrop — the exact thing `aria-modal` tells AT is impossible. Focus lands on controls the user can't see (they're behind a 50%-black backdrop).
3. **Escape is a no-op.** Every other modal surface in the app closes on `Escape` (`Dialog`, `CommandPalette`). The drawer does not, so the muscle-memory dismissal silently fails — the only dismissals today are backdrop tap, destination-row tap (auto-close after navigation), and the hamburger.

**Consequence of not fixing**: the drawer is an `aria-modal` liar. This is both an accessibility defect (WCAG 2.1 keyboard-operability / no-keyboard-trap-escape) and a plain keyboard-UX gap that contradicts Constitution **V (Keyboard-First)** — "Every user-facing action MUST be reachable via keyboard." A modal you can't escape or whose focus you can't contain via keyboard violates that principle directly.

**Why this approach (reuse, not a library)**: the codebase already solves this exact problem twice — `Dialog` (`dialog.tsx`) and `CommandPalette` (`command-palette.tsx`) each implement focus-on-mount + a Tab/Shift+Tab wrap cycle + Escape-close with a document-level `keydown` listener. Constitution **IV (Minimal Surface Area)** and the project's no-new-dependency posture (native HTML5 DnD over a library, etc.) mean we reuse that proven pattern rather than pull in `focus-trap-react` or similar. The drawer becomes consistent with the app's other modals.

## What Changes

Two files change: `shell/shell.tsx` (owns the overlay markup and is where the focus/Escape behavior must live, because it owns the `<aside>` ref and the `setSidebarOpen` dispatch) and `sidebar/index.tsx` (the bonus: scroll+focus the current window row on open). The sidebar bonus is conditional and lower-priority than the trap.

### 1. Reference pattern: the existing focus-cycle logic

The canonical logic to mirror lives in `dialog.tsx` (lines 17–50). For state transfer, here it is verbatim — the new drawer logic SHALL be behavior-equivalent:

```tsx
// Tab trap (dialog.tsx:17–37)
const handleKeyDown = useCallback((e: KeyboardEvent) => {
  if (e.key === "Escape") { onCloseRef.current(); return; }
  const dialog = dialogRef.current;
  if (!dialog || e.key !== "Tab") return;
  const focusable = dialog.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last?.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first?.focus();
  }
}, []);

// Focus-first-on-mount + listener attach (dialog.tsx:40–50)
useEffect(() => {
  const dialog = dialogRef.current;
  if (dialog) {
    const first = dialog.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [handleKeyDown]);
```

`CommandPalette` (`command-palette.tsx:48–52`, `71–73`) follows the same shape (focus on open, `Escape` → `setOpen(false)`).

### 2. Extract a shared `useFocusTrap` hook (preferred) vs. inline replication

The logic above is currently **duplicated inline** in two components. Adding a third inline copy in `shell.tsx` would be three copies of the same focus-cycle code. The cleaner approach — and the one most consistent with the project's "reuse, don't reinvent" posture — is to extract a small shared hook and adopt it in the drawer:

```ts
// app/frontend/src/hooks/use-focus-trap.ts (new)
import { useEffect, useRef } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab focus within `containerRef` and calls `onEscape` on Escape, while
 * `active` is true. Focuses the first focusable element on activation. Mirrors
 * the focus-cycle contract proven in `dialog.tsx` / `command-palette.tsx`.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Focus the first focusable on activation.
    container.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { onEscapeRef.current(); return; }
      if (e.key !== "Tab") return;
      const node = containerRef.current;
      if (!node) return;
      const focusable = node.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, containerRef]);
}
```

**Scope guard**: this change adopts the hook in the **drawer only**. Refactoring `Dialog` and `CommandPalette` to consume the new hook is desirable but out of scope here (it widens the blast radius beyond the two files named in the backlog and risks regressing two already-working modals). It is recorded as a Non-Goal / follow-up. The hook is written so a later change can adopt it in those two components with no API change.

<!-- assumed: extract useFocusTrap hook rather than a third inline copy — backlog says "reusing ... focus-cycle logic"; a shared hook is the literal reuse and matches Constitution IV; inline replication is the fallback if extraction proves awkward -->

### 3. Wire the trap into the drawer (`shell/shell.tsx`)

The overlay `<aside>` currently has no `ref`. Add one and drive the hook from it. The hook is only "active" while the mobile overlay is mounted (`isMobile && sidebarOpen`), and `onEscape` dispatches the existing close:

```tsx
export function Shell({ children, sidebarChildren }: { ... }) {
  useVisualViewport();
  const { sidebarOpen, sidebarWidth } = useChromeState();
  const { setSidebarOpen } = useChromeDispatch();
  const isMobile = useIsMobile();
  const drawerRef = useRef<HTMLElement>(null);

  // Mobile drawer is aria-modal: trap Tab focus within it and close on Escape
  // while it is mounted, honoring the role="dialog" aria-modal="true" contract.
  const drawerActive = isMobile && sidebarOpen && !!sidebarChildren;
  useFocusTrap(drawerRef, drawerActive, () => setSidebarOpen(false));
  ...
  <aside
    ref={drawerRef}
    role="dialog"
    aria-modal="true"
    aria-label="Navigation"
    className="..."
  >
    {sidebarChildren}
  </aside>
}
```

Behavioral contract after the change:

- **On open** (drawer mounts on mobile): focus moves to the first focusable element inside the `<aside>` (today that is the first interactive control in the sidebar nav — e.g., the Boards section toggle).
- **Tab / Shift+Tab**: focus cycles within the `<aside>` and never escapes to the content behind the backdrop. Forward-Tab past the last focusable wraps to the first; Shift+Tab before the first wraps to the last.
- **Escape**: closes the drawer (`setSidebarOpen(false)`), matching `Dialog`/`CommandPalette`.
- **Desktop (≥ 640px)** and **mobile-closed**: the hook is inactive (`active=false`) — no listener attached, no focus stolen. The desktop sidebar lives in the grid and is NOT a modal; its behavior is unchanged.
- **Existing dismissals preserved**: backdrop tap and destination-row auto-close still work; Escape is additive.

### 4. Bonus: focus + scroll the current window row on open (`sidebar/index.tsx`)

Mirror the `ServerPanel` mount-scroll pattern (`server-panel.tsx:77–82`):

```tsx
// server-panel.tsx:77-82 — the pattern to mirror
useEffect(() => {
  if (!isMobile) return;
  const el = activeTileRef.current;
  if (!el || typeof el.scrollIntoView !== "function") return;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}, [isMobile, server]);
```

The selected window row's button carries `aria-current="page"` (`window-row.tsx:193`): `aria-current={isSelected ? "page" : undefined}`. On drawer open that row is scrolled into view and focused so the keyboard user lands on their current context. **Wiring (DECIDED — Sidebar reads hooks/context)**: a `useEffect` in `Sidebar` reads `useIsMobile()` + the chrome `sidebarOpen` state directly (both already available via hooks/context) and, when the drawer becomes visible on mobile, queries the rendered `<nav>` for `[aria-current="page"]` and calls `scrollIntoView({ block: "nearest" })` + `focus()` on it:

```tsx
// sidebar/index.tsx — bonus mount-effect (no new prop)
const isMobile = useIsMobile();
const { sidebarOpen } = useChromeState();
const navRef = useRef<HTMLElement>(null); // attach to the existing <nav aria-label="Sessions">
useEffect(() => {
  if (!isMobile || !sidebarOpen) return;
  const row = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!row) return; // fallback: trap's first-focusable focus stands
  row.scrollIntoView({ block: "nearest" });
  row.focus();
}, [isMobile, sidebarOpen]);
```

No new prop is threaded through `app.tsx` / `board-page.tsx` — the effect is self-contained in `Sidebar`. (Threading an explicit `isDrawerOpen` prop from `Shell` was the rejected alternative; chosen against to keep call sites unchanged. If precise `Shell` mount-timing turns out to be required, the prop is the documented fallback.) Note the `<nav>` currently has no ref — adding `navRef` to the existing `<nav aria-label="Sessions">` (sidebar/index.tsx:700) is the only structural addition.

**Interaction with the focus trap (DECIDED — current row wins)**: the trap (item 3) focuses the *first focusable* on open; this bonus focuses the *current row*. **Resolution (chosen with user)**: when a current row (`[aria-current="page"]`) exists, the bonus wins — it scrolls that row into view and moves focus to it, **superseding** the trap's first-focusable. When no current row exists (board route, fresh session with no selection), the trap's first-focusable focus stands as the fallback. Mechanism: the trap's focus-first is the fallback and the `Sidebar` bonus effect overrides it via a late-running effect (effects run child-before-parent on mount, but here the override is the sidebar's own effect keyed on drawer-open, which runs after the trap's container-mount focus; if a same-tick race surfaces during apply, a `queueMicrotask`/`requestAnimationFrame` deferral of the bonus focus is the resolution). This coupling is the main reason the two files are in one change.

<!-- clarified: current-row focus supersedes the trap's first-focus when a current row exists; falls back to first-focusable otherwise — user chose "current row wins" over "first-focusable always wins / scroll-only" -->

### 5. Tests

- **Unit (`shell/shell.test.tsx`, existing harness)**: the file already renders `<Shell>` under `ChromeProvider` with `mockMatchMedia` and seeds `runkit-sidebar-open`. Add cases:
  - mobile + open: focus lands inside the `<aside>` on mount; `Escape` calls the close path (drawer unmounts / `sidebarOpen` false); Tab from the last focusable wraps to the first (and Shift+Tab from first → last).
  - desktop or mobile-closed: no `keydown` listener side effects; focus not moved.
  - Provide `sidebarChildren` containing ≥2 focusable buttons so the wrap is observable.
- **`useFocusTrap` unit test (new, `use-focus-trap.test.tsx` or co-located)**: trap activation focuses first; Tab-wrap both directions; Escape fires `onEscape`; inactive ⇒ no listener.
- **No Playwright spec is required by the backlog** ("Files: shell/shell.tsx, sidebar/index.tsx" — unit-test surface). If a `.spec.ts` is added, the constitution's Test Companion Docs rule requires a sibling `.spec.md`. Default: unit tests only (jsdom focus/keydown is sufficient for this logic and matches how `dialog`/`palette` are covered).

## Affected Memory

- `run-kit/ui-patterns`: (modify) The **## Sidebar → Mobile** subsection currently documents the overlay as `role="dialog" aria-modal="true"` with dismissals (backdrop tap, destination tap, hamburger). It must record the new focus-trap contract: focus-on-open, Tab/Shift+Tab cycle confinement, Escape-close, and that these reuse the `Dialog`/`CommandPalette` focus-cycle logic via the new shared `useFocusTrap` hook. Note the bonus current-row scroll+focus and that the desktop sidebar is explicitly NOT trapped. (Memory updated during hydrate, not apply.)

## Impact

- **Code areas**:
  - `app/frontend/src/components/shell/shell.tsx` — add `drawerRef`, adopt `useFocusTrap`, wire Escape→`setSidebarOpen(false)`. The `<aside>` already has `role/aria-modal/aria-label`; only the ref + behavior are added.
  - `app/frontend/src/hooks/use-focus-trap.ts` — **new** shared hook (extraction of the `dialog.tsx`/`command-palette.tsx` pattern).
  - `app/frontend/src/components/sidebar/index.tsx` — bonus mount-effect: scrollIntoView + focus the `[aria-current="page"]` row on drawer open.
- **No backend change.** Frontend-only. No API, no Go, no tmux. Constitution II (No Database) / VI (tmux independence) untouched.
- **No new dependencies** — reuses existing React primitives, consistent with the native-DnD / no-library posture.
- **Dependencies / coordination**: orthogonal to Wave 1 [A] and [C] (disjoint file sets). No ordering constraint against them.
- **Risk surface**: the document-level `keydown` listener must be scoped to the active drawer only (gated by `active`) so it never fires on desktop or competes with `Cmd+\` toggle, the `CommandPalette` `Cmd+K` listener, or `Dialog`'s own Escape handler. The `useSidebarKeyboardToggle` and palette listeners are independent `keydown` handlers; Escape is not claimed by them, so there is no contention on Escape. Tab is `preventDefault`-ed only at the wrap boundaries.

## Open Questions

- ~~Should the bonus current-row focus take precedence over the trap's first-focus on open?~~ **RESOLVED** (with user): current-row wins when an `[aria-current="page"]` row exists, falling back to first-focusable otherwise.
- ~~How should the bonus effect learn the drawer opened — read hooks in `Sidebar` or thread a prop from `Shell`?~~ **RESOLVED** (with user): `Sidebar` reads `useIsMobile()` + chrome `sidebarOpen` directly; no new prop.
- When the drawer closes via Escape/backdrop, should focus be restored to the element that had it before open (focus-return)? `Dialog`/`CommandPalette` do NOT implement focus-return today, so matching them means **no** focus-return. (Graded Confident — match existing modals; out of scope to add return.)

No open questions remain that block apply.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse the existing `Dialog`/`CommandPalette` focus-cycle pattern; do NOT add a focus-trap library | Backlog text explicitly says "reusing Dialog/CommandPalette focus-cycle logic" and Constitution IV (minimal surface) + the no-new-dependency posture make this constitution-determined, not a judgment call | S:95 R:85 A:95 D:90 |
| 2 | Confident | Extract a shared `useFocusTrap` hook and adopt it in the drawer (vs. a third inline copy) | "Reusing logic" most literally means a shared hook; the logic is identical across `dialog.tsx`/`command-palette.tsx`; cheaply reversible to inline if extraction is awkward | S:80 R:88 A:85 D:75 |
| 3 | Certain | Trap is active ONLY for the mobile overlay (`isMobile && sidebarOpen`); desktop sidebar is never trapped | Determined by the code: only the mobile `<aside>` carries `role="dialog" aria-modal`; the desktop sidebar is a grid region, never a modal — one obvious interpretation, trapping desktop would break normal Tab nav | S:92 R:85 A:97 D:92 |
| 4 | Certain | Escape closes via the existing `setSidebarOpen(false)` dispatch; no new close mechanism | The dispatch already exists and is the sole drawer-close path (backdrop/destination both route through it); Escape is purely additive and mirrors `Dialog`/`CommandPalette` exactly | S:92 R:88 A:92 D:92 |
| 5 | Confident | No focus-return on close (focus is not restored to the pre-open element) | `Dialog` and `CommandPalette` do not implement focus-return; matching them keeps behavior consistent and avoids scope creep | S:70 R:88 A:85 D:80 |
| 6 | Confident | Refactoring `Dialog`/`CommandPalette` to consume the new hook is OUT of scope (Non-Goal) | Backlog names only `shell.tsx` + `sidebar/index.tsx`; touching two working modals widens blast radius and regression risk for no requirement | S:85 R:78 A:85 D:82 |
| 7 | Confident | Unit tests only (extend `shell.test.tsx` + new hook test); no Playwright spec unless warranted | jsdom covers focus/keydown logic, matching how `dialog`/`palette` are tested; backlog scope is unit-level; avoids the `.spec.md` companion obligation | S:75 R:90 A:85 D:78 |
| 8 | Confident | Bonus current-row focus supersedes the trap's first-focus when an `[aria-current="page"]` row exists; otherwise first-focusable | Decided with user ("current row wins" over "first-focusable always wins / scroll-only"); keeps the keyboard user on their current context on open | S:90 R:78 A:80 D:88 |
| 9 | Confident | Bonus reads `useIsMobile()` + chrome `sidebarOpen` inside `Sidebar`; no new `isDrawerOpen` prop from `Shell` | Decided with user; `Sidebar` already has hook/context access, avoids touching `app.tsx`/`board-page.tsx`; the prop is the documented fallback if `Shell` mount-timing is needed | S:90 R:80 A:82 D:85 |

9 assumptions (3 certain, 6 confident, 0 tentative).
