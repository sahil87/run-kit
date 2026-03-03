"use client";

import "@xterm/xterm/css/xterm.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { TopBar } from "@/components/top-bar";
import { Dialog } from "@/components/dialog";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";

/** Double-Esc detection window (milliseconds). */
const DOUBLE_ESC_TIMEOUT_MS = 300;

const RELAY_PORT = process.env.NEXT_PUBLIC_RELAY_PORT ?? "3001";

type Props = {
  projectName: string;
  windowIndex: string;
  windowName: string;
};

export function TerminalClient({ projectName, windowIndex, windowName }: Props) {
  const router = useRouter();
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sessions, isConnected } = useSessions();
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  // Look up current window's status from session data
  const currentWindow = useMemo(() => {
    const session = sessions.find((s) => s.name === projectName);
    return session?.windows.find((w) => String(w.index) === windowIndex);
  }, [sessions, projectName, windowIndex]);

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
          }, DOUBLE_ESC_TIMEOUT_MS);
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

  async function handleKillWindow() {
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "killWindow",
          session: projectName,
          index: parseInt(windowIndex, 10),
        }),
      });
    } catch {
      // Best effort
    }
    setShowKillConfirm(false);
    router.push(`/p/${projectName}`);
  }

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "kill-window",
        label: "Kill this window",
        onSelect: () => setShowKillConfirm(true),
      },
      {
        id: "back-project",
        label: "Back to project",
        onSelect: () => router.push(`/p/${projectName}`),
      },
      {
        id: "back-dashboard",
        label: "Back to dashboard",
        onSelect: () => router.push("/"),
      },
    ],
    [projectName, router],
  );

  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Top bar */}
      <div className="mx-auto w-full max-w-[900px] px-4 shrink-0">
        <TopBar
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: `project: ${projectName}`, href: `/p/${projectName}` },
            { label: `window: ${windowName}` },
          ]}
          isConnected={isConnected}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowKillConfirm(true)}
              className="text-sm px-3 py-1 border border-border rounded hover:border-red-400 hover:text-red-400 transition-colors"
            >
              Kill Window
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            {currentWindow && (
              <>
                <span
                  className={`w-2 h-2 rounded-full ${
                    currentWindow.activity === "active"
                      ? "bg-accent-green"
                      : "bg-text-secondary"
                  }`}
                />
                <span>{currentWindow.activity}</span>
                {currentWindow.fabProgress && (
                  <span className="text-accent px-1.5 py-0.5 rounded bg-accent/10">
                    fab: {currentWindow.fabProgress}
                  </span>
                )}
              </>
            )}
          </div>
        </TopBar>
      </div>

      {/* Terminal */}
      <div ref={terminalRef} className="mx-auto w-full max-w-[900px] flex-1" />

      {/* Kill confirmation dialog */}
      {showKillConfirm && (
        <Dialog title="Kill window?" onClose={() => setShowKillConfirm(false)}>
          <p className="text-sm text-text-secondary mb-3">
            Kill window <strong>{windowName}</strong>? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowKillConfirm(false)}
              className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleKillWindow}
              className="flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
      )}

      <CommandPalette actions={paletteActions} />
    </div>
  );
}
