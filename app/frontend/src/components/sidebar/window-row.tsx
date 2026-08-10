import { useEffect, useState, useRef, useMemo, memo } from "react";
import { isGhostWindow } from "@/contexts/optimistic-context";
import type { ProjectSession } from "@/types";
import type { MergedSession } from "@/contexts/optimistic-context";
import type { BoardSummary } from "@/api/boards";
import { UNCOLORED_SELECTED_KEY, markerStripeStyle, type RowTint } from "@/themes";
import { SwatchPopover } from "@/components/swatch-popover";
import { StatusDot } from "@/components/status-dot";
import { prOwnsGlyph, prGlyphColor } from "@/components/pr-status-model";
import { PinPopover } from "./pin-popover";
import { PaletteIcon, CloseIcon, GitPullRequestIcon, GitPullRequestClosedIcon } from "./icons";
import { PinIcon } from "@/components/pin-icon";
import { useRowFlyout } from "./row-flyout-card";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { toSafeWindowName } from "@/lib/names";

type ProjectWindow = ProjectSession["windows"][number];
type GhostWindow = MergedSession["windows"][number];

type WindowRowProps = {
  win: ProjectWindow | GhostWindow;
  session: string;
  isSelected: boolean;
  isDragOver: boolean;
  /** Color value: an owned family name ("orange") or a legacy numeric/blend
   *  descriptor ("4" / "1+3") — the row's hue (label axis). */
  color?: string;
  /** Left-gutter marker state ("" | "dotted" | "dashed" | "solid" | "double"
   *  | "thick") — an independent label axis from `color`. */
  marker?: string;
  rowTints?: Map<string, RowTint>;
  /** Contrast-adjusted full-saturation guarded color per color value. Used for
   *  SERVER tile edges and — here — the left-gutter marker's family color. */
  rowBorders?: Map<string, string>;
  editingWindow: { session: string; windowId: string } | null;
  // Note: callers may pass an object that also carries a `server` field — the
  // extra property is ignored (only session + windowId are read), and passing
  // the reference straight through keeps this prop stable across renders.
  editingName: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Identity-arg handlers. The row binds its own (server, session, win)
   *  identity when invoking them, so a SINGLE stable reference can be shared by
   *  every row across the whole sidebar — which is what makes React.memo on
   *  WindowRow effective (the handler prop identity does not change per row or
   *  per SSE tick). The internal onClick wrappers the row builds are NOT part
   *  of the memo comparison, so rebuilding them per row-render is free. */
  onSelectWindow: (server: string, session: string, windowId: string) => void;
  /** Modifier-aware row-click seam for the bulk multi-select (260807-nf9f).
   *  Identity-arg like its siblings so ONE stable reference serves every row
   *  (the memo contract). Receives the raw modifier flags so the sidebar owns
   *  the whole gesture policy — cmd/ctrl toggles, shift extends a range, plain
   *  navigates and clears — in one place. Returns `true` when the sidebar
   *  CONSUMED the click as a selection gesture, in which case the row does NOT
   *  fall through to `onSelectWindow`. Omitted (e.g. a bare unit-test render)
   *  ⇒ every click is a plain navigate, exactly as before. */
  onRowClick?: (
    server: string,
    session: string,
    windowId: string,
    mods: { meta: boolean; ctrl: boolean; shift: boolean },
  ) => boolean;
  /** True when this row is in the sidebar's bulk selection (260807-nf9f) —
   *  drives `aria-selected` on the treeitem plus the visible selected treatment.
   *  Independent of `isSelected`, which is the URL-derived single-window
   *  navigation selection (`aria-current="page"`). */
  isBulkSelected?: boolean;
  onStartEditing: (server: string, session: string, windowId: string, currentName: string) => void;
  onWindowNameChange: (value: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRenameBlur: () => void;
  onKillClick: (server: string, session: string, windowId: string, ctrl: boolean) => void;
  /** Whether this row is draggable (ghost rows are not). When false the drag
   *  handlers are not wired. */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, server: string, session: string, index: number, windowId: string, name: string) => void;
  onDragOver?: (e: React.DragEvent, server: string, session: string, index: number) => void;
  onDrop?: (e: React.DragEvent, server: string, session: string, index: number) => void;
  onDragEnd?: () => void;
  onColorChange?: (server: string, session: string, windowId: string, color: string | null) => void;
  /** Persist a marker state for this window. The combined Label picker passes the
   *  EXACT picked state here (no cycling — any state is one click). Omitted on
   *  ghost rows (the label zone is disabled). */
  onMarkerChange?: (server: string, session: string, windowId: string, marker: string | null) => void;
  /** Fork this window's agent conversation into a new window in the same session
   *  and directory (260806-s4av). Identity-arg like its siblings. Optional
   *  (mirrors `onColorChange`): when omitted — the board-route sidebar, ghost
   *  rows, or a bare unit-test render — the flyout renders no fork affordance.
   *  The card additionally gates on `chatProvider === "claude"`.
   *
   *  Returns a promise resolving when the fork POST settles (it surfaces its own
   *  errors and does not reject), which the flyout's button awaits to hold its
   *  in-flight disabled state. */
  onForkWindow?: (server: string, windowId: string) => Promise<void>;
  /** Tmux server name for the pin popover (server-routing contract) AND the
   *  identity bound into the handlers above. When omitted the pin icon is
   *  hidden and handlers bind an empty server — used by tests that render
   *  WindowRow without the boards system wired up. */
  server?: string;
  /** Aggregate pin state — if this window is pinned to ANY board, the icon
   *  renders filled. */
  isPinnedToAny?: boolean;
  /** When true, the row is pinned to the *currently active board* (if any)
   *  and gets a subtle accent highlight in the Sessions tree. Independent of
   *  isPinnedToAny which controls the pin-icon fill. */
  isPinnedToActiveBoard?: boolean;
  /** All known boards (for the pin popover). */
  boards?: BoardSummary[];
  /** True while the board list is still loading — forwarded to the pin popover
   *  so its cold-start prefill isn't triggered by an empty mid-load list. */
  boardsLoading?: boolean;
  /** Predicate: is this window pinned to the given board? Identity-arg form
   *  (board, server, windowId) so a single stable reference (the context's
   *  `pinnedToBoard`) serves every row; the row binds its own (server,
   *  windowId). Used by the pin popover to render checkmarks. */
  isPinnedToBoard?: (board: string, server: string, windowId: string) => boolean;
  /** The single board this window is pinned to (co9z), or undefined if unpinned.
   *  When set, the pin popover offers a "Go to {board}" navigation row so the
   *  pinned-row indicator becomes a path to the owning board. */
  pinnedBoard?: string;
  /** Navigate to a board's route (`/board/{board}`). Stable identity-arg
   *  handler shared by every row (like the other identity-arg handlers). */
  onNavigateToBoard?: (board: string) => void;
  /** Roving-tabindex value: `0` for the single roving-focused tree row, `-1`
   *  for every other row (the roving model lives in `index.tsx`). Defaults to
   *  `-1` so a row rendered without the tree wiring is not a tab stop. Only the
   *  two affected rows change this per arrow keypress, preserving the memo tree. */
  tabIndex?: number;
  /** W3C-APG tree leaf metadata. Window rows are level-2 leaves. `ariaSetSize`
   *  is the count of sibling windows in the session; `ariaPosInSet` the row's
   *  1-based position among them. Omitted ⇒ not announced (e.g. in unit tests
   *  that render a bare row). */
  ariaLevel?: number;
  ariaSetSize?: number;
  ariaPosInSet?: number;
  /** Globally-unique roving-tabindex handle for the tree's keyboard model
   *  (`index.tsx`), exposed as `data-row-key`. Value is `${server}:${windowId}`
   *  (or `${server}:ghost-${optimisticId}`): bare tmux ids (@N) are only unique
   *  within one server and would collide across open server groups, so the
   *  roving cursor + Enter/Space activation key on this namespaced handle.
   *  `data-window-id` stays the bare id for tests/automation/pin lookups. */
  rowKey?: string;
};

