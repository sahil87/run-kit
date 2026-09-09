/**
 * Code-workspace fetch orchestration (spec docs/specs/right-panel.md § The
 * code lens): the code tile mounts its iframe at the tab-keyed `?workspace=`
 * URL, and this hook owns the derivation GET that produces the path. Invoked
 * from app.tsx's layout-state block; the result passes down through
 * SurfaceLayout to CodeSurface, which stays a lean iframe + states component.
 *
 * - The fetch gates on the SUBSTRATE code root (`@rk_win_code_root`, the
 *   payload's `codeRoot`) — never the `gitRoot` fallback — and on the code
 *   tile actually being open: the GET is the single writer of workspace
 *   files, so it must not fire for editors never opened.
 * - Until the path resolves the tile is PENDING (`codeSrc: null`). A
 *   `no-root` (409 — the option read empty at request time, a race against
 *   the seed POST) keeps the pending state; the next payload change re-drives
 *   the effect (SSE-driven, no polling).
 * - Any other failure (5xx, network) degrades to the `?folder=` form so the
 *   editor still opens, logging exactly one console warning per
 *   (server, window, root) — the resolved entry suppresses a refetch.
 * - A REFUSED seed POST (`seedRejected` — app.tsx's seed effect recorded the
 *   backend's refusal, e.g. a root outside $HOME failing path validation) can
 *   never produce a substrate codeRoot: the tile degrades to the same
 *   `?folder=` form (one console warning per server/window/folder) instead of
 *   pending forever. A later successful seed (a changed root re-attempts)
 *   re-arms the workspace path, which then takes precedence as usual.
 * - `followFolder` is the follow rule's fetch half: after the editor
 *   navigated ITSELF to a new folder (File > Open Folder — app.tsx already
 *   POSTed the latch), re-derive the workspace and return it as a
 *   nonce-keyed `followSrc`, the one sanctioned parent re-navigation. A
 *   failed follow leaves the editor at its own (working) `?folder=`
 *   navigation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCodeWorkspace } from "@/api/client";
import { codeServerSrc, codeServerWorkspaceSrc } from "@/components/code-surface";
import { codeRootFor } from "@/lib/code-folder-latch";
import type { ViewWindow } from "@/lib/window-view";

/** The one sanctioned parent re-navigation payload: a fresh `nonce` is what
 *  licenses CodeSurface to override its per-mount-generation src ref, exactly
 *  once per nonce. */
export interface CodeFollowSrc {
  src: string;
  nonce: number;
}

export interface CodeWorkspace {
  /** The code tile's mount src: null ⇒ pending (unresolved), a string is the
   *  `?workspace=` URL — or the `?folder=` degrade after a failed derivation. */
  codeSrc: string | null;
  followSrc: CodeFollowSrc | null;
  followFolder: (folder: string) => void;
}

export function useCodeWorkspace(
  server: string,
  windowId: string | undefined,
  win: ViewWindow | null,
  codeTileOpen: boolean,
  seedRejected: boolean,
): CodeWorkspace {
  // Resolved entries are keyed by (server, window, root): an unchanged key
  // never re-fetches — the fetch half of the mount-generation rule (a root
  // change re-derives for FUTURE mounts; the live frame is untouched).
  const [resolved, setResolved] = useState<{ key: string; src: string } | null>(null);
  const [follow, setFollow] = useState<{ key: string; src: string; nonce: number } | null>(null);
  const followNonceRef = useRef(0);

  const rootKey =
    windowId && codeTileOpen && win?.codeRoot
      ? `${server}:${windowId}:${win.codeRoot}`
      : null;

  useEffect(() => {
    if (!windowId || rootKey === null || !win) return;
    if (resolved?.key === rootKey) return;
    let alive = true;
    fetchCodeWorkspace(server, windowId)
      .then((result) => {
        if (!alive || result.status === "no-root") return;
        setResolved({ key: rootKey, src: codeServerWorkspaceSrc(result.path) });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        console.warn(
          "code workspace derivation failed; opening the editor at the ?folder= fallback",
          err,
        );
        setResolved({ key: rootKey, src: codeServerSrc(codeRootFor(win)) });
      });
    return () => {
      alive = false;
    };
  }, [server, windowId, rootKey, resolved, win]);

  // Seed-refusal degrade: the backend refused this folder as a code root, so
  // the substrate root (and with it the derivation GET's gate) will never
  // arrive — mount the `?folder=` form, one console warning per key. The key
  // lives in its own `seed-rejected:` namespace: when a later retry lands a
  // substrate root, `rootKey` re-keys the entry and the workspace path takes
  // precedence in the return below.
  const fallbackKey =
    windowId && codeTileOpen && seedRejected && codeRootFor(win)
      ? `${server}:${windowId}:seed-rejected:${codeRootFor(win)}`
      : null;
  useEffect(() => {
    if (!win || fallbackKey === null) return;
    if (resolved?.key === fallbackKey) return;
    console.warn(
      "code root seed refused by the backend; opening the editor at the ?folder= fallback",
    );
    setResolved({ key: fallbackKey, src: codeServerSrc(codeRootFor(win)) });
  }, [fallbackKey, resolved, win]);

  const followFolder = useCallback(
    (folder: string) => {
      if (!windowId) return;
      const key = `${server}:${windowId}`;
      fetchCodeWorkspace(server, windowId)
        .then((result) => {
          if (result.status !== "ok") return;
          const src = codeServerWorkspaceSrc(result.path);
          followNonceRef.current += 1;
          setFollow({ key, src, nonce: followNonceRef.current });
          // Keep the mount src current for future mount generations (a
          // reachability flip or window switch boots at the new workspace);
          // the live frame ignores it — only the nonce moves it.
          setResolved({ key: `${key}:${folder}`, src });
        })
        .catch(() => {});
    },
    [server, windowId],
  );

  const windowKey = `${server}:${windowId ?? ""}`;
  return {
    // The substrate (workspace) entry wins over the seed-refusal fallback: a
    // late seed success re-arms the workspace path for the next mount
    // generation (the live frame never re-navigates — mount-generation rule).
    codeSrc:
      rootKey !== null && resolved?.key === rootKey
        ? resolved.src
        : fallbackKey !== null && resolved?.key === fallbackKey
          ? resolved.src
          : null,
    followSrc:
      follow && follow.key === windowKey ? { src: follow.src, nonce: follow.nonce } : null,
    followFolder,
  };
}
