import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTheme } from "@/contexts/theme-context";
import { deriveXtermTheme } from "@/themes";
import { clipboardProvider } from "@/components/terminal-client";
import { copyToClipboard } from "@/lib/clipboard";
import { LaneHeader } from "@/components/lanes/lane-header";
import type { LanePin } from "@/hooks/use-pinned-lanes";

const WIDTHS_STORAGE_KEY = "runkit-lanes-widths";
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 280;

type LaneProps = {
  pin: LanePin;
  focused: boolean;
  onFocus: () => void;
  onUnpin: () => void;
  closed?: boolean;
};

function laneWidthKey(pin: LanePin): string {
  return `${pin.server}:${pin.session}:${pin.windowIndex}`;
}

function readWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(WIDTHS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number") result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function writeWidth(key: string, width: number): void {
  try {
    const widths = readWidths();
    widths[key] = width;
    localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // localStorage unavailable
  }
}

function readWidth(pin: LanePin): number {
  const widths = readWidths();
  const stored = widths[laneWidthKey(pin)];
  return typeof stored === "number" && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
}

export function Lane({ pin, focused, onFocus, onUnpin, closed }: LaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [width, setWidth] = useState(() => readWidth(pin));
  const { theme: activeTheme } = useTheme();

  // Persist width key derived from pin identity
  const widthKey = laneWidthKey(pin);

  // ── Resize drag handle ────────────────────────────────────────────────────
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = width;
      document.body.style.cursor = "col-resize";

      function onPointerMove(ev: PointerEvent) {
        if (!isDragging.current) return;
        const delta = ev.clientX - dragStartX.current;
        const next = Math.max(MIN_WIDTH, dragStartWidth.current + delta);
        setWidth(next);
      }

      function onPointerUp() {
        if (!isDragging.current) return;
        isDragging.current = false;
        document.body.style.cursor = "";
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);

        // Persist final width and refit terminal via state updater to read current value
        setWidth((current) => {
          writeWidth(widthKey, current);
          fitAddonRef.current?.fit();
          if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current) {
            wsRef.current.send(
              JSON.stringify({
                type: "resize",
                cols: xtermRef.current.cols,
                rows: xtermRef.current.rows,
              }),
            );
          }
          return current;
        });
      }

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    },
    [width, widthKey],
  );

  // Fit terminal after width changes during drag
  useEffect(() => {
    if (!fitAddonRef.current) return;
    fitAddonRef.current.fit();
  }, [width]);

  // ── xterm.js init — mount only ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let resizeRafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      if (!terminalRef.current) return;
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (cancelled || !terminalRef.current) return;

      // Wait for the bundled webfont before xterm measures cell dimensions
      if (typeof document.fonts?.load === "function") {
        const FONT_LOAD_TIMEOUT_MS = 3000;
        const fontLoads = Promise.all([
          document.fonts.load('13px "MonaspiceNe Nerd Font Mono"'),
          document.fonts.load('bold 13px "MonaspiceNe Nerd Font Mono"'),
          document.fonts.load('italic 13px "MonaspiceNe Nerd Font Mono"'),
        ]);
        const timeout = new Promise<void>((resolve) => {
          window.setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
        });
        await Promise.race([fontLoads, timeout]).catch(() => undefined);
      }

      if (cancelled || !terminalRef.current) return;

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily: '"MonaspiceNe Nerd Font Mono", ui-monospace, monospace',
        fontSize: 13,
        theme: deriveXtermTheme(activeTheme.palette),
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);
      fitAddon.fit();
      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Clipboard addon
      const { ClipboardAddon } = await import("@xterm/addon-clipboard");
      if (cancelled) { try { terminal.dispose(); } catch { /* ignore */ } return; }
      terminal.loadAddon(new ClipboardAddon(undefined, clipboardProvider));

      // Clickable URLs
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      if (cancelled) { try { terminal.dispose(); } catch { /* ignore */ } return; }
      terminal.loadAddon(new WebLinksAddon());

      // Unicode graphemes for correct emoji/CJK width
      const { UnicodeGraphemesAddon } = await import("@xterm/addon-unicode-graphemes");
      if (cancelled) { try { terminal.dispose(); } catch { /* ignore */ } return; }
      terminal.loadAddon(new UnicodeGraphemesAddon());
      terminal.unicode.activeVersion = "15-graphemes";

      // GPU-accelerated rendering (silent fallback to canvas)
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        if (!cancelled) terminal.loadAddon(new WebglAddon());
      } catch {
        // canvas renderer continues working
      }
      if (cancelled) { try { terminal.dispose(); } catch { /* ignore */ } return; }

      // Keyboard input to WebSocket
      terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(data);
        }
      });

      // Cmd+C / Ctrl+C: copy selection instead of sending SIGINT
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

      // ResizeObserver for terminal reflow
      resizeObserver = new ResizeObserver(() => {
        if (cancelled) return;
        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          if (cancelled) return;
          resizeRafId = null;
          fitAddonRef.current?.fit();
          xtermRef.current?.scrollToBottom();
          if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current) {
            wsRef.current.send(
              JSON.stringify({
                type: "resize",
                cols: xtermRef.current.cols,
                rows: xtermRef.current.rows,
              }),
            );
          }
        });
      });

      if (cancelled || !terminalRef.current) {
        try { terminal.dispose(); } catch { /* ignore */ }
        return;
      }

      resizeObserver.observe(terminalRef.current);
      connectWs(terminal);
    }

    // ── WebSocket connection with reconnect ─────────────────────────────────
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;

    function connectWs(terminal: import("@xterm/xterm").Terminal) {
      if (cancelled) return;

      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsProto}//${window.location.host}/relay/${encodeURIComponent(pin.session)}/${pin.windowIndex}?server=${encodeURIComponent(pin.server)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";
      let needsReset = true;

      // Write batching: accumulate data and flush once per animation frame
      let textBuffer = "";
      let binaryBuffers: Uint8Array[] = [];
      let flushRafId: number | null = null;

      function flushToTerminal() {
        flushRafId = null;
        if (textBuffer) {
          terminal.write(textBuffer);
          textBuffer = "";
        }
        for (const buf of binaryBuffers) {
          terminal.write(buf);
        }
        binaryBuffers = [];
      }

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        reconnectDelay = 1000;
        fitAddonRef.current?.fit();
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        if (needsReset) {
          needsReset = false;
          terminal.reset();
        }
        if (typeof event.data === "string") {
          textBuffer += event.data;
        } else {
          binaryBuffers.push(new Uint8Array(event.data));
        }
        if (!flushRafId) {
          flushRafId = requestAnimationFrame(flushToTerminal);
        }
      };

      ws.onclose = () => {
        // Flush any buffered data before handling close
        if (flushRafId) {
          cancelAnimationFrame(flushRafId);
          flushRafId = null;
        }
        try { flushToTerminal(); } catch { /* terminal may be disposed */ }

        if (cancelled) return;
        setConnected(false);
        terminal.write("\r\n\x1b[90m[reconnecting...]\x1b[0m\r\n");
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (!cancelled) connectWs(terminal);
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      };

      ws.onerror = () => {};
    }

    init();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (resizeRafId) cancelAnimationFrame(resizeRafId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      xtermRef.current = null;
      fitAddonRef.current = null;
      try { terminal?.dispose(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin.server, pin.session, pin.windowIndex]);

  // Update xterm theme when the app theme changes
  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = deriveXtermTheme(activeTheme.palette);
  }, [activeTheme]);

  return (
    <div
      className={`flex flex-col h-full shrink-0 relative border-r border-border ${
        focused ? "ring-2 ring-accent ring-inset" : ""
      }`}
      style={{ width: `${width}px`, scrollSnapAlign: "start" }}
      onClick={onFocus}
      onMouseEnter={onFocus}
    >
      <LaneHeader pin={pin} connected={connected} onUnpin={onUnpin} />

      {/* Terminal area */}
      <div
        ref={terminalRef}
        className="flex-1 min-h-0 overflow-hidden"
        aria-label={`Lane: ${pin.server}/${pin.session}/${pin.windowIndex}`}
      />

      {/* Window closed overlay */}
      {closed && (
        <div className="absolute inset-0 bg-bg-primary/80 flex flex-col items-center justify-center gap-3 z-20">
          <p className="text-sm text-text-secondary">Window closed</p>
          <button
            type="button"
            onClick={onUnpin}
            className="text-xs text-text-secondary hover:text-text-primary border border-border rounded px-2 py-1"
          >
            Unpin
          </button>
        </div>
      )}

      {/* Right-edge resize handle */}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/30 active:bg-accent/50 z-10"
        onPointerDown={onPointerDown}
      />
    </div>
  );
}
