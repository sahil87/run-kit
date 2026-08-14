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
 * Topology (desktop, viewport ≥ 640px), no right panel (board/server routes):
 *   ┌──────────┬───────────────┐
 *   │ sidebar  │   content     │
 *   │          ├───────────────┤
 *   │          │   bottombar   │
 *   ├──────────┴───────────────┤
 *   │         statusbar        │
 *   └──────────────────────────┘
 *
 * With the `rightPanelChildren` slot filled (desktop terminal route,
 * 260812-nm4p), the non-sidebar region becomes a nested STAGE grid
 * (260814-ldbs — the composed-frame change): the outer grid's content column
 * holds ONE `stage` area, and the stage wraps the consumer's `content` child
 * and the rail aside in its own single-row grid — `bg-bg-inset p-[6px]
 * gap-[6px]`, columns `1fr auto`, areas `"content rightpanel"` — so the tile
 * grid and the rail card float on one continuous inset ground. The stage is
 * NESTED rather than a bare grid-template-areas flip because grid `gap`
 * applies to ALL tracks: on the outer grid it would open a 6px seam against
 * the sidebar, which stays ATTACHED frame chrome (its `border-r` / drag-handle
 * seam; the two-family rule — attached frame vs floating cards — is the
 * change's organizing principle). Consumers' `gridArea: "content"` styles
 * rebind to the nested template untouched (areas bind to direct children).
 *
 *   ┌──────────┬──────────────────────────┐
 *   │          │  ┌─────────────┬───────┐  │
 *   │ sidebar  │  │  content    │ rail  │  │   ← stage (inset ground, 6px)
 *   │          │  └─────────────┴───────┘  │
 *   │          ├──────────────────────────┤
 *   │          │   bottombar (coarse only)│
 *   ├──────────┴──────────────────────────┤
 *   │         statusbar (full width)      │
 *   └─────────────────────────────────────┘
 *
 * - Outer `grid-template-areas`: `"sidebar content" / "sidebar bottombar" /
 *   "statusbar statusbar"` — or, with the right-panel slot filled,
 *   `"sidebar stage" / "sidebar bottombar" / "statusbar statusbar"`.
 * - `grid-template-rows`: `1fr auto auto` (the statusbar row is `auto` — with
 *   no `statusBarChildren` it collapses to zero height).
 * - `grid-template-columns`: `${sidebarWidth}px 1fr` when `sidebarOpen` is
 *   `true`, else `0 1fr`. CSS transition (~150ms ease-out) animates collapse.
 * - The **statusbar** row spans ALL columns (sidebar included): the sidebar
 *   ends flush above it in a square T-junction — the status bar is attached
 *   frame chrome like the top bar, never a card.
 *
 * The `rightpanel` aside lives INSIDE the stage (stage row 1, column 2) — the
 * rail card runs from 6px below the top bar to 6px above the bottombar/status
 * bar, no longer a full-height shell column. It still NEVER unmounts
 * (right-panel spec P3): `rightPanelVisible === false` flips the stage
 * template to `1fr` / `"content"` (dropping the `auto` track so no stray 6px
 * column-gap remains — an explicit `auto` track keeps its gap even with a
 * hidden item) and hides the aside at display level (`hidden`), so the
 * subtree stays mounted and the web/code iframes keep their in-memory state.
 *
 * Topology (mobile, viewport < 640px):
 *   - Single-column grid (`content / bottombar`); the `sidebar` slot
 *     is removed from the grid. The statusbar row never exists here.
 *   - When `sidebarOpen === true`, the sidebar children render outside the
 *     grid as an absolute overlay with a backdrop. The overlay carries
 *     `role="dialog" aria-modal="true"` for assistive tech.
 *
 * The `sidebar`, `bottombar`, and `statusbar` placements are Shell-owned: on
 * desktop Shell renders the `<aside gridArea:"sidebar">` itself from
 * `sidebarChildren` (gated `!isMobile && sidebarOpen && !!sidebarChildren`),
 * with an optional `sidebarResizeHandle` node placed at its right edge
 * (AppShell's drag-resize handle; drag state/handlers stay in AppShell). The
 * bottom bar / compose strip arrive via `bottomBarChildren` (Shell renders the
 * `<footer gridArea:"bottombar">` wrapper — keeping the footer OUT of the
 * nested stage so the stage stays a clean single row and the coarse-pointer
 * bar stays flush-attached), and the status bar via `statusBarChildren`
 * (desktop only). Consumers therefore place ONLY the `content` grid area via
 * `style={{ gridArea: "content" }}` — never `sidebar`/`bottombar`/`statusbar`.
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
  bottomBarChildren,
  statusBarChildren,
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
   * Optional right rail (260812-nm4p) — the terminal route's rail subtree,
   * mirroring the `sidebarChildren` slot. When present on desktop the
   * non-sidebar region becomes the nested stage grid (see the component doc):
   * the rail aside occupies stage row 1 / column 2 as a floating card
   * (260814-ldbs), no longer a full-height shell column. The aside NEVER
   * unmounts (right-panel spec P3): `rightPanelVisible === false` drops the
   * stage's `auto` track and hides the aside at display level only.
   */
  rightPanelChildren?: ReactNode;
  /** Visibility gate for the right column — display-level hide, never unmount. */
  rightPanelVisible?: boolean;
  /**
   * Bottom-bar row content (260814-ldbs — the `sidebarChildren` pattern
   * extended): the compose strip + the BottomBar. Shell renders the
   * `<footer gridArea:"bottombar">` wrapper itself so the footer stays OUT of
   * the nested stage. BottomBar self-gates on pointer type (fine pointers
   * render nothing), so an empty footer collapses the `auto` row to zero —
   * no reserved height survives (the 260814-ink6/PR #598 property).
   */
  bottomBarChildren?: ReactNode;
  /**
   * Status-bar row content (260814-ldbs) — the full-width attached frame
   * strip at the shell bottom. Desktop only: rendered as the `statusbar` area
   * spanning ALL columns (sidebar included); never rendered on mobile (the
   * mobile template has no such row).
   */
  statusBarChildren?: ReactNode;
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
  // of whether the overlay renders. The stage + statusbar (260814-ldbs) are
  // desktop-only: the right-panel slot is ignored on mobile and the mobile
  // template never carries a statusbar row, so that grid stays byte-identical.
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
        gridTemplateColumns: sidebarOpen ? `${sidebarWidth}px 1fr` : "0 1fr",
        gridTemplateRows: "1fr auto auto",
        gridTemplateAreas: hasRightPanel
          ? '"sidebar stage" "sidebar bottombar" "statusbar statusbar"'
          : '"sidebar content" "sidebar bottombar" "statusbar statusbar"',
        transition: "grid-template-columns 150ms ease-out",
      };

  // The nested stage grid (260814-ldbs, hasRightPanel branch only): a single
  // row of tile grid + rail card on the shared inset ground. Collapse drops
  // the `auto` track entirely (template flip to `1fr`) so no stray column-gap
  // survives a hidden rail — the aside below stays MOUNTED, display-hidden.
  const stageStyle: React.CSSProperties = {
    gridArea: "stage",
    display: "grid",
    gridTemplateColumns: rightPanelVisible ? "1fr auto" : "1fr",
    gridTemplateRows: "1fr",
    gridTemplateAreas: rightPanelVisible ? '"content rightpanel"' : '"content"',
    gap: "6px",
    padding: "6px",
    minWidth: 0,
    minHeight: 0,
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

      {/* Content + right rail. With the slot filled (desktop terminal route)
          both live inside the nested STAGE grid (260814-ldbs): the consumer's
          `gridArea: "content"` child and the `rightpanel` aside rebind to the
          stage's single-row template, floating as cards on the stage's
          `bg-bg-inset` ground. Without the slot the children render directly
          in the outer grid's `content` area (byte-identical to before).
          The right aside NEVER unmounts (right-panel spec P3): collapse
          (`rightPanelVisible === false`) flips the stage template to `1fr`
          and hides the aside at display level only (`hidden`), so the
          web/code iframes inside keep their in-memory state across a collapse
          (a deliberate divergence from the sidebar aside's unmount gating
          above). Dialogs passed as children are `position: fixed` (out of
          flow), so they never participate in grid placement. */}
      {hasRightPanel ? (
        <div style={stageStyle} className="bg-bg-inset">
          {children}
          <aside
            style={{ gridArea: "rightpanel" }}
            aria-label="Right panel"
            className={rightPanelVisible ? "flex flex-row overflow-hidden" : "hidden"}
          >
            {rightPanelChildren}
          </aside>
        </div>
      ) : (
        children
      )}

      {/* Bottom-bar row (Shell-owned placement, 260814-ldbs): the footer
          wrapper lives OUTSIDE the stage so the coarse-pointer key-chip bar
          stays flush-attached frame chrome and the stage keeps its clean
          single row. Empty content (fine pointers — BottomBar self-gates to
          null, compose strip off) collapses the `auto` row to zero height. */}
      {bottomBarChildren != null && (
        <footer style={{ gridArea: "bottombar" }}>{bottomBarChildren}</footer>
      )}

      {/* Status-bar row (260814-ldbs): full-width attached frame chrome,
          spanning the sidebar column too (a flush square T-junction — the
          frame family is never rounded). Desktop only; the mobile template
          has no statusbar area, so the slot is ignored there. */}
      {!isMobile && statusBarChildren != null && (
        <div style={{ gridArea: "statusbar" }} className="min-w-0">
          {statusBarChildren}
        </div>
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
