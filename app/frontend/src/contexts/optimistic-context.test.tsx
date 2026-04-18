import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { OptimisticProvider, useOptimisticContext, useMergedSessions } from "./optimistic-context";
import type { ProjectSession } from "@/types";

const TEST_SERVER = "test-server";

// Test consumer to expose context methods and state
function TestConsumer({ realSessions, server = TEST_SERVER }: { realSessions: ProjectSession[]; server?: string }) {
  const ctx = useOptimisticContext();
  const merged = useMergedSessions(realSessions, server);
  return (
    <div>
      <span data-testid="ghost-count">{ctx.ghosts.length}</span>
      <span data-testid="killed-count">{ctx.killed.length}</span>
      <span data-testid="renamed-count">{ctx.renamed.length}</span>
      <span data-testid="merged-count">{merged.length}</span>
      <span data-testid="merged-names">{merged.map((s) => s.name).join(",")}</span>
      <span data-testid="merged-optimistic">
        {merged.filter((s) => s.optimistic).map((s) => s.name).join(",")}
      </span>
      <span data-testid="merged-windows">
        {merged.flatMap((s) => s.windows.map((w) => `${s.name}:${w.name}`)).join(",")}
      </span>
      <span data-testid="merged-optimistic-windows">
        {merged
          .flatMap((s) =>
            s.windows
              .filter((w) => "optimistic" in w && w.optimistic)
              .map((w) => `${s.name}:${w.name}`),
          )
          .join(",")}
      </span>
      <button data-testid="add-ghost-session" onClick={() => ctx.addGhostSession(server, "ghost-sess")}>
        Add Ghost Session
      </button>
      <button data-testid="add-ghost-server" onClick={() => ctx.addGhostServer("ghost-srv")}>
        Add Ghost Server
      </button>
      <button data-testid="kill-session" onClick={() => ctx.markKilled("session", server, "dev")}>
        Kill Session
      </button>
      <button data-testid="unkill-session" onClick={() => ctx.unmarkKilled("session", server, "dev")}>
        Unkill Session
      </button>
      <button data-testid="rename-session" onClick={() => ctx.markRenamed("session", server, "dev", "staging")}>
        Rename Session
      </button>
      <button data-testid="unrename-session" onClick={() => ctx.unmarkRenamed(server, "dev")}>
        Unrename Session
      </button>
    </div>
  );
}

