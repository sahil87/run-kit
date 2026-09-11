import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  SessionContext,
  useSessionContext,
  useCurrentServerFromRoute,
} from "@/contexts/session-context";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { TerminalClient } from "@/components/terminal-client";
import { ConsoleSegments, type ConsoleSegment } from "@/components/terminal-activity-tabs";
import { CronList } from "@/components/cron-list";
import { CronLog } from "@/components/cron-log";
import { CronStaleBanner } from "@/components/cron-stale-banner";
import { WatchedTasks } from "@/components/watched-tasks";
import { Tip } from "@/components/tip";
import { formatDuration } from "@/lib/format";
import { useMatches, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { prefersReducedMotion } from "@/lib/motion";
import { resolveFocusedWindow } from "@/lib/focused-pane-window";
import { useOptionalToast } from "@/components/toast";
import { setComposeText } from "@/lib/compose-draft-store";
import { entryKey } from "@/store/window-store";
import {
  OPERATOR_CONSOLE_EVENT,
  attachOperatorFiles,
  clampConsoleGeometry,
  clearPendingConsoleRequest,
  cycleConsoleMachine,
  drainPendingConsoleRequest,
  findOperatorWindow,
  getConsoleMachineActivity,
  isOperatorConsoleRequest,
  isOperatorConsoleTarget,
  requestOperatorConsole,
  resolveConsoleServer,
  resolveFromOrigin,
  sendOperatorMessage,
  resetOperatorChatChip,
  setConsoleMachineState,
  setOperatorChatSubject,
  useConsoleGeometry,
  useConsoleMachineState,
  useConsoleOpacity,
  useOperatorCompose,
  useOperatorConsoleContext,
  type ConsoleGeometry,
  type OperatorConsoleRequest,
} from "@/lib/operator-console";

/** Slide duration — must match the `.rk-console-slide` transition in globals.css. */
const CONSOLE_SLIDE_MS = 240;

/** The operator-less hint is a toast; repeat activations within one toast
 *  lifetime must not stack duplicates (the toast itself times out at 4s). */
const NO_OPERATOR_HINT_THROTTLE_MS = 4000;

/** The established operator-absent message — the desktop drawer renders it as
 *  its hint line, mobile activations toast it. */
const NO_OPERATOR_HINT = "no operator on this server — run rk operator";

const ALREADY_ON_OPERATOR_HINT = "already viewing the operator — nothing to open";

/**
 * The operator chat console — a global pull-down drawer overlay on desktop,
 * available on every route. Mounted ONCE at the persistent root layout
 * (app.tsx, beside the single CommandPalette mount); every entry point — the
 * registry chord, the palette action, the palette's Ask-operator fallback row,
 * the mobile tongue, and the overflow-menu row — reaches it through the
 * OPERATOR_CONSOLE_EVENT
 * document seam (lib/operator-console.ts).
 *
 * The seam forks on form factor. Desktop runs the ⌘J two-state machine
 * (lib/operator-console.ts): rest ⇄ open (drawer down, omnibox focused —
 * focus and the expanded drawer are linked, so one chord engages both and the
 * next releases both). Enter in the omnibox sends; Esc releases to rest; the
 * palette action lands on the open+focused state; a click outside the
 * console's own DOM (the drawer or the omnibox) collapses to rest, same as the
 * header button. The machine is the controlling state — the drawer's internal
 * open flag follows it through the slide machinery.
 *
 * On MOBILE there is no drawer at all: every request resolves the operator
 * window and NAVIGATES to its ordinary terminal route, reusing that route's
 * chrome wholesale (the top-bar `Terminal: <window>` heading, the compose
 * strip, the bottom-bar key chips, the `--bottom-bar-pad` safe-area
 * handling). The palette fallback row's query is seeded into the operator
 * route's compose-strip draft instead of auto-sending, and a navigation from
 * a terminal route carries the origin window as `?from=` so the operator
 * route's compose strip keeps the templated chat lane behind its context
 * chip. A request against an operator-less server toasts the hint and stays
 * put. The component still mounts on mobile (the seam listener lives here)
 * but renders nothing; a desktop→mobile viewport flip resets the machine to
 * rest and tears down any in-flight slide state, so no effect or frame
 * survives the gate.
 *
 * Anatomy (desktop): a title strip (◉ OPERATOR · server, the operator
 * window's live agent state from the sessions payload, the operator loop's
 * tick-age stamp, a server picker on param-less multi-server routes, a
 * collapse affordance), an Operator Terminal | Operator Tasks | Cron List |
 * Cron Log segment header (the shared
 * `ConsoleSegments` strip from terminal-activity-tabs.tsx, driven by
 * console-local ephemeral state), and the body: on Operator Terminal an
 * embedded LIVE
 * terminal view of the operator window (a plain TerminalClient over the
 * shared /ws/terminals relay mux — the same mechanism a board pane uses,
 * registerFocus off so the BottomBar keeps its target, `transparent` on so
 * the glass background shows through the cells); on Operator Tasks the
 * `WatchedTasks` watchlist (the shared
 * `WatchedTable`, dense variant — a row click navigates through the router to
 * the window's terminal and collapses the drawer explicitly: the in-console
 * click bypasses the outside-click collapse, which stands down for
 * console-DOM clicks); on Cron List / Cron Log the
 * `CronStaleBanner` (mounted once above either cron body) over the `CronList`
 * or `CronLog` (inline variant — the entry detail sheet renders
 * in-container). On every non-terminal segment the TerminalClient is
 * UNMOUNTED, so the drawer holds at
 * most one relay stream. The one-input rule: the
 * compose IS the top-bar omnibox (components/operator-omnibox.tsx); the
 * drawer is output-only, carrying the inline status/error line at its top
 * edge, directly under the box. The omnibox drives the ONE shared compose
 * seam (lib/operator-console.ts) — same draft, same `sendToWindow(...,
 * "submit", "agent")` delivery with chat-send busy semantics (allow + probe —
 * no client-side busy gate), same upload path. Structured send failures
 * surface inline (never toasts) and the composed text survives a failure for
 * retry/edit.
 *
 * On a terminal route the compose carries a dismissable context chip (default
 * attached) naming the subject window — the route's window, or the validated
 * `?from=` origin on the operator window's own route; with it attached, sends
 * ride the templated chat lane (`sendOperatorRequest(server, subjectWindowId,
 * "user-message", text)` — a server-derived source envelope wraps the text,
 * the busy gate and queue are skipped server-side), otherwise the direct
 * lane. The console stamps the subject into the lib's chat-subject store; the
 * omnibox fork lives in `sendOperatorMessage` and the compose strip's
 * plain-submit fork keys on the same store, both read AT SEND TIME, so a
 * pendingSend delivered in the same commit as a chip reset sees the reset,
 * never a stale closure.
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
 * URL, tmux, or localStorage write beyond the ordinary route URL;
 * geometry/opacity are the carve-out preferences). Availability degrades to
 * ABSENT: a server with no operator window renders a single hint line and
 * opens no stream (mobile: a toast, and no navigation).
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
  // The drawer's body segment — console-local ephemeral state (no URL, tmux,
  // or localStorage write), defaulting to Operator Terminal and resetting on
  // close; a seam request carrying `segment` sets it on open.
  const [segment, setSegment] = useState<ConsoleSegment>("terminal");
  const rootRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const navigate = useNavigate();
  const toast = useOptionalToast();
  const noOperatorHintAtRef = useRef(0);
  const alreadyOnOperatorHintAtRef = useRef(0);

  const { servers, sessionsByServer } = useSessionContext();

  // Route server — the shared deepest-first route-param walk (param names are
  // unique across the route tree).
  const routeServer = useCurrentServerFromRoute();
  // Route window — the same deepest-first walk over the window param: a
  // terminal route yields the console's chat subject (or, on the operator
  // window's own route, the `?from=` origin does), every other route none.
  const matches = useMatches();
  let routeWindow: string | null = null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const p = (matches[i]?.params ?? {}) as { window?: string };
    if (typeof p.window === "string" && p.window.length > 0) {
      routeWindow = p.window;
      break;
    }
  }
  // The mobile navigation arm's origin-context carrier (the `?layout=` idiom:
  // raw string, validated against the sessions payload at stamp time).
  const search = useSearch({ strict: false });

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
    setSegment("terminal");
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    // Mobile never slides (there is no drawer) and reduced motion skips the
    // mounted-through-exit delay entirely (the CSS transition is zeroed too).
    if (isMobileRef.current || prefersReducedMotion()) {
      setClosing(false);
      setOpen(false);
      setEntered(false);
      setSegment("terminal");
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
  // close).
  const prevMachineRef = useRef(machine);
  useEffect(() => {
    const prev = prevMachineRef.current;
    prevMachineRef.current = machine;
    if (machine === "open" && prev !== "open") openDrawer();
    else if (machine !== "open" && prev === "open") requestCloseRef.current();
  }, [machine, openDrawer]);

  // Mobile arm: every console request — from any entry point, all three
  // actions collapse into this — resolves the operator window and navigates
  // to its ordinary terminal route (there is no sheet to open). A navigation
  // from a terminal route on the same server carries the origin window as
  // `?from=` (never the operator window itself); re-activating while ALREADY
  // on the target operator route skips the navigate entirely, so the
  // existing `?from=` (and the chip it feeds) survives. A request carrying
  // any non-terminal `segment` instead maps to the route's `?tab=<segment>`
  // search param (merged with `?from=`; an in-place search update when
  // already on the route) — one rule for every drawer-only view. The palette
  // fallback
  // row's query seeds the operator route's compose-strip draft rather than
  // auto-sending, and an operator-less server toasts the hint (throttled to
  // one per toast lifetime) without navigating. Held in a ref so the
  // once-registered seam listener below always reads current-render values.
  const mobileRequestRef = useRef<(detail: OperatorConsoleRequest) => void>(() => {});
  mobileRequestRef.current = (detail) => {
    const srv =
      detail.server ?? resolveConsoleServer(routeServer, serverNames, lastViewedRef.current);
    const tgt = srv ? findOperatorWindow(sessionsByServer.get(srv) ?? []) : undefined;
    if (!srv || !tgt) {
      const now = Date.now();
      if (now - noOperatorHintAtRef.current >= NO_OPERATOR_HINT_THROTTLE_MS) {
        noOperatorHintAtRef.current = now;
        toast?.addToast(NO_OPERATOR_HINT, "info");
      }
      return;
    }
    const onOperatorRoute = routeServer === srv && routeWindow === tgt.window.windowId;
    const requestedTab =
      detail.segment !== undefined && detail.segment !== "terminal" ? detail.segment : undefined;
    if (requestedTab !== undefined) {
      // A non-terminal segment maps to the operator route's `?tab=` search
      // param — merged with the `?from=` origin carrier on a cross-
      // route navigation, an in-place search update when already there.
      if (onOperatorRoute) {
        navigate({
          to: ".",
          search: (prev) => ({ ...prev, tab: requestedTab }),
          replace: true,
        });
      } else {
        const from = routeServer === srv && routeWindow !== null ? routeWindow : undefined;
        navigate({
          to: "/$server/$window",
          params: { server: srv, window: tgt.window.windowId },
          search: from ? { from, tab: requestedTab } : { tab: requestedTab },
        });
      }
    } else if (!onOperatorRoute) {
      const from = routeServer === srv && routeWindow !== null ? routeWindow : undefined;
      navigate({
        to: "/$server/$window",
        params: { server: srv, window: tgt.window.windowId },
        search: from ? { from } : {},
      });
    }
    if (detail.send !== undefined) {
      setComposeText(entryKey(srv, tgt.window.windowId), detail.send);
    }
  };

  // Entry-point seam: chord dispatch, palette action, tongue, overflow-menu
  // row and the palette fallback row all
  // dispatch here. Mobile navigates (the arm above); desktop `toggle` steps
  // the two-state machine, and `open` always opens with the omnibox focused.
  // While the resolved operator route is already current, every desktop
  // action stops here with one throttled hint instead of changing any console
  // state — EXCEPT a request carrying a non-terminal segment: those views
  // exist only inside the drawer on desktop, so the drawer must open to show
  // them.
  useEffect(() => {
    function handleRequest(detail: OperatorConsoleRequest) {
      // Handled — clear the seam's buffer so a later mount cannot replay it.
      clearPendingConsoleRequest();
      if (isMobileRef.current) {
        mobileRequestRef.current(detail);
        return;
      }
      if (
        onOperatorRouteRef.current &&
        (detail.segment === undefined || detail.segment === "terminal")
      ) {
        const now = Date.now();
        if (now - alreadyOnOperatorHintAtRef.current >= NO_OPERATOR_HINT_THROTTLE_MS) {
          alreadyOnOperatorHintAtRef.current = now;
          toastRef.current?.addToast(ALREADY_ON_OPERATOR_HINT, "info");
        }
        return;
      }
      const state = machineRef.current;
      if (detail.action === "toggle") {
        setConsoleMachineState(cycleConsoleMachine(state));
      } else {
        setConsoleMachineState("open");
      }
      if (detail.server) setPinnedServer(detail.server);
      if (detail.send !== undefined) setPendingSend(detail.send);
      // The requested segment applies AFTER the machine transition, so an
      // open-with-segment request lands on it directly.
      if (detail.segment !== undefined) setSegment(detail.segment);
    }
    function onRequest(e: Event) {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!isOperatorConsoleRequest(detail)) return;
      handleRequest(detail);
    }
    document.addEventListener(OPERATOR_CONSOLE_EVENT, onRequest);
    // Mount drain: this module loads lazily behind Suspense, so a request
    // dispatched before the listener attached (a cold `?tab=log` deep
    // link) sits in the seam's buffer — replay it now.
    const pending = drainPendingConsoleRequest();
    if (pending) handleRequest(pending);
    return () => document.removeEventListener(OPERATOR_CONSOLE_EVENT, onRequest);
  }, []);

  // The gate owns the frames AND the effects: a desktop→mobile flip resets
  // the machine and tears down any in-flight slide state, so the drawer, its
  // timers, and its poses never survive onto mobile.
  useEffect(() => {
    if (!isMobile) return;
    setConsoleMachineState("rest");
    finishClose();
  }, [isMobile, finishClose]);

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

  // Esc releases the machine (bubble phase, so an already-claimed Escape — a
  // nested modal's — wins via defaultPrevented): the drawer closes and the
  // omnibox blur + focus restore is the omnibox's machine-follower effect.
  // Owning the release here — rather than letting the omnibox input handle
  // its own Esc — keeps one Esc from being handled twice. The stream closes
  // with the unmount; the conversation itself lives in the operator window
  // regardless.
  useEffect(() => {
    if (!open && machine === "rest") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog layer nested INSIDE the drawer (the inline cron entry sheet)
      // owns this Escape — it dismisses the sheet, never collapses the drawer.
      // A DOM check, not `defaultPrevented`: this listener was registered when
      // the drawer opened, so it runs before the nested layer's focus trap.
      if (rootRef.current?.querySelector('[role="dialog"]')) return;
      if (machineRef.current !== "rest") setConsoleMachineState("rest");
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, machine]);

  // Click outside: the drawer is a peek that survives omnibox blur (see
  // above), so it never closes on its own — a click landing outside the
  // console's own DOM (the drawer + the top-bar omnibox both carry
  // OPERATOR_CONSOLE_ROOT_ATTR) collapses it, same destination as the header
  // button. Two things a plain "collapse on any outside click" would get
  // wrong, both handled below by DEFERRING the decision rather than acting
  // inline:
  //   (1) An entry-point trigger outside the console's DOM (a palette or menu
  //       opener's retarget) reads and
  //       re-writes the machine itself in response to the SAME click — the
  //       collapse must never race that write. Capturing
  //       `getConsoleMachineActivity()` in the CAPTURE phase (before the
  //       trigger's own bubble-phase onClick runs) and re-checking it after a
  //       macrotask settle catches this: if the trigger's handler already
  //       changed activity — even a same-VALUE re-open while already `open`,
  //       which is a no-op by value but still
  //       increments activity — this handler backs off and leaves whatever
  //       that handler decided standing.
  //   (2) A click that opens an unrelated modal (the settings dialog, the
  //       command palette) is outside the console's DOM but must NOT
  //       collapse it — the settings dialog in particular needs the console
  //       to stay open so its opacity control can live-apply. The trigger
  //       trigger itself may carry no console marker, so
  //       this checks for ANY currently-open `role="dialog"` at settle time
  //       instead of the clicked target's ancestry — a modal owns the
  //       interaction while open, so the console holding still behind it is
  //       the correct call regardless of where inside (or outside) the
  //       dialog the click landed.
  // A macrotask (not a microtask) is the settle mechanism: it runs after
  // React has committed and painted the triggering click's own state update
  // (mounting the settings dialog's DOM, or the opener's own
  // re-render), which a same-tick microtask cannot reliably guarantee.
  useEffect(() => {
    if (machine !== "open") return;
    function onClickCapture(e: MouseEvent) {
      if (isOperatorConsoleTarget(e.target)) return;
      const activityAtClick = getConsoleMachineActivity();
      setTimeout(() => {
        if (getConsoleMachineActivity() !== activityAtClick) return;
        // The drawer itself carries role="dialog" — only an UNRELATED open
        // dialog (settings, palette) should hold the collapse back.
        const dialogs = document.querySelectorAll('[role="dialog"]');
        for (const d of dialogs) {
          if (!isOperatorConsoleTarget(d)) return;
        }
        setConsoleMachineState("rest");
      }, 0);
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [machine]);

  const rendered = open || closing;

  const target = useMemo(
    () => (server ? findOperatorWindow(sessionsByServer.get(server) ?? []) : undefined),
    [server, sessionsByServer],
  );

  // The chat subject. On an ordinary terminal route it is the route's window;
  // on the operator window's OWN route it is the validated `?from=` origin
  // window (the mobile navigation's context carrier — the numeric segment
  // form is accepted like the path parse, and an unknown, cross-server, or
  // self id attaches nothing: a subject must never be the send's own target).
  // Either way it attaches only when the console's resolved server IS the
  // route's server (a pinned/picked cross-server retarget must not attach a
  // foreign window id — window ids are server-scoped). Stamped into the lib's
  // chat-subject store — both compose surfaces render the chip from it, and
  // the send forks read it AT SEND TIME, so a pendingSend delivered in the
  // same commit as a reset sees the reset, never a stale closure.
  const onTerminalRoute = routeServer !== null && routeWindow !== null && server === routeServer;
  const onOperatorRoute =
    onTerminalRoute && target !== undefined && routeWindow === target.window.windowId;
  const onOperatorRouteRef = useRef(onOperatorRoute);
  onOperatorRouteRef.current = onOperatorRoute;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const fromWindow = useMemo(() => {
    if (!onOperatorRoute || !server) return null;
    return resolveFromOrigin(search.from, routeWindow, sessionsByServer.get(server) ?? []);
  }, [onOperatorRoute, server, search.from, routeWindow, sessionsByServer]);
  const subjectWindowId = !onTerminalRoute
    ? null
    : onOperatorRoute
      ? (fromWindow?.windowId ?? null)
      : routeWindow;
  const subjectName = useMemo(() => {
    if (!subjectWindowId || !server) return null;
    return resolveFocusedWindow(sessionsByServer.get(server) ?? [], subjectWindowId)?.name ?? null;
  }, [subjectWindowId, server, sessionsByServer]);
  useEffect(() => {
    setOperatorChatSubject(
      subjectWindowId && server ? { server, windowId: subjectWindowId, name: subjectName } : null,
    );
  }, [server, subjectWindowId, subjectName]);

  // Chip dismissal is scoped to one engagement: re-engaging the console — the
  // machine leaving rest — re-attaches the context (Constitution IV ephemeral
  // state; subject changes reset inside the store itself, which is what
  // re-attaches the chip on mobile route arrivals).
  const engaged = open || machine !== "rest";
  const prevEngagedRef = useRef(engaged);
  useEffect(() => {
    if (engaged && !prevEngagedRef.current) resetOperatorChatChip();
    prevEngagedRef.current = engaged;
  }, [engaged]);
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

  // Desktop-only render: the mobile arm is navigation (the seam listener
  // above), so nothing mounts below the shared isMobile rule.
  if (!rendered || isMobile) return null;

  const agentState = target?.window.agentState;
  const agentIdle = target?.window.agentIdleDuration;

  // The title-strip tick-age stamp reads the FIRST session on the resolved
  // server carrying `operatorLastTickAt > 0`; operator-less servers and older
  // backends carry no field and render nothing. Render-time only — the
  // sessions SSE cadence is the clock, never a timer.
  const tickSession = server
    ? sessionsByServer.get(server)?.find((s) => (s.operatorLastTickAt ?? 0) > 0)
    : undefined;
  const tickStale = tickSession?.operatorStale === true;
  const tickAge = tickSession
    ? formatDuration(Math.max(0, Math.floor(Date.now() / 1000) - (tickSession.operatorLastTickAt ?? 0)))
    : null;

  // Glass: alpha-blended bg-primary over a fixed 6px backdrop blur. α=1
  // disables the filter entirely: the zero-cost opaque path.
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
        // Cancel every dragover — not just file drags — so the drop handler
        // below always fires and can swallow non-file drops; a URL/text drop
        // left to the browser's default navigates away from the page.
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        void attachOperatorFiles(server, target, files);
      }}
      className={`rk-console-slide pointer-events-auto absolute top-0 left-1/2 -translate-x-1/2 flex flex-col border border-t-0 border-border rounded-b-lg shadow-2xl${
        entered && !closing ? "" : " rk-console-closed"
      }${dragging ? " rk-console-dragging" : ""}`}
      style={{
        // maxWidth (not a min() width) so the 96vw ceiling keeps
        // tracking live viewport resizes.
        width: `${effectiveGeometry.widthPx}px`,
        maxWidth: "96vw",
        height: `${effectiveGeometry.heightVh}vh`,
        ...glassStyle,
      }}
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
        {tickSession && tickAge !== null && (
          <Tip
            label={tickStale ? `Operator last ticked ${tickAge} ago` : undefined}
            placement="bottom"
          >
            <span
              data-testid="operator-console-tick"
              className={tickStale ? "text-signal-yellow" : "text-text-secondary"}
            >
              {tickStale ? "⚠ " : ""}· tick {tickAge} ago
            </span>
          </Tip>
        )}
        <button
          type="button"
          aria-label="Collapse operator console"
          onClick={() => setConsoleMachineState("rest")}
          className="rk-glint ml-auto shrink-0 inline-flex items-center justify-center rounded px-1 text-text-secondary hover:text-text-primary transition-colors coarse:min-h-[36px] coarse:min-w-[36px]"
        >
          ▼
        </button>
      </div>
      {/* The drawer's Operator Terminal | Operator Tasks | Cron List |
          Cron Log segment header — the shared presentational strip
          (terminal-activity-tabs.tsx), driven here by console-local state
          instead of the mobile route's `tab` param. */}
      <ConsoleSegments value={segment} onChange={setSegment} />
      {/* The status line: the inline-error contract relocated to the
          drawer's top edge, directly under the omnibox (the desktop compose
          lives in the top bar). Carries structured send/upload failures and
          the minimal in-flight indicator. */}
      {(compose.error || compose.sending || compose.uploading) && (
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
      {segment !== "terminal" ? (
        segment === "tasks" ? (
          // One relay stream max per drawer: the TerminalClient is UNMOUNTED
          // while Operator Tasks shows. A row click navigates through the
          // router to the window's terminal route and collapses the drawer
          // explicitly — the outside-click collapse stands down for clicks
          // inside the console's DOM, so the handler drives the machine to
          // rest itself.
          <WatchedTasks
            server={server ?? ""}
            sessions={server ? (sessionsByServer.get(server) ?? []) : []}
            onNavigate={(windowId) => {
              if (!server) return;
              void navigate({
                to: "/$server/$window",
                params: { server, window: windowId },
                // Empty search: the destination window resolves its own stored
                // layout (the cross-server sidebar-select form).
                search: {},
              });
              setConsoleMachineState("rest");
            }}
            dense
          />
        ) : (
          // Same one-relay-stream rule for the cron tabs (the keyed remount
          // on switching back is cheap). The stale banner mounts ONCE above
          // either cron body; an unresolved server renders the tab's own
          // hint line.
          <>
            <CronStaleBanner server={server ?? ""} />
            {segment === "list" ? (
              <CronList server={server ?? ""} inline />
            ) : (
              <CronLog server={server ?? ""} inline />
            )}
          </>
        )
      ) : target && server ? (
        <div className="flex-1 min-h-0 flex flex-col px-1 py-0.5">
          <TerminalClient
            key={`${server}:${target.window.windowId}`}
            sessionName={target.sessionName}
            windowId={target.window.windowId}
            server={server}
            wsRef={wsRef}
            registerFocus={false}
            transparent
          />
        </div>
      ) : (
        <div
          className="flex-1 min-h-0 flex items-center justify-center px-4 text-xs text-text-secondary"
          data-testid="operator-console-empty"
        >
          {NO_OPERATOR_HINT}
        </div>
      )}
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
    </div>
  );

  // The clip wrapper hides the raised portion of the drawer above the top-bar
  // seam during the slide (in-and-out); pointer events pass through except on
  // the drawer itself.
  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-clip">{drawer}</div>
  );
}

