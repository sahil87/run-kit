"use client";

import "@xterm/xterm/css/xterm.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { useChrome } from "@/contexts/chrome-context";
import { BottomBar } from "@/components/bottom-bar";
import { ComposeBuffer } from "@/components/compose-buffer";
import { Dialog } from "@/components/dialog";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";

/** Double-Esc detection window (milliseconds). */
const DOUBLE_ESC_TIMEOUT_MS = 300;

type Props = {
  projectName: string;
  windowIndex: string;
  windowName: string;
  relayPort: number;
};

export function TerminalClient({ projectName, windowIndex, windowName, relayPort }: Props) {
  const router = useRouter();
  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sessions, isConnected } = useSessions();
  const { setBreadcrumbs, setLine2Left, setLine2Right, setBottomBar, setIsConnected, setFullbleed } = useChrome();
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  useVisualViewport();

  // Look up current window's status from session data
  const currentWindow = useMemo(() => {
    const session = sessions.find((s) => s.name === projectName);
    return session?.windows.find((w) => String(w.index) === windowIndex);
  }, [sessions, projectName, windowIndex]);

  // Set chrome slots
  useEffect(() => {
    setFullbleed(true);
    setBreadcrumbs([
      { icon: "⬡", label: projectName, href: `/p/${projectName}` },
      { icon: "❯", label: windowName },
    ]);
    return () => {
      setFullbleed(false);
      setBreadcrumbs([]);
      setLine2Left(null);
      setLine2Right(null);
    };
  }, [projectName, windowName, setBreadcrumbs, setLine2Left, setLine2Right, setFullbleed]);

  useEffect(() => {
    setIsConnected(isConnected);
  }, [isConnected, setIsConnected]);

  useEffect(() => {
    setLine2Left(
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowKillConfirm(true)}
          className="text-sm px-3 py-1 border border-border rounded hover:border-red-400 hover:text-red-400 transition-colors"
        >
          Kill Window
        </button>
      </div>,
    );
  }, [setLine2Left]);

  useEffect(() => {
    setLine2Right(
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
      </div>,
    );
  }, [currentWindow, setLine2Right]);

  // Bottom bar injection
  useEffect(() => {
    setBottomBar(
      <BottomBar
        wsRef={wsRef}
        onOpenCompose={() => setComposeOpen(true)}
      />,
    );
    return () => setBottomBar(null);
  }, [setBottomBar]);

  // Desktop `i` key → open compose (capture phase to intercept before xterm)
  useEffect(() => {
    function handleIKey(e: KeyboardEvent) {
      if (composeOpen) return;
      if (e.key !== "i") return;
      // Only intercept when focus is within the terminal (xterm's internal elements)
      const target = e.target as HTMLElement;
      if (!terminalRef.current?.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      setComposeOpen(true);
    }
    document.addEventListener("keydown", handleIKey, { capture: true });
    return () => document.removeEventListener("keydown", handleIKey, { capture: true });
  }, [composeOpen]);

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
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (escTimerRef.current) clearTimeout(escTimerRef.current);
    };
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
      const wsUrl = `${wsProto}//${wsHost}:${relayPort}/${projectName}/${windowIndex}`;
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
  }, [projectName, windowIndex, relayPort]);

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
    <>
      <div
        ref={terminalRef}
        className={`flex-1 min-h-0 transition-opacity ${composeOpen ? "opacity-50" : ""}`}
      />

      {composeOpen && (
        <ComposeBuffer wsRef={wsRef} onClose={() => setComposeOpen(false)} />
      )}

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
    </>
  );
}