function WindowRowInner({
  win,
  session,
  isSelected,
  isDragOver,
  color,
  marker,
  rowTints,
  rowBorders,
  editingWindow,
  editingName,
  inputRef,
  onSelectWindow,
  onRowClick,
  isBulkSelected = false,
  onStartEditing,
  onWindowNameChange,
  onRenameKeyDown,
  onRenameBlur,
  onKillClick,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onColorChange,
  onMarkerChange,
  onForkWindow,
  server,
  isPinnedToAny = false,
  isPinnedToActiveBoard = false,
  boards = [],
  boardsLoading = false,
  isPinnedToBoard,
  pinnedBoard,
  onNavigateToBoard,
  tabIndex = -1,
  ariaLevel,
  ariaSetSize,
  ariaPosInSet,
  rowKey,
}: WindowRowProps) {
  const ghost = isGhostWindow(win);
  const srv = server ?? "";
  // Drag is wired only for non-ghost rows that opted in via `draggable`.
  const dragEnabled = draggable && !ghost;
  const isEditing = editingWindow?.session === session && editingWindow.windowId === win.windowId;
  // The combined Label picker (colors + marker) opened by the left-edge label
  // zone (or the `Window: Label` palette action). Replaces the former
  // right-cluster color popover + gutter click-to-cycle (hwtr).
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showPinPopover, setShowPinPopover] = useState(false);
  const pinBtnRef = useRef<HTMLButtonElement>(null);

  // Row-hover register flyout card (93dy) — the tier-2 hover surface that
  // replaced the per-dot StatusDotTip. ALL flyout state is row-local (this
  // hook), so the WindowRow memo stays effective. Suppressed while the row's
  // popovers are open (the card must not fight them) and on ghost rows (no
  // real window data yet).
  const coarse = useCoarsePointer();
  // Bind the row's own (server, windowId) onto the shared identity-arg handler.
  // Undefined (no handler, or a ghost row with no real window yet) means the card
  // renders no fork affordance at all — the optional-handler gate.
  const handleFork = useMemo(() => {
    if (!onForkWindow || ghost) return undefined;
    return () => onForkWindow(srv, win.windowId);
  }, [onForkWindow, ghost, srv, win.windowId]);
  const flyout = useRowFlyout(win, {
    suppressed: ghost || showPinPopover || showLabelPicker,
    onFork: handleFork,
  });

  // Listen for the imperative `pin-popover:open` / `label-popover:open` events
  // dispatched by the command palette's "Board: Pin Current Window" and
  // "Window: Label" actions. Only the row whose (server, windowId) matches the
  // event detail opens its popover; other rows ignore the event. Mirrors the
  // `palette:open` document-event pattern used elsewhere — see app.tsx command
  // palette wiring.
  useEffect(() => {
    if (!server) return;
    function isMatch(e: Event): boolean {
      const detail = (e as CustomEvent<{ server: string; windowId: string }>).detail;
      return !!detail && detail.server === server && detail.windowId === win.windowId;
    }
    function pinHandler(e: Event) {
      if (isMatch(e)) setShowPinPopover(true);
    }
    function labelHandler(e: Event) {
      if (isMatch(e)) setShowLabelPicker(true);
    }
    document.addEventListener("pin-popover:open", pinHandler);
    document.addEventListener("label-popover:open", labelHandler);
    return () => {
      document.removeEventListener("pin-popover:open", pinHandler);
      document.removeEventListener("label-popover:open", labelHandler);
    };
  }, [server, win.windowId]);

  const tint = useMemo(() => {
    if (color == null || !rowTints) return null;
    return rowTints.get(color) ?? null;
  }, [color, rowTints]);

  // Uncolored rows borrow the gray tint only in the selected state.
  const uncoloredSelectedTint = useMemo(() => {
    if (color != null || !rowTints || !isSelected) return null;
    return rowTints.get(UNCOLORED_SELECTED_KEY) ?? null;
  }, [color, rowTints, isSelected]);

  // The row's guarded family color, used for the left-gutter MARKER (contrast-
  // adjusted full-saturation family hex, baked into rowBorders). Colored rows
  // use their family; uncolored rows use the gray sentinel. The 4px selection
  // border this once fed was removed in the axis split — selection is now tint
  // depth + typography alone (R6/R7).
  const markerColor = useMemo(() => {
    if (!rowBorders) return "var(--color-border)";
    if (color != null) return rowBorders.get(color) ?? "var(--color-border)";
    return rowBorders.get(UNCOLORED_SELECTED_KEY) ?? "var(--color-border)";
  }, [color, rowBorders]);

  // Compute inline style for the button (background tint only — no left border).
  // While the flyout card is open the row HOLDS its hover shade (the held-row
  // continuity cue): the pointer traveling onto the card drops CSS :hover, and
  // without the hold the card visibly "detaches" from its row.
  const buttonStyle = useMemo(() => {
    const style: React.CSSProperties = {};
    if (tint) {
      style.backgroundColor = isSelected ? tint.selected : flyout.open ? tint.hover : tint.base;
    } else if (uncoloredSelectedTint) {
      style.backgroundColor = uncoloredSelectedTint.selected;
    }
    return Object.keys(style).length > 0 ? style : undefined;
  }, [tint, uncoloredSelectedTint, isSelected, flyout.open]);

  // Build className for the button. The row box is FULL-BLEED — it starts at
  // the physical sidebar edge (the former 12px group `ml-3` indent moved into
  // this button's left padding), so the tint/hover/selection fills span
  // edge-to-edge. The label zone is an absolute z-20 sibling spanning the
  // leftmost 26px of the row, so the button content must start CLEAR of it —
  // otherwise the interactive StatusDot sits under the zone and its hover/click
  // steals the dot's hover-card + row select (the must-fix-3 geometry,
  // preserved). The dot sits at `pl-[30px]` (12px absorbed indent + 18px prior
  // padding) — 4px clear of the zone's inner edge, so the dot and name keep
  // their EXACT pre-full-bleed x-positions (no content shift).
  // When the pin icon is wired up, reserve a few extra px on the right so labels
  // don't run under the icon group.
  const showPinIcon = !ghost && !!server;
  const buttonClass = useMemo(() => {
    const rightPad = showPinIcon ? "pr-[68px]" : "pr-11";
    // Dense rows on fine pointers (24px); touch keeps the 36px target via the
    // `coarse:` variant (context.md § Mobile Responsive Design).
    const base = `w-full text-left flex items-center justify-between gap-2 py-px pl-[30px] ${rightPad} text-xs transition-colors min-h-[24px] coarse:min-h-[36px]`;
    if (isSelected) {
      // Selection = deeper tint (tint.selected / gray sentinel via buttonStyle)
      // + bold + brightened text. No border (removed in the axis split).
      return `${base} text-text-primary font-medium`;
    }
    if (tint) {
      // Colored non-selected: inline bg via buttonStyle, hover via JS. Held
      // (flyout open): the text brightening persists off-:hover too.
      return `${base} text-text-secondary hover:text-text-primary${flyout.open ? " text-text-primary" : ""}`;
    }
    // Uncolored non-selected. Held (flyout open): the hover shade + text
    // brightening persist while the pointer is on the card (held-row cue).
    return `${base} text-text-secondary hover:text-text-primary hover:bg-bg-card/50${
      flyout.open ? " text-text-primary bg-bg-card/50" : ""
    }`;
  }, [tint, isSelected, showPinIcon, flyout.open]);

  // ── Left-edge label zone ────────────────────────────────────────────────
  // The 26px left of the status dot is ONE target opening the combined Label
  // picker (colors + marker). Available on non-ghost rows wired with the color
  // AND marker write seams. Active on coarse pointers too — touch gets direct
  // label access (hwtr, superseding 3prk's palette-only touch decision).
  const labelZoneEnabled = !ghost && !!onColorChange && !!onMarkerChange && !!server;
  const [zoneHover, setZoneHover] = useState(false);
  const openLabelPicker = (e: React.MouseEvent) => {
    // Must not select the row and must coexist with drag-reorder.
    e.stopPropagation();
    setShowLabelPicker(true);
  };
  const isDouble = marker === "double";
  const scanlineAnimated = isDouble && isSelected;
  // Thick pairs with the STATIC hazard wedge (completed / "taped off" cue) —
  // never animated in any state, unlike double's selected crawl.
  const isThick = marker === "thick";
  const isDashed = marker === "dashed";

  return (
    <div
      key={ghost ? `ghost-${win.optimisticId}` : win.windowId}
      // Stable, unique handle for tests/automation. tmux window ids (@N) are
      // unique for a window's lifetime and survive rename/move/index reuse —
      // unlike the window name or session+index, which are ambiguous or
      // transient. Ghost rows expose their optimistic id until confirmed.
      data-window-id={ghost ? `ghost-${win.optimisticId}` : win.windowId}
      // Globally-unique roving handle (`${server}:${windowId}`) for the keyboard
      // model — bare @N collides across servers. Distinct from data-window-id,
      // which stays the bare id for tests/automation/pin lookups.
      data-row-key={rowKey}
      // W3C-APG tree leaf. The roving model in index.tsx threads `tabIndex`
      // (0 for the one roving row, -1 otherwise) + level/set/pos metadata.
      role="treeitem"
      aria-level={ariaLevel}
      aria-setsize={ariaSetSize}
      aria-posinset={ariaPosInSet}
      // Bulk multi-select membership (260807-nf9f). Emitted ONLY on selectable
      // (window) rows and only when the tree is wired for multi-select — an
      // `aria-selected` on every row would announce a selection model the
      // board-route/unit-test mounts don't have. Distinct from `aria-current`
      // ("page" = the URL-navigated window), which lives on the inner button.
      aria-selected={onRowClick ? isBulkSelected : undefined}
      tabIndex={tabIndex}
      // `relative` anchors the absolute gutter + status dot + scanline overlay.
      // The scanline/CRT-band overlay is a dedicated inner element (below), NOT
      // classes on this root: the root must stay free to OVERFLOW so the row's
      // `top-full` pin/color popovers aren't clipped on a selected+double row
      // (must-fix 4). The `--rk-marker-color` custom property is set here (the
      // overlay's pseudos read it via inheritance). See globals.css § scanlines
      // and docs/specs/themes.md.
      className={`relative group${ghost ? " opacity-50 animate-pulse" : ""}`}
      // The row root is the flyout card's floating REFERENCE (93dy): the card
      // anchors to the whole ROW (placement "right" → the sidebar's right
      // edge), and the reference props wire hover (mouseOnly + safePolygon),
      // keyboard focus (the roving treeitem), and dismiss. Spread FIRST so the
      // row's own handlers below are never overridden.
      ref={flyout.setReference}
      {...flyout.referenceProps}
      draggable={dragEnabled}
      onDragStart={
        dragEnabled && onDragStart
          ? (e) => {
              // A drag gesture must not leave (or race) an open hover card.
              flyout.close();
              onDragStart(e, srv, session, win.index, win.windowId, win.name);
            }
          : undefined
      }
      onDragOver={dragEnabled && onDragOver ? (e) => onDragOver(e, srv, session, win.index) : undefined}
      onDrop={dragEnabled && onDrop ? (e) => onDrop(e, srv, session, win.index) : undefined}
      onDragEnd={dragEnabled ? onDragEnd : undefined}
      style={{
        ...(isDouble || isThick || isDashed
          ? ({ "--rk-marker-color": markerColor } as React.CSSProperties)
          : {}),
        // Bulk-selection treatment (260807-nf9f): a 2px inset accent ring, the
        // same `box-shadow` idiom the session-row drop target uses — it reads as
        // "member of a set" without competing with the URL selection's
        // tint-depth + bold treatment, and costs no layout (no border box
        // change, so rows never shift when a selection is made).
        // The transient drag-over indicator WINS while a drag is in flight: it
        // marks where the drop lands, which is the more urgent signal.
        ...(isDragOver
          ? { boxShadow: "0 -2px 0 0 var(--color-accent)" }
          : isBulkSelected
            ? { boxShadow: "inset 0 0 0 2px var(--color-accent)" }
            : {}),
      }}
    >
      {/* Scanline / CRT-band overlay for double-marker rows. A dedicated inner
          element that OWNS the clip (`overflow-hidden`) so the rolling band's
          `::after` stays inside the row while the row ROOT remains free to
          overflow for the `top-full` popovers (must-fix 4). Non-interactive
          (`pointer-events-none`) and z-5 (above the button bg, below the z-10
          icon cluster / z-20 gutter). Selected+double adds the animated crawl. */}
      {isDouble && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 z-[5] overflow-hidden pointer-events-none rk-scanlines${
            scanlineAnimated ? " rk-scanlines-crawl" : ""
          }`}
        />
      )}
      {/* Hazard-wedge overlay for thick-marker rows (completed / "taped off"
          cue). Mirrors the scanlines discipline exactly — dedicated clipped
          inner element (never the root), pointer-events-none, z-5 — but is
          STATIC in every state (rest, hover, selected): no animated twin
          exists by explicit design decision. The wedge reads the same
          `--rk-marker-color` custom property set on the root above. */}
      {isThick && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-[5] overflow-hidden pointer-events-none rk-hazard"
        />
      )}
      {/* Data-rain overlay for dashed-marker rows — ALWAYS-ON: "working" is
          inherently a live state, and the thinned two-lane rain is quiet
          enough to run ambiently (a deliberate user call after watching the
          selection-gated version). Two sparse dash tracks streaming
          left→right; the gutter stripe itself stays static in every state.
          Same overlay discipline (dedicated clipped inner element, never the
          root, pointer-events-none, z-5); reads `--rk-marker-color` from the
          root. Hidden entirely under prefers-reduced-motion (motion-only —
          the static label cue is the stripe). */}
      {isDashed && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-[5] overflow-hidden pointer-events-none rk-dash-rain"
        />
      )}
      {labelZoneEnabled && (
        <LabelZone
          marker={marker}
          markerColor={markerColor}
          colored={color != null}
          hover={zoneHover}
          onEnter={() => setZoneHover(true)}
          onLeave={() => setZoneHover(false)}
          onClick={openLabelPicker}
        />
      )}
      <button
        onClick={(e) => {
          // Selection gestures (cmd/ctrl-click toggle, shift-click range) are
          // offered to the sidebar FIRST; it returns true when it consumed the
          // click, in which case the row must NOT also navigate. A plain click
          // is never consumed — it falls through to the unchanged navigation
          // path (the sidebar separately clears any live selection).
          if (
            onRowClick?.(srv, session, win.windowId, {
              meta: e.metaKey,
              ctrl: e.ctrlKey,
              shift: e.shiftKey,
            })
          ) {
            e.preventDefault();
            return;
          }
          onSelectWindow(srv, session, win.windowId);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!ghost) onStartEditing(srv, session, win.windowId, win.name);
        }}
        className={buttonClass}
        style={buttonStyle}
        aria-current={isSelected ? "page" : undefined}
        onMouseEnter={tint && !isSelected ? (e) => { (e.currentTarget as HTMLElement).style.backgroundColor = tint.hover; } : undefined}
        // Held-row cue: while the flyout is open, leaving the row (the pointer
        // traveling onto the card) must NOT drop the hover shade — the close
        // re-render restores tint.base via buttonStyle when the card goes.
        onMouseLeave={tint && !isSelected ? (e) => { if (!flyout.open) (e.currentTarget as HTMLElement).style.backgroundColor = tint.base; } : undefined}
      >
        {/* No `truncate` on this wrapper: the dot's waiting halo is a
            box-shadow that paints OUTSIDE the 7px dot, and `truncate`'s
            overflow-hidden clipped it into a half-moon at the span's left
            edge. The name span below carries its own `truncate`, so text
            ellipsis is unaffected; `min-w-0` stays so that inner truncation
            keeps working inside the flex row. */}
        <span className="flex items-center gap-1.5 min-w-0">
          {/* Unified status dot — the LOCAL story only (compositional
              vocabulary): blue building / green PR-ready for a fab change,
              yellow for a fresh ad-hoc agent, else monochrome terminal
              activity (filled=active, hollow ring=idle). The PR story lives on
              the trailing rest-state glyph, never here. See StatusDot /
              statusDotState.
              On COARSE pointers the wrapper wires a dot-tap to open the flyout
              card (touch has no hover; hover-open is mouseOnly) — the tap stops
              propagation so it never selects the row. On fine pointers the
              wrapper is inert and a dot click selects the row as before. */}
          <span
            className="flex items-center shrink-0"
            onClick={
              coarse && !ghost
                ? (e) => {
                    e.stopPropagation();
                    flyout.openNow();
                  }
                : undefined
            }
            data-testid="status-dot-tap"
          >
            <StatusDot win={win} />
          </span>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editingName}
              onChange={(e) => onWindowNameChange(toSafeWindowName(e.target.value))}
              onKeyDown={onRenameKeyDown}
              onBlur={onRenameBlur}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-xs bg-transparent border border-accent rounded px-0.5 outline-none truncate w-full"
              aria-label="Rename window"
            />
          ) : (
            <span className="truncate">{win.name}</span>
          )}
        </span>
        {/* Row Minimalism, partially reversed (260706-y1ar → 93dy;
            status-pyramid.md § Row Minimalism): the trailing STATUS cluster —
            the stage word (red-when-failed) and the duration text — stays
            REMOVED, and the freed width still goes to the window name. The
            row's status signals are the leading StatusDot (hue = journey,
            shape = health, additive halo = waiting) PLUS, for a window with an
            owned PR, a rest-state PR glyph in the trailing cluster's last slot
            (user-approved reversal — see the glyph below). The exact stage
            word + durations survive in the row-hover flyout card
            (row-flyout-card.tsx) and the PANE panel's register view. Hover-
            reveal action icons (pin/kill) below are actions, not status. The
            color affordance lives in the left-edge label zone (hwtr). */}
      </button>
      {/* Hover-reveal buttons: pin + kill (actions only — the color button moved
          to the left label zone, hwtr). Inert at rest on fine pointers
          (pointer-events-none) so stray clicks near the row's right edge fall
          through to the row-select button instead of hitting an invisible icon;
          interactivity is restored on hover, coarse pointers, and keyboard focus
          within (has-[:focus-visible]). Named `group/icons` so the rest-state
          PR glyph below can key its hide on focus WITHIN this cluster. */}
      <div className="group/icons absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10 pointer-events-none group-hover:pointer-events-auto coarse:pointer-events-auto has-[:focus-visible]:pointer-events-auto">
        {/* Rest-state PR glyph (93dy — user-approved partial Row-Minimalism
            reversal): a window with an OWNED PR (prOwnsGlyph — open/failing/
            merged/closed) shows a git-pull-request glyph at rest,
            right-edge-aligned with the hover ✕ (an absolute overlay on the
            LAST slot, same 24px box — so pinned rows read rest `[pin][PR]` →
            hover `[pin][✕]`: the pin holds its slot, only the last slot
            swaps). It is INFORMATIONAL ONLY — aria-hidden decoration (the
            dot's aria-label + the flyout card + PANE panel carry the info),
            pointer-events-none, and it disappears entirely on row hover
            (display swap, not an opacity fade), on coarse pointers (actions
            are always visible there), and while keyboard focus is inside the
            action cluster — so it can never be a click target or occlude the
            revealed ✕. Color via the shared PR vocabulary (prGlyphColor),
            six-way: muted closed (dead PR), red failing, gray open-draft,
            yellow checks-running, green open, purple merged — closed sits
            ABOVE fail (stale checks are noise), draft is open-gated and sits
            BELOW fail and ABOVE pending. Icon picked by state (xuej): a
            closed PR gets the distinct ✕ `GitPullRequestClosedIcon` — shape,
            not color, separates closed from failing and from draft — and the
            glyph is the row's ONLY PR channel (the dot never renders PR
            state; see pr-status-model.ts). */}
        {!ghost && prOwnsGlyph(win) && (
          <span
            aria-hidden="true"
            data-testid="row-pr-glyph"
            className={`absolute right-0 top-1/2 -translate-y-1/2 flex items-center justify-center px-0.5 min-w-[24px] min-h-[24px] pointer-events-none group-hover:hidden coarse:hidden group-has-[:focus-visible]/icons:hidden ${prGlyphColor(win)}`}
          >
            {win.prState === "closed" ? <GitPullRequestClosedIcon /> : <GitPullRequestIcon />}
          </span>
        )}
        {showPinIcon && (
          <button
            ref={pinBtnRef}
            type="button"
            aria-label={`Pin ${win.name} to a board`}
            aria-pressed={isPinnedToAny}
            // The active-board cue lives on THIS glyph now (the 4px left border
            // was removed in the axis split): a row pinned to the board you're
            // viewing gets an ACCENT-colored persistent glyph; a row pinned to
            // some other board is a monochrome persistent glyph; an unpinned row
            // shows the glyph only on hover/focus/coarse. isPinnedToActiveBoard
            // implies isPinnedToAny, so the accent branch is always persistent.
            onClick={(e) => {
              e.stopPropagation();
              setShowPinPopover((v) => !v);
            }}
            className={`transition-opacity cursor-pointer ${
              isPinnedToActiveBoard
                ? "opacity-100 text-accent hover:text-accent"
                : isPinnedToAny
                ? "opacity-100 text-text-secondary hover:text-text-primary"
                : "opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 text-text-secondary hover:text-text-primary"
            } px-0.5 min-w-[24px] coarse:min-w-[32px] min-h-[24px] coarse:min-h-[36px] flex items-center justify-center`}
          >
            <PinIcon filled={isPinnedToAny} />
          </button>
        )}
        <button
          type="button"
          aria-label={`Kill window ${win.name}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!ghost) onKillClick(srv, session, win.windowId, e.ctrlKey || e.metaKey);
          }}
          className="text-text-secondary hover:text-red-400 transition-opacity cursor-pointer opacity-0 group-hover:opacity-100 coarse:opacity-100 focus-visible:opacity-100 px-0.5 min-w-[24px] coarse:min-w-[32px] min-h-[24px] coarse:min-h-[36px] flex items-center justify-center"
        >
          <CloseIcon />
        </button>
      </div>
      {showPinPopover && server && (
        <PinPopover
          server={server}
          windowId={win.windowId}
          boards={boards}
          boardsLoading={boardsLoading}
          isPinnedTo={(b) => (isPinnedToBoard ? isPinnedToBoard(b, srv, win.windowId) : false)}
          pinnedBoard={pinnedBoard}
          onNavigateToBoard={onNavigateToBoard}
          onClose={() => setShowPinPopover(false)}
        />
      )}
      {showLabelPicker && onColorChange && onMarkerChange && (
        // Combined Label picker (colors + marker), anchored at the row's
        // BOTTOM-LEFT (twin of the shipped right-anchored color popover). The
        // row root stays overflow-free (must-fix 4) so this `top-full` popover
        // is not clipped, even on a selected+double row.
        <div className="absolute left-0 top-full z-50">
          <SwatchPopover
            selectedColor={color}
            // Selection does NOT close (the picker's dismissal contract) — the
            // user can toggle color + marker combos and watch the row update
            // live. Dismissal is the picker's ✕ / outside click / Escape.
            onSelect={(c) => onColorChange(srv, session, win.windowId, c)}
            selectedMarker={marker}
            onSelectMarker={(m) => onMarkerChange(srv, session, win.windowId, m === "" ? null : m)}
            onClose={() => setShowLabelPicker(false)}
          />
        </div>
      )}
      {/* Row-hover register flyout card (93dy) — portalled to document.body,
          mounted ONLY while open (perf contract). */}
      {flyout.card}
    </div>
  );
}

