import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebglAddon } from "@xterm/addon-webgl";
import { useEffect, useRef, useCallback, useState } from "react";
import { useTheme } from "@/contexts/theme-context";
import { useChromeState, useChromeDispatch } from "@/contexts/chrome-context";
import { useFocusedTerminal } from "@/contexts/focused-terminal-context";
import { deriveXtermTheme } from "@/themes";
import { dispatchComposeStripAttach } from "@/lib/compose-strip-events";
import { copyToClipboard } from "@/lib/clipboard";
import { notifyFirstWrite } from "@/lib/window-transition";
import { relayMux, type RelayStream } from "@/lib/relay-mux";

/**
 * Custom ClipboardProvider for the xterm.js ClipboardAddon.
 * Accepts both "" (empty/default) and "c" (explicit clipboard) as valid OSC 52
 * selection targets. Tmux sends "" by default; the built-in provider only accepts "c".
 */
export const clipboardProvider = {
  async readText(selection: string): Promise<string> {
    if (selection !== "c" && selection !== "") return "";
    return navigator.clipboard.readText();
  },
  async writeText(selection: string, text: string): Promise<void> {
    if (selection !== "c" && selection !== "") return;
    await navigator.clipboard.writeText(text);
  },
};

/**
 * Test-only terminal registry. The echo-latency e2e harness needs a handle to
 * the live `Terminal` instance to poll `term.buffer.active` for the echoed
 * glyph (the WebGL canvas is not DOM-readable). We expose instances on
 * `window.__rkTerminals`, keyed by windowId, so a Playwright `page.evaluate`
 * can reach them. Kept tiny and symmetric (register on create, unregister on
 * dispose) so a stale handle never points at a disposed terminal.
 *
 * Gated on `import.meta.env.DEV`: this is populated ONLY in dev/e2e builds
 * (Vite's dev server, which is what `just dev` / the e2e harness run against),
 * never in a production `vite build`. So production bundles do not expose live
 * Terminal instances on `window` at all — the helpers compile to no-ops there.
 */
declare global {
  interface Window {
    __rkTerminals?: Record<string, import("@xterm/xterm").Terminal>;
    /** Active renderer per windowId — "webgl" until a context-loss demotes it. */
    __rkRenderer?: Record<string, "webgl" | "canvas">;
  }
}

function registerTestTerminal(windowId: string, terminal: import("@xterm/xterm").Terminal) {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  (window.__rkTerminals ??= {})[windowId] = terminal;
}

function unregisterTestTerminal(windowId: string) {
  if (!import.meta.env.DEV || typeof window === "undefined" || !window.__rkTerminals) return;
  delete window.__rkTerminals[windowId];
}

/** Record which renderer is live for `windowId` (read by the latency harness). */
function setActiveRenderer(windowId: string, renderer: "webgl" | "canvas") {
  if (typeof window === "undefined") return;
  (window.__rkRenderer ??= {})[windowId] = renderer;
}

function unsetActiveRenderer(windowId: string) {
  if (typeof window === "undefined" || !window.__rkRenderer) return;
  delete window.__rkRenderer[windowId];
}

/**
 * The muxed relay adapter surfaced through `wsRef` is WebSocket-shaped but adds
 * a dedicated `resize(cols, rows)` op so terminal-grid resizes travel on their
 * OWN channel — NOT muxed into `send()`, which carries raw terminal input
 * (keystrokes, SGR scroll, pasted text). Sniffing `send()` payloads for a
 * `{type:"resize"}` shape would let a paste that happens to contain that JSON be
 * swallowed as a resize instead of reaching the PTY. Optional so a plain
 * `WebSocket` (pre-mux / tests) still satisfies the type; `fitAndSync` falls
 * back to the JSON control frame when `resize` is absent.
 */
type ResizableSocket = WebSocket & {
  resize?: (cols: number, rows: number) => void;
};

type TerminalClientProps = {
  sessionName: string;
  windowId: string;
  server: string;
  wsRef: React.MutableRefObject<WebSocket | null>;
  onSessionNotFound?: () => void;
  focusRef?: React.MutableRefObject<(() => void) | null>;
  scrollLocked?: boolean;
  /**
   * When `true` (default), this terminal registers itself as the focused
   * terminal on mount so the shell-level BottomBar targets it. Set to
   * `false` for board panes — BoardPane handles registration based on its
   * own focused-pane state so multiple TerminalClients in a board don't
   * fight over the focused-terminal slot.
   */
  registerFocus?: boolean;
};

