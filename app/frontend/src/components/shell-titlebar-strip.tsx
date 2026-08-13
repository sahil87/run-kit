import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInstanceAccent } from "@/contexts/instance-accent-context";
import { useTheme } from "@/contexts/theme-context";
import { Tip } from "@/components/tip";
import { useToast } from "@/components/toast";
import {
  addShellHost,
  canAddShellHost,
  canReorderShellHosts,
  listShellServers,
  reorderShellHosts,
  shellInfo,
  switchShellServer,
} from "@/lib/shell";
import type { ShellServer } from "@/lib/shell";
import {
  activeShellHostName,
  SHELL_STRIP_HEIGHT_PX,
  SHELL_STRIP_MARKER_CLASS,
  shellHostMenuRows,
  stripInsets,
  stripLabelColor,
  stripSwitcherEnabled,
} from "@/lib/shell-strip";
import type { ShellHostMenuRow } from "@/lib/shell-strip";

/**
 * Desktop-shell titlebar strip (260731-ofws): a 28px full-width draggable
 * band above the top bar, rendered ONLY inside the Electron viewer shell
 * (callers gate the mount on `isShell()`). The shell hides the native
 * titlebar (`hiddenInset` / `hidden`+overlay), so this strip IS the visible
 * titlebar: macOS traffic lights and the Windows/Linux window controls
 * composite over its ends (hence the platform insets on the label).
 *
 * Background = the instance accent blended at `INSTANCE_TITLEBAR_RATIO`
 * (`titlebarHex` — identical color math to the installed-PWA titlebar tint),
 * falling back to the plain theme background when no accent is set. The whole
 * band is a drag region (`.rk-shell-drag`) with exactly ONE no-drag island
 * (260731-4bqi): the centered host-switcher trigger and its open menu carry
 * `.rk-shell-no-drag`; everything else in the band stays draggable.
 *
 * While mounted, `<html>` carries the `rk-shell-strip` marker class — the
 * shell's version-skew fallback CSS (`html:not(.rk-shell-strip)` selectors,
 * injected for older SPAs) keys off it and no-ops here.
 *
 * The centered label names the window's host: the shell-registered active
 * host's display name via the existing `servers.list()` bridge call, falling
 * back to `location.hostname` (older shell, denial, no active entry). When
 * the bridge answers a non-empty host list, the label is the host-switcher
 * dropdown trigger (`<name> ▾`, 260731-4bqi) — the mouse-secondary companion
 * to the ⌥⌘1–9 / ⇧Ctrl+1–9 accelerators and the palette's `Server: Switch
 * to` block (Constitution V keeps the keyboard paths primary). Selecting a
 * host hands off to the shell's `switchToHost` seam (a full page swap with
 * lastPath restore), so there is no optimistic UI. On an older shell without
 * the `servers` group the label stays today's static, non-interactive span.
 *
 * When the shell's `servers` group carries the optional `add` invoker, the
 * menu ends with a `+ Add Host…` footer that opens the shell's welcome page
 * in add mode (`servers:add` → the same main-side path as the native
 * `Hosts → Add Host…` menu item). Older shells without the invoker render
 * the menu without the footer.
 *
 * Three additive, independently capability-gated row features (1i7j): a
 * ~3px left-edge bar in the host's persisted accent color (hex-validated in
 * the row model), an amber `● N` waiting-agent count on BACKGROUND rows
 * (the active host's attention surface is the dock badge), and manual
 * reorder — a hover drag grip (commit-on-drop) plus ⌥↑/⌥↓ while the menu is
 * open (one move per keypress). Order IS the ⌥⌘1–9/⇧Ctrl+1–9 accelerator
 * map, so reordering re-numbers the hints live; the shell rebuilds its
 * native menu on each committed move. All three ride the optional
 * `reorder` invoker / additive projection fields — an older shell renders
 * exactly the plain marker/name/origin/hint rows.
 */

/** Custom MIME so a host-reorder drag never collides with the other
 *  drag-reorder payloads (server/session/board-list). */
const HOST_REORDER_MIME = "application/x-shell-host-reorder";

