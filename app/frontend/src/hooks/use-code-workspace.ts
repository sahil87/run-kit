/**
 * Code-workspace fetch orchestration (spec docs/specs/right-panel.md § The
 * code lens): the code tile mounts its iframe at the tab-keyed `?workspace=`
 * URL, and this hook owns the derivation GET that produces the path. Invoked
 * from app.tsx's layout-state block; the result passes down through
 * SurfaceLayout to CodeSurface, which stays a lean iframe + states component.
 *
 * - Resolved srcs live in a MAP keyed `${server}:${windowId}:${root}` (plus
 *   the `seed-rejected:` namespace below) that survives window switches for
 *   the hook's lifetime: revisiting a window renders its src synchronously
 *   (no pending flash, no refetch), and a retained code frame's src outlives
 *   its window's active period. Nothing is persisted — the map is in-memory
 *   viewer state.
 * - The fetch gates on the SUBSTRATE code root (`@rk_win_code_root`, the
 *   payload's `codeRoot`) — never the `gitRoot` fallback — and on the code
 *   tile actually being open: the GET is the single writer of workspace
 *   files, so it must not fire for editors never opened. The derivation
 *   effect fires only for the ACTIVE window and only while its key has no
 *   entry.
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
 *  once per nonce. `root` is the folder followed to — the frame record's
 *  eviction baseline moves with it before the payload catches up. */
export interface CodeFollowSrc {
  src: string;
  nonce: number;
  root: string;
}

/** Optional cross-window inputs: `windowsById` backs the `codeSrcFor` lookup
 *  (the per-window key embeds the window's CURRENT root, so resolving another
 *  window's src needs its payload record); `liveWindowIds` prunes entries
 *  whose window left the server's live set (killed/closed). */
export interface CodeWorkspaceOptions {
  windowsById?: ReadonlyMap<string, ViewWindow>;
  liveWindowIds?: ReadonlySet<string>;
}

export interface CodeWorkspace {
  /** The code tile's mount src: null ⇒ pending (unresolved), a string is the
   *  `?workspace=` URL — or the `?folder=` degrade after a failed derivation. */
  codeSrc: string | null;
  /** Per-window lookup over the resolved map (the substrate entry wins over
   *  the seed-refusal fallback): a retained frame's src stays readable while
   *  another window is active. Null while that window is unresolved. */
  codeSrcFor: (windowId: string) => string | null;
  followSrc: CodeFollowSrc | null;
  followFolder: (folder: string) => void;
}

export function useCodeWorkspace(
  server: string,
  windowId: string | undefined,
  win: ViewWindow | null,
  codeTileOpen: boolean,
  seedRejected: boolean,
  options?: CodeWorkspaceOptions,
): CodeWorkspace {
  // Resolved entries keyed by (server, window, root): an unchanged key never
  // re-fetches — the fetch half of the mount-generation rule (a root change
  // re-derives for FUTURE mounts; the live frame is untouched). The map
  // survives window switches so a revisit resolves synchronously and a
  // retained frame's src outlives its window's active period.
  const [resolved, setResolved] = useState<ReadonlyMap<string, string>>(new Map());
  const [follow, setFollow] = useState<{ key: string; src: string; nonce: number; root: string } | null>(null);
  const followNonceRef = useRef(0);

  const rootKey =
    windowId && codeTileOpen && win?.codeRoot
      ? `${server}:${windowId}:${win.codeRoot}`
      : null;

  useEffect(() => {
    if (!windowId || rootKey === null || !win) return;
    if (resolved.has(rootKey)) return;
    let alive = true;
    fetchCodeWorkspace(server, windowId)
      .then((result) => {
        if (!alive || result.status === "no-root") return;
        setResolved((prev) => new Map(prev).set(rootKey, codeServerWorkspaceSrc(result.path)));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        console.warn(
          "code workspace derivation failed; opening the editor at the ?folder= fallback",
          err,
        );
        setResolved((prev) => new Map(prev).set(rootKey, codeServerSrc(codeRootFor(win))));
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
    if (resolved.has(fallbackKey)) return;
    console.warn(
      "code root seed refused by the backend; opening the editor at the ?folder= fallback",
    );
    setResolved((prev) => new Map(prev).set(fallbackKey, codeServerSrc(codeRootFor(win))));
  }, [fallbackKey, resolved, win]);

  // Entries for windows that left the server's live set (killed/closed) are
  // pruned alongside their frame's eviction. Both key shapes embed the window
  // id as the SECOND colon-segment (server and window id carry no colon).
  const liveWindowIds = options?.liveWindowIds;
  useEffect(() => {
    if (!liveWindowIds) return;
    setResolved((prev) => {
      let next: Map<string, string> | null = null;
      for (const key of prev.keys()) {
        if (!liveWindowIds.has(key.split(":")[1])) {
          next ??= new Map(prev);
          next.delete(key);
        }
      }
      return next ?? prev;
    });
  }, [liveWindowIds]);

  const followFolder = useCallback(
    (folder: string) => {
      if (!windowId) return;
      const key = `${server}:${windowId}`;
      fetchCodeWorkspace(server, windowId)
        .then((result) => {
          if (result.status !== "ok") return;
          const src = codeServerWorkspaceSrc(result.path);
          followNonceRef.current += 1;
          setFollow({ key, src, nonce: followNonceRef.current, root: folder });
          // Keep the window's map entry current for future mount generations
          // (a reachability flip or an eviction + re-show boots at the new
          // workspace); the live frame ignores it — only the nonce moves it.
          setResolved((prev) => new Map(prev).set(`${key}:${folder}`, src));
        })
        .catch(() => {});
    },
    [server, windowId],
  );

  const windowsById = options?.windowsById;
  const codeSrcFor = useCallback(
    (id: string): string | null => {
      const w = windowsById?.get(id);
      if (!w) return null;
      // The substrate (workspace) entry wins over the seed-refusal fallback:
      // a late seed success re-arms the workspace path (the live frame never
      // re-navigates — mount-generation rule).
      if (w.codeRoot) {
        const src = resolved.get(`${server}:${id}:${w.codeRoot}`);
        if (src !== undefined) return src;
      }
      const folder = codeRootFor(w);
      if (folder !== "") {
        const src = resolved.get(`${server}:${id}:seed-rejected:${folder}`);
        if (src !== undefined) return src;
      }
      return null;
    },
    [resolved, server, windowsById],
  );

  const windowKey = `${server}:${windowId ?? ""}`;
  return {
    codeSrc:
      rootKey !== null && resolved.has(rootKey)
        ? (resolved.get(rootKey) ?? null)
        : fallbackKey !== null && resolved.has(fallbackKey)
          ? (resolved.get(fallbackKey) ?? null)
          : null,
    codeSrcFor,
    followSrc:
      follow && follow.key === windowKey
        ? { src: follow.src, nonce: follow.nonce, root: follow.root }
        : null,
    followFolder,
  };
}
