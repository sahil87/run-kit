/**
 * The gui tile's session toolbar pill (spec gui.md § The tile → The toolbar
 * pill, HiDPI, and Send key). GuiSurface mounts it for EVERY canvas-state
 * viewer (the credentials prompt suppresses it); only the reveal differs by
 * pointer kind — initial `shown` is `coarsePointer || fullscreen`, so a
 * fine-pointer non-fullscreen viewer starts hidden and appears on a
 * top-edge hover / tap via `revealSignal`.
 *
 * The pill is a by-id MIRROR of the palette: every chip and every menu row
 * fires the `onSelect` of the `buildGuiActions` row with that id, picked
 * from the `actions` prop (the same array app.tsx feeds the palette —
 * Constitution V). No chip carries logic of its own; presence follows the
 * palette's omit-not-disable rule EXCEPT the three zoom chips and the two
 * coarse posture chips (⌖, ⌨), which always render within their pointer
 * gate and disable when the destination row is absent, so the View/Input
 * groups never reflow on a zoom or mode change. `gui-turn-off`,
 * `gui-desktop`, `gui-logs`, `gui-hidpi-*`, and `gui-view-1to1` never
 * appear here.
 *
 * Groups render left to right — Display (resolution, ⤢), View (− fit + ◐),
 * Input (⌖ ⌨ ⎘ ⌥), Launch (▣ ◍), Health (∿ ↻) — separated by 1-px
 * dividers, a divider only between two non-empty groups. Below
 * TOOLBAR_OVERFLOW_MIN_PX of wrapper width only the primary set (Display,
 * − fit +, the coarse pair) stays inline and the rest folds into the `⋯`
 * menu; below TOOLBAR_SHORT_LABEL_MAX_PX the resolution chip drops its
 * `×H` half so the narrow pill fits one row.
 *
 * The show/hide machine: shown on a `revealSignal` bump and on every
 * pill/menu pointerdown (each restarts the timer); it hides
 * TOOLBAR_HIDE_MS after the last reveal or interaction, SUSPENDED while one
 * of its menus is open (closing the menu restarts the timer). While hidden
 * it renders nothing.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Control } from "./control";
import { GuiToolbarMenu, type GuiToolbarMenuRow } from "./gui-toolbar-menu";
import { pickGuiActions, stripGuiLabel, type GuiPaletteAction } from "@/lib/palette/gui";
import { presetLabel } from "@/lib/gui-geometry";
import {
  GUI_QUALITY_LABELS,
  nextGuiQuality,
  type GuiPointerMode,
  type GuiQuality,
  type GuiZoom,
} from "@/lib/gui-posture";

/** How long after the last reveal or interaction the pill hides. */
export const TOOLBAR_HIDE_MS = 3_000;

/** Top-edge reveal: a pointermove within this distance of the wrapper's top
 *  edge shows the pill (GuiSurface performs the check and bumps the signal). */
export const TOOLBAR_REVEAL_EDGE_PX = 24;

/** Below this wrapper width the secondary chips fold into the `⋯` menu. */
export const TOOLBAR_OVERFLOW_MIN_PX = 560;

/** Below this wrapper width the resolution chip drops its `×H` half. */
export const TOOLBAR_SHORT_LABEL_MAX_PX = 400;

/** The resolution menu's row order — palette ids, each present only if the
 *  built list contains it (the lock rows exist on fine pointers only). */
const RESOLUTION_MENU_IDS = [
  "gui-res-1280x720",
  "gui-res-1600x900",
  "gui-res-1920x1080",
  "gui-res-2560x1440",
  "gui-res-1080x1920",
  "gui-res-match",
  "gui-res-auto",
  "gui-res-custom",
  "gui-lock",
  "gui-unlock",
];

/** The `⋯` menu's row order after the quality row — palette ids, each
 *  present iff its chip would be present wide. */
