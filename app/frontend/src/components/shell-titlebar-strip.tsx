import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInstanceAccent } from "@/contexts/instance-accent-context";
import { useTheme } from "@/contexts/theme-context";
import { Tip } from "@/components/tip";
import { useToast } from "@/components/toast";
import {
  addShellHost,
  canAddShellHost,
  canRemoveShellHost,
  canRenameShellHost,
  canReorderShellHosts,
  listShellServers,
  removeShellHost,
  renameShellHost,
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
 *
 * Two further capability-gated row affordances join the grip in a trailing
 * hover/focus-revealed cluster: Disconnect (routes into the shell's ONE
 * removal path — the native Cancel-default confirm dialog is the only
 * confirmation; the SPA adds none) and an inline rename (Enter/blur commits,
 * Escape cancels — the window-heading precedent; an empty/unchanged commit
 * is a cancel, no dialog anywhere). Delete/Backspace and F2 reach both from
 * the focused row (Constitution V), and while the rename input holds focus
 * the menu's capture-phase key handling suspends. Each affordance rides its
 * own optional invoker (`servers.remove` / `servers.rename`), so an older
 * shell renders rows without the icons or the bindings.
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
  // Disconnect and inline rename ride their own optional invokers
  // (`servers.remove` / `servers.rename`), gated independently — an older
  // shell renders rows without the icons or the key bindings.
  const canRemove = canRemoveShellHost();
  const canRename = canRenameShellHost();
  // The trailing reservation must fit every rendered cluster member (icons
  // are hover/focus-revealed but the width is static): grip + up to two
  // icon buttons.
  const affordanceCount = (canReorder ? 1 : 0) + (canRemove ? 1 : 0) + (canRename ? 1 : 0);
  const affordancePad =
    affordanceCount === 0
      ? "pr-3"
      : affordanceCount === 1
        ? "pr-6"
        : affordanceCount === 2
          ? "pr-11"
          : "pr-16";

  // Inline row rename: the editing row's id plus its draft. `keyHandledRef`
  // is the WindowHeading blur guard — a key-driven commit/cancel (Enter/
  // Escape) tears the input down, and the trailing blur must not re-commit.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const keyHandledRef = useRef(false);
  const editInputRef = useRef<HTMLInputElement>(null);

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

  // Disconnect routes into the shell's ONE removal path — the native
  // Cancel-default confirm dialog is the only confirmation (the SPA adds
  // none). The list refetches to reconcile either way; a failure toasts.
  const disconnectHost = useCallback(
    (id: string) => {
      void removeShellHost(id).then((ok) => {
        if (!ok) addToast("Shell host disconnect failed", "error");
        fetchServers();
      });
    },
    [addToast, fetchServers],
  );

  const startRename = useCallback((row: ShellHostMenuRow) => {
    keyHandledRef.current = false;
    setEditDraft(row.name);
    setEditingId(row.id);
  }, []);

  // Entering edit focuses the input with the current name selected (the
  // window-heading rename precedent).
  useEffect(() => {
    if (editingId !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  // Commit trims; an empty/whitespace-only or unchanged commit is a cancel
  // (no invoke). A real commit updates the row name optimistically, invokes
  // the shell, and refetches to reconcile — the menu stays open throughout.
  const commitRename = useCallback(() => {
    const id = editingId;
    const trimmed = editDraft.trim();
    setEditingId(null);
    if (id === null) return;
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row || trimmed === "" || trimmed === row.name) return;
    setServers((prev) =>
      prev ? prev.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) : prev,
    );
    void renameShellHost(id, trimmed).then((ok) => {
      if (!ok) addToast("Shell host rename failed", "error");
      fetchServers();
    });
  }, [editingId, editDraft, addToast, fetchServers]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
  }, []);

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
  // needs no handler — the focused row is a native <button>. Delete/Backspace
  // disconnects the focused row and F2 enters its inline rename.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      // Edit-mode suspension: while a row's rename input holds focus the menu
      // owns no keys — the input's own handlers run (Escape exits only the
      // edit, Enter commits, arrows/Delete/Backspace edit text).
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // Disconnect the focused host row — the shell's native confirm dialog
        // is the accident guard. The Add-Host footer is not bound, and an
        // older shell without the capability falls through untouched.
        if (!canRemove) return;
        const idx = itemRefs.current.findIndex((el) => el === document.activeElement);
        if (idx < 0 || idx >= hostCountRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const row = rowsRef.current[idx];
        if (row) disconnectHost(row.id);
        return;
      }
      if (e.key === "F2") {
        // Enter inline rename on the focused host row — same gating as
        // Delete/Backspace (host rows only, capability-gated).
        if (!canRename) return;
        const idx = itemRefs.current.findIndex((el) => el === document.activeElement);
        if (idx < 0 || idx >= hostCountRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const row = rowsRef.current[idx];
        if (row) startRename(row);
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
  }, [open, rows.length, canAdd, canReorder, canRemove, canRename, moveHostRow, disconnectHost, startRename]);

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
                // Non-interactive row wrapper: owns the hover/focus group and
                // the drag handlers (they bubble up from the draggable primary
                // button and cover the trailing cluster zone). Icon buttons
                // and the rename input are SIBLINGS of the primary button —
                // interactive elements must never nest inside it.
                <div
                  key={row.id}
                  className="group relative"
                  onDragStart={(e) => onRowDragStart(e, row.id)}
                  onDragOver={(e) => onRowDragOver(e, row.id)}
                  onDrop={onRowDrop}
                  onDragEnd={onRowDragEnd}
                >
                  {editingId === row.id ? (
                    // Inline rename: the primary button is replaced (an input
                    // inside a button is invalid HTML); marker/origin columns
                    // keep the row's alignment.
                    <div className="relative flex w-full items-baseline gap-2 py-2 pl-3 pr-3 text-left text-sm">
                      <span aria-hidden="true" className="w-3 shrink-0">
                        {row.active ? "✓" : ""}
                      </span>
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onBlur={() => {
                          // A key-driven commit/cancel already settled the
                          // edit — swallow the trailing teardown blur.
                          if (keyHandledRef.current) {
                            keyHandledRef.current = false;
                            return;
                          }
                          commitRename();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            keyHandledRef.current = true;
                            commitRename();
                            requestAnimationFrame(() => itemRefs.current[i]?.focus());
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            keyHandledRef.current = true;
                            cancelRename();
                            requestAnimationFrame(() => itemRefs.current[i]?.focus());
                          }
                        }}
                        aria-label={`Rename ${row.name}`}
                        style={{ width: `${Math.max(editDraft.length + 1, 3)}ch` }}
                        className="min-w-0 shrink-0 border-b border-accent bg-transparent text-left text-sm text-text-primary outline-none"
                      />
                      <span className="min-w-0 truncate text-xs opacity-60">{row.origin}</span>
                    </div>
                  ) : (
                    <>
                      <button
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
                        className={`relative flex w-full items-baseline gap-2 py-2 pl-3 text-left text-sm transition-colors ${affordancePad} ${
                          row.active
                            ? "text-accent"
                            : "text-text-secondary hover:bg-bg-card hover:text-text-primary"
                        }`}
                      >
                        {/* Accent edge bar — absolutely overlaid on the row's
                            left edge so a colorless row keeps identical
                            alignment. The row model hex-validated the value
                            (no interpolation of unvalidated strings). */}
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
                        {/* Dimmed origin — display names are not unique, the
                            origin disambiguates. */}
                        <span className="min-w-0 truncate text-xs opacity-60">{row.origin}</span>
                        {/* Amber waiting-agent count — BACKGROUND hosts only
                            (the row model nulls the active row's count; the
                            dock badge is the active host's attention surface).
                            Waiting-only semantics: 0/absent renders nothing. */}
                        {row.waiting !== null && (
                          <span className="ml-auto shrink-0 pl-2 text-xs text-amber-600">
                            ● {row.waiting}
                          </span>
                        )}
                        {/* Trailing accelerator hint mirroring the native Hosts
                            menu bindings (⌥⌘1–9 mac / ⇧Ctrl+1–9 win-linux,
                            9-cap). It shares the trailing zone with the action
                            cluster, so it hides while the cluster shows. */}
                        {row.hint && (
                          <span
                            className={`${row.waiting === null ? "ml-auto " : ""}${
                              affordanceCount > 0
                                ? "group-hover:invisible group-focus-within:invisible "
                                : ""
                            }shrink-0 pl-2 text-xs text-text-secondary`}
                          >
                            {row.hint}
                          </span>
                        )}
                      </button>
                      {/* Trailing action cluster — hover/focus-revealed, edit ·
                          disconnect · grip (its width is the row's `pr-*`
                          reservation). Icon buttons are tab-skip: the keyboard
                          paths are the row-level Delete/Backspace and F2
                          bindings (Constitution V). */}
                      {affordanceCount > 0 && (
                        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          {canRename && (
                            <Tip label="Rename">
                              <button
                                type="button"
                                aria-label="Rename"
                                tabIndex={-1}
                                onClick={() => startRename(row)}
                                className="flex h-5 w-5 items-center justify-center rounded text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary"
                              >
                                <svg
                                  aria-hidden="true"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                                  <path d="m15 5 4 4" />
                                </svg>
                              </button>
                            </Tip>
                          )}
                          {canRemove && (
                            <Tip label="Disconnect">
                              <button
                                type="button"
                                aria-label="Disconnect"
                                tabIndex={-1}
                                onClick={() => disconnectHost(row.id)}
                                className="flex h-5 w-5 items-center justify-center rounded text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary"
                              >
                                <svg
                                  aria-hidden="true"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="m19 5 3-3" />
                                  <path d="m2 22 3-3" />
                                  <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
                                  <path d="M7.5 13.5 10 11" />
                                  <path d="M10.5 16.5 13 14" />
                                  <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
                                </svg>
                              </button>
                            </Tip>
                          )}
                          {/* Drag grip — visual affordance only; the row
                              itself is the draggable. */}
                          {canReorder && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none text-[10px] leading-none tracking-[-2px] text-text-secondary opacity-60"
                            >
                              ⋮⋮
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
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
