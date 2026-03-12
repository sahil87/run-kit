import {
  createRouter,
  createRootRoute,
  createRoute,
  redirect,
} from "@tanstack/react-router";
import { App } from "@/app";

const rootRoute = createRootRoute({
  component: App,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    // Redirect will happen in the App component after SSE data arrives.
    // This route renders the app shell with an empty terminal placeholder.
    return {};
  },
});

const sessionWindowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$session/$window",
  parseParams: (params) => ({
    session: params.session,
    window: params.window,
  }),
});

const routeTree = rootRoute.addChildren([indexRoute, sessionWindowRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