const OVERFLOW_MENU_IDS = [
  "gui-paste",
  "gui-send-key",
  "gui-open-terminal",
  "gui-open-browser",
  "gui-stats-hide",
  "gui-stats-show",
  "gui-reconnect",
];

interface GuiToolbarProps {
  /** The built `GUI:` palette list (the same array the palette renders) —
   *  every chip and menu row fires a row picked from it by id. */
  actions: GuiPaletteAction[];
  /** The viewer's zoom posture — the zoom chips' destination gating rides
   *  the rows; the prop only labels. */
  zoom: GuiZoom;
  pointerMode: GuiPointerMode;
  /** The ⌖ and ⌨ chips are coarse-only surfaces (their palette rows are too). */
  coarsePointer: boolean;
  /** Toggles the ⤢ chip's aria-label; entering fullscreen also reveals. */
  fullscreen: boolean;
  keyBarVisible: boolean;
  /** The viewer's current quality preset — the ◐ chip / ⋯ row fire the
   *  `gui-quality-<nextGuiQuality(quality)>` row (the cycle). */
  quality: GuiQuality;
  statsVisible: boolean;
  /** The tile's RFB connection state — presence itself rides the rows
   *  (⎘/⌥ absent, ↻ present while disconnected). */
  connected: boolean;
  /** The host signal's geometry/width/height/locked — the resolution chip's
   *  status label. */
  geometry: string;
  width: number;
  height: number;
  locked: boolean;
  /** The surface wrapper's measured width — the overflow and short-label
   *  thresholds key on it (never the viewport, never the pointer kind). */
  wrapperWidth: number;
  /** Bump to reveal: a tap on the tile or a top-edge hover. A counter, not
   *  a boolean, so repeated reveals re-fire. */
  revealSignal: number;
}

