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
  // Route is /$server/$window — the window id (@N) is the only identity in the
  // URL. The owning session is derived from the SSE snapshot, not the URL. Old
  // 3-segment /$server/$session/$window URLs are a hard break (no redirect shim).
  path: "/$window",
  parseParams: (params) => ({
    window: params.window,
  }),
});

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/board/$name",
  parseParams: (params) => ({ name: params.name }),
  component: BoardPage,
});

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
