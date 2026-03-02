"use client";

import { useRouter } from "next/navigation";
import { useState, useMemo, useCallback } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { SessionCard } from "@/components/session-card";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import type { WindowInfo } from "@/lib/types";

type Props = {
  projectName: string;
  initialWindows: WindowInfo[];
};

export function ProjectClient({ projectName, initialWindows }: Props) {
  const router = useRouter();
  const { sessions } = useSessions();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [sendMessage, setSendMessage] = useState("");

  // Get live windows for this project
  const windows = useMemo(() => {
    const session = sessions.find((s) => s.name === projectName);
    return session?.windows ?? initialWindows;
  }, [sessions, projectName, initialWindows]);

  const navigateToTerminal = useCallback(
    (index: number) => {
      const win = windows[index];
      if (win) {
        router.push(`/p/${projectName}/${win.index}`);
      }
    },
    [windows, projectName, router],
  );

  const { focusedIndex } = useKeyboardNav({
    itemCount: windows.length,
    onSelect: navigateToTerminal,
    shortcuts: {
      n: () => setShowCreateDialog(true),
      x: () => windows.length > 0 && setShowKillConfirm(true),
      s: () => windows.length > 0 && setShowSendDialog(true),
    },
  });

  async function handleCreate() {
    if (!createName.trim()) return;
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createWindow",
          session: projectName,
          name: createName.trim(),
        }),
      });
    } catch {
      // SSE will reflect actual state
    }
    setCreateName("");
    setShowCreateDialog(false);
  }

  async function handleKill() {
    const win = windows[focusedIndex];
    if (!win) return;
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "killWindow",
          session: projectName,
          index: win.index,
        }),
      });
    } catch {
      // SSE will reflect actual state
    }
    setShowKillConfirm(false);
  }

  async function handleSend() {
    const win = windows[focusedIndex];
    if (!win || !sendMessage.trim()) return;
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sendKeys",
          session: projectName,
          window: win.index,
          keys: sendMessage.trim(),
        }),
      });
    } catch {
      // Best effort
    }
    setSendMessage("");
    setShowSendDialog(false);
  }

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "create-window",
        label: "Create new window",
        shortcut: "n",
        onSelect: () => setShowCreateDialog(true),
      },
      {
        id: "kill-window",
        label: "Kill focused window",
        shortcut: "x",
        onSelect: () => windows.length > 0 && setShowKillConfirm(true),
      },
      {
        id: "send-message",
        label: "Send message to agent",
        shortcut: "s",
        onSelect: () => windows.length > 0 && setShowSendDialog(true),
      },
      {
        id: "back",
        label: "Back to dashboard",
        onSelect: () => router.push("/"),
      },
      ...windows.map((w) => ({
        id: `terminal-${w.index}`,
        label: `Open terminal: ${w.name}`,
        onSelect: () => router.push(`/p/${projectName}/${w.index}`),
      })),
    ],
    [windows, projectName, router],
  );

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="text-text-secondary hover:text-text-primary text-sm"
          >
            ←
          </button>
          <h1 className="text-lg font-medium">{projectName}</h1>
          <span className="text-xs text-text-secondary">
            {windows.length} window{windows.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <kbd className="px-1.5 py-0.5 rounded border border-border">n</kbd>
          <span>new</span>
          <kbd className="px-1.5 py-0.5 rounded border border-border">x</kbd>
          <span>kill</span>
          <kbd className="px-1.5 py-0.5 rounded border border-border">s</kbd>
          <span>send</span>
        </div>
      </header>

      {windows.length === 0 ? (
        <div className="text-center text-text-secondary py-16">
          <p className="text-sm">No windows in this session</p>
          <p className="text-xs mt-2">
            Press <kbd className="px-1 border border-border rounded">n</kbd> to
            create one
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {windows.map((win, i) => (
            <SessionCard
              key={win.index}
              window={win}
              projectName={projectName}
              focused={i === focusedIndex}
              onClick={() => navigateToTerminal(i)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      {showCreateDialog && (
        <Dialog
          title="Create window"
          onClose={() => setShowCreateDialog(false)}
        >
          <input
            autoFocus
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Window name..."
            className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={handleCreate}
            className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary"
          >
            Create
          </button>
        </Dialog>
      )}

      {/* Kill confirmation */}
      {showKillConfirm && (
        <Dialog title="Kill window?" onClose={() => setShowKillConfirm(false)}>
          <p className="text-sm text-text-secondary mb-3">
            Kill window &quot;{windows[focusedIndex]?.name}&quot;? This cannot
            be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowKillConfirm(false)}
              className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleKill}
              className="flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
      )}

      {/* Send dialog */}
      {showSendDialog && (
        <Dialog
          title={`Send to ${windows[focusedIndex]?.name}`}
          onClose={() => setShowSendDialog(false)}
        >
          <input
            autoFocus
            type="text"
            value={sendMessage}
            onChange={(e) => setSendMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Message..."
            className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={handleSend}
            className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary"
          >
            Send
          </button>
        </Dialog>
      )}

      <CommandPalette actions={paletteActions} />
    </div>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="relative bg-bg-primary border border-border rounded-lg p-4 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}
