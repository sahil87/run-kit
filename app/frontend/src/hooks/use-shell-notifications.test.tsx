import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateTerminalSearch } from "@/lib/router-url";

let notifyHandler: ((payload: unknown) => void) | undefined;
const subscribeNotify = vi.fn((handler: (payload: unknown) => void) => {
  notifyHandler = handler;
  return () => {
    if (notifyHandler === handler) notifyHandler = undefined;
  };
});

vi.mock("@/contexts/session-context", () => ({
  useSessionContext: () => ({ subscribeNotify }),
}));

vi.mock("@/lib/shell-notifications", () => ({
  showShellNotification: (payload: unknown, navigate: (path: string) => void) => {
    if (typeof payload === "string") navigate(payload);
    return true;
  },
}));

import { useShellNotifications } from "./use-shell-notifications";

function HookRoute() {
  useShellNotifications();
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: HookRoute });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});
const terminalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$server/$window",
  validateSearch: validateTerminalSearch,
  component: () => null,
});
const routeTree = rootRoute.addChildren([indexRoute, terminalRoute]);

beforeEach(() => {
  notifyHandler = undefined;
  subscribeNotify.mockClear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useShellNotifications", () => {
  it("parses a chat deep link into the route pathname and search", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(subscribeNotify).toHaveBeenCalledTimes(1));

    const handler = notifyHandler;
    if (!handler) throw new Error("notify handler was not registered");
    act(() => handler("/utils2/5?view=chat"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/utils2/5"));
    expect(router.state.location.search).toMatchObject({ view: "chat" });
  });
});
