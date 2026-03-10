import { useNavigate, useParams } from "@tanstack/react-router";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSessions } from "@/hooks/use-sessions";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { useChromeDispatch } from "@/contexts/chrome-context";
import { SessionCard } from "@/components/session-card";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { Dialog } from "@/components/dialog";
import type { WindowInfo } from "@/types";

export function Project() {
  const { project: projectName } = useParams({ from: "/p/$project" });
  const navigate = useNavigate();
  const { sessions } = useSessions();
  const { setBreadcrumbs, setLine2Left, setLine2Right } = useChromeDispatch();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [killWindowTarget, setKillWindowTarget] = useState<WindowInfo | null>(null);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WindowInfo | null>(null);
  const [renameName, setRenameName] = useState("");
  const [createName, setCreateName] = useState("");
  const [sendMessage, setSendMessage] = useState("");

  const windows = useMemo(() => {
    const session = sessions.find((s) => s.name === projectName);
    return session?.windows ?? [];
  }, [sessions, projectName]);

  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const focusedIndexRef = useRef(0);

  const navigateToTerminal = useCallback(
    (index: number) => {
      const win = windows[index];
      if (win) {
        navigate({ to: "/p/$project/$window", params: { project: projectName, window: String(win.index) }, search: { name: win.name } });
      }
    },
    [windows, projectName, navigate],
  );

  const shortcuts = useMemo(
    () => ({
      n: () => setShowCreateDialog(true),
      x: () => { if (windowsRef.current.length > 0) setShowKillConfirm(true); },
      s: () => { if (windowsRef.current.length > 0) setShowSendDialog(true); },
      r: () => {
        if (windowsRef.current.length > 0) {
          const win = windowsRef.current[focusedIndexRef.current];
          if (win) { setRenameTarget(win); setRenameName(win.name); setShowRenameDialog(true); }
        }
      },
    }),
    [],
  );

  const { focusedIndex, setFocusedIndex } = useKeyboardNav({
    itemCount: windows.length,
    onSelect: navigateToTerminal,
    shortcuts,
  });
  focusedIndexRef.current = focusedIndex;

  useEffect(() => {
    setBreadcrumbs([{
      icon: "⬡",
      label: projectName,
      dropdownItems: sessions.map((s) => ({
        label: s.name,
        href: `/p/${encodeURIComponent(s.name)}`,
        current: s.name === projectName,
      })),
    }]);
    return () => { setBreadcrumbs([]); setLine2Left(null); setLine2Right(null); };
  }, [projectName, sessions, setBreadcrumbs, setLine2Left, setLine2Right]);

  useEffect(() => {
    setLine2Left(
      <div className="flex items-center gap-3">
        <button onClick={() => setShowCreateDialog(true)} className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary">+ New Window</button>
        <button onClick={() => windows.length > 0 && setShowSendDialog(true)} disabled={windows.length === 0} className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary disabled:opacity-40 disabled:cursor-not-allowed">Send Message</button>
        <button
          onClick={() => {
            if (windows.length > 0) {
              const win = windows[focusedIndex];
              if (win) { setRenameTarget(win); setRenameName(win.name); setShowRenameDialog(true); }
            }
          }}
          disabled={windows.length === 0}
          className="text-sm px-3 py-1 border border-border rounded hover:border-text-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >Rename</button>
      </div>,
    );
  }, [windows.length, focusedIndex, windows, setLine2Left]);

  useEffect(() => {
    setLine2Right(
      <span className="text-xs text-text-secondary">{windows.length} window{windows.length !== 1 ? "s" : ""}</span>,
    );
  }, [windows.length, setLine2Right]);

  async function handleRename() {
    const win = renameTarget;
    if (!win || !renameName.trim()) return;
    try {
      await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "renameWindow", session: projectName, index: win.index, name: renameName.trim() }) });
    } catch { /* SSE */ }
    setShowRenameDialog(false); setRenameTarget(null);
  }

  async function handleCreate() {
    if (!createName.trim()) return;
    try {
      await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createWindow", session: projectName, name: createName.trim() }) });
    } catch { /* SSE */ }
    setCreateName(""); setShowCreateDialog(false);
  }

  async function handleKill() {
    const win = killWindowTarget ?? windows[focusedIndex];
    if (!win) return;
    try {
      await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "killWindow", session: projectName, index: win.index }) });
    } catch { /* SSE */ }
    setShowKillConfirm(false); setKillWindowTarget(null);
  }

  async function handleSend() {
    const win = windows[focusedIndex];
    if (!win || !sendMessage.trim()) return;
    try {
      await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sendKeys", session: projectName, window: win.index, keys: sendMessage.trim() }) });
    } catch { /* best effort */ }
    setSendMessage(""); setShowSendDialog(false);
  }

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      { id: "create-window", label: "Create new window", shortcut: "n", onSelect: () => setShowCreateDialog(true) },
      { id: "kill-window", label: "Kill focused window", shortcut: "x", onSelect: () => { const win = windows[focusedIndex]; if (win) { setKillWindowTarget(win); setShowKillConfirm(true); } } },
      { id: "send-message", label: "Send message to agent", shortcut: "s", onSelect: () => windows.length > 0 && setShowSendDialog(true) },
      { id: "rename-window", label: "Rename focused window", shortcut: "r", onSelect: () => { const win = windows[focusedIndex]; if (win) { setRenameTarget(win); setRenameName(win.name); setShowRenameDialog(true); } } },
      { id: "back", label: "Back to dashboard", onSelect: () => navigate({ to: "/" }) },
      ...windows.map((w) => ({ id: `terminal-${w.index}`, label: `Open terminal: ${w.name}`, onSelect: () => navigate({ to: "/p/$project/$window", params: { project: projectName, window: String(w.index) }, search: { name: w.name } }) })),
    ],
    [windows, focusedIndex, projectName, navigate],
  );

  const killTarget = killWindowTarget ?? windows[focusedIndex];

  return (
    <>
      {windows.length === 0 ? (
        <div className="text-center text-text-secondary py-16">
          <p className="text-sm">No windows in this session</p>
          <p className="text-xs mt-2">Press <kbd className="px-1 border border-border rounded">n</kbd> to create one</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {windows.map((win, i) => (
            <SessionCard key={win.index} window={win} projectName={projectName} focused={i === focusedIndex} onMouseEnter={() => setFocusedIndex(i)} onClick={() => navigateToTerminal(i)} onKill={() => { setKillWindowTarget(win); setShowKillConfirm(true); }} />
          ))}
        </div>
      )}

      {showCreateDialog && (
        <Dialog title="Create window" onClose={() => setShowCreateDialog(false)}>
          <input autoFocus type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} aria-label="Window name" placeholder="Window name..." className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary" />
          <button onClick={handleCreate} className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary">Create</button>
        </Dialog>
      )}

      {showKillConfirm && killTarget && (
        <Dialog title="Kill window?" onClose={() => { setShowKillConfirm(false); setKillWindowTarget(null); }}>
          <p className="text-sm text-text-secondary mb-3">Kill window <strong>{killTarget.name}</strong>? This cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={() => { setShowKillConfirm(false); setKillWindowTarget(null); }} className="flex-1 text-sm py-1.5 border border-border rounded hover:border-text-secondary">Cancel</button>
            <button onClick={handleKill} className="flex-1 text-sm py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50">Kill</button>
          </div>
        </Dialog>
      )}

      {showSendDialog && windows.length > 0 && (
        <Dialog title={`Send to ${windows[focusedIndex]?.name}`} onClose={() => setShowSendDialog(false)}>
          <input autoFocus type="text" value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSend()} aria-label="Message to send" placeholder="Message..." className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary" />
          <button onClick={handleSend} className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary">Send</button>
        </Dialog>
      )}

      {showRenameDialog && renameTarget && (
        <Dialog title="Rename window" onClose={() => { setShowRenameDialog(false); setRenameTarget(null); }}>
          <input autoFocus type="text" value={renameName} onChange={(e) => setRenameName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRename()} onFocus={(e) => e.target.select()} aria-label="Window name" placeholder="Window name..." className="w-full bg-transparent text-text-primary text-sm p-2 border border-border rounded outline-none placeholder:text-text-secondary" />
          <button onClick={handleRename} className="mt-3 w-full text-sm py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary">Rename</button>
        </Dialog>
      )}

      <CommandPalette actions={paletteActions} />
    </>
  );
}
