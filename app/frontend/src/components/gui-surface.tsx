import { useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";
import { fetchGuiStatus } from "@/api/client";
import type { GuiSignal } from "@/contexts/session-context";
import { copyToClipboard } from "@/lib/clipboard";
import {
  readGuiWmStripDismissed,
  writeGuiWmStripDismissed,
  type GuiViewMode,
} from "@/lib/gui-posture";
import { Control } from "./control";

/**
 * GuiSurface — the renderer for the `gui` lens (spec docs/specs/gui.md § The
 * substrate / § Availability vs reachability), mounted as a tile by
 * SurfaceLayout's `case "gui"` and lazy-loaded (`export default` +
 * `React.lazy`) so tabs that never open a gui tile never pay for noVNC.
 *
 * - **Content states**: `enabled && reachable` mounts a noVNC `RFB` on a bare
 *   host div connected to the ABSOLUTE `ws(s)://<location.host>/ws/gui/host`
 *   URL (never a relative path — the embed must work behind any proxy); an
 *   enabled-but-unreachable host renders the empty state with the `reason`
 *   fetched ONCE per unreachable transition (never polled — the state socket
 *   drives re-fetch). A `!enabled` host never mounts this tile (degradation).
 *   On a reachable host with NO window manager (`wm === ""`, never on the
 *   screen-sharing mirror backend) a one-line strip (`gui-wm-strip`) rides
 *   above the canvas as a flex sibling — the fit subtracts it — carrying the
 *   status document's `wm_hint` install line (fetched ONCE per bare
 *   transition, the reason-fetch grammar), a Copy of the line, the empty
 *   state's Restart supervisor action, and a per-viewer dismiss
 *   (`runkit-gui-wm-strip-dismissed`, cleared whenever `wm` turns non-empty).
 * - **Connection lifecycle**: connect/disconnect report through
 *   `onConnectionChange` (the top-bar dot). An RFB disconnect while
 *   `reachable` stays true re-dials on a 1s→2s→4s→8s backoff (reset on
 *   connect) under a `disconnected — reconnecting…` overlay; `reachable`
 *   flipping false swaps in the empty state and clears the timer. When the
 *   tile is not VISIBLE (zoomed away, or the document hidden) for 15s the RFB
 *   disconnects — releasing the relay's viewer count so the backend probe
 *   resumes — and reconnects on the next visible true. Focus loss alone never
 *   disconnects. Unmount disconnects and clears every timer.
 * - **Resize policy (D7)**: `resizeSession` is `!coarsePointer && focused &&
 *   !resizeLocked && !hostLocked && geometry === "auto"`, recomputed on every
 *   prop change. D7's follow-the-tile is now the `auto` value of the host's
 *   `gui.geometry` setting: only while it reads `auto` may the focused
 *   fine-pointer viewer drive SetDesktopSize; a fixed `WxH` (or the `""` of a
 *   disabled host) disables `resizeSession` for EVERY viewer, so the desktop
 *   keeps its configured size (fit mode already letterboxes via
 *   `scaleViewport`). Under `auto` the two pins keep their meaning:
 *   `hostLocked` is the host-side pin (`rk gui lock`, streamed as the entry's
 *   `locked`) — an AND term beside the viewer-local `resizeLocked`, not a
 *   replacement. Coarse viewers scale client-side (`scaleViewport` in fit,
 *   `clipViewport` + `dragViewport` in 1:1) and can never resize the shared
 *   desktop.
 * - **Chord gate**: a capture-phase keydown on the canvas wrapper intercepts
 *   registry chords (`shouldReclaimChord`, bound to kind "gui") BEFORE
 *   noVNC's canvas-attached handler sees them and re-dispatches a synthetic
 *   bubbling KeyboardEvent on the parent document so rk's window-level
 *   dispatcher handles the chord (the code-surface grammar — the dispatcher
 *   listens in the bubble phase, so a plain stopPropagation would eat the
 *   chord). Every other key reaches the guest. No steal guard: noVNC grabs
 *   focus only on click (`focusOnClick`), never programmatically.
 * - **macOS credentials**: on `credentialsrequired` an inline password field
 *   overlays the canvas; the password lives only in component state (never
 *   storage, never a POST) and is re-asked on every reconnect. A
 *   `securityfailure` re-shows the field with the wrong-password note; Escape
 *   disconnects into the empty state.
 */

/** Reconnect backoff after an RFB drop while the host stays reachable. */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000];

