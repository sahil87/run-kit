import { useState, useCallback, useMemo, useRef } from "react";
import { renameSession, renameWindow, killSession, killWindow } from "@/api/client";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useSessionContext } from "@/contexts/session-context";
import { useToast } from "@/components/toast";
import { useWindowStore } from "@/store/window-store";

type UseDialogStateOptions = {
  sessionName: string | undefined;
  windowId: string | undefined;
  onKillComplete?: () => void;
  onSessionRenamed?: (newName: string) => void;
};

export function useDialogState({ sessionName, windowId, onKillComplete, onSessionRenamed }: UseDialogStateOptions) {
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showRenameSessionDialog, setShowRenameSessionDialog] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [showKillSessionConfirm, setShowKillSessionConfirm] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameSessionName, setRenameSessionName] = useState("");

  // useDialogState is consumed only by AppShell where currentServer is set.
  // When null (board route, defensive), handlers no-op via the empty-string
  // guard at execute sites.
  const { currentServer } = useSessionContext();
  const server = currentServer ?? "";
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
  const lastRenameWindowRef = useRef<{ server: string; session: string; windowId: string } | null>(null);
  const lastKillSessionRef = useRef<{ server: string; name: string } | null>(null);
  const lastKillWindowRef = useRef<{ server: string; session: string; windowId: string } | null>(null);

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

  const { execute: executeRenameWindow } = useOptimisticAction<[string, string, string, string]>({
    action: (srv, _session, wid, newName) => renameWindow(srv, wid, newName),
    onOptimistic: (srv, session, wid, newName) => {
      lastRenameWindowRef.current = { server: srv, session, windowId: wid };
      renameWindowStore(srv, session, wid, newName);
    },
    onRollback: () => {
      const last = lastRenameWindowRef.current;
      if (last) clearRename(last.server, last.session, last.windowId);
    },
    onError: (err) => {
      addToast(err.message || "Failed to rename window");
    },
    onSettled: () => {
      const last = lastRenameWindowRef.current;
      if (last) clearRename(last.server, last.session, last.windowId);
      lastRenameWindowRef.current = null;
    },
  });

  const handleRename = useCallback(() => {
    if (!renameName.trim() || !sessionName || !windowId) return;
    executeRenameWindow(server, sessionName, windowId, renameName.trim());
    setShowRenameDialog(false);
  }, [renameName, sessionName, windowId, server, executeRenameWindow]);

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
      if (last) clearSession(last.server, last.name);
      lastKillSessionRef.current = null;
    },
  });

  const handleKillSession = useCallback(() => {
    if (!sessionName) return;
    executeKillSession(server, sessionName);
    onKillComplete?.();
    setShowKillSessionConfirm(false);
  }, [sessionName, server, onKillComplete, executeKillSession]);

  const { execute: executeKillWindow } = useOptimisticAction<[string, string, string]>({
    action: (srv, _session, wid) => killWindow(srv, wid),
    onOptimistic: (srv, session, wid) => {
      lastKillWindowRef.current = { server: srv, session, windowId: wid };
      killWindowStore(srv, session, wid);
    },
    onAlwaysRollback: () => {
      const last = lastKillWindowRef.current;
      if (last) restoreWindow(last.server, last.session, last.windowId);
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill window");
    },
    onAlwaysSettled: () => {
      const last = lastKillWindowRef.current;
      if (last) restoreWindow(last.server, last.session, last.windowId);
      lastKillWindowRef.current = null;
    },
  });

  const handleKillWindow = useCallback(() => {
    if (!sessionName || !windowId) return;
    executeKillWindow(server, sessionName, windowId);
    onKillComplete?.();
    setShowKillConfirm(false);
  }, [sessionName, windowId, server, onKillComplete, executeKillWindow]);

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
