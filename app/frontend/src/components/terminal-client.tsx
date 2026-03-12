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
};

export function TerminalClient({
  sessionName,
  windowIndex,
  wsRef,
  composeOpen,
  setComposeOpen,
}: TerminalClientProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
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

  // xterm.js init + WebSocket connection
  useEffect(() => {
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;

    async function init() {
      if (!terminalRef.current) return;
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      const isMobile = !window.matchMedia("(min-width: 640px)").matches;

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily:
          "JetBrains Mono, Fira Code, SF Mono, Menlo, Monaco, Consolas, monospace",
        fontSize: isMobile ? 11 : 13,
        theme: {
          background: "#111111",
          foreground: "#ffffff",
          cursor: "#ffffff",
          selectionBackground: "#333333",
        },
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);
      fitAddon.fit();
      xtermRef.current = terminal;

      // WebSocket — same host, /relay/ prefix
      const wsProto =
        window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsProto}//${window.location.host}/relay/${encodeURIComponent(sessionName)}/${windowIndex}`;
      let reconnectDelay = 1000;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let unmounting = false;

      function connect() {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          reconnectDelay = 1000;
          const dims = { cols: terminal!.cols, rows: terminal!.rows };
          ws.send(JSON.stringify({ type: "resize", ...dims }));
        };

        ws.onmessage = (event) => {
          if (typeof event.data === "string") terminal!.write(event.data);
          else terminal!.write(new Uint8Array(event.data));
        };

        ws.onclose = () => {
          if (unmounting) {
            terminal?.write("\r\n\x1b[90m[connection closed]\x1b[0m\r\n");
            return;
          }
          terminal?.write("\r\n\x1b[90m[reconnecting...]\x1b[0m\r\n");
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (!unmounting) connect();
          }, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        };

        ws.onerror = () => {};
      }

      connect();

      terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN)
          wsRef.current.send(data);
      });

      let resizeRafId: number | null = null;
      const resizeObserver = new ResizeObserver(() => {
        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = null;
          fitAddon?.fit();
          terminal?.scrollToBottom();
          if (wsRef.current?.readyState === WebSocket.OPEN && terminal) {
            wsRef.current.send(
              JSON.stringify({
                type: "resize",
                cols: terminal.cols,
                rows: terminal.rows,
              }),
            );
          }
        });
      });

      resizeObserver.observe(terminalRef.current);

      return () => {
        unmounting = true;
        resizeObserver.disconnect();
        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        if (reconnectTimer) clearTimeout(reconnectTimer);
      };
    }

    const cleanup = init();
    return () => {
      cleanup.then((fn) => fn?.());
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      xtermRef.current = null;
      terminal?.dispose();
    };
  }, [sessionName, windowIndex, wsRef]);

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
