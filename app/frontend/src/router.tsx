import {
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { lazy } from "react";
import { RootWrapper, AppLayout, ServerShell } from "@/app";
import { HostOverviewPage } from "@/components/host-overview-page";
import { useSignalTopBarNotFound } from "@/contexts/top-bar-slot-context";

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
  // Signal the persistent `RootTopBar` to force its minimal `host`-like
  // fallback mode while this page renders. Route params alone can't distinguish
  // a not-found from a real route: TanStack Router's fuzzy not-found handling
  // retains the partially-matched params (e.g. `/board/x/y` keeps `name=x`), so
  // without this signal the bar would derive `board` mode ("Board: x") over the
  // not-found body (260707-4vq2 rework, R10).
  useSignalTopBarNotFound();
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 bg-bg-primary">
      <h1 className="text-xl text-text-primary">Page not found</h1>
      <a href="/" className="text-accent hover:underline">
        Go to server list
      </a>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootWrapper,
});

// Pathless layout route (260707-4vq2): hosts the persistent TopBar chrome via
// `AppLayout` and uniformly parents every page route below. Because it carries
// no `path`, it adds a stable middle match to EVERY route's chain
// (`[root, app-layout, <leaf>]`) without touching any URL — so `AppLayout` (and
// the single TopBar it mounts) is never remounted across navigation, which is
// what makes the bar persist in place. `id` (not `path`) is how tanstack-router
// names a pathless layout route.
//
// `notFoundComponent` lives HERE (not on the root route) so an unmatched path
// renders `NotFoundPage` inside `AppLayout`'s `<Outlet>` — i.e. BELOW the
// persistent TopBar (R10), where the route-derived mode falls back to the
// minimal `host`-like heading.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app-layout",
  component: AppLayout,
  notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  component: HostOverviewPage,
});

const serverLayoutRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/$server",
  component: ServerShell,
});

const serverIndexRoute = createRoute({
  getParentRoute: () => serverLayoutRoute,
  path: "/",
});

// The `?view=` search param carries the per-viewer window-view lens (spec R2,
// change 260714-t97o-web-view-lens; chat lens folded in from 260714-r7rq). It is
// per-VIEWER client state, NOT part of the window's identity — no new route
// (Constitution IV). `web` and `chat` are the valid values (`tty` is the absence
// of the param — the always-available default lens); any other/unknown value is
// DROPPED (treated as absent), never errored, so a stale/garbage deep link
// degrades to the default view rather than a route error. The registry is
// open-ended: `desktop` extends this union when it ships.
type TerminalSearch = { view?: "web" | "chat" };

// Exported as a pure function so the unknown-value drop is unit-testable.
export function validateTerminalSearch(
  search: Record<string, unknown>,
): TerminalSearch {
  return search.view === "web" || search.view === "chat"
    ? { view: search.view }
    : {};
}

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
  validateSearch: validateTerminalSearch,
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
  getParentRoute: () => appLayoutRoute,
  path: "/board/$name",
  parseParams: (params) => ({ name: params.name }),
  component: BoardPage,
});

// Canonical page names (spoken/doc vocabulary — see docs/memory/run-kit/ui-patterns.md):
//   /                  → Host         (HostOverviewPage — global home / server list)
//   /$server           → tmux Server  (ServerShell — a single server's view)
//   /$server/$window   → Terminal     (inherited layout — a specific window;
//                                       URL segment is the window id's numeric
//                                       part, @N sans @; parse restores @N)
//   /board/$name       → Board        (BoardPage — cross-server pane board)
//   not-found fallback → Not Found    (NotFoundPage — app-layout route's
//                                       notFoundComponent, rendered below the
//                                       persistent TopBar; see appLayoutRoute)
const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute,
    boardRoute,
    serverLayoutRoute.addChildren([serverIndexRoute, terminalRoute]),
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
