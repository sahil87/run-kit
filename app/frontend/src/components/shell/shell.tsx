import { useEffect, useRef, type ReactNode } from "react";
import { useChromeState, useChromeDispatch } from "@/contexts/chrome-context";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useFocusTrap } from "@/hooks/use-focus-trap";

/**
 * `Cmd+\` (macOS) / `Ctrl+\` (Linux/Windows) toggles the sidebar. Constitution V
 * (Keyboard-First) requires every user-facing action be keyboard-reachable;
 * the sidebar's visibility now is one such action. We register at Shell level
 * so the chord works on every route that mounts a `<Shell>` (AppShell + BoardPage).
 *
 * Suppressed when an input/textarea/contenteditable has focus to avoid
 * stealing the chord from the user's text editing.
 */
function useSidebarKeyboardToggle(toggle: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Match `\` (Backslash) — `e.key` reads the resolved character.
      if (e.key !== "\\") return;
      if (!(e.metaKey || e.ctrlKey)) return;

      // Suppress only when a "real" text input has focus. xterm.js focuses a
      // hidden `.xterm-helper-textarea` whenever a terminal is mounted —
      // that's the user's most-common focus state, so naïvely skipping every
      // TEXTAREA would silently break the toggle in the typical case. We only
      // bail when the focused element is NOT inside the xterm container.
      const target = e.target;
      if (target instanceof HTMLElement) {
        const insideXterm = target.closest(".xterm") != null;
        if (!insideXterm) {
          const tag = target.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
        }
      }

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
 *   ┌──────────┬───────────────┐
 *   │ sidebar  │   content     │
 *   │          ├───────────────┤
 *   │          │   bottombar   │
 *   └──────────┴───────────────┘
 *
 * - `grid-template-areas`: `"sidebar content" / "sidebar bottombar"`.
 * - `grid-template-rows`: `1fr auto`
 * - `grid-template-columns`: `${sidebarWidth}px 1fr` when `sidebarOpen` is `true`,
 *   else `0 1fr`. CSS transition (~150ms ease-out) animates collapse.
 *
 * Topology (mobile, viewport < 640px):
 *   - Single-column grid (`content / bottombar`); the `sidebar` slot
 *     is removed from the grid.
 *   - When `sidebarOpen === true`, the sidebar children render outside the
 *     grid as an absolute overlay with a backdrop. The overlay carries
 *     `role="dialog" aria-modal="true"` for assistive tech.
 *
 * Children must use grid-area placement via `style={{ gridArea: "sidebar" | "content" | "bottombar" }}`.
 *
 * Height is `100%` — Shell fills the root layout's `flex-1` content region.
 * The `--app-height` var (iOS keyboard handling) is now maintained by
 * `useVisualViewport()` in `RootWrapper`, whose root layout div is the var's
 * consumer; Shell no longer calls the hook or reads the var directly.
 */
export function Shell({ children, sidebarChildren }: { children: ReactNode; sidebarChildren?: ReactNode }) {
  const { sidebarOpen, sidebarWidth } = useChromeState();
  const { setSidebarOpen } = useChromeDispatch();
  const isMobile = useIsMobile();
  const drawerRef = useRef<HTMLElement>(null);

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
  // of whether the overlay renders.
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
        gridTemplateRows: "1fr auto",
        gridTemplateAreas: '"sidebar content" "sidebar bottombar"',
        transition: "grid-template-columns 150ms ease-out",
      };

  return (
    <div className="app-shell" style={gridStyle}>
      {children}

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
  );
}