/** Label-zone geometry (px). The row box is full-bleed (starts at the physical
 *  sidebar edge), so the zone is a plain `left-0` overlay spanning the 26px
 *  left of the status dot at `pl-[30px]` — 4px clear of the zone's inner edge,
 *  so the zone never steals the dot's hover-card/click (must-fix-3). The
 *  marker stripe anchors near-flush at the sidebar edge (`STRIPE_EDGE_INSET`);
 *  the hover palette-icon zone is inset `ICON_EDGE_INSET`px off that edge,
 *  spanning to `ICON_EDGE_INSET + ICON_ZONE_WIDTH` — past the widest (double,
 *  4+6=10px) stripe, so the hover icon sits beside the stripe rather than over
 *  it. The icon keeps an explicit `z-10` (layering below) as a guard for any
 *  residual sub-pixel overlap. */
const LABEL_ZONE_WIDTH = 26; // full zone: icon home + clearance before the dot
const ICON_ZONE_WIDTH = 12; // 12px icon zone: home of the hover palette icon
const ICON_EDGE_INSET = 12; // icon-zone inset off the physical sidebar edge — clears the widest (double, 4+6=10px) marker stripe so the hover icon sits beside it, not over it
const STRIPE_EDGE_INSET = 4; // stripe inset from the zone's/sidebar's left edge (near-flush per the full-bleed spec)