export function ShellTitlebarStrip() {
  const { titlebarHex } = useInstanceAccent();
  const { theme } = useTheme();
  const { addToast } = useToast();
  const [servers, setServers] = useState<ShellServer[] | null>(null);
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Mark <html> so the shell's injected fallback strip disables itself.
  useLayoutEffect(() => {
    document.documentElement.classList.add(SHELL_STRIP_MARKER_CLASS);
    return () => document.documentElement.classList.remove(SHELL_STRIP_MARKER_CLASS);
  }, []);

  // Monotonic sequence guarding every list fetch: the open-time refetch has
  // no effect cleanup to cancel it, so a resolution older than the latest
  // issued request is dropped — two in-flight fetches resolving out of order
  // can never leave a stale list rendered. A null resolution (denial or
  // rejection) keeps the last known list rather than blanking an open menu;
  // the initial state is already null, so skipping the set on a failed mount
  // fetch changes nothing there either.
  const listSeqRef = useRef(0);
  const fetchServers = useCallback(() => {
    const seq = ++listSeqRef.current;
    void listShellServers().then((fresh) => {
      if (fresh !== null && seq === listSeqRef.current) setServers(fresh);
    });
  }, []);

  // One list call on mount — feeds the label AND the switcher gate. Host
  // identity only changes via a full page swap (switching hosts loads the new
  // host's URL), so no subscription is needed. The cleanup bump invalidates
  // any still-in-flight fetch (the sequence guard doubles as cancellation).
  useEffect(() => {
    fetchServers();
    return () => {
      listSeqRef.current++;
    };
  }, [fetchServers]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Refetch on every open (260731-4bqi): the native `Hosts → Remove "<name>"…`
  // menu mutates the list without a page reload, so a mount-time-only list can
  // go stale.
  useEffect(() => {
    if (open) fetchServers();
  }, [open, fetchServers]);

  const interactive = stripSwitcherEnabled(servers);
  const rows = interactive ? shellHostMenuRows(servers, shellInfo()?.platform ?? "") : [];
  // The `+ Add Host…` footer rides the optional `servers.add` invoker — older
  // shells expose only list/switch and render the menu without it.
  const canAdd = canAddShellHost();
  // The reorder affordances (drag grip, ⌥↑/⌥↓) ride the optional
  // `servers.reorder` invoker — an older shell renders plain rows.
  const canReorder = canReorderShellHosts();

  // Latest COMMITTED host-row count, read live inside the capture-phase
  // keydown handler: that handler stays attached from a commit until the
  // passive-effect flush swaps the subscription, so a closure capture would
  // observe the OLD count in that window. A layout effect writes the ref at
  // commit time — before any keydown dispatched after an emptied-list commit
  // can reach the stale handler (a passive useEffect write would flush in
  // the same phase it is meant to beat).
  const hostCountRef = useRef(0);
  useLayoutEffect(() => {
    hostCountRef.current = rows.length;
  }, [rows.length]);

  // Live copy of the derived rows for the reorder gestures (the keydown
  // handler's subscription can lag a reorder commit the same way it lags a
  // count change — the ref always reads the committed order).
  const rowsRef = useRef<ShellHostMenuRow[]>([]);
  useLayoutEffect(() => {
    rowsRef.current = rows;
  });

  // One committed shell invocation per gesture; a denial/failure surfaces
  // the toast precedent and refetches so the list reconciles with the store.
  const commitReorder = useCallback(
    (id: string, toIndex: number) => {
      void reorderShellHosts(id, toIndex).then((ok) => {
        if (!ok) {
          addToast("Shell host reorder failed", "error");
          fetchServers();
        }
      });
    },
    [addToast, fetchServers],
  );

  // Shared move commit (⌥↑/⌥↓ per keypress): the local list reorders
  // OPTIMISTICALLY so the accelerator hints re-number immediately, and the
  // roving-tabindex seat follows the moved row (DOM focus follows on its
  // own — the row's keyed element moves with it).
  const moveHostRow = useCallback(
    (from: number, to: number) => {
      const row = rowsRef.current[from];
      if (!row) return;
      setServers((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
      setFocusedIndex(to);
      commitReorder(row.id, to);
    },
    [commitReorder],
  );

  // Drag-grip reorder (the board-tile/session-reorder precedent): the local
  // order reorders optimistically during the drag (presentation state — the
  // open-time refetch reconciles), and exactly ONE reorder invocation
  // commits at drop, keyed on the immutable host id.
  const dragIdRef = useRef<string | null>(null);

  const onRowDragStart = useCallback((e: React.DragEvent, id: string) => {
    dragIdRef.current = id;
    e.dataTransfer.setData(HOST_REORDER_MIME, id);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onRowDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    const dragId = dragIdRef.current;
    if (!dragId || !e.dataTransfer.types.includes(HOST_REORDER_MIME)) return;
    // Accept the drop BEFORE the self-target bail: the final dragover lands
    // on the dragged row's own element, and only a preventDefaulted dragover
    // registers the release as a drop.
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragId === targetId) return;
    // Resolve indexes by id INSIDE the functional updater: React can batch
    // several dragover updates before a commit refreshes `rowsRef`, so
    // ref-derived indexes could be stale relative to the `prev` being spliced.
    setServers((prev) => {
      if (!prev) return prev;
      const from = prev.findIndex((s) => s.id === dragId);
      const to = prev.findIndex((s) => s.id === targetId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const onRowDrop = useCallback(
    (e: React.DragEvent) => {
      const dragId = dragIdRef.current;
      if (!dragId || !e.dataTransfer.types.includes(HOST_REORDER_MIME)) return;
      e.preventDefault();
      dragIdRef.current = null;
      // The optimistic dragover splices already landed the row at its drop
      // position — commit exactly that index.
      const to = rowsRef.current.findIndex((r) => r.id === dragId);
      if (to === -1) return;
      commitReorder(dragId, to);
    },
    [commitReorder],
  );

  const onRowDragEnd = useCallback(() => {
    dragIdRef.current = null;
  }, []);

  // An open-time refetch can EMPTY the list: the trigger and menu unmount
  // (interactive flips false) while `open` would otherwise stay true, leaving
  // the capture-phase key handling subscribed with nothing visible. Release
  // the open state so the menu's effects tear down with it.
  useEffect(() => {
    if (open && !interactive) setOpen(false);
  }, [open, interactive]);

  // Outside-click closes (the BreadcrumbDropdown contract).
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Escape closes + refocuses the trigger; ArrowDown/ArrowUp move focus with
  // wraparound (capture-phase, mirroring BreadcrumbDropdown). With the
  // reorder capability, ⌥↑/⌥↓ instead MOVES the focused host row. Enter
  // needs no handler — the focused row is a native <button>.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // Never swallow arrows the menu cannot act on: an emptied-list
        // refetch unmounts the rows one render before the close-on-empty
        // effect flips `open`, and this handler may still be the STALE
        // subscription (attached until the passive-effect flush swaps it).
        // The guard therefore reads the live committed count from
        // `hostCountRef` — written at commit time — so even a stale
        // subscription sees the zero and releases the key instead of
        // preventDefaulting app-wide. Keyed on the HOST count — the menu
        // (footer included) unmounts when it hits zero.
        const hostCount = hostCountRef.current;
        if (hostCount === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        // ⌥↑/⌥↓ moves the focused HOST row (all platforms — arrows compose
        // no characters): one committed move per keypress, hints re-number
        // live via the optimistic reorder. The Add-Host footer is NOT
        // movable — Alt-arrows there (and ALL Alt-arrows on an older shell
        // without the capability) fall through to the roving cycle. No wrap
        // at the list edges: a move past either end swallows the key
        // without invoking the shell.
        if (e.altKey && canReorder) {
          const from = itemRefs.current.findIndex((el) => el === document.activeElement);
          if (from >= 0 && from < hostCount) {
            const to = from + delta;
            if (to < 0 || to >= hostCount) return;
            moveHostRow(from, to);
            return;
          }
        }
        // The roving set spans the host rows PLUS the Add-Host footer when
        // the bridge carries it — the footer is the last stop in the arrow
        // cycle. The modulus derives from the same live read, so a
        // shrunk-but-non-empty list also cycles over the live count.
        const count = hostCount + (canAdd ? 1 : 0);
        setFocusedIndex((prev) => {
          const next = (prev + delta + count) % count;
          itemRefs.current[next]?.focus();
          return next;
        });
      }
    }
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => document.removeEventListener("keydown", handleKey, { capture: true });
  }, [open, rows.length, canAdd, canReorder, moveHostRow]);

  // Focus lands on the active row on open.
  useEffect(() => {
    if (!open) return;
    const activeIdx = Math.max(
      rows.findIndex((r) => r.active),
      0,
    );
    setFocusedIndex(activeIdx);
    requestAnimationFrame(() => {
      itemRefs.current[activeIdx]?.focus();
    });
    // Keys on the open transition only — re-running on a refetched row set
    // would yank focus while the user is arrowing through the menu.
  }, [open]);

  // Re-clamp the roving-tabindex seat when an open-time refetch SHRINKS the
  // row set below it — otherwise no row would carry tabIndex=0 and focus
  // falls to <body>. An in-bounds seat is left alone, so a refetch that
  // leaves the list unchanged never yanks focus mid-arrowing (the seed
  // effect above stays open-transition-only for the same reason).
  useEffect(() => {
    if (!open || rows.length === 0) return;
    const itemCount = rows.length + (canAdd ? 1 : 0);
    setFocusedIndex((prev) => {
      if (prev < itemCount) return prev;
      const clamped = itemCount - 1;
      itemRefs.current[clamped]?.focus();
      return clamped;
    });
  }, [open, rows.length, canAdd]);

  // Hand off to the shell's single switch seam. The whole page navigates
  // (lastPath capture/restore is shell-side), so there is nothing to update
  // optimistically; a denial/failure surfaces the palette's toast precedent.
  const selectHost = useCallback(
    (id: string) => {
      setOpen(false);
      void switchShellServer(id).then((ok) => {
        if (!ok) addToast("Shell server switch failed", "error");
      });
    },
    [addToast],
  );

  // Open the shell's Add Host flow (welcome page in add mode) — a full page
  // swap, same as selecting a host, so the menu just closes first.
  const openAddHost = useCallback(() => {
    setOpen(false);
    void addShellHost().then((ok) => {
      if (!ok) addToast("Shell add host failed", "error");
    });
  }, [addToast]);

  const bg = titlebarHex ?? theme.palette.background;
  const insets = stripInsets(shellInfo()?.platform ?? "");
  const hostLabel = activeShellHostName(servers) ?? window.location.hostname;

  return (
    <div
      data-testid="shell-titlebar-strip"
      className="rk-shell-drag shrink-0 flex items-center justify-center select-none"
      style={{
        height: `${SHELL_STRIP_HEIGHT_PX}px`,
        backgroundColor: bg,
        color: stripLabelColor(bg),
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {interactive ? (
        <div ref={containerRef} className="rk-shell-no-drag relative flex min-w-0 items-center">
          {/* Tip reveals the full host name — the label truncates by design
              inside the platform insets. Suppressed while open, the standard
              dropdown-trigger treatment (BreadcrumbDropdown, OpenButton). */}
          <Tip label={open ? undefined : hostLabel}>
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label="Switch host"
              onClick={toggle}
              // Subtle hover pill: a currentColor tint so it reads on any
              // accent-blended strip background (the label color is already
              // contrast-derived against it).
              className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-current/15"
            >
              <span className="min-w-0 truncate">{hostLabel}</span>
              <span aria-hidden="true" className="shrink-0 opacity-60">
                {"▾"}
              </span>
            </button>
          </Tip>
          {open && rows.length > 0 && (
            <div
              role="menu"
              aria-label="Switch host"
              // The strip has no overflow-hidden ancestor clipping below it,
              // so a plain absolute anchor under the trigger suffices (no
              // fixed-position machinery needed here). The menu paints over
              // SPA content below the band, so it uses theme surface colors,
              // not the strip's accent blend.
              className="rk-shell-no-drag absolute left-1/2 top-full z-50 mt-1 max-h-72 min-w-[220px] max-w-[320px] -translate-x-1/2 overflow-y-auto rounded-lg border border-border bg-bg-primary py-1 shadow-2xl"
            >
              {rows.map((row, i) => (
                <button
                  key={row.id}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  // menuitemradio + aria-checked: the active host is a
                  // single-select state AT must hear, not a color-only cue
                  // (the view-switcher precedent; aria-pressed is invalid on
                  // a menu item).
                  role="menuitemradio"
                  aria-checked={row.active}
                  tabIndex={focusedIndex === i ? 0 : -1}
                  onClick={() => selectHost(row.id)}
                  draggable={canReorder}
                  onDragStart={(e) => onRowDragStart(e, row.id)}
                  onDragOver={(e) => onRowDragOver(e, row.id)}
                  onDrop={onRowDrop}
                  onDragEnd={onRowDragEnd}
                  className={`group relative flex w-full items-baseline gap-2 py-2 pl-3 text-left text-sm transition-colors ${
                    canReorder ? "pr-6" : "pr-3"
                  } ${
                    row.active
                      ? "text-accent"
                      : "text-text-secondary hover:bg-bg-card hover:text-text-primary"
                  }`}
                >
                  {/* Accent edge bar — absolutely overlaid on the row's left
                      edge so a colorless row keeps identical alignment. The
                      row model hex-validated the value (no interpolation of
                      unvalidated strings). */}
                  {row.accentColor !== null && (
                    <span
                      aria-hidden="true"
                      data-testid="shell-host-accent-bar"
                      className="absolute bottom-1 left-0 top-1 w-[3px] rounded-full"
                      style={{ backgroundColor: row.accentColor }}
                    />
                  )}
                  {/* Active marker column — fixed width so names align. */}
                  <span aria-hidden="true" className="w-3 shrink-0">
                    {row.active ? "✓" : ""}
                  </span>
                  <span className="min-w-0 shrink-0 truncate">{row.name}</span>
                  {/* Dimmed origin — display names are not unique, the origin
                      disambiguates. */}
                  <span className="min-w-0 truncate text-xs opacity-60">{row.origin}</span>
                  {/* Amber waiting-agent count — BACKGROUND hosts only (the
                      row model nulls the active row's count; the dock badge
                      is the active host's attention surface). Waiting-only
                      semantics: 0/absent renders nothing. */}
                  {row.waiting !== null && (
                    <span className="ml-auto shrink-0 pl-2 text-xs text-amber-600">
                      ● {row.waiting}
                    </span>
                  )}
                  {/* Trailing accelerator hint mirroring the native Hosts
                      menu bindings (⌥⌘1–9 mac / ⇧Ctrl+1–9 win-linux, 9-cap). */}
                  {row.hint && (
                    <span
                      className={`${row.waiting === null ? "ml-auto " : ""}shrink-0 pl-2 text-xs text-text-secondary`}
                    >
                      {row.hint}
                    </span>
                  )}
                  {/* Drag grip — hover-revealed at the row's trailing edge
                      (the `pr-6` above reserves its width). Visual affordance
                      only; the row itself is the draggable. */}
                  {canReorder && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] leading-none tracking-[-2px] text-text-secondary opacity-0 transition-opacity group-hover:opacity-60"
                    >
                      ⋮⋮
                    </span>
                  )}
                </button>
              ))}
              {canAdd && (
                <button
                  ref={(el) => {
                    itemRefs.current[rows.length] = el;
                  }}
                  type="button"
                  // Plain menuitem — an action, not a member of the host
                  // radio group. Last roving-tabindex stop (index rows.length).
                  role="menuitem"
                  tabIndex={focusedIndex === rows.length ? 0 : -1}
                  onClick={openAddHost}
                  className="mt-1 flex w-full items-baseline gap-2 border-t border-border px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary"
                >
                  {/* Aligned with the rows' fixed marker column. */}
                  <span aria-hidden="true" className="w-3 shrink-0">
                    +
                  </span>
                  <span className="min-w-0 truncate">Add Host…</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <span className="min-w-0 truncate text-xs">{hostLabel}</span>
      )}
    </div>
  );
}
