import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { CollapsiblePanel } from "./collapsible-panel";
import { PaletteIcon } from "./icons";
import { HostMetrics } from "../host-metrics";
import { SwatchPopover } from "@/components/swatch-popover";
import { useHostMetrics, useMetrics } from "@/contexts/session-context";
import { useInstanceAccent } from "@/contexts/instance-accent-context";

type HostPanelProps = {
  /** Health of whatever source feeds this panel: the current server's
   *  subscription on server routes, the host-metrics source on the board route
   *  (where no server-scoped signal exists) — derived by `BottomPanels`. */
  isConnected: boolean;
};

export function HostPanel({ isConnected }: HostPanelProps) {
  // Server-scoped metrics win when present; fall back to the host-global
  // metrics broadcast (available on EVERY route) when they are null — the
  // board route has no `currentServer`, so the server-scoped slice is null by
  // construction there (260720-zx4i). The two arrive on the same tick when a
  // server is attached, so the fallback is harmless on server routes too.
  const serverMetrics = useMetrics();
  const hostMetrics = useHostMetrics();
  const metrics = serverMetrics ?? hostMetrics;

  // Instance accent (1etw): the hostname carries the instance's accent color
  // and the header hosts the accent picker — the HOST panel is the "which
  // run-kit instance is this" surface (server colors own the sidebar rows).
  const { color, isExplicit, stripeHex, setColor } = useInstanceAccent();
  const [showColorPicker, setShowColorPicker] = useState(false);
  const paletteBtnRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  // Portal the popover to document.body at fixed coordinates anchored at the
  // palette button (right-aligned, flip-above heuristic) so it escapes the
  // panel's overflow clip — the x4sf ServerGroup-header precedent. The HOST
  // panel sits at the sidebar's bottom, so the flip-above branch is the norm.
  useLayoutEffect(() => {
    if (!showColorPicker || !paletteBtnRef.current) {
      setPopoverPos(null);
      return;
    }
    const rect = paletteBtnRef.current.getBoundingClientRect();
    const approxPopoverHeight = 190; // color-only grid: Clear row + 3 swatch rows
    const below = rect.bottom + 4;
    const fitsBelow = below + approxPopoverHeight <= window.innerHeight;
    const top = fitsBelow ? below : Math.max(4, rect.top - approxPopoverHeight - 4);
    setPopoverPos({
      top,
      right: Math.max(4, window.innerWidth - rect.right),
    });
  }, [showColorPicker]);

  const hostnameHeader = metrics ? (
    <>
      <span
        className={`truncate font-mono ${stripeHex ? "" : "text-text-primary"}`}
        style={stripeHex ? { color: stripeHex } : undefined}
      >
        {metrics.hostname}
      </span>
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
          isConnected ? "bg-accent-green" : "bg-text-secondary"
        }`}
        title={isConnected ? "SSE connected" : "SSE disconnected"}
      />
    </>
  ) : null;

  // Sibling of the header toggle button (the `headerAction` slot) — a button
  // nested inside the toggle would be invalid markup. Hover-revealed with the
  // touch/keyboard fallbacks (the session-row convention).
  const paletteAction = (
    <>
      <button
        ref={paletteBtnRef}
        type="button"
        onClick={() => setShowColorPicker((v) => !v)}
        aria-label="Set instance color"
        className="opacity-0 group-hover/panel:opacity-100 coarse:opacity-100 focus-visible:opacity-100 transition-opacity px-1 flex items-center justify-center hover:text-text-primary"
      >
        <PaletteIcon />
      </button>
      {showColorPicker && popoverPos && createPortal(
        <div
          style={{
            position: "fixed",
            top: popoverPos.top,
            right: popoverPos.right,
            zIndex: 100,
          }}
        >
          <SwatchPopover
            selectedColor={isExplicit && color != null ? color : undefined}
            onSelect={(c) => {
              setColor(c);
              setShowColorPicker(false);
            }}
            onClose={() => setShowColorPicker(false)}
          />
        </div>,
        document.body,
      )}
    </>
  );

  return (
    <CollapsiblePanel
      title="Host"
      storageKey="runkit-panel-host"
      defaultOpen={true}
      headerRight={hostnameHeader}
      headerAction={paletteAction}
    >
      {!metrics ? (
        <div className="text-xs text-text-secondary">No metrics</div>
      ) : (
        <HostMetrics metrics={metrics} />
      )}
    </CollapsiblePanel>
  );
}
