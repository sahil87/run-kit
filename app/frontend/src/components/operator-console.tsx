import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionContext, useCurrentServerFromRoute } from "@/contexts/session-context";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { TerminalClient } from "@/components/terminal-client";
import { prefersReducedMotion } from "@/lib/motion";
import {
  OPERATOR_CONSOLE_EVENT,
  attachOperatorFiles,
  clampConsoleGeometry,
  cycleConsoleMachine,
  findOperatorWindow,
  isOperatorConsoleRequest,
  requestOperatorConsole,
  resolveConsoleServer,
  sendOperatorMessage,
  setConsoleMachineState,
  setOperatorComposeText,
  setOperatorConsoleOpen,
  useConsoleGeometry,
  useConsoleMachineState,
  useConsoleOpacity,
  useOperatorCompose,
  useOperatorConsoleContext,
  useOperatorConsoleOpen,
  type ConsoleGeometry,
} from "@/lib/operator-console";

/** Slide duration — must match the `.rk-console-slide` transition in globals.css. */
const CONSOLE_SLIDE_MS = 240;

/**
 * The operator chat console — a global pull-down overlay (drawer on desktop,
 * full-height sheet under the top bar on mobile) available on every route.
 * Mounted ONCE at the persistent root layout (app.tsx, beside the single
 * CommandPalette mount); every entry point — the registry chord, the palette
 * action, the palette's Ask-operator fallback row, the sidebar pinned row, the
 * top-bar operator button, the mobile tongue, the mobile overflow-menu row —
 * reaches it through the OPERATOR_CONSOLE_EVENT document seam
 * (lib/operator-console.ts).
 *
 * Desktop runs the ⌘J three-state machine (lib/operator-console.ts): rest →
 * focused (omnibox focused, drawer closed) → open (drawer down — a peek,
 * nothing sent) → rest. Enter in the omnibox sends and auto-opens; Esc steps
 * back one level (open → focused → rest); the palette action and the pinned
 * row land straight on open+focused; the ◉ button maps open ⇄ rest. The
 * machine is the controlling state — the drawer's internal open flag follows
 * it through the slide machinery. Mobile never leaves the rest/open pair: the
 * chord, tongue, and menu row plain-toggle the sheet.
 *
 * Anatomy: a title strip (◉ OPERATOR · server, the operator window's live
 * agent state from the sessions payload, a server picker on param-less
 * multi-server routes, a close affordance), an embedded LIVE terminal view of
 * the operator window (a plain TerminalClient over the shared /ws/terminals
 * relay mux — the same mechanism a board pane uses, registerFocus off so the
 * BottomBar keeps its target, `transparent` on so the glass background shows
 * through the cells), and — MOBILE ONLY — a compose strip. The one-input
 * rule: on desktop the compose IS the top-bar omnibox (components/
 * operator-omnibox.tsx) and the drawer is output-only, carrying the inline
 * status/error line at its top edge, directly under the box. Both inputs
 * drive the ONE shared compose seam (lib/operator-console.ts) — same draft,
 * same `sendToWindow(..., "submit", "agent")` delivery with chat-send busy
 * semantics (allow + probe — no client-side busy gate), same upload path.
 * Structured send failures surface inline (never toasts) and the composed
 * text survives a failure for retry/edit.
 *
 * The desktop drawer is a true quake slide: it mounts translated fully above
 * the top-bar seam (an `overflow-clip` wrapper hides the raised portion) and
 * transitions to rest, and a close request drives the raised class and holds
 * the unmount until `transitionend` (with a timeout fallback), so the terminal
 * stream tears down AFTER the slide, not mid-animation. Reduced motion zeroes
 * both directions including the exit delay. The drawer is mouse-resizable —
 * the hanging bottom tongue drags height (25–85vh), side grips drag width
 * symmetrically about the center line (420px–96vw), drags suspend the slide
 * transition, and the geometry persists per-viewer in localStorage — and its
 * background is glass: `color-mix`-alpha bg-primary at the per-viewer opacity
 * (default 0.90, settings-dialog row) over a fixed 6px backdrop blur, disabled
 * entirely at α=1.
 *
 * File paste/drop inside the drawer (or the omnibox) uploads via the existing
 * `uploadFile` client scoped to the OPERATOR window's session and
 * insert-delivers each returned path to the operator pane (`"raw"` send mode
 * — staged into the TUI composer, never submitted; the user's own Enter
 * submits). With no operator window resolved, file paste is a no-op — the
 * hint line is the answer.
 *
 * Open/closed is ephemeral per-viewer component state (Constitution IV — no
 * URL, tmux, or localStorage write; geometry/opacity are the carve-out
 * preferences). Availability degrades to ABSENT: a server with no operator
 * window renders a single hint line and opens no stream.
 */
