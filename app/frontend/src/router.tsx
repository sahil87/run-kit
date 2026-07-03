import {
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { lazy } from "react";
import { RootWrapper, ServerShell } from "@/app";
import { ServerListPage } from "@/components/server-list-page";

const BoardPage = lazy(() =>
  import("@/components/board/board-page").then((m) => ({ default: m.BoardPage })),
);

// The terminal route serializes the tmux window id (`@N`) as its numeric part
// only (`N`) in the URL — `/testServer/0`, not `/testServer/%400`. tmux window
// ids are always `@` + digits, so stripping the `@` for display is a lossless,
// bijective mapping; the `@N` form is restored by parse and remains the window
// identity everywhere in code. These are the two directions of that mapping,
// exported as pure functions so they are unit-testable.

/** stringify direction: param `@N` → URL segment `N` (strip the leading `@`). */
export function windowIdToUrlSegment(windowId: string): string {
  return windowId.replace(/^@/, "");
}

/**
 * parse direction: URL segment `N` → param `@N` (prepend `@`). Idempotent — a
 * segment that already carries `@` (an old bookmarked `/testServer/%400` deep
 * link, whose segment decodes to `@0`) is returned unchanged, so it resolves to
 * `@0` and never `@@0`.
 */
export function urlSegmentToWindowId(segment: string): string {
  return segment.startsWith("@") ? segment : `@${segment}`;
}

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 bg-bg-primary">
      <h1 className="text-xl text-text-primary">Page not found</h1>
      <a href="/" className="text-accent hover:underline">
        Go to server list
      </a>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootWrapper,
  notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ServerListPage,
});

const serverLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$server",
  component: ServerShell,
});

const serverIndexRoute = createRoute({
  getParentRoute: () => serverLayoutRoute,
  path: "/",
});

const terminalRoute = createRoute({
  getParentRoute: () => serverLayoutRoute,
  // Route is /$server/$window — the window id (@N) is the only window identity.
  // The URL segment carries the numeric part only (`@N` sans `@`, e.g. `/srv/0`);
  // parse restores the `@N` form, which remains the identity everywhere in code.
  // The owning session is derived from the SSE snapshot, not the URL. Old
  // 3-segment /$server/$session/$window URLs are a hard break (no redirect shim),
  // but old bookmarked /$server/%40N deep links still resolve via the idempotent
  // parse (segment decodes to @N → parse leaves it @N, never @@N).
  path: "/$window",
  params: {
    parse: (params) => ({
      window: urlSegmentToWindowId(params.window),
    }),
    stringify: (params) => ({
      window: windowIdToUrlSegment(params.window),
    }),
  },
});

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/board/$name",
  parseParams: (params) => ({ name: params.name }),
  component: BoardPage,
});

// Canonical page names (spoken/doc vocabulary — see docs/memory/run-kit/ui-patterns.md):
//   /                  → Cockpit      (ServerListPage — global home / server list)
//   /$server           → Server Cabin (ServerShell — a single server's view)
//   /$server/$window   → Terminal     (inherited layout — a specific window;
//                                       URL segment is the window id's numeric
//                                       part, @N sans @; parse restores @N)
//   /board/$name       → Board        (BoardPage — cross-server pane board)
//   not-found fallback → Not Found    (NotFoundPage — root notFoundComponent catch-all)
const routeTree = rootRoute.addChildren([
  indexRoute,
  boardRoute,
  serverLayoutRoute.addChildren([serverIndexRoute, terminalRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
