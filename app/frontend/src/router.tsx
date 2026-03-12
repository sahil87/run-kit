import {
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import App from "./app";

const rootRoute = createRootRoute({
  component: App,
});

const sessionWindowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$session/$window",
});

const routeTree = rootRoute.addChildren([sessionWindowRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
