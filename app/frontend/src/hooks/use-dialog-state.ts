import { useState, useCallback, useMemo, useRef } from "react";
import { renameSession, renameWindow, killSession, killWindow } from "@/api/client";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useToast } from "@/components/toast";
import { useWindowStore } from "@/store/window-store";

type UseDialogStateOptions = {
  sessionName: string | undefined;
  windowIndex: number | undefined;
  windowId: string | undefined;
  onKillComplete?: () => void;
  onSessionRenamed?: (newName: string) => void;
};

export function useDialogState({ sessionName, windowIndex, windowId, onKillComplete, onSessionRenamed }: UseDialogStateOptions) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showRenameSessionDialog, setShowRenameSessionDialog] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [showKillSessionConfirm, setShowKillSessionConfirm] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameSessionName, setRenameSessionName] = useState("");

  const { markRenamed, unmarkRenamed, markKilled, unmarkKilled } = useOptimisticContext();
  const { addToast } = useToast();
  const killWindowStore = useWindowStore((state) => state.killWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const clearSession = useWindowStore((state) => state.clearSession);
  const renameWindowStore = useWindowStore((state) => state.renameWindow);
  const clearRename = useWindowStore((state) => state.clearRename);

  // Refs to capture identifiers at execute time, avoiding stale closures on rollback
  const lastRenameSessionRef = useRef<string | null>(null);
  const lastRenameWindowRef = useRef<string | null>(null);
  const lastKillSessionRef = useRef<string | null>(null);
  const lastKillWindowRef = useRef<string | null>(null);

  const openCreateDialog = useCallback(() => setShowCreateDialog(true), []);
  const closeCreateDialog = useCallback(() => setShowCreateDialog(false), []);

  const openRenameDialog = useCallback(
    (currentName: string) => {
      setRenameName(currentName);
      setShowRenameDialog(true);
    },
    [],
  );
  const closeRenameDialog = useCallback(() => setShowRenameDialog(false), []);

  const openRenameSessionDialog = useCallback(
    (currentName: string) => {
      setRenameSessionName(currentName);
      setShowRenameSessionDialog(true);
    },
    [],
  );
  const closeRenameSessionDialog = useCallback(() => setShowRenameSessionDialog(false), []);

  const openKillConfirm = useCallback(() => setShowKillConfirm(true), []);
  const closeKillConfirm = useCallback(() => setShowKillConfirm(false), []);

  const openKillSessionConfirm = useCallback(() => setShowKillSessionConfirm(true), []);
  const closeKillSessionConfirm = useCallback(() => setShowKillSessionConfirm(false), []);

  const { execute: executeRenameSession } = useOptimisticAction<[string, string]>({
    action: (oldName, newName) => renameSession(oldName, newName),
    onOptimistic: (oldName, newName) => {
      lastRenameSessionRef.current = oldName;
      markRenamed("session", oldName, newName);
    },
    onRollback: () => {
      if (lastRenameSessionRef.current) unmarkRenamed(lastRenameSessionRef.current);
    },
    onError: (err) => {
      addToast(err.message || "Failed to rename session");
    },
    onSettled: () => {
      lastRenameSessionRef.current = null;
    },
  });

  const handleRenameSession = useCallback(() => {
    if (!renameSessionName.trim() || !sessionName) return;
    const newName = renameSessionName.trim();
    executeRenameSession(sessionName, newName);
    onSessionRenamed?.(newName);
    setShowRenameSessionDialog(false);
  }, [renameSessionName, sessionName, onSessionRenamed, executeRenameSession]);

  const { execute: executeRenameWindow } = useOptimisticAction<[string, string, number, string]>({
    action: (session, _wid, index, newName) => renameWindow(session, index, newName),
    onOptimistic: (session, wid, _index, newName) => {
      lastRenameWindowRef.current = wid;
      renameWindowStore(session, wid, newName);
    },
    onRollback: () => {
      if (lastRenameWindowRef.current && sessionName) {
        clearRename(sessionName, lastRenameWindowRef.current);
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to rename window");
    },
    onSettled: () => {
      if (lastRenameWindowRef.current && sessionName) {
        clearRename(sessionName, lastRenameWindowRef.current);
      }
      lastRenameWindowRef.current = null;
    },
  });

  const handleRename = useCallback(() => {
    if (!renameName.trim() || !sessionName || windowIndex == null || !windowId) return;
    executeRenameWindow(sessionName, windowId, windowIndex, renameName.trim());
    setShowRenameDialog(false);
  }, [renameName, sessionName, windowIndex, windowId, executeRenameWindow]);

  const { execute: executeKillSession } = useOptimisticAction<[string]>({
    action: (name) => killSession(name),
    onOptimistic: (name) => {
      lastKillSessionRef.current = name;
      markKilled("session", name);
    },
    onAlwaysRollback: () => {
      if (lastKillSessionRef.current) unmarkKilled(lastKillSessionRef.current);
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill session");
    },
    onAlwaysSettled: () => {
      if (lastKillSessionRef.current) clearSession(lastKillSessionRef.current);
      lastKillSessionRef.current = null;
    },
  });

  const handleKillSession = useCallback(() => {
    if (!sessionName) return;
    executeKillSession(sessionName);
    onKillComplete?.();
    setShowKillSessionConfirm(false);
  }, [sessionName, onKillComplete, executeKillSession]);

  const { execute: executeKillWindow } = useOptimisticAction<[string, string, number]>({
    action: (session, _wid, index) => killWindow(session, index),
    onOptimistic: (session, wid) => {
      lastKillWindowRef.current = wid;
      killWindowStore(session, wid);
    },
    onAlwaysRollback: () => {
      if (lastKillWindowRef.current && sessionName) restoreWindow(sessionName, lastKillWindowRef.current);
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill window");
    },
    onAlwaysSettled: () => {
      if (lastKillWindowRef.current && sessionName) restoreWindow(sessionName, lastKillWindowRef.current);
      lastKillWindowRef.current = null;
    },
  });

  const handleKillWindow = useCallback(() => {
    if (!sessionName || windowIndex == null || !windowId) return;
    executeKillWindow(sessionName, windowId, windowIndex);
    onKillComplete?.();
    setShowKillConfirm(false);
  }, [sessionName, windowIndex, windowId, onKillComplete, executeKillWindow]);

  return useMemo(() => ({
    showCreateDialog,
    showRenameDialog,
    showRenameSessionDialog,
    showKillConfirm,
    showKillSessionConfirm,
    renameName,
    setRenameName,
    renameSessionName,
    setRenameSessionName,
    openCreateDialog,
    closeCreateDialog,
    openRenameDialog,
    closeRenameDialog,
    openRenameSessionDialog,
    closeRenameSessionDialog,
    openKillConfirm,
    closeKillConfirm,
    openKillSessionConfirm,
    closeKillSessionConfirm,
    handleRename,
    handleRenameSession,
    handleKillSession,
    handleKillWindow,
  }), [
    showCreateDialog,
    showRenameDialog,
    showRenameSessionDialog,
    showKillConfirm,
    showKillSessionConfirm,
    renameName,
    renameSessionName,
    openCreateDialog,
    closeCreateDialog,
    openRenameDialog,
    closeRenameDialog,
    openRenameSessionDialog,
    closeRenameSessionDialog,
    openKillConfirm,
    closeKillConfirm,
    openKillSessionConfirm,
    closeKillSessionConfirm,
    handleRename,
    handleRenameSession,
    handleKillSession,
    handleKillWindow,
  ]);
}
