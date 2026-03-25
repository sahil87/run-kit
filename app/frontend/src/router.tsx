import {
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { RootWrapper, ServerShell } from "@/app";
import { ServerListPage } from "@/components/server-list-page";

function NotFoundPage() {
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
  path: "/$session/$window",
  parseParams: (params) => ({
    session: params.session,
    window: params.window,
  }),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  serverLayoutRoute.addChildren([serverIndexRoute, terminalRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
