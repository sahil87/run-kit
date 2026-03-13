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
import { ProjectPage } from "./project-page";
import type { ProjectSession } from "@/types";

const nowSeconds = Math.floor(Date.now() / 1000);

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
        paneCommand: "claude",
        activityTimestamp: nowSeconds - 5,
        fabStage: "apply",
        fabChange: "260313-ll1j-dashboard-project-page-views",
      },
      {
        index: 1,
        name: "scratch",
        worktreePath: "~/code/run-kit",
        activity: "idle",
        isActiveWindow: false,
        paneCommand: "zsh",
        activityTimestamp: nowSeconds - 120,
      },
    ],
  },
  {
    name: "empty-session",
    byobu: false,
    windows: [],
  },
];

function RootComponent() {
  return <Outlet />;
}

function renderProjectPage(
  sessionName: string,
  testSessions: ProjectSession[] = sessions,
) {
  const rootRoute = createRootRoute({ component: RootComponent });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <div data-testid="dashboard" />,
  });
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$session",
    component: () => (
      <ProjectPage sessionName={sessionName} sessions={testSessions} />
    ),
  });
  const sessionWindowRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$session/$window",
    component: () => <div data-testid="terminal" />,
  });

  const routeTree = rootRoute.addChildren([
    indexRoute,
    sessionRoute,
    sessionWindowRoute,
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [`/${encodeURIComponent(sessionName)}`],
    }),
  });

  return render(<RouterProvider router={router} />);
}

describe("ProjectPage", () => {
  afterEach(cleanup);

  it("renders window cards for a valid session", async () => {
    renderProjectPage("run-kit");
    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getByText("scratch")).toBeInTheDocument();
  });

  it("shows pane command on window cards", async () => {
    renderProjectPage("run-kit");
    expect(await screen.findByText("claude")).toBeInTheDocument();
    expect(screen.getByText("zsh")).toBeInTheDocument();
  });

  it("shows activity dot and label", async () => {
    renderProjectPage("run-kit");
    expect(await screen.findByText("active")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("shows idle duration for idle windows", async () => {
    renderProjectPage("run-kit");
    // scratch: idle, 120s ago -> "2m"
    expect(await screen.findByText("2m")).toBeInTheDocument();
  });

  it("shows fab stage badge when fabStage present", async () => {
    renderProjectPage("run-kit");
    expect(await screen.findByText("apply")).toBeInTheDocument();
  });

  it("shows fab change info when fab data present", async () => {
    renderProjectPage("run-kit");
    // "260313-ll1j-dashboard-project-page-views" -> id: "ll1j"
    expect(await screen.findByText(/ll1j/)).toBeInTheDocument();
  });

  it("navigates to /$session/$window on card click", async () => {
    renderProjectPage("run-kit");
    fireEvent.click(await screen.findByText("main"));
    expect(await screen.findByTestId("terminal")).toBeInTheDocument();
  });

  it("shows session not found with link to dashboard", async () => {
    renderProjectPage("ghost");
    expect(await screen.findByText("Session not found")).toBeInTheDocument();
    expect(screen.getByText("Back to dashboard")).toBeInTheDocument();
  });

  it("navigates to dashboard when clicking back link on not found", async () => {
    renderProjectPage("ghost");
    fireEvent.click(await screen.findByText("Back to dashboard"));
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
  });

  it("shows empty state with New Window button for session with no windows", async () => {
    renderProjectPage("empty-session");
    expect(await screen.findByText("No windows")).toBeInTheDocument();
    expect(screen.getByText("+ Window")).toBeInTheDocument();
  });

  it("renders New Window button below card grid", async () => {
    renderProjectPage("run-kit");
    expect(await screen.findByText("+ Window")).toBeInTheDocument();
  });
});
