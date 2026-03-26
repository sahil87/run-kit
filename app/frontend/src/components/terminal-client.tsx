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

  // Mobile touch-to-scroll via scroll proxy.
  //
  // On iOS Safari, touch events on a canvas (xterm.js WebGL) don't produce
  // native scroll — the canvas isn't a "normal scrollable surface". JS-level
  // touchmove handlers also fail because iOS suppresses them for non-scrollable
  // elements even with touch-action: none.
  //
  // Solution: inject an invisible scrollable overlay ("scroll proxy") on top of
  // the terminal. iOS natively handles touch-to-scroll on this div. We listen
  // for the `scroll` event and translate delta into SGR mouse wheel escape
  // sequences sent to tmux via WebSocket. The proxy's scrollTop is re-centered
  // after each scroll so the user can scroll indefinitely in both directions.
  //
  // The proxy only activates on coarse-pointer (touch) devices. On desktop
  // (fine pointer), native mouse wheel events go through xterm.js's own handler.
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    // Only create proxy on touch devices
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (!isTouch) return;

    const LINE_HEIGHT = xtermRef.current?.options.fontSize ?? 13;

    // Create scroll proxy: invisible div with tall content for native scroll
    const proxy = document.createElement("div");
    proxy.style.cssText =
      "position:absolute;inset:0;z-index:5;overflow-y:scroll;opacity:0;" +
      "-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:none;";
    const spacer = document.createElement("div");
    const SPACER_HEIGHT = 10000;
    const CENTER = SPACER_HEIGHT / 2;
    spacer.style.height = `${SPACER_HEIGHT}px`;
    proxy.appendChild(spacer);
    container.style.position = "relative";
    container.appendChild(proxy);
    proxy.scrollTop = CENTER;

    let lastScrollTop = CENTER;
    let rafId: number | null = null;

    function onScroll() {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const delta = proxy.scrollTop - lastScrollTop;
        if (delta === 0) return;

        const lines = Math.round(delta / LINE_HEIGHT);
        if (lines === 0) return;

        // SGR mouse encoding: \x1b[<button;col;rowM
        // button 64 = scroll up (older), 65 = scroll down (newer)
        // col/row must be valid terminal coordinates (1-based) — tmux
        // ignores events at 1;1 (status bar area). Use terminal center.
        const term = xtermRef.current;
        const col = term ? Math.ceil(term.cols / 2) : 40;
        const row = term ? Math.ceil(term.rows / 2) : 12;
        const button = lines > 0 ? 65 : 64;
        const seq = `\x1b[<${button};${col};${row}M`;
        const count = Math.abs(lines);
        let payload = "";
        for (let i = 0; i < count; i++) payload += seq;
        ws.send(payload);

        // Re-center so user can keep scrolling in both directions
        proxy.scrollTop = CENTER;
        lastScrollTop = CENTER;
      });
    }

    proxy.addEventListener("scroll", onScroll, { passive: true });

    // Tap passthrough: the proxy blocks taps from reaching xterm.js (needed
    // for focusing the terminal / opening the iOS keyboard). Detect taps
    // (short duration, minimal movement) and forward them to the element below.
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    const TAP_MAX_DURATION = 300;
    const TAP_MAX_DISTANCE = 10;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      touchStartTime = Date.now();
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }

    function onTouchEnd(e: TouchEvent) {
      const dt = Date.now() - touchStartTime;
      if (dt > TAP_MAX_DURATION) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = Math.abs(touch.clientX - touchStartX);
      const dy = Math.abs(touch.clientY - touchStartY);
      if (dx > TAP_MAX_DISTANCE || dy > TAP_MAX_DISTANCE) return;

      // It's a tap — forward to the element underneath
      proxy.style.pointerEvents = "none";
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      proxy.style.pointerEvents = "";
      if (target) {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: touch.clientX, clientY: touch.clientY }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: touch.clientX, clientY: touch.clientY }));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: touch.clientX, clientY: touch.clientY }));
        if (target instanceof HTMLElement) target.focus();
      }
    }

    proxy.addEventListener("touchstart", onTouchStart, { passive: true });
    proxy.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      proxy.removeEventListener("scroll", onScroll);
      proxy.removeEventListener("touchstart", onTouchStart);
      proxy.removeEventListener("touchend", onTouchEnd);
      if (rafId) cancelAnimationFrame(rafId);
      proxy.remove();
    };
  }, [terminalReady, wsRef]);

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
