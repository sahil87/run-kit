import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useCallback, useState } from "react";
import { useFileUpload } from "@/hooks/use-file-upload";
import type { UploadedFile } from "@/hooks/use-file-upload";
import { useTheme } from "@/contexts/theme-context";
import { deriveXtermTheme } from "@/themes";
import { ComposeBuffer } from "@/components/compose-buffer";
import { copyToClipboard } from "@/lib/clipboard";

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

type TerminalClientProps = {
  sessionName: string;
  windowIndex: string;
  server: string;
  wsRef: React.MutableRefObject<WebSocket | null>;
  composeOpen: boolean;
  setComposeOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onSessionNotFound?: () => void;
  focusRef?: React.MutableRefObject<(() => void) | null>;
  scrollLocked?: boolean;
};

export function TerminalClient({
  sessionName,
  windowIndex,
  server,
  wsRef,
  composeOpen,
  setComposeOpen,
  onSessionNotFound,
  focusRef,
  scrollLocked,
}: TerminalClientProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [composeInitialText, setComposeInitialText] = useState<string | undefined>();
  const [composeFiles, setComposeFiles] = useState<UploadedFile[]>([]);
  const { uploadFiles, uploading } = useFileUpload(sessionName, windowIndex);
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
      const fontPx = isMobile ? 11 : 13;

      // Ensure the bundled webfont is loaded before xterm measures cell
      // dimensions. xterm.js measures once at open() and does not re-measure
      // when fonts arrive later, so fallback metrics would persist as
      // misaligned glyphs. Load all three weights concurrently, but do not
      // block terminal startup indefinitely if the FontFaceSet API is
      // unavailable or a font request stalls (e.g., proxy blackholes .woff2).
      if (typeof document.fonts?.load === "function") {
        const FONT_LOAD_TIMEOUT_MS = 3000;
        const fontLoads = Promise.all([
          document.fonts.load(`${fontPx}px "JetBrainsMono Nerd Font"`),
          document.fonts.load(`bold ${fontPx}px "JetBrainsMono Nerd Font"`),
          document.fonts.load(`italic ${fontPx}px "JetBrainsMono Nerd Font"`),
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
        fontFamily: '"JetBrainsMono Nerd Font", ui-monospace, monospace',
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

      // Clipboard addon — enriched clipboard support
      const { ClipboardAddon } = await import("@xterm/addon-clipboard");
      if (cancelled) { try { terminal.dispose(); } catch { /* WebGL addon may throw during teardown */ } return; }
      terminal.loadAddon(new ClipboardAddon(undefined, clipboardProvider));

      // Clickable URLs
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      if (cancelled) { try { terminal.dispose(); } catch { /* WebGL addon may throw during teardown */ } return; }
      terminal.loadAddon(new WebLinksAddon());

      // xterm defaults to Unicode 6 width tables, but tmux lays out its buffer
      // using wcwidth (Unicode 14/15). Without this addon, emojis tmux treats
      // as 2 cells wide land in 1-cell slots and subsequent glyphs overlap.
      // Must load before WebGL so the renderer measures cells against the
      // correct table on first paint.
      const { UnicodeGraphemesAddon } = await import("@xterm/addon-unicode-graphemes");
      if (cancelled) { try { terminal.dispose(); } catch { /* WebGL addon may throw during teardown */ } return; }
      terminal.loadAddon(new UnicodeGraphemesAddon());
      terminal.unicode.activeVersion = "15-graphemes";

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
      xtermRef.current = null;
      fitAddonRef.current = null;
      try { terminal?.dispose(); } catch { /* WebGL addon may throw during teardown */ }
      setTerminalReady(false);
    };
  }, [wsRef, focusRef]);

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

    const LINE_HEIGHT = xtermRef.current?.options.fontSize ?? 13;
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

      const lines = Math.trunc(accumulatedDelta / LINE_HEIGHT);
      if (lines === 0) return;
      accumulatedDelta -= lines * LINE_HEIGHT;

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

    // Write batching: accumulate WebSocket data and flush once per animation frame
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
        if (typeof event.data === "string") {
          textBuffer += event.data;
        } else {
          binaryBuffers.push(new Uint8Array(event.data));
        }
        if (!flushRafId) {
          flushRafId = requestAnimationFrame(flushToTerminal);
        }
      };

      ws.onclose = (event) => {
        // Flush any buffered data before handling close
        if (flushRafId) {
          cancelAnimationFrame(flushRafId);
          flushRafId = null;
        }
        try { flushToTerminal(); } catch { /* terminal may be disposed */ }

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
      if (flushRafId) cancelAnimationFrame(flushRafId);
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
        className={`flex-1 min-h-0 overflow-hidden touch-none transition-opacity ${
          composeOpen ? "opacity-50" : ""
        } ${dragOver ? "ring-2 ring-accent ring-inset" : ""}`}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      {uploading && (
        <div className="absolute bottom-1 left-2 text-xs text-text-secondary bg-bg-card/80 px-2 py-0.5 rounded z-10">
          Uploading...
        </div>
      )}
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