type LabelZoneProps = {
  marker?: string;
  markerColor: string;
  /** True on colored rows — the palette icon is drawn in the guarded family
   *  color; false borrows the inherited monochrome token. */
  colored: boolean;
  hover: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: (e: React.MouseEvent) => void;
};

/** The left-edge label zone (hwtr) — the whole 26px left of the status dot is
 *  ONE target that OPENS the combined Label picker (colors + marker). It never
 *  cycles and never selects the row (click stopPropagation lives in `onClick`).
 *  A hover-revealed PaletteIcon in the 12px icon zone + a family-tinted zone glow
 *  make it discoverable (two-stage: row-hover ~65%/12% → zone-hover 100%/24%).
 *  The marker stripe is DISPLAY-ONLY, anchored near-flush at the sidebar's left
 *  edge (`STRIPE_EDGE_INSET`px). The icon zone is inset `ICON_EDGE_INSET`px off
 *  the physical edge (spanning to `ICON_EDGE_INSET + ICON_ZONE_WIDTH`) so the
 *  hover icon clears both the sidebar boundary and the widest (10px) stripe,
 *  sitting beside it (explicit `z-10` on the icon container guards residual
 *  overlap; the zone's own `z-20` scopes the stack). `cursor: pointer` (menu-opener
 *  semantics). Active on coarse pointers — touch gets direct label access.
 *  `aria-label` names it for pointer AT users and test selection
 *  (getByLabelText / getByLabel). */
