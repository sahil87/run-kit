import { useState, useCallback, useMemo, useRef } from "react";
import { renameSession, renameWindow, killSession, killWindow } from "@/api/client";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useSessionContext } from "@/contexts/session-context";
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
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showRenameSessionDialog, setShowRenameSessionDialog] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [showKillSessionConfirm, setShowKillSessionConfirm] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameSessionName, setRenameSessionName] = useState("");

  const { server } = useSessionContext();
  const { markRenamed, unmarkRenamed, markKilled, unmarkKilled } = useOptimisticContext();
  const { addToast } = useToast();
  const killWindowStore = useWindowStore((state) => state.killWindow);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const clearSession = useWindowStore((state) => state.clearSession);
  const renameWindowStore = useWindowStore((state) => state.renameWindow);
  const clearRename = useWindowStore((state) => state.clearRename);

  // Refs to capture identifiers at execute time, avoiding stale closures on rollback.
  // Captures (server, identifier) so rollback / settle targets the exact originating server.
  const lastRenameSessionRef = useRef<{ server: string; name: string } | null>(null);
  const lastRenameWindowRef = useRef<string | null>(null);
  const lastKillSessionRef = useRef<{ server: string; name: string } | null>(null);
  const lastKillWindowRef = useRef<string | null>(null);

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

  const { execute: executeRenameSession } = useOptimisticAction<[string, string, string]>({
    action: (srv, oldName, newName) => renameSession(srv, oldName, newName),
    onOptimistic: (srv, oldName, newName) => {
      lastRenameSessionRef.current = { server: srv, name: oldName };
      markRenamed("session", srv, oldName, newName);
    },
    onRollback: () => {
      const last = lastRenameSessionRef.current;
      if (last) unmarkRenamed(last.server, last.name);
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
    executeRenameSession(server, sessionName, newName);
    onSessionRenamed?.(newName);
    setShowRenameSessionDialog(false);
  }, [renameSessionName, sessionName, server, onSessionRenamed, executeRenameSession]);

  const { execute: executeRenameWindow } = useOptimisticAction<[string, string, string, number, string]>({
    action: (srv, session, _wid, index, newName) => renameWindow(srv, session, index, newName),
    onOptimistic: (_srv, session, wid, _index, newName) => {
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
    executeRenameWindow(server, sessionName, windowId, windowIndex, renameName.trim());
    setShowRenameDialog(false);
  }, [renameName, sessionName, windowIndex, windowId, server, executeRenameWindow]);

  const { execute: executeKillSession } = useOptimisticAction<[string, string]>({
    action: (srv, name) => killSession(srv, name),
    onOptimistic: (srv, name) => {
      lastKillSessionRef.current = { server: srv, name };
      markKilled("session", srv, name);
    },
    onAlwaysRollback: () => {
      const last = lastKillSessionRef.current;
      if (last) unmarkKilled("session", last.server, last.name);
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill session");
    },
    onAlwaysSettled: () => {
      const last = lastKillSessionRef.current;
      if (last) clearSession(last.name);
      lastKillSessionRef.current = null;
    },
  });

  const handleKillSession = useCallback(() => {
    if (!sessionName) return;
    executeKillSession(server, sessionName);
    onKillComplete?.();
    setShowKillSessionConfirm(false);
  }, [sessionName, server, onKillComplete, executeKillSession]);

  const { execute: executeKillWindow } = useOptimisticAction<[string, string, string, number]>({
    action: (srv, session, _wid, index) => killWindow(srv, session, index),
    onOptimistic: (_srv, session, wid) => {
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
    executeKillWindow(server, sessionName, windowId, windowIndex);
    onKillComplete?.();
    setShowKillConfirm(false);
  }, [sessionName, windowIndex, windowId, server, onKillComplete, executeKillWindow]);

  return useMemo(() => ({
    showRenameDialog,
    showRenameSessionDialog,
    showKillConfirm,
    showKillSessionConfirm,
    renameName,
    setRenameName,
    renameSessionName,
    setRenameSessionName,
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
    showRenameDialog,
    showRenameSessionDialog,
    showKillConfirm,
    showKillSessionConfirm,
    renameName,
    renameSessionName,
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
