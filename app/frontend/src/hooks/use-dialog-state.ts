import { useState, useCallback, useMemo, useRef } from "react";
import { renameSession, renameWindow, killSession, killWindow } from "@/api/client";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useToast } from "@/components/toast";

type UseDialogStateOptions = {
  sessionName: string | undefined;
  windowIndex: number | undefined;
  onKillComplete?: () => void;
  onSessionRenamed?: (newName: string) => void;
};

export function useDialogState({ sessionName, windowIndex, onKillComplete, onSessionRenamed }: UseDialogStateOptions) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showRenameSessionDialog, setShowRenameSessionDialog] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [showKillSessionConfirm, setShowKillSessionConfirm] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameSessionName, setRenameSessionName] = useState("");

  const { markRenamed, unmarkRenamed, markKilled, unmarkKilled } = useOptimisticContext();
  const { addToast } = useToast();

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

  const { execute: executeRenameWindow } = useOptimisticAction<[string, number, string]>({
    action: (session, index, newName) => renameWindow(session, index, newName),
    onOptimistic: (session, index, newName) => {
      const id = `${session}:${index}`;
      lastRenameWindowRef.current = id;
      markRenamed("window", id, newName);
    },
    onRollback: () => {
      if (lastRenameWindowRef.current) unmarkRenamed(lastRenameWindowRef.current);
    },
    onError: (err) => {
      addToast(err.message || "Failed to rename window");
    },
    onSettled: () => {
      lastRenameWindowRef.current = null;
    },
  });

  const handleRename = useCallback(() => {
    if (!renameName.trim() || !sessionName || windowIndex == null) return;
    executeRenameWindow(sessionName, windowIndex, renameName.trim());
    setShowRenameDialog(false);
  }, [renameName, sessionName, windowIndex, executeRenameWindow]);

  const { execute: executeKillSession } = useOptimisticAction<[string]>({
    action: (name) => killSession(name),
    onOptimistic: (name) => {
      lastKillSessionRef.current = name;
      markKilled("session", name);
    },
    onRollback: () => {
      if (lastKillSessionRef.current) unmarkKilled(lastKillSessionRef.current);
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill session");
    },
    onSettled: () => {
      lastKillSessionRef.current = null;
    },
  });

  const handleKillSession = useCallback(() => {
    if (!sessionName) return;
    executeKillSession(sessionName);
    onKillComplete?.();
    setShowKillSessionConfirm(false);
  }, [sessionName, onKillComplete, executeKillSession]);

  const { execute: executeKillWindow } = useOptimisticAction<[string, number]>({
    action: (session, index) => killWindow(session, index),
    onOptimistic: (session, index) => {
      const id = `${session}:${index}`;
      lastKillWindowRef.current = id;
      markKilled("window", id);
    },
    onRollback: () => {
      if (lastKillWindowRef.current) unmarkKilled(lastKillWindowRef.current);
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill window");
    },
    onSettled: () => {
      lastKillWindowRef.current = null;
    },
  });

  const handleKillWindow = useCallback(() => {
    if (!sessionName || windowIndex == null) return;
    executeKillWindow(sessionName, windowIndex);
    onKillComplete?.();
    setShowKillConfirm(false);
  }, [sessionName, windowIndex, onKillComplete, executeKillWindow]);

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
