"use client";

import "@xterm/xterm/css/xterm.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useCallback } from "react";
import { RELAY_PORT } from "@/lib/types";

type Props = {
  projectName: string;
  windowIndex: string;
};

export function TerminalClient({ projectName, windowIndex }: Props) {
  const router = useRouter();
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Double-Esc detection
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (escTimerRef.current) {
          // Second Esc within window — navigate back
          clearTimeout(escTimerRef.current);
          escTimerRef.current = null;
          router.push(`/p/${projectName}`);
        } else {
          // First Esc — start timer
          escTimerRef.current = setTimeout(() => {
            escTimerRef.current = null;
          }, 300);
        }
      }
    },
    [projectName, router],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;

    async function init() {
      if (!terminalRef.current) return;

      // Dynamic imports for xterm (client-only)
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily:
          "JetBrains Mono, Fira Code, SF Mono, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
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

      // Connect WebSocket — derive from current host, use correct protocol
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsHost = window.location.hostname;
      const wsUrl = `${wsProto}//${wsHost}:${RELAY_PORT}/${projectName}/${windowIndex}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        // Send initial size
        const dims = { cols: terminal!.cols, rows: terminal!.rows };
        ws.send(JSON.stringify({ type: "resize", ...dims }));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          terminal!.write(event.data);
        } else {
          terminal!.write(new Uint8Array(event.data));
        }
      };

      ws.onclose = () => {
        terminal!.write("\r\n\x1b[90m[connection closed]\x1b[0m\r\n");
      };

      ws.onerror = () => {
        terminal!.write(
          "\r\n\x1b[31m[connection error]\x1b[0m\r\n",
        );
      };

      // Send terminal input to WebSocket
      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon?.fit();
        if (ws.readyState === WebSocket.OPEN && terminal) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          );
        }
      });

      resizeObserver.observe(terminalRef.current);

      return () => {
        resizeObserver.disconnect();
      };
    }

    const cleanup = init();

    return () => {
      cleanup.then((fn) => fn?.());
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      terminal?.dispose();
    };
  }, [projectName, windowIndex]);

  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Top bar */}
      <div className="mx-auto w-full max-w-[900px] flex items-center justify-between px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/p/${projectName}`)}
            className="text-text-secondary hover:text-text-primary text-sm"
          >
            ←
          </button>
          <span className="text-sm">
            {projectName}/{windowIndex}
          </span>
        </div>
        <span className="text-xs text-text-secondary">Esc Esc to go back</span>
      </div>

      {/* Terminal */}
      <div ref={terminalRef} className="mx-auto w-full max-w-[900px] flex-1" />
    </div>
  );
}
