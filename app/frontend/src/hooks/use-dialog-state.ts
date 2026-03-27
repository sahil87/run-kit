import { useState, useCallback, useMemo } from "react";
import { renameSession, renameWindow, killSession, killWindow } from "@/api/client";

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

  const handleRenameSession = useCallback(async () => {
    if (!renameSessionName.trim() || !sessionName) return;
    const newName = renameSessionName.trim();
    try {
      await renameSession(sessionName, newName);
      onSessionRenamed?.(newName);
    } catch {
      // SSE will reflect
    }
    setShowRenameSessionDialog(false);
  }, [renameSessionName, sessionName, onSessionRenamed]);

  const handleRename = useCallback(async () => {
    if (!renameName.trim() || !sessionName || windowIndex == null) return;
    try {
      await renameWindow(sessionName, windowIndex, renameName.trim());
    } catch {
      // SSE will reflect
    }
    setShowRenameDialog(false);
  }, [renameName, sessionName, windowIndex]);

  const handleKillSession = useCallback(async () => {
    if (!sessionName) return;
    try {
      await killSession(sessionName);
      onKillComplete?.();
    } catch {
      // SSE will reflect
    } finally {
      setShowKillSessionConfirm(false);
    }
  }, [sessionName, onKillComplete]);

  const handleKillWindow = useCallback(async () => {
    if (!sessionName || windowIndex == null) return;
    try {
      await killWindow(sessionName, windowIndex);
      onKillComplete?.();
    } catch {
      // SSE will reflect
    } finally {
      setShowKillConfirm(false);
    }
  }, [sessionName, windowIndex, onKillComplete]);

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