export function TerminalClient({
  sessionName,
  windowId,
  server,
  wsRef,
  onSessionNotFound,
  focusRef,
  scrollLocked,
  registerFocus = true,
}: TerminalClientProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const { theme: activeTheme } = useTheme();
  const { terminalFontSize, composeStripEnabled } = useChromeState();
  const { toggleComposeStrip } = useChromeDispatch();
  const { setFocused } = useFocusedTerminal();

  // Register this terminal as the BottomBar's focused input target. The
  // single-terminal route trivially has only one terminal — this is the
  // explicit form of the focus relationship that previously was implicit
  // through prop drilling. On unmount we clear so a stale ref isn't read
  // by a subsequent route's BottomBar before its own TerminalClient mounts.
  // BoardPane passes `registerFocus={false}` and handles registration itself
  // based on its focused-pane state.
  useEffect(() => {
    if (!registerFocus) return;
    setFocused({ wsRef, server, session: sessionName, windowId });
    return () => {
      setFocused(null);
    };
  }, [registerFocus, setFocused, wsRef, server, sessionName, windowId]);

  // Refit the terminal to its container and tell tmux the new grid size. The
  // resize message is the ONLY way the backend learns the new cols/rows, so
  // every fit() must be paired with it — otherwise tmux keeps rendering at the
  // old grid (stale columns, dead space) until a remount. Used by both the
  // container ResizeObserver and the font-size effect.
  const fitAndSync = useCallback(() => {
    fitAddonRef.current?.fit();
    xtermRef.current?.scrollToBottom();
    const term = xtermRef.current;
    const ws = wsRef.current as ResizableSocket | null;
    if (ws?.readyState === WebSocket.OPEN && term) {
      // Prefer the adapter's dedicated resize op — resizes must NOT share the
      // `send()` input channel (a paste containing resize JSON would be
      // swallowed). Fall back to the JSON control frame only for a plain
      // WebSocket that lacks `resize` (pre-mux / tests).
      if (ws.resize) {
        ws.resize(term.cols, term.rows);
      } else {
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
      }
    }
  }, [wsRef]);

  // Forward dropped/pasted files to the docked compose strip. The strip owns
  // the upload (scoped to the live focused target's worktree) and its own
  // draft/attachment state — terminal-client only enables the strip preference
  // (if off) and hands off the raw files. This replaces the old
  // upload-then-open-modal flow.
  const attachToStrip = useCallback(
    (files: FileList) => {
      if (files.length === 0) return;
      if (!composeStripEnabled) toggleComposeStrip();
      dispatchComposeStripAttach(Array.from(files));
    },
    [composeStripEnabled, toggleComposeStrip],
  );

  // Clipboard paste interception for file upload
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      attachToStrip(files);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [attachToStrip]);

  // Drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = e.dataTransfer.files;
      if (files.length === 0) return;
      attachToStrip(files);
    },
    [attachToStrip],
  );

  // xterm.js init — mount only, creates terminal instance and resize observer.
  // WebSocket connection is handled by the separate effect below.
  useEffect(() => {
    let cancelled = false;
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let resizeRafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      if (!terminalRef.current) return;

      // Effective font size from ChromeContext (stored preference, else the
      // device default). Read at mount; subsequent changes are applied by the
      // dedicated terminalFontSize effect below (this init effect is mount-only).
      const fontPx = terminalFontSize;

      // Ensure the bundled webfont is loaded before xterm measures cell
      // dimensions. xterm.js measures once at open() and does not re-measure
      // when fonts arrive later, so fallback metrics would persist as
      // misaligned glyphs. Load all three weights concurrently, but do not
      // block terminal startup indefinitely if the FontFaceSet API is
      // unavailable or a font request stalls (e.g., proxy blackholes .woff2).
      if (typeof document.fonts?.load === "function") {
        const FONT_LOAD_TIMEOUT_MS = 3000;
        const fontLoads = Promise.all([
          document.fonts.load(`${fontPx}px "MonaspiceNe Nerd Font Mono"`),
          document.fonts.load(`bold ${fontPx}px "MonaspiceNe Nerd Font Mono"`),
          document.fonts.load(`italic ${fontPx}px "MonaspiceNe Nerd Font Mono"`),
        ]);
        const timeout = new Promise<void>((resolve) => {
          window.setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
        });
        // Proceed with the fallback font stack if font loading fails or stalls.
        await Promise.race([fontLoads, timeout]).catch(() => undefined);
      }

      // Component unmounted while awaiting font loads
      if (cancelled || !terminalRef.current) return;

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily: '"MonaspiceNe Nerd Font Mono", ui-monospace, monospace',
        fontSize: fontPx,
        theme: deriveXtermTheme(activeTheme.palette),
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);
      fitAddon.fit();
      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // (The test-only registry is keyed on `windowId`, which can change while
      // this terminal stays mounted — see the dedicated effect below, which
      // re-keys register/unregister on windowId so the registry never goes
      // stale. The init effect deliberately does NOT register here.)

      // Clipboard addon — enriched clipboard support
      terminal.loadAddon(new ClipboardAddon(undefined, clipboardProvider));

      // Clickable URLs
      terminal.loadAddon(new WebLinksAddon());

      // xterm defaults to Unicode 6 width tables, but tmux lays out its buffer
      // using wcwidth (Unicode 14/15). Without this addon, emojis tmux treats
      // as 2 cells wide land in 1-cell slots and subsequent glyphs overlap.
      // Must load before WebGL so the renderer measures cells against the
      // correct table on first paint.
      terminal.loadAddon(new UnicodeGraphemesAddon());
      terminal.unicode.activeVersion = "15-graphemes";

      // GPU-accelerated rendering (silent fallback to canvas). The module is
      // statically imported (resolved at chunk load), but WebGL context
      // creation can still throw at runtime — keep the guard around it.
      //
      // Two robustness additions over a bare load:
      //  1. Record the active renderer ("webgl" | "canvas") on a window hook so
      //     the latency harness can ASSERT WebGL is live — a silent canvas
      //     fallback renders slower, and without this we'd never know it
      //     happened (the whole point of the latency work is to not regress
      //     blind).
      //  2. Handle `onContextLoss`: a WebGL context can be lost AFTER successful
      //     creation (tab backgrounding, GPU reset, driver hiccup). When that
      //     happens the addon stops painting and the terminal FREEZES unless we
      //     dispose it — disposing drops xterm back to its DOM/canvas renderer,
      //     which keeps working. Correctness, not latency.
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          // Drop to the fallback renderer so output keeps flowing.
          try { webgl.dispose(); } catch { /* already disposing */ }
          setActiveRenderer(windowId, "canvas");
        });
        terminal.loadAddon(webgl);
        setActiveRenderer(windowId, "webgl");
      } catch {
        // canvas renderer continues working
        setActiveRenderer(windowId, "canvas");
      }

      // Keyboard input → current WebSocket (wsRef always points to latest)
      terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN)
          wsRef.current.send(data);
      });

      // Cmd+C / Ctrl+C: copy selection instead of sending SIGINT
      // Local const narrows the type for the closure (outer `terminal` is T | null).
      const term = terminal;
      term.attachCustomKeyEventHandler((event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === "c" &&
          event.type === "keydown"
        ) {
          if (term.hasSelection()) {
            const text = term.getSelection();
            void copyToClipboard(text).finally(() => {
              term.clearSelection();
            });
            return false;
          }
        }
        return true;
      });

      resizeObserver = new ResizeObserver(() => {
        if (cancelled) return;
        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          if (cancelled) return;
          resizeRafId = null;
          fitAndSync();
        });
      });

      // Guard against unmount during terminal setup. The addon section above is
      // now synchronous (static imports), so this single post-construction check
      // before setTerminalReady disposes a terminal orphaned by an unmount that
      // raced the font-load await.
      if (cancelled || !terminalRef.current) {
        try { terminal.dispose(); } catch { /* WebGL addon may throw during teardown */ }
        return;
      }

      resizeObserver.observe(terminalRef.current);
      if (focusRef) focusRef.current = () => xtermRef.current?.focus();
      setTerminalReady(true);
    }

    init();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (resizeRafId) cancelAnimationFrame(resizeRafId);
      // Close any active WS on true unmount
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (focusRef) focusRef.current = null;
      // Note: __rkTerminals register/unregister moved to the dedicated
      // windowId-keyed effect below. __rkRenderer is set at WebGL-load time in
      // this init effect, so its cleanup stays here.
      unsetActiveRenderer(windowId);
      xtermRef.current = null;
      fitAddonRef.current = null;
      try { terminal?.dispose(); } catch { /* WebGL addon may throw during teardown */ }
      setTerminalReady(false);
    };
  }, [wsRef, focusRef]);

  // Apply terminal-font CHANGES to the live xterm instance. The font size lives
  // in ChromeContext (global, all terminals react), so when the user steps or
  // resets it, set the option then fitAndSync so xterm recomputes rows×cols AND
  // tells tmux the new grid — a font change does NOT resize the container, so
  // the ResizeObserver never fires; without the explicit sync tmux would keep
  // rendering at the old grid (stale columns, dead space) until a remount.
  //
  // Skips the first run after (re)mount: the init effect already constructs the
  // terminal at the current size and fits it, so re-fitting + re-sending resize
  // here would be redundant (and would fire before the WebSocket is open). Only
  // an actual post-mount change of `terminalFontSize` needs this path.
  const lastAppliedFontSize = useRef<number | null>(null);
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    if (lastAppliedFontSize.current === terminalFontSize) return;
    const isFirstRun = lastAppliedFontSize.current === null;
    lastAppliedFontSize.current = terminalFontSize;
    if (isFirstRun) return; // init effect already applied the mount-time size
    term.options.fontSize = terminalFontSize;
    fitAndSync();
  }, [terminalFontSize, terminalReady, fitAndSync]);

  // Test-only registry, keyed on the CURRENT windowId. The init effect runs
  // mount-only (deps [wsRef, focusRef]), but `windowId` can change while this
  // component stays mounted (it is rendered without a `key` in app.tsx, so a
  // window switch re-renders rather than remounts). Registering here — keyed on
  // [terminalReady, windowId] — re-keys the entry on every switch and cleans up
  // the OLD id before adding the new one, so `window.__rkTerminals` never holds
  // a stale handle. The echo-latency harness reads this to poll
  // `term.buffer.active` (the WebGL canvas is not DOM-readable). Inert in normal
  // use — nothing reads the registry unless a test driver does.
  useEffect(() => {
    if (!terminalReady || !xtermRef.current) return;
    registerTestTerminal(windowId, xtermRef.current);
    return () => unregisterTestTerminal(windowId);
  }, [terminalReady, windowId]);

  // Scroll-lock: prevent xterm textarea from gaining focus when locked.
  // Instead of reactively blurring on focusin (which disrupts active touch
  // sequences and can corrupt xterm.js internal state), we preventDefault()
  // on touchend to suppress the synthetic mousedown → focusin → click chain.
  // touchstart/touchmove still fire normally so SGR scroll keeps working.
  useEffect(() => {
    if (!scrollLocked) return;
    const container = terminalRef.current;
    if (!container) return;

    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
    }

    container.addEventListener("touchend", onTouchEnd, { capture: true });
    return () => container.removeEventListener("touchend", onTouchEnd, { capture: true });
  }, [scrollLocked]);

  // Mobile touch-to-scroll: translate vertical swipe gestures into SGR mouse
  // wheel escape sequences sent to tmux via WebSocket.
  //
  // No overlay/proxy needed — we listen for touchmove directly on the terminal
  // container in the capture phase. touch-action: none on the container ensures
  // iOS delivers all touchmove events to JS. Taps naturally reach xterm.js for
  // keyboard focus since there's no overlay blocking them.
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    // Only on touch devices — desktop uses native mouse wheel via xterm.js
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (!isTouch) return;

    let startY = 0;
    let accumulatedDelta = 0;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      accumulatedDelta = 0;
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const currentY = e.touches[0].clientY;
      const dy = startY - currentY; // positive = swiped up
      accumulatedDelta += dy;
      startY = currentY;

      // Read the font size live — it can change at runtime via the terminal-font
      // control, and this effect is not torn down on a font change (deps below
      // are mount-stable), so capturing it at setup would go stale.
      const lineHeight = xtermRef.current?.options.fontSize ?? 13;
      const lines = Math.trunc(accumulatedDelta / lineHeight);
      if (lines === 0) return;
      accumulatedDelta -= lines * lineHeight;

      // SGR mouse encoding: \x1b[<button;col;rowM
      // button 64 = scroll up (older), 65 = scroll down (newer)
      // col/row must be valid terminal coordinates — tmux ignores 1;1.
      const term = xtermRef.current;
      const col = term ? Math.ceil(term.cols / 2) : 40;
      const row = term ? Math.ceil(term.rows / 2) : 12;
      // Swipe up (dy > 0, lines > 0) = see newer content = scroll down = 65
      // Swipe down (dy < 0, lines < 0) = see older content = scroll up = 64
      const button = lines > 0 ? 65 : 64;
      const seq = `\x1b[<${button};${col};${row}M`;
      const count = Math.abs(lines);
      let payload = "";
      for (let i = 0; i < count; i++) payload += seq;
      ws.send(payload);
    }

    container.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart, { capture: true });
      container.removeEventListener("touchmove", onTouchMove, { capture: true });
    };
  }, [terminalReady, wsRef]);

  // Update xterm theme when the app theme changes
  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = deriveXtermTheme(activeTheme.palette);
  }, [activeTheme]);

  // Keep a ref to windowId so the stream open op always reads the latest value
  // without the connect effect needing to be torn down/rebuilt — this is what
  // lets same-session window switches ride the existing stream. A same-session
  // ride also pushes the new windowId into the live stream via
  // stream.setWindowId (the effect below), so a later socket-level reconnect
  // re-issues `open` for the window the user is looking at NOW, not the one from
  // connect time (without it, RelayMux would re-open the STALE open-time window
  // and the server would SelectWindowInSession it, yanking the pane back).
  const windowIdRef = useRef(windowId);
  windowIdRef.current = windowId;

  // The live RelayMux stream handle for the current connection. Held in a ref so
  // the same-session-ride effect below can update its re-open target without
  // being a dependency of (and thus re-running) the connect effect.
  const streamRef = useRef<RelayStream | null>(null);

  // Same-session windowId ride: keep the live stream's re-open target fresh.
  // The connect effect deliberately does NOT depend on windowId (a same-session
  // switch rides the existing stream — tmux moves the attached PTY's active
  // window in place), so this effect is the seam that tells RelayMux the new
  // windowId for reconnect purposes. A genuine identity change (cross-session /
  // server / loss) instead bumps connectionEpoch and re-opens a fresh stream,
  // which carries the current windowId at open time — so this call is redundant
  // (harmless) there and load-bearing only for the ride.
  useEffect(() => {
    streamRef.current?.setWindowId(windowId);
  }, [windowId]);

  // Connection identity — (server, owning session), NOT windowId.
  //
  // Backend model (since 260602-qn62, move-based board pin-sessions): the
  // relay resolves the window's real owning session via ResolveWindowSession
  // — in the move-based model a window lives in exactly ONE session, its
  // home session or its `_rk-pin-*` board pin-session — then runs a
  // session-scoped select (`tmux select-window -t <session>:@N`) and
  // attaches the PTY DIRECTLY to that real session
  // (`attach-session -t <session>`). The attached PTY therefore tracks its
  // session's active window natively, exactly like a local `tmux attach`
  // client.
  //
  // Consequence: a same-session windowId change needs NO reconnect — tmux
  // has already switched the active window in place (a status-bar click
  // travels over this very socket) or will switch it (REST selectWindow
  // fired by navigateToWindow and the mount-time URL alignment in app.tsx),
  // and the attached PTY redraws by itself. Reconnecting would only add a
  // WS + PTY + attach roundtrip and wipe the xterm scrollback. So the
  // connection is keyed on (server, owning session), tracked as:
  //
  //   - connectedSessionRef — the session the live connection serves.
  //     "" means "not yet resolved": on a cold deep-link the sessionName
  //     prop is SSE-derived and resolves a beat after mount, so we connect
  //     immediately by windowId (the relay resolves the owning session
  //     server-side) and absorb the "" → resolved transition by merely
  //     recording it — by construction the live connection is already
  //     attached to that window's owning session. That construction only
  //     holds if the windowId hasn't changed since connect, which is why
  //     the UNRESOLVED state falls back to windowId-based identity (next
  //     bullet).
  //   - connectedWindowIdRef — the windowId the live connection was opened
  //     for. Read ONLY while unresolved (connectedSessionRef is ""): with
  //     no session known yet, the connection's identity IS its windowId,
  //     so a windowId change in that state bumps for a reconnect — the
  //     relay re-resolves the new window's owner. Without this, navigating
  //     to another window before the first SSE snapshot (browser history,
  //     typed URL) would leave the socket attached to the OLD window's
  //     session, and the later "" → resolved absorption would record the
  //     NEW window's session — a silent identity/attachment mismatch.
  //     Once resolved, windowId changes are same-session rides and this
  //     ref is not consulted.
  //   - connectedServerRef — the server the live connection was opened
  //     against. The connect effect re-runs on `server` changes directly
  //     (it stays in the deps), so the watcher below must NOT also bump
  //     the epoch when the server changed in the same commit — that would
  //     tear down and reconnect twice.
  //   - connectionEpoch — bumped by the watcher to force a teardown +
  //     reconnect when the served identity changes in a way the connect
  //     effect's own deps don't already cover:
  //       • resolved → different resolved: cross-session navigation, or a
  //         window moved to another session. A session RENAME also lands
  //         here and reconnects — accepted tradeoff: the SSE snapshot
  //         carries no stable session id to tell a rename from a genuine
  //         session change, renames are rare, and the deferred reset keeps
  //         any reconnect flicker-free.
  //       • resolved → "": LOSS of identity. sessionName is derived by
  //         locating the URL's @N in the SSE snapshot, so it goes "" and
  //         STAYS "" when the viewed window is killed externally, pinned
  //         to a `_rk-pin-*` board session (pin-sessions are filtered from
  //         the snapshot — pinning the viewed window therefore presents as
  //         resolved → "", never resolved → resolved), or the route is a
  //         dead deep link. The bump issues a probe reconnect by windowId:
  //         if the window still exists (e.g. an X → "" → X ghost gap
  //         during navigation — one reconnect, flicker-free) the relay
  //         re-resolves the owning session server-side; if it is gone the
  //         relay closes 4004 and the onSessionNotFound redirect fires.
  //         Without this bump nothing recovers: the kill redirect and the
  //         URL writeback in app.tsx are both gated on a non-empty
  //         sessionName, so the route would wedge.
  //     "" → resolved never bumps (absorption — connectedSessionRef
  //     above), and "" → "" with an unchanged windowId is a no-op; a
  //     windowId change while unresolved bumps (windowId-based identity —
  //     connectedWindowIdRef above). The watcher also records identity
  //     before a connection exists — harmless: pre-ready bumps are blocked
  //     by the server guard (connectedServerRef is "" until the first
  //     connect; the server prop never is).
  const connectedSessionRef = useRef("");
  const connectedServerRef = useRef("");
  const connectedWindowIdRef = useRef("");
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  // Session-identity watcher. MUST stay declared BEFORE the connect effect:
  // on a same-commit server+session change it has to read the PRE-change
  // server from connectedServerRef (the connect effect overwrites it) to
  // see that the reconnect is already being handled by the `server` dep.
  useEffect(() => {
    const servedSession = connectedSessionRef.current;

    // UNRESOLVED connection (opened before the first snapshot — its served
    // session is ""): identity is the windowId it was opened for. A
    // windowId change here must reconnect — the relay resolved the OLD
    // window's owner, so riding the socket (or absorbing a same-commit
    // resolution) would silently mismatch identity and attachment.
    // connectedWindowIdRef is "" before the first connect, so pre-ready
    // renders skip this branch (and the server guard blocks their bumps).
    if (
      !servedSession &&
      connectedWindowIdRef.current &&
      windowId !== connectedWindowIdRef.current
    ) {
      connectedSessionRef.current = sessionName;
      // Server changed in this same commit → the connect effect re-runs
      // via its `server` dep; bumping the epoch too would reconnect twice.
      if (server !== connectedServerRef.current) return;
      setConnectionEpoch((epoch) => epoch + 1);
      return;
    }

    if (!sessionName) {
      // "" → "" (cold mount, still unresolved, same window): nothing to do.
      if (!servedSession) return;
      // resolved → "": loss of identity (see the connectionEpoch bullet
      // above) — record it and bump so the probe reconnect either
      // re-resolves the window server-side or closes 4004 and the
      // onSessionNotFound redirect fires.
      connectedSessionRef.current = "";
      // Server changed in this same commit → the connect effect re-runs
      // via its `server` dep; bumping the epoch too would reconnect twice.
      if (server !== connectedServerRef.current) return;
      setConnectionEpoch((epoch) => epoch + 1);
      return;
    }
    connectedSessionRef.current = sessionName;
    // First resolution ("" → resolved) or unchanged → record only.
    if (!servedSession || servedSession === sessionName) return;
    // Same-commit server change → see above.
    if (server !== connectedServerRef.current) return;
    setConnectionEpoch((epoch) => epoch + 1);
  }, [sessionName, server, windowId]);

  // WebSocket connection — lives as long as (server, owning session) does.
  // windowId is deliberately NOT a dependency: same-session switches ride
  // the existing socket, and the relay URL reads windowIdRef.current so any
  // genuine reconnect (session change, server change, transient drop) picks
  // up the latest window. sessionName is NOT a dependency either: its
  // changes are translated into connectionEpoch bumps by the watcher above,
  // which is what lets the cold-deep-link "" → resolved transition pass
  // without a reconnect.
  useEffect(() => {
    if (!terminalReady || !xtermRef.current) return;

    // Record the identity this connection serves. sessionName may be ""
    // here (cold deep-link, or a loss-of-identity probe reconnect) — the
    // watcher above fills it in on resolution without forcing a reconnect.
    // Recording at effect-run time is sufficient: any identity change
    // re-runs this effect (clearing the reconnect timer), so a
    // timer-driven connect() can never observe a changed identity.
    connectedServerRef.current = server;
    connectedSessionRef.current = sessionName;
    connectedWindowIdRef.current = windowIdRef.current;

    const terminal = xtermRef.current;

    let cancelled = false;

    // Adaptive write flushing.
    //
    // The naive strategy — buffer every inbound chunk and flush once per
    // requestAnimationFrame — adds up to a full frame (~16ms) of latency to a
    // lone keystroke echo for no benefit: there is nothing to coalesce when one
    // small chunk arrives in an idle frame. (Latency attribution showed this
    // rAF tail dominates perceived input latency ~3:1 over the network hop.)
    //
    // Instead: write SMALL chunks that arrive while idle straight to the
    // terminal, synchronously, so an echo paints on the same tick. Fall back to
    // rAF-coalescing only under load — i.e. once a chunk is large, or once we
    // are already buffering — so a flood (`cat largefile`, a build log) still
    // batches into one write per frame and does not melt the renderer.
    //
    // Ordering safety (terminal bytes are order-sensitive): the moment ANYTHING
    // is buffered, every subsequent chunk also buffers until the buffer drains.
    // An immediate write therefore only happens when the buffer is empty AND no
    // flush is pending, so a synchronous write can never jump ahead of buffered
    // bytes.
    // Under the mux, inbound PTY output is always BINARY (the relay's byte
    // stream, tagged with the stream id and demuxed by RelayMux), so there is no
    // string-buffer path — every chunk is a Uint8Array.
    let binaryBuffers: Uint8Array[] = [];
    let flushRafId: number | null = null;
    // At most ONE immediate (synchronous) write per animation frame. The flag is
    // reset on each rAF tick. This is the flood guard: the first small idle
    // chunk in a frame paints immediately (interactive echo), but a burst of
    // small chunks within the same frame coalesces — without it, a program
    // emitting one byte at a time would write synchronously on every message.
    let wroteImmediatelyThisFrame = false;
    let frameResetRafId: number | null = null;

    // A chunk larger than this is treated as "under load" and coalesced rather
    // than written immediately. A keystroke echo is a handful of bytes; a paste,
    // a program's burst output, or a redraw is far larger (the relay reads the
    // PTY in 4KB chunks). The threshold trades a little extra latency on medium
    // chunks for protection against synchronous-write storms.
    const IMMEDIATE_WRITE_MAX_BYTES = 64;

    // Deferred per-connection reset. Each connect() arms this flag; the reset
    // then executes immediately BEFORE the first chunk of that connection is
    // written — in the same tick on the immediate path, and inside the same
    // rAF callback (same frame) on the coalesced path — so clear + repaint
    // land in one presented frame. Resetting at message-RECEIPT time (the old
    // behavior) guaranteed ≥1 fully-cleared frame whenever the first chunk
    // took the coalesced path: the wipe was synchronous but the repaint
    // waited for the next animation frame. That cleared frame was the
    // window-switch flicker. Until the new redraw arrives, the user keeps
    // seeing the OLD content instead of black.
    //
    // Handoff semantics (why an effect-scoped flag is per-connection safe):
    // connections within one effect are strictly sequential, and the flush
    // buffers above only ever hold the CURRENT connection's data. An old
    // connection's close-time drain (ws.onclose) runs before the reconnect
    // timer's connect() re-arms the flag, so a tail drain can never consume a
    // reset armed for a DIFFERENT connection — which is why arming must stay
    // in connect() and nowhere earlier. A zero-message connection closes with
    // empty buffers; the empty flush below neither consumes nor executes the
    // pending reset (resetting with nothing to repaint would recreate the
    // flicker) — the next connect() simply re-arms, idempotently.
    let pendingReset = false;

    /** Run the deferred per-connection reset exactly once, at first-write time. */
    function consumePendingReset() {
      if (!pendingReset) return;
      pendingReset = false;
      terminal.reset();
    }

    function flushToTerminal() {
      flushRafId = null;
      // An empty flush (e.g. a zero-message connection's close-time drain)
      // must not consume or execute the pending reset — see above.
      if (binaryBuffers.length === 0) return;
      consumePendingReset();
      for (const buf of binaryBuffers) {
        terminal.write(buf);
      }
      binaryBuffers = [];
    }

    /** True while we are coalescing — a flush is pending or data is buffered. */
    function isBuffering(): boolean {
      return flushRafId !== null || binaryBuffers.length > 0;
    }

    function scheduleFlush() {
      if (flushRafId === null) {
        flushRafId = requestAnimationFrame(flushToTerminal);
      }
    }

    /** Decide whether an inbound chunk of `len` bytes can be written now. */
    function canWriteImmediately(len: number): boolean {
      return (
        !isBuffering() &&
        !wroteImmediatelyThisFrame &&
        len <= IMMEDIATE_WRITE_MAX_BYTES
      );
    }

    /** Mark that an immediate write happened; arm a one-shot frame reset. */
    function markImmediateWrite() {
      wroteImmediatelyThisFrame = true;
      if (frameResetRafId === null) {
        frameResetRafId = requestAnimationFrame(() => {
          frameResetRafId = null;
          wroteImmediatelyThisFrame = false;
        });
      }
    }

    // Open a muxed stream on the single per-tab terminals socket (RelayMux),
    // replacing the former per-pane `new WebSocket('/relay/...')`. The stream
    // handle is surfaced through wsRef as a WebSocket-shaped adapter so the
    // shell consumers (BottomBar, ComposeStrip, touch-scroll, fitAndSync) —
    // which read wsRef.current.{readyState,send,close} — are untouched. Every
    // `send` (keystrokes, SGR, paste) becomes a binary data frame; resizes use
    // the adapter's DEDICATED `resize(cols, rows)` op (fitAndSync calls it), so
    // a paste containing `{type:"resize"}` JSON is never mistaken for a resize.
    //
    // Socket-level reconnect is owned by RelayMux (one backoff loop for the
    // whole tab); on reconnect it re-issues `open` for this stream — targeting
    // the CURRENT windowId (kept fresh via stream.setWindowId on same-session
    // rides — M1) — the server re-attaches, and stream.onOpened re-arms the
    // deferred reset, so a transient socket drop repaints flicker-free on the
    // incoming first data frame WITHOUT a per-pane reconnect timer.
    // stream.onClosed fires for STREAM-level closes: 4004 → redirect; 4001/1000
    // → probe ONE fresh re-open (S1 — a gone window then 4004s → redirect, a
    // transient one re-attaches).

    /** Consume one inbound data chunk through the adaptive write / deferred-reset
     *  path. Inbound frames are always binary under the mux. */
    function handleInbound(chunk: Uint8Array) {
      if (cancelled) return;
      // First inbound bytes of the incoming window RECEIVED — release any
      // in-flight window-switch view-transition awaiting the incoming first
      // paint (260703-l4nf). Fired at receipt time and BEFORE the write/coalesce
      // decision, because `startViewTransition` suppresses rendering while its
      // update callback runs and rAF callbacks DO NOT fire during that
      // suppression — so a write-time release would be structurally
      // unreleasable and every animated switch would eat the full timeout. This
      // callback is a macrotask that runs during suppression, and the pending
      // flush still paints these bytes at the first rendering opportunity. The
      // receipt source is now the stream's first DATA frame (seam 1 of the
      // TerminalClient port), replacing the socket's `onmessage`. No-op when no
      // transition is armed.
      notifyFirstWrite();

      if (canWriteImmediately(chunk.length)) {
        consumePendingReset();
        terminal.write(chunk);
        markImmediateWrite();
        return;
      }
      binaryBuffers.push(chunk);
      scheduleFlush();
    }

    // The live stream. Held in a mutable local (not a const) because a
    // stream-level `closed` for a non-4004 reason probes ONE fresh re-open (S1),
    // which replaces this reference; the adapter + cleanup read `currentStream`.
    let currentStream: RelayStream;
    // At most one probe re-open per stream-level close, so a genuinely dead
    // window (which 4004s the probe) redirects instead of looping.
    let probedReopen = false;

    /** Open a fresh stream for the CURRENT window and wire its callbacks. */
    function openAndWire(): RelayStream {
      const stream = relayMux.openStream({
        server,
        windowId: windowIdRef.current,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      currentStream = stream;
      streamRef.current = stream;

      // open → opened (seam 2 anchor + seam 4 re-arm): arm the deferred reset for
      // this (re)connection and re-fit + re-sync the grid. Fires on the initial
      // open AND every transparent re-open after a socket-level reconnect.
      stream.onOpened(() => {
        if (cancelled || streamRef.current !== stream) return;
        pendingReset = true;
        fitAddonRef.current?.fit();
        stream.resize(terminal.cols, terminal.rows);
      });

      stream.onData((chunk) => {
        if (streamRef.current !== stream) return; // superseded by a probe re-open
        handleInbound(chunk);
      });

      stream.onClosed((code) => {
        if (streamRef.current !== stream) return; // stale — a newer stream is live

        // Flush any buffered data before handling close.
        if (flushRafId) {
          cancelAnimationFrame(flushRafId);
          flushRafId = null;
        }
        if (frameResetRafId) {
          cancelAnimationFrame(frameResetRafId);
          frameResetRafId = null;
        }
        wroteImmediatelyThisFrame = false;
        try { flushToTerminal(); } catch { /* terminal may be disposed */ }

        if (cancelled) return;
        // 4004 = session or window not found — redirect, no reconnect.
        if (code === 4004) {
          terminal.write("\r\n\x1b[91m[session not found]\x1b[0m\r\n");
          onSessionNotFound?.();
          return;
        }
        // Non-4004 (4001 attach-failed, 1000 graceful/PTY-EOF): the old per-pane
        // relay printed "[reconnecting…]" and self-healed. RelayMux only re-opens
        // on a SOCKET drop, not a stream-level close, so probe ONE fresh re-open
        // here (S1). If the window is genuinely gone the probe 4004s and the
        // branch above redirects; otherwise it re-attaches. Bounded to one probe
        // so a hard-failing window can't loop.
        if (probedReopen) {
          terminal.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
          return;
        }
        probedReopen = true;
        terminal.write("\r\n\x1b[90m[reconnecting...]\x1b[0m\r\n");
        openAndWire();
      });

      return stream;
    }

    currentStream = openAndWire();

    // WebSocket-shaped adapter over the current stream handle. Keeps the wsRef
    // contract ({ readyState, send, close }) the shell consumers depend on. Reads
    // `currentStream` live so a probe re-open (S1) transparently retargets it.
    const adapter = {
      get readyState() {
        return relayMux.isOpen() ? WebSocket.OPEN : WebSocket.CONNECTING;
      },
      send(data: string | ArrayBufferView | ArrayBuffer) {
        // Everything sent here is raw terminal input (keystrokes, SGR scroll,
        // pasted text) — forwarded verbatim to the PTY. Resizes travel on the
        // dedicated `resize` op below, NOT this channel, so a paste that
        // happens to contain `{type:"resize"}` JSON is never swallowed.
        currentStream.send(data);
      },
      resize(cols: number, rows: number) {
        if (cols > 0 && rows > 0) currentStream.resize(cols, rows);
      },
      close() {
        currentStream.close();
      },
    };
    wsRef.current = adapter as unknown as WebSocket;

    return () => {
      cancelled = true;
      // Neutralize this effect's pending write state. A late inbound chunk or a
      // close can be delivered asynchronously AFTER this cleanup, and its drain
      // runs BEFORE the `cancelled` check in some paths. Clearing the flag and
      // buffers turns any orphaned drain into a no-op via the empty-flush guard
      // in flushToTerminal.
      pendingReset = false;
      binaryBuffers = [];
      if (flushRafId) cancelAnimationFrame(flushRafId);
      if (frameResetRafId) cancelAnimationFrame(frameResetRafId);
      // Close the muxed stream (a `close` control op). The tab's single
      // terminals socket stays open for the other panes.
      currentStream.close();
      if (streamRef.current === currentStream) {
        streamRef.current = null;
      }
      if (wsRef.current === (adapter as unknown as WebSocket)) {
        wsRef.current = null;
      }
    };
    // sessionName and windowId are deliberately omitted (connection identity
    // is (server, owning session) — see the comment block above); they are
    // read inside only via windowIdRef / identity recording, which must not
    // retrigger the effect. onSessionNotFound is a close-time callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalReady, server, wsRef, connectionEpoch]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={terminalRef}
        role="application"
        aria-label={`Terminal: ${sessionName}/${windowId}`}
        className={`flex-1 min-h-0 overflow-hidden coarse:touch-none ${
          dragOver ? "ring-2 ring-accent ring-inset" : ""
        }`}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
    </div>
  );
}
