import { useState, useCallback } from "react";
import { renameWindow, killWindow } from "@/api/client";

type UseDialogStateOptions = {
  sessionName: string | undefined;
  windowIndex: number | undefined;
};

export function useDialogState({ sessionName, windowIndex }: UseDialogStateOptions) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [renameName, setRenameName] = useState("");

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

  const openKillConfirm = useCallback(() => setShowKillConfirm(true), []);
  const closeKillConfirm = useCallback(() => setShowKillConfirm(false), []);

  const handleRename = useCallback(async () => {
    if (!renameName.trim() || !sessionName || windowIndex == null) return;
    try {
      await renameWindow(sessionName, windowIndex, renameName.trim());
    } catch {
      // SSE will reflect
    }
    setShowRenameDialog(false);
  }, [renameName, sessionName, windowIndex]);

  const handleKillWindow = useCallback(async () => {
    if (!sessionName || windowIndex == null) return;
    try {
      await killWindow(sessionName, windowIndex);
    } catch {
      // SSE will reflect
    }
    setShowKillConfirm(false);
  }, [sessionName, windowIndex]);

  return {
    showCreateDialog,
    showRenameDialog,
    showKillConfirm,
    renameName,
    setRenameName,
    openCreateDialog,
    closeCreateDialog,
    openRenameDialog,
    closeRenameDialog,
    openKillConfirm,
    closeKillConfirm,
    handleRename,
    handleKillWindow,
  };
}