export function OperatorConsole() {
  const isMobile = useIsMobile();
  const machine = useConsoleMachineState();
  const compose = useOperatorCompose();
  const [open, setOpen] = useState(false);
  // True while the exit slide runs: the component stays mounted with the
  // raised class until transitionend (or the timeout fallback) unmounts it.
  const [closing, setClosing] = useState(false);
  // True once the drawer has left its raised start pose — the enter slide is
  // the transition between these two poses.
  const [entered, setEntered] = useState(false);
  const [pinnedServer, setPinnedServer] = useState<string | null>(null);
  const [pickerServer, setPickerServer] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const { servers, sessionsByServer } = useSessionContext();

  // Route server — the shared deepest-first route-param walk (param names are
  // unique across the route tree).
  const routeServer = useCurrentServerFromRoute();

  // Most-recently-viewed server, remembered ephemerally for the picker
  // default on param-less routes (no persistence — Constitution IV).
  const lastViewedRef = useRef<string | null>(null);
  if (routeServer) lastViewedRef.current = routeServer;

  const serverNames = useMemo(() => servers.map((s) => s.name), [servers]);
  const showPicker = routeServer === null && serverNames.length > 1;
  const server =
    pickerServer ?? pinnedServer ?? resolveConsoleServer(routeServer, serverNames, lastViewedRef.current);

  // A pinned/picked server is scoped to the route it was requested from — a
  // navigation retargets the console to the new route's server.
  useEffect(() => {
    setPinnedServer(null);
    setPickerServer(null);
  }, [routeServer]);

  // ── Slide machinery ─────────────────────────────────────────────────────
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const closingRef = useRef(closing);
  closingRef.current = closing;
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;

  const finishClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);
    setOpen(false);
    setEntered(false);
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    // Reduced motion skips the mounted-through-exit delay entirely (the CSS
    // transition is zeroed too); the mobile sheet keeps its own fast
    // treatment and never rides the quake slide.
    if (isMobileRef.current || prefersReducedMotion()) {
      setOpen(false);
      setEntered(false);
      return;
    }
    setClosing(true);
    closeTimerRef.current = setTimeout(finishClose, CONSOLE_SLIDE_MS + 120);
  }, [finishClose]);
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // The component can unmount mid-exit (layout teardown); a pending slide
  // timeout must not fire setState afterwards.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const openDrawer = useCallback(() => {
    // A re-open mid-exit cancels the close: the drawer transitions back down
    // from wherever the slide had reached.
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);
    setOpen(true);
  }, []);

  // The machine is the controlling state: entering `open` runs the enter
  // slide; leaving it runs the exit slide (or the immediate mobile/reduced
  // close). `focused` changes nothing by itself — the drawer stays put.
  const prevMachineRef = useRef(machine);
  useEffect(() => {
    const prev = prevMachineRef.current;
    prevMachineRef.current = machine;
    if (machine === "open" && prev !== "open") openDrawer();
    else if (machine !== "open" && prev === "open") requestCloseRef.current();
  }, [machine, openDrawer]);

  // Entry-point seam: chord dispatch, palette action, top-bar button, tongue,
  // overflow-menu row, sidebar pinned row, and the palette fallback row all
  // dispatch here. Desktop `toggle` steps the three-state machine; mobile
  // `toggle` plain-toggles the sheet; `button` (the top-bar ◉) maps
  // open ⇄ rest; `open` always opens (desktop: with the omnibox focused).
  useEffect(() => {
    function onRequest(e: Event) {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!isOperatorConsoleRequest(detail)) return;
      const state = machineRef.current;
      if (detail.action === "toggle") {
        if (isMobileRef.current) setConsoleMachineState(state === "open" ? "rest" : "open");
        else setConsoleMachineState(cycleConsoleMachine(state));
      } else if (detail.action === "button") {
        setConsoleMachineState(state === "open" ? "rest" : "open");
      } else {
        setConsoleMachineState("open");
      }
      if (detail.server) setPinnedServer(detail.server);
      if (detail.send !== undefined) setPendingSend(detail.send);
    }
    document.addEventListener(OPERATOR_CONSOLE_EVENT, onRequest);
    return () => document.removeEventListener(OPERATOR_CONSOLE_EVENT, onRequest);
  }, []);

  // Enter pose: mount raised (translateY(-102%), clipped by the wrapper), then
  // drop the raised class two frames later so the transition animates.
  useEffect(() => {
    if (!open) return;
    setEntered(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open]);

  // Esc steps the machine back ONE level (bubble phase, so an already-claimed
  // Escape — a nested modal's — wins via defaultPrevented): open → focused
  // (the drawer closes, the omnibox keeps focus), focused → rest (the omnibox
  // blur + focus restore is the omnibox's machine-follower effect). Owning
  // both steps here — rather than letting the omnibox input handle its own
  // Esc — guarantees one Esc never double-steps. Mobile steps straight to
  // rest. The stream closes with the unmount; the conversation itself lives
  // in the operator window regardless.
  useEffect(() => {
    if (!open && machine === "rest") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const state = machineRef.current;
      if (isMobileRef.current || state === "focused") setConsoleMachineState("rest");
      else if (state === "open") setConsoleMachineState("focused");
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, machine]);

  const rendered = open || closing;

  // Publish the open flag to the module slot — the mobile tongue hides while
  // the sheet covers it, and the paste guard can read the state without
  // owning it.
  useEffect(() => {
    setOperatorConsoleOpen(rendered);
    return () => setOperatorConsoleOpen(false);
  }, [rendered]);

  // Focus the compose input on open (the mobile sheet — the desktop drawer's
  // input is the omnibox, whose machine-follower effect owns focus there);
  // restore prior focus once the close completes.
  useEffect(() => {
    if (!rendered || !isMobile) return;
    restoreFocusRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      (composeRef.current ?? root.querySelector<HTMLElement>("button, select"))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [rendered, isMobile]);
  useEffect(() => {
    if (rendered || !isMobile) return;
    const el = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (el instanceof HTMLElement) el.focus();
  }, [rendered, isMobile]);

  const target = useMemo(
    () => (server ? findOperatorWindow(sessionsByServer.get(server) ?? []) : undefined),
    [server, sessionsByServer],
  );

  // The palette fallback row's pre-filled query: sent once the console is open
  // AND the operator window resolves — the sessions slice can lag the open, so
  // the send waits for `target` instead of being dropped. A genuinely
  // operator-less server never resolves it (the hint line is the answer
  // there), and closing the console abandons it: the send is scoped to the
  // open it arrived with.
  useEffect(() => {
    if (!open || pendingSend == null || !target) return;
    setPendingSend(null);
    void sendOperatorMessage(server, target, pendingSend);
  }, [open, pendingSend, target, server]);
  useEffect(() => {
    if (!open) setPendingSend(null);
  }, [open]);

  // ── Geometry (desktop drawer) + glass ─────────────────────────────────────
  const [geometry, writeGeometry] = useConsoleGeometry();
  const [opacity] = useConsoleOpacity();
  // Live drag state: the override drives the drawer's box while a grip is held
  // (transition suspended via the dragging class); the store write lands on
  // pointer-up.
  const [dragOverride, setDragOverride] = useState<ConsoleGeometry | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    kind: "height" | "left" | "right";
    startX: number;
    startY: number;
    start: ConsoleGeometry;
  } | null>(null);

  const effectiveGeometry = clampConsoleGeometry(dragOverride ?? geometry);

  const onGripPointerDown = useCallback(
    (kind: "height" | "left" | "right") => (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer events (unit tests) have no active pointer to capture.
      }
      dragRef.current = { kind, startX: e.clientX, startY: e.clientY, start: effectiveGeometry };
      setDragging(true);
    },
    [effectiveGeometry],
  );
  const onGripPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next =
      drag.kind === "height"
        ? {
            ...drag.start,
            heightVh: drag.start.heightVh + ((e.clientY - drag.startY) / window.innerHeight) * 100,
          }
        : {
            ...drag.start,
            // Symmetric about the center line: an edge delta moves BOTH sides,
            // so the width changes by twice the pointer delta (sign flipped on
            // the left grip) and the drawer stays centered.
            widthPx: drag.start.widthPx + 2 * (e.clientX - drag.startX) * (drag.kind === "left" ? -1 : 1),
          };
    setDragOverride(clampConsoleGeometry(next));
  }, []);
  const onGripPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Synthetic pointer events (unit tests) have no active pointer.
      }
      setDragging(false);
      setDragOverride((prev) => {
        if (prev) writeGeometry(prev);
        return null;
      });
    },
    [writeGeometry],
  );

  if (!rendered) return null;

  const agentState = target?.window.agentState;
  const agentIdle = target?.window.agentIdleDuration;

  // Glass: alpha-blended bg-primary over a fixed 6px backdrop blur (desktop
  // drawer only — the mobile sheet stays opaque). α=1 disables the filter
  // entirely: the zero-cost opaque path.
  const glassStyle: React.CSSProperties = {
    backgroundColor: `color-mix(in srgb, var(--color-bg-primary) ${Math.round(opacity * 100)}%, transparent)`,
    ...(opacity < 1
      ? { backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }
      : {}),
  };

  const gripHandlers = {
    onPointerMove: onGripPointerMove,
    onPointerUp: onGripPointerUp,
  };

  const drawer = (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Operator console"
      data-testid="operator-console"
      data-operator-console=""
      onTransitionEnd={(e) => {
        if (e.target === rootRef.current && e.propertyName === "transform" && closingRef.current) {
          finishClose();
        }
      }}
      onPasteCapture={(e) => {
        // Capture phase: xterm's own textarea paste handler stops propagation,
        // so a bubble-phase handler would never see file pastes targeted at
        // the embedded terminal. Text pastes fall through (no files) and keep
        // their native behavior.
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        void attachOperatorFiles(server, target, files);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        void attachOperatorFiles(server, target, files);
      }}
      className={
        isMobile
          ? "rk-console-drop absolute inset-0 z-40 flex flex-col bg-bg-primary"
          : `rk-console-slide pointer-events-auto absolute top-0 left-1/2 -translate-x-1/2 flex flex-col border border-t-0 border-border rounded-b-lg shadow-2xl${
              entered && !closing ? "" : " rk-console-closed"
            }${dragging ? " rk-console-dragging" : ""}`
      }
      style={
        isMobile
          ? undefined
          : {
              // maxWidth (not a min() width) so the 96vw ceiling keeps
              // tracking live viewport resizes.
              width: `${effectiveGeometry.widthPx}px`,
              maxWidth: "96vw",
              height: `${effectiveGeometry.heightVh}vh`,
              ...glassStyle,
            }
      }
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs shrink-0">
        <span className="text-text-primary">◉ OPERATOR</span>
        {showPicker ? (
          <select
            aria-label="Operator server"
            value={server ?? ""}
            onChange={(e) => setPickerServer(e.target.value)}
            className="bg-transparent text-text-secondary outline-none cursor-pointer"
          >
            {serverNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          server && <span className="text-text-secondary">· {server}</span>
        )}
        {agentState && (
          <span className="text-text-secondary" data-testid="operator-console-state">
            {agentState}
            {agentIdle ? ` ${agentIdle}` : ""}
          </span>
        )}
        <button
          type="button"
          aria-label="Close operator console"
          onClick={() => setConsoleMachineState("rest")}
          className="rk-glint ml-auto shrink-0 inline-flex items-center justify-center rounded px-1 text-text-secondary hover:text-text-primary transition-colors coarse:min-h-[36px] coarse:min-w-[36px]"
        >
          ✕
        </button>
      </div>
      {/* Desktop status line: the inline-error contract relocated to the
          drawer's top edge, directly under the omnibox (the desktop compose
          lives in the top bar). Carries structured send/upload failures and
          the minimal in-flight indicator. The mobile sheet keeps its error
          between the terminal and the compose strip. */}
      {!isMobile && (compose.error || compose.sending || compose.uploading) && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs shrink-0">
          {compose.error ? (
            <span role="alert" data-testid="operator-console-error" className="text-signal-red">
              {compose.error}
            </span>
          ) : (
            <span data-testid="operator-console-uploading" className="text-text-secondary">
              {compose.sending ? "sending…" : "uploading…"}
            </span>
          )}
        </div>
      )}
      {target && server ? (
        <>
          <div className="flex-1 min-h-0 flex flex-col px-1 py-0.5">
            <TerminalClient
              key={`${server}:${target.window.windowId}`}
              sessionName={target.sessionName}
              windowId={target.window.windowId}
              server={server}
              wsRef={wsRef}
              registerFocus={false}
              transparent={!isMobile}
            />
          </div>
          {isMobile && compose.error && (
            <div
              role="alert"
              data-testid="operator-console-error"
              className="px-3 py-1 text-xs text-signal-red border-t border-border shrink-0"
            >
              {compose.error}
            </div>
          )}
          {/* The compose strip — MOBILE ONLY. The one-input rule: on desktop
              the omnibox in the top bar is the input and the drawer is
              output-only; the sheet keeps its compose (no omnibox exists
              there; the strip is the OS-dictation target). Both drive the
              shared compose seam. */}
          {isMobile && (
            <div className="flex items-end gap-2 border-t border-border px-3 py-1.5 shrink-0">
              <textarea
                ref={composeRef}
                value={compose.text}
                rows={2}
                onChange={(e) => setOperatorComposeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendOperatorMessage(server, target, compose.text);
                  }
                }}
                placeholder="Ask the operator…  (Enter sends · Shift+Enter newline · paste an image to attach)"
                aria-label="Message the operator"
                className="flex-1 min-w-0 resize-none bg-transparent text-text-primary text-xs outline-none placeholder:text-text-secondary"
              />
              {compose.uploading && (
                <span
                  data-testid="operator-console-uploading"
                  className="text-xs text-text-secondary shrink-0 self-center"
                >
                  uploading…
                </span>
              )}
              <button
                type="button"
                onClick={() => void sendOperatorMessage(server, target, compose.text)}
                disabled={compose.sending || compose.text.trim() === ""}
                className="rk-glint shrink-0 inline-flex items-center justify-center rounded px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-secondary coarse:min-h-[36px] coarse:min-w-[36px]"
              >
                Send
              </button>
            </div>
          )}
        </>
      ) : (
        <div
          className="flex-1 min-h-0 flex items-center justify-center px-4 text-xs text-text-secondary"
          data-testid="operator-console-empty"
        >
          no operator on this server — run `rk operator`
        </div>
      )}
      {!isMobile && (
        <>
          {/* Side grips — symmetric width resize about the center line. */}
          <div
            data-testid="operator-console-grip-left"
            aria-hidden="true"
            onPointerDown={onGripPointerDown("left")}
            {...gripHandlers}
            className="absolute left-[-4px] top-0 h-full w-2 cursor-ew-resize touch-none"
          />
          <div
            data-testid="operator-console-grip-right"
            aria-hidden="true"
            onPointerDown={onGripPointerDown("right")}
            {...gripHandlers}
            className="absolute right-[-4px] top-0 h-full w-2 cursor-ew-resize touch-none"
          />
          {/* The tongue: a pull tab hanging from the drawer's bottom edge —
              the desktop height drag grip (on mobile the tongue is instead the
              standing affordance, mounted beside this console in app.tsx). */}
          <div
            data-testid="operator-console-grip-height"
            aria-hidden="true"
            onPointerDown={onGripPointerDown("height")}
            {...gripHandlers}
            className="absolute left-1/2 top-full h-3 w-16 -translate-x-1/2 cursor-ns-resize touch-none select-none"
          >
            <span
              className="block h-full w-full rounded-b-md border border-t-0 border-border"
              style={glassStyle}
            />
          </div>
        </>
      )}
    </div>
  );

  if (isMobile) return drawer;

  // The clip wrapper hides the raised portion of the drawer above the top-bar
  // seam during the slide (in-and-out); pointer events pass through except on
  // the drawer itself.
  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-clip">{drawer}</div>
  );
}

