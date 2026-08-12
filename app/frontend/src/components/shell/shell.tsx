import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useChromeState, useChromeDispatch } from "@/contexts/chrome-context";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useKeybindings } from "@/hooks/use-keybindings";
import { matchesCombo, shouldSuppressChord } from "@/lib/keybindings";

/**
 * Ref to the `.app-shell` grid element, provided to the right-panel subtree so
 * its width math can measure the content+panel region (shell width minus the
 * sidebar column) through a seam that is NOT the panel's own parentElement —
 * once the panel IS its own grid column, percent-of-parent is circular
 * (260812-nm4p). `null` outside a `<Shell>`.
 */
const ShellGridRefContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

/** Read the Shell grid element ref (see `ShellGridRefContext`). */
export function useShellGridRef(): React.RefObject<HTMLDivElement | null> | null {
  return useContext(ShellGridRefContext);
}

/**
 * `Cmd+\` (macOS) / `Ctrl+\` (Linux/Windows) toggles the sidebar. Constitution V
 * (Keyboard-First) requires every user-facing action be keyboard-reachable;
 * the sidebar's visibility now is one such action. We register at Shell level
 * so the chord works on every route that mounts a `<Shell>` (AppShell + BoardPage).
 *
 * The chord comes from the keybinding registry (`sidebar-toggle`, default ⌘\,
 * per-device rebindable — 260730-g40a); the input gating is the shared
 * `shouldSuppressChord` predicate (real text inputs suppress; the `.xterm`
 * helper textarea and `.rk-chat-input` carve-outs pass through). Binding held
 * in a ref so the listener registers once per mount.
 */
function useSidebarKeyboardToggle(toggle: () => void) {
  const { byAction } = useKeybindings();
  const bindingRef = useRef(byAction.get("sidebar-toggle"));
  bindingRef.current = byAction.get("sidebar-toggle");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const binding = bindingRef.current;
      if (!binding?.enabled || !matchesCombo(e, binding)) return;
      if (shouldSuppressChord(e.target)) return;

      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}

/**
 * Shell — shared layout wrapper for `AppShell` and `BoardPage`.
 *
 * The TopBar is NO LONGER part of the Shell grid (260707-4vq2). It mounts once
 * in the persistent root layout (`RootTopBar` in `app.tsx`), full-width above
 * this Shell. Because the old grid already spanned the topbar full-width above
 * the sidebar, dropping the row here and painting the bar above Shell in the
 * root layout is a geometric no-op — the visual stack is preserved.
 *
 * Topology (desktop, viewport ≥ 640px):
 *   ┌──────────┬───────────────┬─────────────┐
 *   │ sidebar  │   content     │             │
 *   │          ├───────────────┤  rightpanel │
 *   │          │   bottombar   │             │
 *   └──────────┴───────────────┴─────────────┘
 *
 * - `grid-template-areas`: `"sidebar content" / "sidebar bottombar"` — or, when
 *   the optional `rightPanelChildren` slot is filled (desktop only),
 *   `"sidebar content rightpanel" / "sidebar bottombar rightpanel"` with
 *   columns `${sidebarWidth}px 1fr auto` (260812-nm4p): the right column spans
 *   BOTH rows full-height, exactly like the sidebar, and the bottombar stays
 *   scoped to the content column with no consumer change.
 * - `grid-template-rows`: `1fr auto`
 * - `grid-template-columns`: `${sidebarWidth}px 1fr` when `sidebarOpen` is `true`,
 *   else `0 1fr` (plus the `auto` right column when the slot is filled).
 *   CSS transition (~150ms ease-out) animates collapse.
 * - Without `rightPanelChildren` (board/host consumers, mobile) the grid is
 *   byte-identical to the two-column layout.
 *
 * The `rightpanel` area mirrors `sidebarChildren` with ONE deliberate
 * divergence (right-panel spec P3): the right aside NEVER unmounts — collapse
 * (`rightPanelVisible === false`) hides it at display level (`hidden`, so the
 * `auto` column collapses to zero width) while the subtree stays mounted and
 * the web/code iframes keep their in-memory state.
 *
 * Topology (mobile, viewport < 640px):
 *   - Single-column grid (`content / bottombar`); the `sidebar` slot
 *     is removed from the grid.
 *   - When `sidebarOpen === true`, the sidebar children render outside the
 *     grid as an absolute overlay with a backdrop. The overlay carries
 *     `role="dialog" aria-modal="true"` for assistive tech.
 *
 * The `sidebar` grid area is Shell-owned: on desktop Shell renders the
 * `<aside gridArea:"sidebar">` itself from `sidebarChildren` (gated
 * `!isMobile && sidebarOpen && !!sidebarChildren`), with an optional
 * `sidebarResizeHandle` node placed at its right edge (AppShell's drag-resize
 * handle; drag state/handlers stay in AppShell). Consumers therefore place
 * ONLY the `content` and `bottombar` grid areas via
 * `style={{ gridArea: "content" | "bottombar" }}` — never `sidebar`.
 *
 * Height is `100%` — Shell fills the root layout's `flex-1` content region.
 * The `--app-height` var (iOS keyboard handling) is now maintained by
 * `useVisualViewport()` in `RootWrapper`, whose root layout div is the var's
 * consumer; Shell no longer calls the hook or reads the var directly.
 */