/** How long the tile may stay invisible before the RFB disconnects — the
 *  "stop framebuffer requests when hidden" budget (noVNC has no pause API). */
const VISIBILITY_DISCONNECT_MS = 15_000;

/** How long the strip's Copy button reads `Copied` after a successful write. */
const COPIED_FEEDBACK_MS = 1_500;

/** The imperative seams the palette's `GUI:` verbs drive (app.tsx holds the
 *  ref; the component fills it while mounted). */
export interface GuiSurfaceCommands {
  /** Paste host clipboard text into the guest (palette: GUI: Paste clipboard). */
  paste(text: string): void;
  /** Drop and re-dial the RFB connection (palette: GUI: Reconnect). */
  reconnect(): void;
}

export type GuiRestartResult = { ok: boolean; disabled?: boolean };

interface GuiSurfaceProps {
  /** The host signal (enabled/reachable/backend drive the content states). */
  gui: GuiSignal | null;
  /** Tile displayed (not zoomed away / the mobile-active slot). Combined with
   *  `document.visibilityState` for the 15s hidden-disconnect rule. */
  visible: boolean;
  /** This tile owns tile focus (focusedTileKind === "gui"). */
  focused: boolean;
  /** Coarse pointer — never drives resize, gets the low quality preset. */
  coarsePointer: boolean;
  /** Per-viewer view posture (localStorage `rk-gui-view`, owned by app.tsx). */
  viewMode: GuiViewMode;
  /** Viewer-local resize lock (localStorage `rk-gui-lock`). */
  resizeLocked: boolean;
  /** RFB connection report — the top-bar toggle dot (R6). */
  onConnectionChange: (connected: boolean) => void;
  /** Tile-focus seam: pointerdown/keydown on the canvas wrapper. */
  onInteract?: () => void;
  /** Registry-chord predicate bound to kind "gui" (built in app.tsx from
   *  `hasReclaimableMatch`). Absent ⇒ no reclaim. */
  shouldReclaimChord?: (e: KeyboardEvent) => boolean;
  /** POST /api/gui/host/restart (via app.tsx); a 409 surfaces as
   *  `{ ok: false, disabled: true }` so the empty state can render
   *  "gui turned off" instead of an error. */
  onRestart: () => Promise<GuiRestartResult>;
  onOpenLogs: () => void;
  /** Filled with the imperative seams while an RFB is live (paste/reconnect). */
  commandsRef?: { current: GuiSurfaceCommands | null };
}

