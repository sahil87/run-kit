import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useCallback, useState } from "react";
import { useFileUpload } from "@/hooks/use-file-upload";
import type { UploadedFile } from "@/hooks/use-file-upload";
import { useTheme } from "@/contexts/theme-context";
import { deriveXtermTheme } from "@/themes";
import { ComposeBuffer } from "@/components/compose-buffer";

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

/** Copy text to clipboard — tries Clipboard API first, falls back to execCommand for non-secure contexts (HTTP). */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Clipboard API failed (likely non-secure context) — fall through to fallback
    }
  }
  const previousActiveElement = document.activeElement as HTMLElement | null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    document.execCommand("copy");
  } catch {
    // Both mechanisms failed — silently ignore
  } finally {
    document.body.removeChild(textarea);
    previousActiveElement?.focus();
  }
}

type TerminalClientProps = {
  sessionName: string;
  windowIndex: string;
  server: string;
  wsRef: React.MutableRefObject<WebSocket | null>;
  composeOpen: boolean;
  setComposeOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onSessionNotFound?: () => void;
};

export function TerminalClient({
  sessionName,
  windowIndex,
  server,
  wsRef,
  composeOpen,
  setComposeOpen,
  onSessionNotFound,
}: TerminalClientProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [composeInitialText, setComposeInitialText] = useState<string | undefined>();
  const [composeFiles, setComposeFiles] = useState<UploadedFile[]>([]);
  const { uploadFiles } = useFileUpload(sessionName, windowIndex);
  const { theme: activeTheme } = useTheme();

  const openComposeWithUploads = useCallback(
    (uploads: UploadedFile[]) => {
      if (uploads.length === 0) return;
      setComposeFiles((prev) => [...prev, ...uploads]);
      setComposeInitialText(uploads.map((u) => u.path).join("\n"));
      setComposeOpen(true);
    },
    [setComposeOpen],
  );

  // Clipboard paste interception for file upload
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      uploadFiles(files).then(openComposeWithUploads);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [uploadFiles, openComposeWithUploads]);

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
      uploadFiles(files).then(openComposeWithUploads);
    },
    [uploadFiles, openComposeWithUploads],
  );

  const handleUploadFiles = useCallback(
    (files: FileList) => {
      uploadFiles(files).then(openComposeWithUploads);
    },
    [uploadFiles, openComposeWithUploads],
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
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      // Component unmounted while awaiting imports
      if (cancelled || !terminalRef.current) return;

      const isMobile = !window.matchMedia("(min-width: 640px)").matches;

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily:
          "JetBrainsMono Nerd Font, JetBrains Mono, Fira Code, SF Mono, Menlo, Monaco, Consolas, monospace",
        fontSize: isMobile ? 11 : 13,
        theme: deriveXtermTheme(activeTheme.palette),
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);
      fitAddon.fit();
      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Clipboard addon — enriched clipboard support
      const { ClipboardAddon } = await import("@xterm/addon-clipboard");
      if (cancelled) { try { terminal.dispose(); } catch { /* WebGL addon may throw during teardown */ } return; }
      terminal.loadAddon(new ClipboardAddon(undefined, clipboardProvider));

      // Clickable URLs
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      if (cancelled) { try { terminal.dispose(); } catch { /* WebGL addon may throw during teardown */ } return; }
      terminal.loadAddon(new WebLinksAddon());

      // GPU-accelerated rendering (silent fallback to canvas)
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        if (!cancelled) terminal.loadAddon(new WebglAddon());
      } catch {
        // canvas renderer continues working
      }
      if (cancelled) { try { terminal.dispose(); } catch { /* WebGL addon may throw during teardown */ } return; }

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

      // Guard against unmount during terminal setup (after imports returned)
      if (cancelled || !terminalRef.current) {
        try { terminal.dispose(); } catch { /* WebGL addon may throw during teardown */ }
        return;
      }

      resizeObserver.observe(terminalRef.current);
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
      xtermRef.current = null;
      fitAddonRef.current = null;
      try { terminal?.dispose(); } catch { /* WebGL addon may throw during teardown */ }
      setTerminalReady(false);
    };
  }, [wsRef]);

  // Touch-to-scroll: translate vertical swipe gestures into synthetic wheel
  // events. xterm.js's wheel handler sends arrow key escape sequences to tmux
  // when mouse mode is active, or scrolls the local viewport otherwise.
  // scrollLines() only moves the local xterm buffer — it doesn't reach tmux.
  // Dispatching WheelEvent goes through xterm.js's own handler which does the
  // right thing for both mouse-mode and non-mouse-mode terminals.
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    let startY = 0;
    let accumulatedDelta = 0;
    const SCROLL_THRESHOLD = 15; // pixels per synthetic wheel tick

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      accumulatedDelta = 0;
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 1 || !container) return;
      const currentY = e.touches[0].clientY;
      accumulatedDelta += startY - currentY;
      startY = currentY;

      // Find the xterm viewport (the element xterm.js listens on for wheel)
      const target = container.querySelector(".xterm-viewport") ?? container;

      while (Math.abs(accumulatedDelta) >= SCROLL_THRESHOLD) {
        const direction = accumulatedDelta > 0 ? 1 : -1;
        target.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: direction * 25,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            bubbles: true,
            cancelable: true,
          }),
        );
        accumulatedDelta -= direction * SCROLL_THRESHOLD;
      }
    }

    // Use capture phase to see events before xterm.js can stop propagation
    container.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart, { capture: true });
      container.removeEventListener("touchmove", onTouchMove, { capture: true });
    };
  }, [terminalReady]);

  // Update xterm theme when the app theme changes
  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = deriveXtermTheme(activeTheme.palette);
  }, [activeTheme]);

  // Keep a ref to windowIndex so the WS effect can read it without
  // depending on it. The relay uses `tmux attach-session` which follows
  // window switches automatically — only session changes need a reconnect.
  const windowIndexRef = useRef(windowIndex);
  windowIndexRef.current = windowIndex;

  // WebSocket connection — reconnects only when the session changes.
  // Window switches within the same session are handled by the relay's
  // tmux attach-session, which follows the active window automatically.
  useEffect(() => {
    if (!terminalReady || !xtermRef.current) return;

    const terminal = xtermRef.current;

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;

    const wsProto =
      window.location.protocol === "https:" ? "wss:" : "ws:";

    function connect() {
      if (cancelled) return;
      const wsUrl = `${wsProto}//${window.location.host}/relay/${encodeURIComponent(sessionName)}/${windowIndexRef.current}?server=${server}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";
      let needsReset = true;

      ws.onopen = () => {
        if (cancelled) return;
        reconnectDelay = 1000;
        fitAddonRef.current?.fit();
        const dims = { cols: terminal.cols, rows: terminal.rows };
        ws.send(JSON.stringify({ type: "resize", ...dims }));
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        if (needsReset) {
          needsReset = false;
          terminal.reset();
        }
        if (typeof event.data === "string") terminal.write(event.data);
        else terminal.write(new Uint8Array(event.data));
      };

      ws.onclose = (event) => {
        if (cancelled) return;
        // 4004 = session or window not found — redirect instead of reconnecting
        if (event.code === 4004) {
          terminal.write("\r\n\x1b[91m[session not found]\x1b[0m\r\n");
          onSessionNotFound?.();
          return;
        }
        terminal.write("\r\n\x1b[90m[reconnecting...]\x1b[0m\r\n");
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (!cancelled) connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      };

      ws.onerror = () => {};
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalReady, sessionName, server, wsRef]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={terminalRef}
        role="application"
        aria-label={`Terminal: ${sessionName}/${windowIndex}`}
        className={`flex-1 min-h-0 overflow-hidden touch-pan-y transition-opacity ${
          composeOpen ? "opacity-50" : ""
        } ${dragOver ? "ring-2 ring-accent ring-inset" : ""}`}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      {composeOpen && (
        <ComposeBuffer
          wsRef={wsRef}
          onClose={() => {
            setComposeOpen(false);
            setComposeInitialText(undefined);
            setComposeFiles([]);
            xtermRef.current?.focus();
          }}
          initialText={composeInitialText}
          uploadedFiles={composeFiles}
          onUploadFiles={handleUploadFiles}
          onRemoveFile={(index) => {
            setComposeFiles((prev) => prev.filter((_, i) => i !== index));
          }}
        />
      )}
    </div>
  );
}
