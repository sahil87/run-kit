import {
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { App } from "@/app";

const rootRoute = createRootRoute({
  component: App,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$session",
  parseParams: (params) => ({
    session: params.session,
  }),
});

const sessionWindowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$session/$window",
  parseParams: (params) => ({
    session: params.session,
    window: params.window,
  }),
});

const routeTree = rootRoute.addChildren([indexRoute, sessionRoute, sessionWindowRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
