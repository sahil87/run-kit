import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useCallback, useState } from "react";
import { useFileUpload } from "@/hooks/use-file-upload";
import { ComposeBuffer } from "@/components/compose-buffer";

type TerminalClientProps = {
  sessionName: string;
  windowIndex: string;
  wsRef: React.MutableRefObject<WebSocket | null>;
  composeOpen: boolean;
  setComposeOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onSessionNotFound?: () => void;
};

export function TerminalClient({
  sessionName,
  windowIndex,
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
  const { uploadFiles } = useFileUpload(sessionName, windowIndex);

  const openComposeWithPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      setComposeInitialText(paths.join("\n"));
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
      uploadFiles(files).then(openComposeWithPaths);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [uploadFiles, openComposeWithPaths]);

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
      uploadFiles(files).then(openComposeWithPaths);
    },
    [uploadFiles, openComposeWithPaths],
  );

  const handleUploadFiles = useCallback(
    (files: FileList) => {
      uploadFiles(files).then(openComposeWithPaths);
    },
    [uploadFiles, openComposeWithPaths],
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
          "JetBrains Mono, Fira Code, SF Mono, Menlo, Monaco, Consolas, monospace",
        fontSize: isMobile ? 11 : 13,
        theme: {
          background: "#0f1117",
          foreground: "#e8eaf0",
          cursor: "#e8eaf0",
          selectionBackground: "#2a3040",
        },
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
      terminal.loadAddon(new ClipboardAddon());

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
            void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
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
      const wsUrl = `${wsProto}//${window.location.host}/relay/${encodeURIComponent(sessionName)}/${windowIndexRef.current}`;
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
  }, [terminalReady, sessionName, wsRef]);

  return (
    <>
      <div
        ref={terminalRef}
        role="application"
        aria-label={`Terminal: ${sessionName}/${windowIndex}`}
        className={`flex-1 min-h-0 overflow-hidden touch-none transition-opacity ${
          composeOpen ? "opacity-50" : ""
        } ${dragOver ? "ring-2 ring-accent ring-inset" : ""}`}
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
            xtermRef.current?.focus();
          }}
          initialText={composeInitialText}
          onUploadFiles={handleUploadFiles}
        />
      )}
    </>
  );
}