function LabelZone({ marker, markerColor, colored, hover, onEnter, onLeave, onClick }: LabelZoneProps) {
  const current = marker ?? "";
  const stripeStyle = markerStripeStyle(current, markerColor);
  return (
    <div
      aria-label="Set window label"
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // z-20 sits above the row-select button (z-10 icon cluster) at the left
      // edge. The row box is full-bleed, so `left-0` IS the physical sidebar
      // edge and the whole 26px is one hit target. Active on coarse pointers
      // (touch label access). Cursor pointer = it opens a menu, not a cycle.
      className="absolute left-0 top-0 bottom-0 z-20 cursor-pointer"
      style={{ width: LABEL_ZONE_WIDTH }}
    >
      {/* Zone glow: transparent at rest; ~12% family color on ROW hover
          (group-hover); ~24% when the zone ITSELF is hovered. */}
      <div
        className="absolute inset-0 transition-colors opacity-0 group-hover:opacity-100"
        style={{
          backgroundColor: `color-mix(in srgb, ${markerColor} ${hover ? 24 : 12}%, transparent)`,
        }}
      />
      {/* Display-only marker stripe, anchored `STRIPE_EDGE_INSET`px from the
          zone's (= the sidebar's) left edge. Rendered BEFORE the icon container
          so the hover icon paints on top where the two overlap. ALWAYS static —
          the dashed marker's motion lives on the row's data-rain overlay
          (globals.css § Dashed-marker data rain), never on the stripe. */}
      {stripeStyle && (
        <div
          className="absolute inset-y-0"
          style={{ left: STRIPE_EDGE_INSET, right: 0, ...stripeStyle }}
        />
      )}
      {/* Palette icon in the 12px icon zone, inset `ICON_EDGE_INSET`px off the
          physical sidebar edge — beside (past) the widest marker stripe, not
          over it; family-tinted on colored rows / inherited monochrome
          otherwise. Fades in on row hover (~65%) and reaches full opacity when
          the zone is hovered. Explicit `z-10` guards any residual overlap. */}
      <div
        className="absolute inset-y-0 z-10 flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-65"
        style={{
          left: ICON_EDGE_INSET,
          width: ICON_ZONE_WIDTH,
          color: colored ? markerColor : undefined,
          ...(hover ? { opacity: 1 } : {}),
        }}
        aria-hidden="true"
      >
        <PaletteIcon size={11} />
      </div>
    </div>
  );
}

/** Memoized window row. Re-renders only when its own props change identity —
 *  an SSE tick on an unrelated server, or the per-second clock tick (now scoped
 *  to the `WindowDuration` leaf below), no longer re-renders the whole row.
 *  Prop stability is the parent's responsibility: `index.tsx` passes
 *  identity-arg `useCallback`s + stable context refs. */
export const WindowRow = memo(WindowRowInner);

/* Row Minimalism (260706-y1ar): the `WindowDuration`/`TickingDuration` leaves
   (and their per-second `useNow()` tick) were removed with the trailing status
   cluster — the row renders no duration. Idle/elapsed durations now live only in
   the row-hover flyout card (row-flyout-card.tsx, whose clocks are leaf-scoped
   inside the open card) and the PANE panel's register view. This also drops the
   last `getWindowDuration` caller (removed from lib/format.ts). */