export default function GuiSurface({
  gui,
  visible,
  focused,
  coarsePointer,
  viewMode,
  resizeLocked,
  onConnectionChange,
  onInteract,
  shouldReclaimChord,
  onRestart,
  onOpenLogs,
  commandsRef,
}: GuiSurfaceProps) {
  const enabled = gui?.enabled === true;
  const reachable = gui?.reachable === true;
  const wm = gui?.wm ?? "";
  const backend = gui?.backend ?? "";
  // The bare state: a reachable host whose supervisor resolved no WM rung.
  // The screen-sharing mirror stamps no WM by construction and has no display
  // to install one into — it is never "bare" here.
  const bare = enabled && reachable && wm === "" && backend !== "screen-sharing";

  const hostRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffAttemptRef = useRef(0);

  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reason, setReason] = useState("");
  const [restartDisabled, setRestartDisabled] = useState(false);
  const [credentials, setCredentials] = useState<{ wrong: boolean } | null>(null);
  const [password, setPassword] = useState("");
  // Escape on the credentials prompt: disconnect and stay on the empty state
  // until the host signal changes (the stream drives any recovery).
  const [credEscaped, setCredEscaped] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [docVisible, setDocVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  // Connection generation: bumping re-dials (the backoff timer and the manual
  // GUI: Reconnect seam both ride it).
  const [epoch, setEpoch] = useState(0);
  // The bare-WM strip: the install line (empty until the status GET resolves —
  // the strip renders without that segment meanwhile) and the per-viewer
  // dismiss/Copy feedback state.
  const [wmHint, setWmHint] = useState("");
  const [wmStripDismissed, setWmStripDismissed] = useState(readGuiWmStripDismissed);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest-value refs for the listener/effect closures that outlive renders.
  const propsRef = useRef({ coarsePointer, focused, resizeLocked, viewMode, backend: gui?.backend ?? "", hostLocked: gui?.locked ?? false, geometry: gui?.geometry ?? "" });
  propsRef.current = { coarsePointer, focused, resizeLocked, viewMode, backend: gui?.backend ?? "", hostLocked: gui?.locked ?? false, geometry: gui?.geometry ?? "" };
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const reclaimRef = useRef(shouldReclaimChord);
  reclaimRef.current = shouldReclaimChord;

  // D7: only the focused fine-pointer viewer on an unlocked host (neither the
  // viewer-local pin nor `rk gui lock` set) whose host setting is `auto`
  // drives SetDesktopSize.
  const applyRfbProps = (rfb: RFB) => {
    const p = propsRef.current;
    rfb.resizeSession = !p.coarsePointer && p.focused && !p.resizeLocked && !p.hostLocked && p.geometry === "auto";
    rfb.scaleViewport = p.viewMode === "fit";
    rfb.clipViewport = p.viewMode === "1:1";
    rfb.dragViewport = p.viewMode === "1:1";
    rfb.qualityLevel = p.coarsePointer ? 4 : 6;
    rfb.compressionLevel = p.coarsePointer ? 6 : 2;
    rfb.showDotCursor = true;
    rfb.focusOnClick = true;
    rfb.background = "";
    // The relay already drops input on macOS; viewOnly stops the pretend cursor.
    rfb.viewOnly = p.backend === "screen-sharing";
  };

  const effectivelyVisible = visible && docVisible;
  const wantConnection = enabled && reachable && !credEscaped && !suspended;
  // Read from inside the disconnect closure (the connect effect re-runs on
  // its flip, but a listener outlives the render that installed it).
  const wantConnectionRef = useRef(wantConnection);
  wantConnectionRef.current = wantConnection;

  // Track document visibility (a prop can't — it lives outside React).
  useEffect(() => {
    const onVis = () => setDocVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // The 15s hidden-disconnect rule: invisible starts the budget, visible
  // clears it and unsuspends (the connect effect re-dials on the flip).
  useEffect(() => {
    if (effectivelyVisible) {
      setSuspended(false);
      return;
    }
    const t = setTimeout(() => setSuspended(true), VISIBILITY_DISCONNECT_MS);
    return () => clearTimeout(t);
  }, [effectivelyVisible]);

  // The RFB connection itself. Keyed on wantConnection + epoch: any flip to
  // unwanted tears down; any epoch bump re-dials. Cleanup removes the RFB's
  // listeners BEFORE disconnect() so the teardown disconnect event cannot
  // schedule a spurious reconnect, and drops noVNC's screen subtree so a
  // re-dial starts from a bare host div.
  useEffect(() => {
    if (!wantConnection) return;
    const hostEl = hostRef.current;
    if (!hostEl) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const rfb = new RFB(hostEl, `${proto}://${window.location.host}/ws/gui/host`, {
      shared: true,
    });
    rfbRef.current = rfb;
    applyRfbProps(rfb);

    const onConnect = () => {
      backoffAttemptRef.current = 0;
      setConnected(true);
      setReconnecting(false);
      onConnectionChangeRef.current(true);
    };
    const onDisconnect = () => {
      setConnected(false);
      onConnectionChangeRef.current(false);
      if (!wantConnectionRef.current) return;
      // The host stays reachable: re-dial with capped backoff, the overlay
      // marking the interim.
      setReconnecting(true);
      const attempt = Math.min(backoffAttemptRef.current, RECONNECT_BACKOFF_MS.length - 1);
      backoffAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => setEpoch((e) => e + 1), RECONNECT_BACKOFF_MS[attempt]);
    };
    const onClipboard = (e: CustomEvent<{ text: string }>) => {
      // Best-effort: no clipboard permission silently skips the write.
      navigator.clipboard?.writeText(e.detail.text).catch(() => {});
    };
    const onCredentials = () => {
      setPassword("");
      setCredentials({ wrong: false });
    };
    const onSecurityFailure = () => {
      setPassword("");
      setCredentials({ wrong: true });
    };
    rfb.addEventListener("connect", onConnect);
    rfb.addEventListener("disconnect", onDisconnect);
    rfb.addEventListener("clipboard", onClipboard);
    rfb.addEventListener("credentialsrequired", onCredentials);
    rfb.addEventListener("securityfailure", onSecurityFailure);

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      rfb.removeEventListener("connect", onConnect);
      rfb.removeEventListener("disconnect", onDisconnect);
      rfb.removeEventListener("clipboard", onClipboard);
      rfb.removeEventListener("credentialsrequired", onCredentials);
      rfb.removeEventListener("securityfailure", onSecurityFailure);
      rfb.disconnect();
      rfbRef.current = null;
      hostEl.replaceChildren();
      setConnected(false);
      setReconnecting(false);
      onConnectionChangeRef.current(false);
    };
    // Deps stay [wantConnection, epoch] by contract: applyRfbProps reads the
    // latest props through propsRef, and prop-only changes apply to the live
    // RFB via the every-render effect below — they must NOT re-dial.
  }, [wantConnection, epoch]);

  // Recompute the RFB prop mapping on EVERY prop change — noVNC applies the
  // setters live (a resizeSession flip sends SetDesktopSize on the next size
  // change). No deps array: runs after every render, cheap plain assignments.
  useEffect(() => {
    const rfb = rfbRef.current;
    if (rfb) applyRfbProps(rfb);
  });

  // The palette seams (GUI: Paste clipboard / GUI: Reconnect) — live only
  // while mounted; paste no-ops without a live RFB.
  useEffect(() => {
    if (!commandsRef) return;
    commandsRef.current = {
      paste: (text) => rfbRef.current?.clipboardPasteFrom(text),
      reconnect: () => {
        backoffAttemptRef.current = 0;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        // An Escape'd credentials prompt parks the connection until the next
        // host-signal transition; a user-invoked reconnect reopens it now.
        setCredEscaped(false);
        setEpoch((e) => e + 1);
      },
    };
    return () => {
      commandsRef.current = null;
    };
  }, [commandsRef]);

  // The empty state's reason: fetched ONCE per unreachable transition (the
  // stream drives any re-fetch — a reachable flip re-arms the transition).
  // A failed GET leaves the empty state without a reason line, never a throw.
  const reasonFetchedRef = useRef(false);
  useEffect(() => {
    if (!enabled || reachable) {
      reasonFetchedRef.current = false;
      setRestartDisabled(false);
      setCredEscaped(false);
      return;
    }
    if (reasonFetchedRef.current) return;
    reasonFetchedRef.current = true;
    // A new unreachable transition starts with no reason: a stale line from an
    // earlier transition must not survive a failed GET.
    setReason("");
    let cancelled = false;
    fetchGuiStatus()
      .then((s) => {
        if (!cancelled) setReason(s.reason ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      // StrictMode's mount-replay cleanup runs synchronously between the two
      // effect invocations of ONE transition — re-arm so the replay re-fires
      // the fetch instead of dropping it (the cancelled flag above suppresses
      // the first attempt's late resolution).
      reasonFetchedRef.current = false;
    };
  }, [enabled, reachable]);

  // The strip's install line: fetched ONCE per bare transition from the status
  // document (the stream carries `wm` but not the package-manager-aware hint,
  // so the frontend never hardcodes one) — the same never-polled grammar as
  // the reason fetch above. A failed GET leaves the line unknown: the strip
  // still renders, without the install segment and without Copy. A `wm` or
  // `reachable` flip re-arms the transition and clears the stored line.
  const hintFetchedRef = useRef(false);
  useEffect(() => {
    if (!bare) {
      hintFetchedRef.current = false;
      setWmHint("");
      return;
    }
    if (hintFetchedRef.current) return;
    hintFetchedRef.current = true;
    // A new bare transition starts with no line: a stale hint from an earlier
    // transition must not survive a failed GET.
    setWmHint("");
    let cancelled = false;
    fetchGuiStatus()
      .then((s) => {
        if (!cancelled) setWmHint(s.wm_hint ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      // StrictMode's mount-replay cleanup runs synchronously between the two
      // effect invocations of ONE transition — re-arm so the replay re-fires
      // the fetch instead of dropping it (the cancelled flag above suppresses
      // the first attempt's late resolution).
      hintFetchedRef.current = false;
    };
  }, [bare]);

  // A non-empty `wm` (the user installed a WM and restarted) clears the
  // dismissal, so a LATER bare state shows the strip again. A `reachable`
  // flip deliberately never clears it.
  useEffect(() => {
    if (wm === "") return;
    writeGuiWmStripDismissed(false);
    setWmStripDismissed(false);
  }, [wm]);

  // The `Copied` feedback timer must not outlive the component.
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const dismissWmStrip = () => {
    setWmStripDismissed(true);
    writeGuiWmStripDismissed(true);
  };

  const copyInstallLine = () => {
    void copyToClipboard(wmHint).then((ok) => {
      // A failed copy (both mechanisms) leaves the strip unchanged.
      if (!ok) return;
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  };

  if (!gui || !enabled) return null;

  if (!reachable || credEscaped) {
    return (
      <div
        data-testid="gui-surface-empty"
        className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-text-secondary text-xs font-mono select-none"
      >
        <div>GUI is on but not running</div>
        {reason ? <div data-testid="gui-surface-reason">{reason}</div> : null}
        {restartDisabled ? <div>gui turned off</div> : null}
        <div className="flex gap-2">
          <button
            type="button"
            className="border border-border rounded px-2 py-1 hover:bg-bg-inset"
            onClick={() => {
              onRestart()
                .then((r) => {
                  if (r.ok === false) setRestartDisabled(true);
                })
                .catch(() => {});
            }}
          >
            Restart supervisor
          </button>
          <button
            type="button"
            className="border border-border rounded px-2 py-1 hover:bg-bg-inset"
            onClick={onOpenLogs}
          >
            Open supervisor logs
          </button>
        </div>
      </div>
    );
  }

  const submitCredentials = () => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.sendCredentials({ password });
    // The password lives in component state only — cleared immediately after
    // submit, never stored, and re-asked on the next credentialsrequired.
    setPassword("");
    setCredentials(null);
  };

  return (
    <div
      data-testid="gui-surface-canvas"
      className="flex-1 min-h-0 relative overflow-hidden flex flex-col"
      onPointerDownCapture={() => onInteractRef.current?.()}
      onKeyDownCapture={(e) => {
        onInteractRef.current?.();
        if (!reclaimRef.current?.(e.nativeEvent)) return;
        // noVNC's Keyboard listens on the canvas (a descendant) — stop the
        // event before it descends, then re-dispatch on the parent document:
        // rk's keybinding dispatcher listens at window in the BUBBLE phase,
        // so a plain stopPropagation would eat the chord with it.
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            bubbles: true,
          }),
        );
      }}
    >
      {bare && !wmStripDismissed ? (
        <div
          data-testid="gui-wm-strip"
          role="status"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 border-b border-border text-text-secondary select-none font-mono text-xs"
        >
          <span>No window manager on the GUI host</span>
          {wmHint ? <span>{` — ${wmHint}`}</span> : null}
          <span>
            {" · then "}
            <button
              type="button"
              className="underline hover:text-text-primary"
              // An ok:false (409) means the switch flipped off — the stream
              // unmounts the tile; there is nothing to render for it here.
              onClick={() => void onRestart().catch(() => {})}
            >
              Restart supervisor
            </button>
          </span>
          {wmHint ? (
            <Control variant="chip" aria-label="Copy install line" onClick={copyInstallLine}>
              {copied ? "Copied" : "Copy"}
            </Control>
          ) : null}
          <Control variant="chip" aria-label="Dismiss" onClick={dismissWmStrip}>
            ×
          </Control>
        </div>
      ) : null}
      {/* The key pins the host div's DOM node identity: without it a branch
          switch (canvas ⇄ empty state) can reuse the node for a same-position
          sibling, and the connect effect's cleanup (`hostEl.replaceChildren()`)
          would then wipe THAT element's content. */}
      <div ref={hostRef} className="flex-1 min-h-0" key="novnc-host" />
      {reconnecting && !credentials ? (
        <div
          data-testid="gui-surface-reconnecting"
          className="absolute inset-0 flex items-center justify-center text-text-secondary text-xs font-mono select-none bg-bg-primary/70"
        >
          disconnected — reconnecting…
        </div>
      ) : null}
      {credentials ? (
        <div
          data-testid="gui-surface-credentials"
          className="absolute inset-0 flex items-center justify-center bg-bg-primary/70"
        >
          <form
            className="flex flex-col gap-2 items-center text-xs font-mono text-text-secondary"
            onSubmit={(e) => {
              e.preventDefault();
              submitCredentials();
            }}
          >
            <label htmlFor="gui-surface-password">Screen Sharing password</label>
            {credentials.wrong ? <div>Wrong password — try again</div> : null}
            <input
              id="gui-surface-password"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setCredentials(null);
                  setCredEscaped(true);
                  setReason("Screen Sharing password required");
                }
              }}
              className="bg-bg-inset border border-border rounded px-2 py-1 text-text-primary"
            />
            <button
              type="submit"
              className="border border-border rounded px-2 py-1 hover:bg-bg-inset"
            >
              Connect
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