const baseSessions: ProjectSession[] = [
  {
    name: "dev",
    windows: [
      { index: 0, windowId: "@0", name: "zsh", worktreePath: "/tmp", activity: "active", isActiveWindow: true, activityTimestamp: 0 },
      { index: 1, windowId: "@1", name: "build", worktreePath: "/tmp", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
    ],
  },
  {
    name: "prod",
    windows: [
      { index: 0, windowId: "@2", name: "deploy", worktreePath: "/app", activity: "idle", isActiveWindow: true, activityTimestamp: 0 },
    ],
  },
];

describe("OptimisticProvider", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts with empty ghost, killed, and renamed lists", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );
    expect(screen.getByTestId("ghost-count").textContent).toBe("0");
    expect(screen.getByTestId("killed-count").textContent).toBe("0");
    expect(screen.getByTestId("renamed-count").textContent).toBe("0");
  });

  it("merged sessions equal real sessions when no optimistic state", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );
    expect(screen.getByTestId("merged-count").textContent).toBe("2");
    expect(screen.getByTestId("merged-names").textContent).toBe("dev,prod");
  });

  it("adds a ghost session that appears in merged output", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("add-ghost-session").click();
    });

    expect(screen.getByTestId("ghost-count").textContent).toBe("1");
    expect(screen.getByTestId("merged-count").textContent).toBe("3");
    expect(screen.getByTestId("merged-names").textContent).toBe("dev,prod,ghost-sess");
    expect(screen.getByTestId("merged-optimistic").textContent).toBe("ghost-sess");
  });

  it("marks a session as killed (filters it from merged)", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("kill-session").click();
    });

    expect(screen.getByTestId("merged-count").textContent).toBe("1");
    expect(screen.getByTestId("merged-names").textContent).toBe("prod");
  });

  it("unmarks a killed session (restores it)", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("kill-session").click();
    });

    expect(screen.getByTestId("merged-count").textContent).toBe("1");

    act(() => {
      screen.getByTestId("unkill-session").click();
    });

    expect(screen.getByTestId("merged-count").textContent).toBe("2");
    expect(screen.getByTestId("merged-names").textContent).toBe("dev,prod");
  });

  it("renames a session in merged output", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("rename-session").click();
    });

    expect(screen.getByTestId("merged-names").textContent).toBe("staging,prod");
  });

  it("unrenames a session (reverts to original name)", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("rename-session").click();
    });

    expect(screen.getByTestId("merged-names").textContent).toBe("staging,prod");

    act(() => {
      screen.getByTestId("unrename-session").click();
    });

    expect(screen.getByTestId("merged-names").textContent).toBe("dev,prod");
  });

  it("SSE reconciliation: ghost session removed when real data arrives", async () => {
    const { rerender } = render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("add-ghost-session").click();
    });

    expect(screen.getByTestId("merged-optimistic").textContent).toBe("ghost-sess");

    // Simulate SSE delivering the new session
    const updatedSessions: ProjectSession[] = [
      ...baseSessions,
      { name: "ghost-sess", windows: [{ index: 0, windowId: "@99", name: "zsh", worktreePath: "/tmp", activity: "idle", isActiveWindow: true, activityTimestamp: 0 }] },
    ];

    rerender(
      <OptimisticProvider>
        <TestConsumer realSessions={updatedSessions} />
      </OptimisticProvider>,
    );

    // Allow the queueMicrotask to fire
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Ghost should be auto-cleared
    expect(screen.getByTestId("ghost-count").textContent).toBe("0");
    expect(screen.getByTestId("merged-count").textContent).toBe("3");
    expect(screen.getByTestId("merged-optimistic").textContent).toBe("");
  });

  it("addGhostServer returns an optimisticId", () => {
    let capturedId = "";
    function Capture() {
      const ctx = useOptimisticContext();
      return (
        <button
          onClick={() => {
            capturedId = ctx.addGhostServer("test-srv");
          }}
        >
          Add
        </button>
      );
    }

    render(
      <OptimisticProvider>
        <Capture />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByText("Add").click();
    });

    expect(capturedId).toMatch(/^ghost-/);
  });

  it("removeGhost removes a specific ghost by id", () => {
    let ghostId = "";
    function Adder() {
      const ctx = useOptimisticContext();
      const merged = useMergedSessions([], TEST_SERVER);
      return (
        <div>
          <span data-testid="count">{merged.length}</span>
          <button onClick={() => { ghostId = ctx.addGhostSession(TEST_SERVER, "a"); }}>Add</button>
          <button onClick={() => ctx.removeGhost(ghostId)}>Remove</button>
        </div>
      );
    }

    render(
      <OptimisticProvider>
        <Adder />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByText("Add").click();
    });

    expect(screen.getByTestId("count").textContent).toBe("1");

    act(() => {
      screen.getByText("Remove").click();
    });

    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("throws when useOptimisticContext is used outside provider", () => {
    function Orphan() {
      useOptimisticContext();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow("useOptimisticContext must be used within OptimisticProvider");
  });

  it("ghost entry lifecycle: add ghost → SSE update matching ghost → ghost cleared", async () => {
    const { rerender } = render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    // Step 1: add ghost session
    act(() => {
      screen.getByTestId("add-ghost-session").click();
    });

    expect(screen.getByTestId("ghost-count").textContent).toBe("1");
    expect(screen.getByTestId("merged-count").textContent).toBe("3");
    expect(screen.getByTestId("merged-optimistic").textContent).toBe("ghost-sess");

    // Step 2: SSE delivers a real session matching the ghost name
    const updatedSessions: ProjectSession[] = [
      ...baseSessions,
      {
        name: "ghost-sess",
        windows: [{ index: 0, windowId: "@99", name: "zsh", worktreePath: "/tmp", activity: "idle", isActiveWindow: true, activityTimestamp: 0 }],
      },
    ];

    rerender(
      <OptimisticProvider>
        <TestConsumer realSessions={updatedSessions} />
      </OptimisticProvider>,
    );

    // Allow queueMicrotask to fire for reconciliation
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Step 3: ghost is cleared, real session remains
    expect(screen.getByTestId("ghost-count").textContent).toBe("0");
    expect(screen.getByTestId("merged-count").textContent).toBe("3");
    expect(screen.getByTestId("merged-optimistic").textContent).toBe("");
  });

  it("ghost failure lifecycle: add ghost → removeGhost → ghost removed", () => {
    let capturedId = "";

    function FailureConsumer({ realSessions }: { realSessions: ProjectSession[] }) {
      const ctx = useOptimisticContext();
      const merged = useMergedSessions(realSessions, TEST_SERVER);
      return (
        <div>
          <span data-testid="fc-ghost-count">{ctx.ghosts.length}</span>
          <span data-testid="fc-merged-count">{merged.length}</span>
          <span data-testid="fc-merged-optimistic">
            {merged.filter((s) => s.optimistic).map((s) => s.name).join(",")}
          </span>
          <button
            data-testid="fc-add"
            onClick={() => { capturedId = ctx.addGhostSession(TEST_SERVER, "fail-sess"); }}
          >
            Add
          </button>
          <button
            data-testid="fc-remove"
            onClick={() => ctx.removeGhost(capturedId)}
          >
            Remove
          </button>
        </div>
      );
    }

    render(
      <OptimisticProvider>
        <FailureConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    // Step 1: add ghost
    act(() => {
      screen.getByTestId("fc-add").click();
    });

    expect(screen.getByTestId("fc-ghost-count").textContent).toBe("1");
    expect(screen.getByTestId("fc-merged-count").textContent).toBe("3");
    expect(screen.getByTestId("fc-merged-optimistic").textContent).toBe("fail-sess");

    // Step 2: simulate failure — remove ghost (as onRollback would do)
    act(() => {
      screen.getByTestId("fc-remove").click();
    });

    // Step 3: ghost is gone
    expect(screen.getByTestId("fc-ghost-count").textContent).toBe("0");
    expect(screen.getByTestId("fc-merged-count").textContent).toBe("2");
    expect(screen.getByTestId("fc-merged-optimistic").textContent).toBe("");
  });

  describe("server-scoped optimistic overlays", () => {
    it("ghost session on server-A is not rendered when viewing server-B", () => {
      function DualView() {
        const ctx = useOptimisticContext();
        const mergedA = useMergedSessions([], "server-A");
        const mergedB = useMergedSessions([], "server-B");
        return (
          <div>
            <span data-testid="count-a">{mergedA.length}</span>
            <span data-testid="count-b">{mergedB.length}</span>
            <span data-testid="names-a">{mergedA.map((s) => s.name).join(",")}</span>
            <span data-testid="names-b">{mergedB.map((s) => s.name).join(",")}</span>
            <button onClick={() => ctx.addGhostSession("server-A", "pending")}>Add</button>
          </div>
        );
      }

      render(
        <OptimisticProvider>
          <DualView />
        </OptimisticProvider>,
      );

      expect(screen.getByTestId("count-a").textContent).toBe("0");
      expect(screen.getByTestId("count-b").textContent).toBe("0");
      expect(screen.getByTestId("names-a").textContent).toBe("");
      expect(screen.getByTestId("names-b").textContent).toBe("");

      act(() => {
        screen.getByText("Add").click();
      });

      // A-side sees the ghost added for server-A; B-side remains unaffected.
      expect(screen.getByTestId("count-a").textContent).toBe("1");
      expect(screen.getByTestId("names-a").textContent).toBe("pending");
      expect(screen.getByTestId("count-b").textContent).toBe("0");
      expect(screen.getByTestId("names-b").textContent).toBe("");
    });

    it("kill overlay keyed by server: kill on server-A does not hide session on server-B", () => {
      const sharedSession: ProjectSession = {
        name: "foo",
        windows: [
          { index: 0, windowId: "@0", name: "zsh", worktreePath: "/", activity: "idle", isActiveWindow: true, activityTimestamp: 0 },
        ],
      };

      function DualView() {
        const ctx = useOptimisticContext();
        const mergedA = useMergedSessions([sharedSession], "server-A");
        const mergedB = useMergedSessions([sharedSession], "server-B");
        return (
          <div>
            <span data-testid="count-a">{mergedA.length}</span>
            <span data-testid="count-b">{mergedB.length}</span>
            <button onClick={() => ctx.markKilled("session", "server-A", "foo")}>Kill A</button>
          </div>
        );
      }

      render(
        <OptimisticProvider>
          <DualView />
        </OptimisticProvider>,
      );

      expect(screen.getByTestId("count-a").textContent).toBe("1");
      expect(screen.getByTestId("count-b").textContent).toBe("1");

      act(() => {
        screen.getByText("Kill A").click();
      });

      // A side sees the session killed; B side is unaffected.
      expect(screen.getByTestId("count-a").textContent).toBe("0");
      expect(screen.getByTestId("count-b").textContent).toBe("1");
    });

    it("rename overlay keyed by server: rename on server-A does not re-label session on server-B", () => {
      const sharedSession: ProjectSession = {
        name: "foo",
        windows: [
          { index: 0, windowId: "@0", name: "zsh", worktreePath: "/", activity: "idle", isActiveWindow: true, activityTimestamp: 0 },
        ],
      };

      function DualView() {
        const ctx = useOptimisticContext();
        const mergedA = useMergedSessions([sharedSession], "server-A");
        const mergedB = useMergedSessions([sharedSession], "server-B");
        return (
          <div>
            <span data-testid="name-a">{mergedA[0]?.name ?? ""}</span>
            <span data-testid="name-b">{mergedB[0]?.name ?? ""}</span>
            <button onClick={() => ctx.markRenamed("session", "server-A", "foo", "bar")}>Rename A</button>
          </div>
        );
      }

      render(
        <OptimisticProvider>
          <DualView />
        </OptimisticProvider>,
      );

      expect(screen.getByTestId("name-a").textContent).toBe("foo");
      expect(screen.getByTestId("name-b").textContent).toBe("foo");

      act(() => {
        screen.getByText("Rename A").click();
      });

      expect(screen.getByTestId("name-a").textContent).toBe("bar");
      expect(screen.getByTestId("name-b").textContent).toBe("foo");
    });

    it("ghost server (no server key) appears regardless of current-server selection", () => {
      // Ghost servers are rendered in the server list, not the session list, so
      // they are intentionally not filtered here. We verify addGhostServer still
      // produces a server-type ghost entry in the ghosts list.
      function View() {
        const ctx = useOptimisticContext();
        return (
          <div>
            <span data-testid="server-ghosts">
              {ctx.ghosts.filter((g) => g.type === "server").map((g) => g.name).join(",")}
            </span>
            <button onClick={() => ctx.addGhostServer("new-server")}>Add</button>
          </div>
        );
      }

      render(
        <OptimisticProvider>
          <View />
        </OptimisticProvider>,
      );

      act(() => {
        screen.getByText("Add").click();
      });

      expect(screen.getByTestId("server-ghosts").textContent).toBe("new-server");
    });
  });
});
