"use client";

import "@xterm/xterm/css/xterm.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { useChromeDispatch } from "@/contexts/chrome-context";
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
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sessions } = useSessions();
  const { setBreadcrumbs, setLine2Left, setLine2Right, setBottomBar, setFullbleed } = useChromeDispatch();
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameName, setRenameName] = useState("");
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
    setLine2Left(
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setRenameName(windowName);
            setShowRenameDialog(true);
          }}
          className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary"
        >
          Rename
        </button>
        <button
          onClick={() => setShowKillConfirm(true)}
          className="text-sm px-3 py-1 border border-border rounded hover:border-red-400 hover:text-red-400 transition-colors"
        >
          Kill
        </button>
      </div>,
    );
  }, [setLine2Left, windowName]);

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
        onOpenCompose={() => setComposeOpen((v) => !v)}
      />,
    );
    return () => setBottomBar(null);
  }, [setBottomBar]);

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
      xtermRef.current = terminal;

      // WebSocket with exponential backoff reconnection
      // When served over HTTPS (e.g. via Caddy), use wss: on the same host/port
      // with /relay/ prefix. Over HTTP, connect directly to the relay port.
      const isSecure = window.location.protocol === "https:";
      const wsProto = isSecure ? "wss:" : "ws:";
      const wsHost = window.location.hostname;
      const wsUrl = isSecure
        ? `${wsProto}//${wsHost}:${window.location.port || "443"}/relay/${projectName}/${windowIndex}`
        : `${wsProto}//${wsHost}:${relayPort}/${projectName}/${windowIndex}`;
      let reconnectDelay = 1000;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let unmounting = false;

      function connect() {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          reconnectDelay = 1000; // Reset backoff on success
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

        ws.onerror = () => {
          // onclose will fire after onerror — reconnection handled there
        };
      }

      connect();

      // Send terminal input to WebSocket
      terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(data);
        }
      });

      // Handle resize — debounce via rAF to prevent reflow storms
      let resizeRafId: number | null = null;
      const resizeObserver = new ResizeObserver(() => {
        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = null;
          fitAddon?.fit();
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
  }, [projectName, windowIndex, relayPort]);

  async function handleRename() {
    if (!renameName.trim()) return;
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "renameWindow",
          session: projectName,
          index: parseInt(windowIndex, 10),
          name: renameName.trim(),
        }),
      });
    } catch {
      // SSE will reflect actual state
    }
    setShowRenameDialog(false);
    xtermRef.current?.focus();
  }

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
        id: "rename-window",
        label: "Rename window",
        shortcut: "r",
        onSelect: () => {
          setRenameName(windowName);
          setShowRenameDialog(true);
        },
      },
      {
        id: "kill-window",
        label: "Kill window",
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
    [projectName, windowName, router],
  );

  return (
    <>
      <div
        ref={terminalRef}
        role="application"
        aria-label={`Terminal: ${projectName}/${windowName}`}
        className={`flex-1 min-h-0 transition-opacity ${composeOpen ? "opacity-50" : ""}`}
      />

      {composeOpen && (
        <ComposeBuffer wsRef={wsRef} onClose={() => { setComposeOpen(false); xtermRef.current?.focus(); }} />
      )}

      {/* Rename dialog */}
      {showRenameDialog && (
        <Dialog title="Rename window" onClose={() => { setShowRenameDialog(false); xtermRef.current?.focus(); }}>
          <input
            autoFocus
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            onFocus={(e) => e.target.select()}
            aria-label="Window name"
            placeholder="Window name..."
            className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={handleRename}
            className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary"
          >
            Rename
          </button>
        </Dialog>
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
