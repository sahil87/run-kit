import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { Dashboard } from "./dashboard";
import type { ProjectSession } from "@/types";

const sessions: ProjectSession[] = [
  {
    name: "run-kit",
    byobu: false,
    windows: [
      {
        index: 0,
        name: "main",
        worktreePath: "~/code/run-kit",
        activity: "active",
        isActiveWindow: true,
        activityTimestamp: Math.floor(Date.now() / 1000) - 5,
      },
      {
        index: 1,
        name: "scratch",
        worktreePath: "~/code/run-kit",
        activity: "idle",
        isActiveWindow: false,
        activityTimestamp: Math.floor(Date.now() / 1000) - 180,
      },
    ],
  },
  {
    name: "ao-server",
    byobu: false,
    windows: [
      {
        index: 0,
        name: "dev",
        worktreePath: "~/code/ao-server",
        activity: "idle",
        isActiveWindow: true,
        activityTimestamp: Math.floor(Date.now() / 1000) - 3600,
      },
    ],
  },
];

function RootComponent() {
  return <Outlet />;
}

function renderDashboard(
  overrides: { sessions?: ProjectSession[]; onCreateSession?: () => void } = {},
) {
  const onCreateSession = overrides.onCreateSession ?? vi.fn();
  const testSessions = overrides.sessions ?? sessions;

  const rootRoute = createRootRoute({ component: RootComponent });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <Dashboard sessions={testSessions} onCreateSession={onCreateSession} />
    ),
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$session",
    component: () => <div data-testid="project-page" />,
  });

  const routeTree = rootRoute.addChildren([indexRoute, sessionRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  return render(<RouterProvider router={router} />);
}

describe("Dashboard", () => {
  afterEach(cleanup);

  it("renders stats line with correct counts", async () => {
    renderDashboard();
    expect(await screen.findByText("2 sessions, 3 windows")).toBeInTheDocument();
  });

  it("uses singular for 1 session, 1 window", async () => {
    const single: ProjectSession[] = [
      {
        name: "solo",
        byobu: false,
        windows: [
          {
            index: 0,
            name: "main",
            worktreePath: "~/code/solo",
            activity: "active",
            isActiveWindow: true,
            activityTimestamp: Math.floor(Date.now() / 1000),
          },
        ],
      },
    ];
    renderDashboard({ sessions: single });
    expect(await screen.findByText("1 session, 1 window")).toBeInTheDocument();
  });

  it("renders session cards with name, window count, and activity", async () => {
    renderDashboard();
    expect(await screen.findByText("run-kit")).toBeInTheDocument();
    expect(screen.getByText("2 windows")).toBeInTheDocument();
    expect(screen.getByText("1 active, 1 idle")).toBeInTheDocument();

    expect(screen.getByText("ao-server")).toBeInTheDocument();
    expect(screen.getByText("1 window")).toBeInTheDocument();
    expect(screen.getByText("0 active, 1 idle")).toBeInTheDocument();
  });

  it("navigates to /$session on card click", async () => {
    renderDashboard();
    fireEvent.click(await screen.findByText("run-kit"));
    expect(await screen.findByTestId("project-page")).toBeInTheDocument();
  });

  it("shows empty state with New Session button when no sessions", async () => {
    renderDashboard({ sessions: [] });
    expect(await screen.findByText("No sessions")).toBeInTheDocument();
    expect(screen.getByText("+ Session")).toBeInTheDocument();
  });

  it("calls onCreateSession when New Session button is clicked (empty state)", async () => {
    const onCreateSession = vi.fn();
    renderDashboard({ sessions: [], onCreateSession });
    fireEvent.click(await screen.findByText("+ Session"));
    expect(onCreateSession).toHaveBeenCalledOnce();
  });

  it("renders New Session button when sessions exist", async () => {
    renderDashboard();
    expect(await screen.findByText("+ Session")).toBeInTheDocument();
  });
});
