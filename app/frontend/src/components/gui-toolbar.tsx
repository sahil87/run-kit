/**
 * The gui tile's session toolbar pill (spec gui.md § The tile → The toolbar
 * pill, HiDPI, and Send key): the coarse-and-fullscreen mirror of the
 * palette's `GUI:` rows — the two contexts where the palette is unreachable
 * (fullscreen) or clumsy (a phone). A fine-pointer, non-fullscreen viewer
 * never mounts it (GuiSurface owns that gate); the empty/credentials states
 * never see it either.
 *
 * Every chip calls the SAME callback object its `buildGuiActions` row calls
 * (Constitution V — the palette is the complete action registry, so the pill
 * shares handlers instead of duplicating logic). `◐`/`∿` are optional slots
 * (the quality/stats feature ships separately): they render only when their
 * slot prop is supplied.
 *
 * The show/hide machine: shown on mount (so a phone user discovers it without
 * knowing to tap) and on every `revealSignal` bump (GuiSurface bumps it on a
 * tap on the tile and on a pointermove within TOOLBAR_REVEAL_EDGE_PX of the
 * wrapper's top edge while fullscreen); it hides TOOLBAR_HIDE_MS after the
 * last reveal or pill interaction — any interaction restarts the timer. While
 * hidden it renders nothing.
 */
import { useEffect, useRef, useState } from "react";
import { Control } from "./control";
import { stepGuiZoom, type GuiPointerMode, type GuiZoom } from "@/lib/gui-posture";

/** How long after the last reveal or interaction the pill hides. */
export const TOOLBAR_HIDE_MS = 3_000;

/** Fullscreen reveal: a pointermove within this distance of the wrapper's top
 *  edge shows the pill (GuiSurface performs the check and bumps the signal). */
export const TOOLBAR_REVEAL_EDGE_PX = 24;

interface GuiToolbarProps {
  /** The viewer's zoom posture — labels and the +/- destination gating. */
  zoom: GuiZoom;
  pointerMode: GuiPointerMode;
  /** The ⌖ and ⌨ chips are coarse-only surfaces (their palette rows are too). */
  coarsePointer: boolean;
  /** The ⤢ chip exists only while fullscreen. */
  fullscreen: boolean;
  keyBarVisible: boolean;
  /** Bump to reveal: a tap on the tile (coarse) or a top-edge hover
   *  (fullscreen). A counter, not a boolean, so repeated reveals re-fire. */
  revealSignal: number;
  onZoom: (z: GuiZoom) => void;
  onPointerMode: (m: GuiPointerMode) => void;
  onKeyBarVisibleChange: (visible: boolean) => void;
  /** The fullscreen toggle verb (it exits when fullscreen). */
  onFullscreen: () => void;
  /** Optional quality slot — rendered only when supplied. */
  quality?: { label: string; onCycle: () => void };
  /** Optional stats slot — rendered only when supplied. */
  stats?: { onToggle: () => void };
}

export function GuiToolbar({
  zoom,
  pointerMode,
  coarsePointer,
  fullscreen,
  keyBarVisible,
  revealSignal,
  onZoom,
  onPointerMode,
  onKeyBarVisibleChange,
  onFullscreen,
  quality,
  stats,
}: GuiToolbarProps) {
  const [shown, setShown] = useState(true);
  // Bump restarts the hide timer (the effect below re-runs).
  const [interactions, setInteractions] = useState(0);
  const lastSignalRef = useRef(revealSignal);

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
    if (!shown) return;
    const t = setTimeout(() => setShown(false), TOOLBAR_HIDE_MS);
    return () => clearTimeout(t);
  }, [shown, interactions]);

  if (!shown) return null;

  /** Wrap a chip's handler so using the pill restarts the hide timer. */
  const chip = (fn: () => void) => () => {
    poke();
    fn();
  };

  return (
    <div
      data-testid="gui-toolbar"
      className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-1 py-1 rounded border border-border bg-bg-primary/80 select-none font-mono"
      onPointerDown={poke}
    >
      <Control
        variant="chip"
        aria-label="Zoom out"
        disabled={zoom === "fit"}
        onClick={chip(() => onZoom(stepGuiZoom(zoom, -1)))}
      >
        −
      </Control>
      <Control
        variant="chip"
        aria-label="Zoom to fit"
        disabled={zoom === "fit"}
        onClick={chip(() => onZoom("fit"))}
      >
        fit
      </Control>
      <Control
        variant="chip"
        aria-label="Zoom in"
        disabled={zoom === 200}
        onClick={chip(() => onZoom(stepGuiZoom(zoom, 1)))}
      >
        +
      </Control>
      {coarsePointer ? (
        <Control
          variant="chip"
          aria-label="Pointer mode"
          onClick={chip(() => onPointerMode(pointerMode === "trackpad" ? "touch" : "trackpad"))}
        >
          {pointerMode === "trackpad" ? "⌖ Trackpad" : "⌖ Touch"}
        </Control>
      ) : null}
      {quality ? (
        <Control variant="chip" aria-label="Quality" onClick={chip(quality.onCycle)}>
          {`◐ ${quality.label}`}
        </Control>
      ) : null}
      {coarsePointer ? (
        <Control
          variant="chip"
          aria-label="Toggle key bar"
          pressed={keyBarVisible}
          onClick={chip(() => onKeyBarVisibleChange(!keyBarVisible))}
        >
          ⌨
        </Control>
      ) : null}
      {stats ? (
        <Control variant="chip" aria-label="Toggle stats" onClick={chip(stats.onToggle)}>
          ∿
        </Control>
      ) : null}
      {fullscreen ? (
        <Control variant="chip" aria-label="Exit fullscreen" onClick={chip(onFullscreen)}>
          ⤢
        </Control>
      ) : null}
    </div>
  );
}
