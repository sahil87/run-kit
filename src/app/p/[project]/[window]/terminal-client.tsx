"use client";

import "@xterm/xterm/css/xterm.css";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { useFileUpload } from "@/hooks/use-file-upload";
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
  const [composeInitialText, setComposeInitialText] = useState<string | undefined>();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFiles } = useFileUpload(projectName, windowIndex);

  useVisualViewport();

  // Look up active window from session data (follows byobu/tmux switches)
  const activeWindow = useMemo(() => {
    const session = sessions.find((s) => s.name === projectName);
    if (!session) return undefined;
    // Prefer the tmux-active window; fall back to URL-based lookup
    return session.windows.find((w) => w.isActiveWindow)
      ?? session.windows.find((w) => String(w.index) === windowIndex);
  }, [sessions, projectName, windowIndex]);

  // Track active window index and name (initialized from URL params, updated by SSE)
  const activeIndexRef = useRef(windowIndex);
  const activeNameRef = useRef(windowName);
  useEffect(() => {
    if (activeWindow) {
      activeIndexRef.current = String(activeWindow.index);
      activeNameRef.current = activeWindow.name;
    }
  }, [activeWindow]);

  // Set chrome slots + sync breadcrumb/URL with active window
  const displayName = activeWindow?.name ?? windowName;
  const displayIndex = activeWindow ? String(activeWindow.index) : windowIndex;

  useEffect(() => {
    setFullbleed(true);
    return () => {
      setFullbleed(false);
      setBreadcrumbs([]);
      setLine2Left(null);
      setLine2Right(null);
    };
  }, [setBreadcrumbs, setLine2Left, setLine2Right, setFullbleed]);

  // Update breadcrumb and URL when active window changes
  useEffect(() => {
    const currentSession = sessions.find((s) => s.name === projectName);
    setBreadcrumbs([
      {
        icon: "⬡",
        label: projectName,
        href: `/p/${encodeURIComponent(projectName)}`,
        dropdownItems: sessions.map((s) => ({
          label: s.name,
          href: `/p/${encodeURIComponent(s.name)}`,
          current: s.name === projectName,
        })),
      },
      {
        icon: "❯",
        label: displayName,
        dropdownItems: currentSession?.windows.map((w) => ({
          label: w.name,
          href: `/p/${encodeURIComponent(projectName)}/${w.index}?name=${encodeURIComponent(w.name)}`,
          current: String(w.index) === displayIndex,
        })) ?? [],
      },
    ]);
    // Sync URL without triggering Next.js routing
    const newUrl = `/p/${encodeURIComponent(projectName)}/${displayIndex}?name=${encodeURIComponent(displayName)}`;
    window.history.replaceState(window.history.state, "", newUrl);
  }, [projectName, displayName, displayIndex, sessions, setBreadcrumbs]);

  useEffect(() => {
    setLine2Left(
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setRenameName(activeNameRef.current);
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
  }, [setLine2Left]);

  useEffect(() => {
    setLine2Right(
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        {activeWindow && (
          <>
            <span
              className={`w-2 h-2 rounded-full ${
                activeWindow.activity === "active"
                  ? "bg-accent-green"
                  : "bg-text-secondary"
              }`}
            />
            <span>{activeWindow.activity}</span>
            {activeWindow.fabProgress && (
              <span className="text-accent px-1.5 py-0.5 rounded bg-accent/10">
                fab: {activeWindow.fabProgress}
              </span>
            )}
          </>
        )}
      </div>,
    );
  }, [activeWindow, setLine2Right]);

  // Open compose buffer with uploaded file paths
  const openComposeWithPaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const text = paths.join("\n");
    setComposeInitialText(text);
    setComposeOpen(true);
  }, []);

  // Paste handler — upload files from clipboard
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

  // Drag-and-drop handlers
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

  // Upload button handler (passed to BottomBar)
  const handleUploadFiles = useCallback(
    (files: FileList) => {
      uploadFiles(files).then(openComposeWithPaths);
    },
    [uploadFiles, openComposeWithPaths],
  );

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

  // Keyboard shortcuts (double-Esc + rename)
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
        return;
      }

      // Ctrl/Cmd+Enter toggles compose buffer (unless already inside it)
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "TEXTAREA") {
          e.preventDefault();
          setComposeOpen((v) => !v);
          return;
        }
      }

      // Guard: skip shortcuts when typing in inputs, dialogs, or palette
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "r") {
        setRenameName(activeNameRef.current);
        setShowRenameDialog(true);
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
          index: parseInt(activeIndexRef.current, 10),
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
          index: parseInt(activeIndexRef.current, 10),
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
        id: "upload-file",
        label: "Upload file",
        onSelect: () => fileInputRef.current?.click(),
      },
      {
        id: "rename-window",
        label: "Rename window",
        shortcut: "r",
        onSelect: () => {
          setRenameName(activeNameRef.current);
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
    [projectName, router],
  );

  return (
    <>
      <div
        ref={terminalRef}
        role="application"
        aria-label={`Terminal: ${projectName}/${displayName}`}
        className={`flex-1 min-h-0 overflow-hidden transition-opacity ${composeOpen ? "opacity-50" : ""} ${dragOver ? "ring-2 ring-accent ring-inset" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />

      {/* Hidden file input for command palette upload action */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleUploadFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {composeOpen && (
        <ComposeBuffer
          wsRef={wsRef}
          onClose={() => { setComposeOpen(false); setComposeInitialText(undefined); xtermRef.current?.focus(); }}
          initialText={composeInitialText}
          onUploadFiles={handleUploadFiles}
        />
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
            Kill window <strong>{displayName}</strong>? This cannot be undone.
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