export function GuiToolbar({
  actions,
  pointerMode,
  coarsePointer,
  fullscreen,
  keyBarVisible,
  quality,
  statsVisible,
  geometry,
  width,
  height,
  locked,
  wrapperWidth,
  revealSignal,
}: GuiToolbarProps) {
  // A fine-pointer non-fullscreen viewer starts hidden (mount-for-all, but
  // only coarse/fullscreen discover the pill without a reveal gesture).
  const [shown, setShown] = useState(() => coarsePointer || fullscreen);
  // Bump restarts the hide timer (the effect below re-runs).
  const [interactions, setInteractions] = useState(0);
  // An open menu suspends the hide timer until it closes.
  const [openMenu, setOpenMenu] = useState<"resolution" | "overflow" | null>(null);
  const lastSignalRef = useRef(revealSignal);
  const resolutionChipRef = useRef<HTMLButtonElement>(null);
  const overflowChipRef = useRef<HTMLButtonElement>(null);

  const poke = () => {
    setShown(true);
    setInteractions((n) => n + 1);
  };

  useEffect(() => {
    if (revealSignal !== lastSignalRef.current) {
      lastSignalRef.current = revealSignal;
      setShown(true);
      setInteractions((n) => n + 1);
    }
  }, [revealSignal]);

  useEffect(() => {
    if (!shown || openMenu !== null) return;
    const t = setTimeout(() => setShown(false), TOOLBAR_HIDE_MS);
    return () => clearTimeout(t);
  }, [shown, interactions, openMenu]);

  if (!shown) return null;

  const byId = new Map(actions.map((a) => [a.id, a]));
  const fullscreenRow = byId.get("gui-fullscreen");
  const zoomOutRow = byId.get("gui-zoom-out");
  const zoomFitRow = byId.get("gui-zoom-fit");
  const zoomInRow = byId.get("gui-zoom-in");
  const qualityRow = byId.get(`gui-quality-${nextGuiQuality(quality)}`);
  const pointerRow = byId.get("gui-pointer-touch") ?? byId.get("gui-pointer-trackpad");
  const keyBarRow = byId.get("gui-keybar-hide") ?? byId.get("gui-keybar-show");
  const pasteRow = byId.get("gui-paste");
  const sendKeyRow = byId.get("gui-send-key");
  const terminalRow = byId.get("gui-open-terminal");
  const browserRow = byId.get("gui-open-browser");
  const statsRow = byId.get("gui-stats-hide") ?? byId.get("gui-stats-show");
  const reconnectRow = byId.get("gui-reconnect");
  const hasResolution = actions.some((a) => a.id.startsWith("gui-res-"));

  const narrow = wrapperWidth < TOOLBAR_OVERFLOW_MIN_PX;

  // The resolution chip reads the stream entry's live size; a zeroed entry
  // falls back to the geometry preset label, never with the (portrait)
  // suffix (the menu rows keep it).
  const sizeText =
    geometry === "auto"
      ? "auto"
      : width > 0 && height > 0
        ? `${width}×${height}`
        : presetLabel(geometry).replace(" (portrait)", "");
  const shortSize = sizeText.includes("×") ? sizeText.slice(0, sizeText.indexOf("×")) : sizeText;
  const shownSize = wrapperWidth < TOOLBAR_SHORT_LABEL_MAX_PX ? shortSize : sizeText;
  const resolutionAria = `Resolution ${sizeText}${locked ? ", locked" : ""}, menu`;

  const resolutionMenuRows: GuiToolbarMenuRow[] = pickGuiActions(actions, RESOLUTION_MENU_IDS).map(
    (a) => ({
      id: a.id,
      label:
        a.id === "gui-lock" || a.id === "gui-unlock"
          ? stripGuiLabel(a.label)
          : stripGuiLabel(a.label, "Resolution → "),
      description: a.description,
      disabled: a.disabled,
      onSelect: a.onSelect,
    }),
  );

  const overflowMenuRows: GuiToolbarMenuRow[] = [
    ...(qualityRow
      ? [
          {
            id: qualityRow.id,
            label: `Quality → ${GUI_QUALITY_LABELS[quality]}`,
            onSelect: qualityRow.onSelect,
          },
        ]
      : []),
    ...pickGuiActions(actions, OVERFLOW_MENU_IDS).map((a) => ({
      id: a.id,
      label: stripGuiLabel(a.label),
      description: a.description,
      disabled: a.disabled,
      onSelect: a.onSelect,
    })),
  ];

  /** Wrap a row's handler so using the pill restarts the hide timer. */
  const chip = (row: GuiPaletteAction | undefined) =>
    row
      ? () => {
          poke();
          row.onSelect();
        }
      : undefined;

  const toggleMenu = (menu: "resolution" | "overflow") => {
    poke();
    setOpenMenu((m) => (m === menu ? null : menu));
  };
  const closeMenu = () => setOpenMenu(null);

  const resolutionChip = hasResolution ? (
    <Control
      key="resolution"
      ref={resolutionChipRef}
      variant="chip"
      data-testid="gui-toolbar-resolution"
      aria-haspopup="menu"
      aria-expanded={openMenu === "resolution"}
      aria-label={resolutionAria}
      onClick={() => toggleMenu("resolution")}
    >
      {`${locked ? "🔒 " : ""}${shownSize} ▾`}
    </Control>
  ) : null;
  const fullscreenChip = (
    <Control
      key="fullscreen"
      variant="chip"
      aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      disabled={!fullscreenRow}
      onClick={chip(fullscreenRow)}
    >
      ⤢
    </Control>
  );
  const zoomChips = [
    <Control
      key="zoom-out"
      variant="chip"
      aria-label="Zoom out"
      disabled={!zoomOutRow}
      onClick={chip(zoomOutRow)}
    >
      −
    </Control>,
    <Control
      key="zoom-fit"
      variant="chip"
      aria-label="Zoom to fit"
      disabled={!zoomFitRow}
      onClick={chip(zoomFitRow)}
    >
      fit
    </Control>,
    <Control
      key="zoom-in"
      variant="chip"
      aria-label="Zoom in"
      disabled={!zoomInRow}
      onClick={chip(zoomInRow)}
    >
      +
    </Control>,
  ];
  const qualityChip = (
    <Control
      key="quality"
      variant="chip"
      aria-label="Quality"
      disabled={!qualityRow}
      onClick={chip(qualityRow)}
    >
      {`◐ ${GUI_QUALITY_LABELS[quality]}`}
    </Control>
  );
  const pointerChip = coarsePointer ? (
    <Control
      key="pointer"
      variant="chip"
      aria-label="Pointer mode"
      disabled={!pointerRow}
      onClick={chip(pointerRow)}
    >
      {narrow ? "⌖" : pointerMode === "trackpad" ? "⌖ Trackpad" : "⌖ Touch"}
    </Control>
  ) : null;
  const keyBarChip = coarsePointer ? (
    <Control
      key="keybar"
      variant="chip"
      aria-label="Toggle key bar"
      pressed={keyBarVisible}
      disabled={!keyBarRow}
      onClick={chip(keyBarRow)}
    >
      ⌨
    </Control>
  ) : null;
  const statsChip = (
    <Control
      key="stats"
      variant="chip"
      aria-label="Toggle stats"
      pressed={statsVisible}
      disabled={!statsRow}
      onClick={chip(statsRow)}
    >
      ∿
    </Control>
  );

  const groups: (ReactNode | null)[][] = narrow
    ? [
        [resolutionChip, fullscreenChip],
        zoomChips,
        [pointerChip, keyBarChip],
        [
          <Control
            key="overflow"
            ref={overflowChipRef}
            variant="chip"
            data-testid="gui-toolbar-overflow"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={openMenu === "overflow"}
            onClick={() => toggleMenu("overflow")}
          >
            ⋯
          </Control>,
        ],
      ]
    : [
        [resolutionChip, fullscreenChip],
        [...zoomChips, qualityChip],
        [
          pointerChip,
          keyBarChip,
          pasteRow ? (
            <Control key="paste" variant="chip" aria-label="Paste clipboard" onClick={chip(pasteRow)}>
              ⎘
            </Control>
          ) : null,
          sendKeyRow ? (
            <Control key="send-key" variant="chip" aria-label="Send key…" onClick={chip(sendKeyRow)}>
              ⌥
            </Control>
          ) : null,
        ],
        [
          terminalRow ? (
            <Control key="terminal" variant="chip" aria-label="Open terminal" onClick={chip(terminalRow)}>
              ▣
            </Control>
          ) : null,
          browserRow ? (
            <Control key="browser" variant="chip" aria-label="Open browser" onClick={chip(browserRow)}>
              ◍
            </Control>
          ) : null,
        ],
        [
          statsChip,
          reconnectRow ? (
            <Control key="reconnect" variant="chip" aria-label="Reconnect" onClick={chip(reconnectRow)}>
              ↻
            </Control>
          ) : null,
        ],
      ];

  const nonEmpty = groups.map((g) => g.filter(Boolean)).filter((g) => g.length > 0);

  return (
    <div
      data-testid="gui-toolbar"
      className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-1 py-1 rounded border border-border bg-bg-primary/80 select-none font-mono"
      onPointerDown={poke}
    >
      {nonEmpty.map((group, i) => (
        <div key={i} className="contents">
          {i > 0 ? <div className="w-px self-stretch bg-border" /> : null}
          {group}
        </div>
      ))}
      {openMenu === "resolution" ? (
        <GuiToolbarMenu
          kind="resolution"
          anchorRef={resolutionChipRef}
          rows={resolutionMenuRows}
          ariaLabel="Resolution"
          onClose={closeMenu}
        />
      ) : null}
      {openMenu === "overflow" ? (
        <GuiToolbarMenu
          kind="overflow"
          anchorRef={overflowChipRef}
          rows={overflowMenuRows}
          ariaLabel="More actions"
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
