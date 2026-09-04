import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMatches } from "@tanstack/react-router";
import { useSessionContext } from "@/contexts/session-context";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { TerminalClient } from "@/components/terminal-client";
import { sendToWindow } from "@/api/client";
import {
  OPERATOR_CONSOLE_EVENT,
  findOperatorWindow,
  isOperatorConsoleRequest,
  resolveConsoleServer,
} from "@/lib/operator-console";

/**
 * The operator chat console — a global pull-down overlay (drawer on desktop,
 * full-height sheet under the top bar on mobile) available on every route.
 * Mounted ONCE at the persistent root layout (app.tsx, beside the single
 * CommandPalette mount); every entry point — the registry chord, the palette
 * action, the palette's Ask-operator fallback row, the sidebar pinned row, the
 * mobile overflow-menu row — reaches it through the OPERATOR_CONSOLE_EVENT
 * document seam (lib/operator-console.ts).
 *
 * Anatomy: a title strip (OPERATOR · server, the operator window's live agent
 * state from the sessions payload, a server picker on param-less multi-server
 * routes, a close affordance), an embedded LIVE terminal view of the operator
 * window (a plain TerminalClient over the shared /ws/terminals relay mux — the
 * same mechanism a board pane uses, registerFocus off so the BottomBar keeps
 * its target), and a compose strip delivering through the existing
 * `sendToWindow(..., "submit", "agent")` lane with chat-send busy semantics
 * (allow + probe — no client-side busy gate, no template-queue interaction).
 * Structured send failures surface as an inline error line (never toasts —
 * the user is looking at this surface) and the composed text survives a
 * failure for retry/edit.
 *
 * Open/closed is ephemeral per-viewer component state (Constitution IV — no
 * URL, tmux, or localStorage write). Availability degrades to ABSENT: a server
 * with no operator window renders a single hint line and opens no stream.
 */
export function OperatorConsole() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [pinnedServer, setPinnedServer] = useState<string | null>(null);
  const [pickerServer, setPickerServer] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const { servers, sessionsByServer } = useSessionContext();

  // Route server — the same deepest-first route-param walk SessionContext's
  // useCurrentServerFromRoute and RootTopBar use (param names are unique
  // across the route tree).
  const matches = useMatches();
  let routeServer: string | null = null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const p = (matches[i]?.params ?? {}) as { server?: string };
    if (typeof p.server === "string" && p.server.length > 0) {
      routeServer = p.server;
      break;
    }
  }

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

  // Entry-point seam: chord dispatch, palette action, overflow-menu row,
  // sidebar pinned row, and the palette fallback row all dispatch here.
  useEffect(() => {
    function onRequest(e: Event) {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!isOperatorConsoleRequest(detail)) return;
      if (detail.action === "toggle") setOpen((v) => !v);
      else setOpen(true);
      if (detail.server) setPinnedServer(detail.server);
      if (detail.send !== undefined) setPendingSend(detail.send);
    }
    document.addEventListener(OPERATOR_CONSOLE_EVENT, onRequest);
    return () => document.removeEventListener(OPERATOR_CONSOLE_EVENT, onRequest);
  }, []);

  // Esc closes (bubble phase, so an already-claimed Escape — a nested modal's
  // — wins via defaultPrevented). The stream closes with the unmount; the
  // conversation itself lives in the operator window regardless.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus the compose input on open (fall back to the strip's first control
  // when the operator-absent hint is showing); restore prior focus on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      (composeRef.current ?? root.querySelector<HTMLElement>("button, select"))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (open) return;
    const el = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (el instanceof HTMLElement) el.focus();
  }, [open]);

  const target = useMemo(
    () => (server ? findOperatorWindow(sessionsByServer.get(server) ?? []) : undefined),
    [server, sessionsByServer],
  );

  const deliver = useCallback(
    async (value: string) => {
      if (!server || !target || sending) return;
      if (value.trim() === "") return;
      setSending(true);
      try {
        await sendToWindow(server, target.window.windowId, value, "submit", "agent");
        setText("");
        setSendError(null);
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Send failed");
      } finally {
        setSending(false);
      }
    },
    [server, target, sending],
  );
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  // The palette fallback row's pre-filled query: sent immediately once the
  // console is open and the operator window resolves. Dropped unsent when the
  // server has no operator — the hint line is the answer there.
  useEffect(() => {
    if (!open || pendingSend == null) return;
    setPendingSend(null);
    if (!target) return;
    void deliverRef.current(pendingSend);
  }, [open, pendingSend, target]);

  if (!open) return null;

  const agentState = target?.window.agentState;
  const agentIdle = target?.window.agentIdleDuration;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Operator console"
      data-testid="operator-console"
      className={
        isMobile
          ? "rk-console-drop absolute inset-0 z-40 flex flex-col bg-bg-primary"
          : "rk-console-drop absolute top-0 left-1/2 -translate-x-1/2 z-40 flex flex-col w-[min(760px,94vw)] h-[55vh] bg-bg-primary border border-t-0 border-border rounded-b-lg shadow-2xl"
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
          onClick={() => setOpen(false)}
          className="ml-auto text-text-secondary hover:text-text-primary transition-colors px-1"
        >
          ✕
        </button>
      </div>
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
            />
          </div>
          {sendError && (
            <div
              role="alert"
              data-testid="operator-console-error"
              className="px-3 py-1 text-xs text-signal-red border-t border-border shrink-0"
            >
              {sendError}
            </div>
          )}
          <div className="flex items-end gap-2 border-t border-border px-3 py-1.5 shrink-0">
            <textarea
              ref={composeRef}
              value={text}
              rows={2}
              onChange={(e) => {
                setText(e.target.value);
                setSendError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void deliverRef.current(text);
                }
              }}
              placeholder="Ask the operator…  (Enter sends · Shift+Enter newline)"
              aria-label="Message the operator"
              className="flex-1 min-w-0 resize-none bg-transparent text-text-primary text-xs outline-none placeholder:text-text-secondary"
            />
            <button
              type="button"
              onClick={() => void deliverRef.current(text)}
              disabled={sending || text.trim() === ""}
              className="text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-secondary px-1.5 py-1 shrink-0"
            >
              Send
            </button>
          </div>
        </>
      ) : (
        <div
          className="flex-1 min-h-0 flex items-center justify-center px-4 text-xs text-text-secondary"
          data-testid="operator-console-empty"
        >
          no operator on this server — run `rk operator`
        </div>
      )}
    </div>
  );
}