export function Shell({
  children,
  sidebarChildren,
  sidebarResizeHandle,
  rightPanelChildren,
  rightPanelVisible = true,
}: {
  children: ReactNode;
  sidebarChildren?: ReactNode;
  /**
   * Desktop-only chrome rendered at the sidebar aside's right edge, after the
   * content wrapper (AppShell passes its drag-resize handle here; BoardPage
   * passes none). The mobile overlay never renders it. When present, the aside
   * drops its `border-r` (the handle bar is the visual seam); when absent, the
   * aside keeps `border-r border-border` as the seam.
   */
  sidebarResizeHandle?: ReactNode;
  /**
   * Optional full-height right column (260812-nm4p) — the terminal route's
   * rail + panel subtree, mirroring the `sidebarChildren` slot. When present
   * on desktop the grid gains a third `auto` column spanning both rows. Unlike
   * the sidebar aside, this column NEVER unmounts (right-panel spec P3):
   * `rightPanelVisible === false` hides it at display level only.
   */
  rightPanelChildren?: ReactNode;
  /** Visibility gate for the right column — display-level hide, never unmount. */
  rightPanelVisible?: boolean;
}) {
  const { sidebarOpen, sidebarWidth } = useChromeState();
  const { setSidebarOpen } = useChromeDispatch();
  const isMobile = useIsMobile();
  const drawerRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Cmd+\ / Ctrl+\ toggles the sidebar. Cmd captures only — see hook for
  // the input/textarea/contenteditable suppression rules.
  useSidebarKeyboardToggle(() => setSidebarOpen(!sidebarOpen));

  // The mobile drawer is `aria-modal`: trap Tab focus within it and close on
  // Escape while it is mounted, honoring the `role="dialog" aria-modal="true"`
  // contract. Active ONLY for the mobile overlay — the desktop sidebar lives in
  // the grid and is never a modal, so its Tab navigation is unchanged.
  const drawerActive = isMobile && sidebarOpen && !!sidebarChildren;
  useFocusTrap(drawerRef, drawerActive, () => setSidebarOpen(false));

  // Grid-template-columns on desktop: animate width on collapse via CSS transition.
  // On mobile we use a single column ('1fr') so collapsed/open is purely a function
  // of whether the overlay renders. The right column (260812-nm4p) is desktop-only:
  // the slot is ignored on mobile so that grid stays byte-identical.
  const hasRightPanel = !isMobile && !!rightPanelChildren;
  const gridStyle: React.CSSProperties = isMobile
    ? {
        height: "100%",
        display: "grid",
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr auto",
        gridTemplateAreas: '"content" "bottombar"',
        position: "relative",
      }
    : {
        height: "100%",
        display: "grid",
        gridTemplateColumns:
          (sidebarOpen ? `${sidebarWidth}px 1fr` : "0 1fr") + (hasRightPanel ? " auto" : ""),
        gridTemplateRows: "1fr auto",
        gridTemplateAreas: hasRightPanel
          ? '"sidebar content rightpanel" "sidebar bottombar rightpanel"'
          : '"sidebar content" "sidebar bottombar"',
        transition: "grid-template-columns 150ms ease-out",
      };

  return (
    <ShellGridRefContext.Provider value={gridRef}>
    <div className="app-shell" ref={gridRef} style={gridStyle}>
      {/* Desktop sidebar aside (Shell-owned — 260719-rwqf). Gated the same way
          the callers used to gate their own asides (`!isMobile && sidebarOpen`,
          plus a `sidebarChildren` presence check), so it fully unmounts on
          collapse — no zero-width rail. The optional `sidebarResizeHandle` sits
          at the right edge (AppShell's drag handle; BoardPage passes none). The
          `border-r` seam is applied ONLY when no handle is present: with a
          handle the 3px handle bar IS the seam, so a border would double it. */}
      {!isMobile && sidebarOpen && sidebarChildren && (
        <aside
          style={{ gridArea: "sidebar" }}
          aria-label="Sidebar"
          className={
            sidebarResizeHandle
              ? "relative flex flex-row overflow-hidden"
              : "relative flex flex-row overflow-hidden border-r border-border"
          }
        >
          <div className="flex-1 min-w-0 overflow-hidden">{sidebarChildren}</div>
          {sidebarResizeHandle}
        </aside>
      )}

      {children}

      {/* Desktop right column (260812-nm4p — the `sidebarChildren` mirror).
          Rendered whenever the slot is filled, gated by `rightPanelVisible` at
          DISPLAY level only (`hidden` collapses the `auto` grid column to zero
          width) — NEVER unmounted, so the web/code iframes inside keep their
          in-memory state across a collapse (right-panel spec P3; a deliberate
          divergence from the sidebar aside's unmount gating above). */}
      {hasRightPanel && (
        <aside
          style={{ gridArea: "rightpanel" }}
          aria-label="Right panel"
          className={rightPanelVisible ? "flex flex-row overflow-hidden" : "hidden"}
        >
          {rightPanelChildren}
        </aside>
      )}

      {/* Mobile overlay: renders below the topbar so the hamburger stays
          visible as a close affordance (matches the project convention
          documented in `fab/project/context.md`: "Mobile sidebar drawer is
          `absolute` inside the main area (not `fixed inset-0`) so the top
          bar stays visible and the logo toggle can close the drawer.").
          Implementation: a grid child spanning both rows (content +
          bottombar, `gridRow: "1 / 3"`) hosts the absolutely-positioned
          backdrop and aside.
          Backdrop tap and explicit close both fire `setSidebarOpen(false)`.
          Destination-tap auto-close lives in the consumer (Sidebar callbacks
          already invoke `setSidebarOpen(false)` after navigation). */}
      {isMobile && sidebarOpen && sidebarChildren && (
        <div
          style={{ gridRow: "1 / 3", gridColumn: 1, position: "relative" }}
          className="z-40 pointer-events-none"
        >
          <div
            className="absolute inset-0 z-40 bg-black/50 pointer-events-auto"
            aria-hidden="true"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 z-50 w-[88%] max-w-[320px] bg-bg-primary border-r border-border overflow-y-auto shadow-2xl pointer-events-auto"
          >
            {sidebarChildren}
          </aside>
        </div>
      )}
    </div>
    </ShellGridRefContext.Provider>
  );
}