/**
 * The mobile standing affordance for the operator — a centered pull tab
 * hanging under the top bar on every route (the desktop standing affordance
 * is the omnibox; there is no bottom-bar chip). Mounted once beside
 * the console in the root layout. The tongue is a TOGGLE: on every other
 * route a tap dispatches through the document-event seam, which on mobile
 * navigates to the operator window's terminal route (amber dot when the
 * operator is waiting); on the operator window's OWN route it renders in a
 * return state (`data-tongue-state="return"`, a ⌃ mark in the tab, dot
 * suppressed — the user is already looking at the operator) and a tap
 * navigates BACK: the validated `?from=` origin window when present, else
 * browser history when an entry plausibly exists, else the server route. An
 * unknown, cross-server, or self `?from=` falls through rather than
 * navigating to a dead window. Hidden when no operator window resolves
 * (omitted, not disabled).
 */
export function OperatorConsoleTongue() {
  const isMobile = useIsMobile();
  const { server, target } = useOperatorConsoleContext();
  const sessionsByServer = useContext(SessionContext)?.sessionsByServer;
  const routeServer = useCurrentServerFromRoute();
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ strict: false });
  const matches = useMatches();
  let routeWindow: string | null = null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const p = (matches[i]?.params ?? {}) as { window?: string };
    if (typeof p.window === "string" && p.window.length > 0) {
      routeWindow = p.window;
      break;
    }
  }
  if (!isMobile || !target) return null;
  // Window ids are server-scoped, so the operator-route check needs the
  // server to match too.
  const onOperatorRoute = routeServer === server && routeWindow === target.window.windowId;
  if (onOperatorRoute) {
    const onReturn = () => {
      if (server) {
        const origin = resolveFromOrigin(search.from, routeWindow, sessionsByServer?.get(server) ?? []);
        if (origin) {
          void navigate({
            to: "/$server/$window",
            params: { server, window: origin.windowId },
            search: {},
          });
          return;
        }
      }
      // A cold deep-link (PWA start) has no back entry; history.length is the
      // best available probe — back() with nothing there would be a dead tap.
      if (window.history.length > 1) {
        router.history.back();
        return;
      }
      if (server) void navigate({ to: "/$server", params: { server } });
    };
    return (
      <button
        type="button"
        data-testid="operator-console-tongue"
        data-tongue-state="return"
        aria-label="Back to previous window"
        onClick={onReturn}
        // The visual tab is 64×12; the button's own box is the ≥36px hit area.
        className="absolute top-0 left-1/2 z-30 flex h-9 w-16 -translate-x-1/2 items-start justify-center"
      >
        <span className="relative flex h-3 w-16 items-center justify-center rounded-b-md border border-t-0 border-border bg-bg-primary">
          <span aria-hidden="true" className="text-[10px] leading-none text-text-secondary">
            ⌃
          </span>
        </span>
      </button>
    );
  }
  const waiting = target.window.agentState === "waiting";
  return (
    <button
      type="button"
      data-testid="operator-console-tongue"
      data-tongue-state="operator"
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