/**
 * The mobile standing affordance for the console — a centered pull tab hanging
 * under the top bar on every route (the desktop standing affordance is the
 * top-bar ◉ button; there is no bottom-bar chip). Mounted once beside the
 * console in the root layout so it renders while the console is closed; hidden
 * while the sheet is open (the sheet's own ✕ closes). Tap toggles the console
 * through the same document-event seam; an amber dot marks a waiting operator
 * on the resolved server.
 */
export function OperatorConsoleTongue() {
  const isMobile = useIsMobile();
  const open = useOperatorConsoleOpen();
  const { target } = useOperatorConsoleContext();
  if (!isMobile || open) return null;
  const waiting = target?.window.agentState === "waiting";
  return (
    <button
      type="button"
      data-testid="operator-console-tongue"
      aria-label="Operator console"
      onClick={() => requestOperatorConsole({ action: "toggle" })}
      // The visual tab is 64×12; the button's own box is the ≥36px hit area.
      className="absolute top-0 left-1/2 z-30 flex h-9 w-16 -translate-x-1/2 items-start justify-center"
    >
      <span className="relative block h-3 w-16 rounded-b-md border border-t-0 border-border bg-bg-primary">
        {waiting && (
          <span
            data-testid="operator-console-tongue-waiting"
            className="absolute right-1 top-0.5 block h-1.5 w-1.5 rounded-full bg-signal-yellow"
          />
        )}
      </span>
    </button>
  );
}
