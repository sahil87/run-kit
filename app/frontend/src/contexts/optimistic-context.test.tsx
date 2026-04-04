import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { OptimisticProvider, useOptimisticContext, useMergedSessions } from "./optimistic-context";
import type { ProjectSession } from "@/types";

// Test consumer to expose context methods and state
function TestConsumer({ realSessions }: { realSessions: ProjectSession[] }) {
  const ctx = useOptimisticContext();
  const merged = useMergedSessions(realSessions);
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
      <button data-testid="add-ghost-session" onClick={() => ctx.addGhostSession("ghost-sess")}>
        Add Ghost Session
      </button>
      <button data-testid="add-ghost-window" onClick={() => ctx.addGhostWindow("dev", "ghost-win")}>
        Add Ghost Window
      </button>
      <button data-testid="add-ghost-server" onClick={() => ctx.addGhostServer("ghost-srv")}>
        Add Ghost Server
      </button>
      <button data-testid="kill-session" onClick={() => ctx.markKilled("session", "dev")}>
        Kill Session
      </button>
      <button data-testid="unkill-session" onClick={() => ctx.unmarkKilled("dev")}>
        Unkill Session
      </button>
      <button data-testid="rename-session" onClick={() => ctx.markRenamed("session", "dev", "staging")}>
        Rename Session
      </button>
      <button data-testid="unrename-session" onClick={() => ctx.unmarkRenamed("dev")}>
        Unrename Session
      </button>
      <button data-testid="kill-window" onClick={() => ctx.markKilled("window", "dev:0")}>
        Kill Window
      </button>
      <button data-testid="rename-window" onClick={() => ctx.markRenamed("window", "dev:0", "editor")}>
        Rename Window
      </button>
    </div>
  );
}

const baseSessions: ProjectSession[] = [
  {
    name: "dev",
    windows: [
      { index: 0, name: "zsh", worktreePath: "/tmp", activity: "active", isActiveWindow: true, activityTimestamp: 0 },
      { index: 1, name: "build", worktreePath: "/tmp", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
    ],
  },
  {
    name: "prod",
    windows: [
      { index: 0, name: "deploy", worktreePath: "/app", activity: "idle", isActiveWindow: true, activityTimestamp: 0 },
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

  it("adds a ghost window under a session", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("add-ghost-window").click();
    });

    expect(screen.getByTestId("merged-optimistic-windows").textContent).toBe("dev:ghost-win");
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

  it("kills a window within a session", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("kill-window").click();
    });

    // dev should only have the "build" window
    expect(screen.getByTestId("merged-windows").textContent).toBe("dev:build,prod:deploy");
  });

  it("renames a window within a session", () => {
    render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("rename-window").click();
    });

    expect(screen.getByTestId("merged-windows").textContent).toBe("dev:editor,dev:build,prod:deploy");
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
      { name: "ghost-sess", windows: [{ index: 0, name: "zsh", worktreePath: "/tmp", activity: "idle", isActiveWindow: true, activityTimestamp: 0 }] },
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

  it("SSE reconciliation: ghost window removed when real window arrives", async () => {
    const { rerender } = render(
      <OptimisticProvider>
        <TestConsumer realSessions={baseSessions} />
      </OptimisticProvider>,
    );

    act(() => {
      screen.getByTestId("add-ghost-window").click();
    });

    expect(screen.getByTestId("merged-optimistic-windows").textContent).toBe("dev:ghost-win");

    // SSE delivers dev session with the new window
    const updatedSessions: ProjectSession[] = [
      {
        name: "dev",
        windows: [
          ...baseSessions[0].windows,
          { index: 2, name: "ghost-win", worktreePath: "/tmp", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
        ],
      },
      baseSessions[1],
    ];

    rerender(
      <OptimisticProvider>
        <TestConsumer realSessions={updatedSessions} />
      </OptimisticProvider>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByTestId("ghost-count").textContent).toBe("0");
    expect(screen.getByTestId("merged-optimistic-windows").textContent).toBe("");
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
      const merged = useMergedSessions([]);
      return (
        <div>
          <span data-testid="count">{merged.length}</span>
          <button onClick={() => { ghostId = ctx.addGhostSession("a"); }}>Add</button>
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

  it("renumbered window appears in merged output once killed entry is cleared", () => {
    // Scenario: dev session has windows [0, 1, 2]. Window 1 is killed.
    // After tmux renumbers, index 2 becomes index 1.
    // Once unmarkKilled("dev:1") fires, the new window at index 1 should be visible.

    // TestConsumer already exposes a kill-window button for "dev:0".
    // We need a custom consumer that targets "dev:1" specifically.
    function KillWindowConsumer({ realSessions }: { realSessions: ProjectSession[] }) {
      const ctx = useOptimisticContext();
      const merged = useMergedSessions(realSessions);
      return (
        <div>
          <span data-testid="kw-windows">
            {merged.flatMap((s) => s.windows.map((w) => `${s.name}:${w.index}:${w.name}`)).join(",")}
          </span>
          <span data-testid="kw-killed-count">{ctx.killed.length}</span>
          <button data-testid="kw-mark-killed" onClick={() => ctx.markKilled("window", "dev:1")}>
            Mark Killed
          </button>
          <button data-testid="kw-unmark-killed" onClick={() => ctx.unmarkKilled("dev:1")}>
            Unmark Killed
          </button>
        </div>
      );
    }

    const threeWindowSessions: ProjectSession[] = [
      {
        name: "dev",
        windows: [
          { index: 0, name: "zsh", worktreePath: "/tmp", activity: "active", isActiveWindow: true, activityTimestamp: 0 },
          { index: 1, name: "build", worktreePath: "/tmp", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
          { index: 2, name: "logs", worktreePath: "/tmp", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
        ],
      },
    ];

    const renumberedSessions: ProjectSession[] = [
      {
        name: "dev",
        windows: [
          { index: 0, name: "zsh", worktreePath: "/tmp", activity: "active", isActiveWindow: true, activityTimestamp: 0 },
          // After killing index 1 ("build"), tmux renumbers "logs" from index 2 to index 1
          { index: 1, name: "logs", worktreePath: "/tmp", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
        ],
      },
    ];

    const { rerender } = render(
      <OptimisticProvider>
        <KillWindowConsumer realSessions={threeWindowSessions} />
      </OptimisticProvider>,
    );

    // Step 1: mark window 1 as killed (optimistic hide)
    act(() => {
      screen.getByTestId("kw-mark-killed").click();
    });

    // Window 1 ("build") is hidden; windows 0 and 2 still visible
    expect(screen.getByTestId("kw-windows").textContent).toBe("dev:0:zsh,dev:2:logs");
    expect(screen.getByTestId("kw-killed-count").textContent).toBe("1");

    // Step 2: SSE delivers renumbered session (window 2 "logs" is now at index 1)
    rerender(
      <OptimisticProvider>
        <KillWindowConsumer realSessions={renumberedSessions} />
      </OptimisticProvider>,
    );

    // Killed entry for "dev:1" still hides the renumbered window
    expect(screen.getByTestId("kw-windows").textContent).toBe("dev:0:zsh");

    // Step 3: onSettled fires — unmarkKilled clears the killed entry
    act(() => {
      screen.getByTestId("kw-unmark-killed").click();
    });

    // Renumbered window (index 1 "logs") is now visible
    expect(screen.getByTestId("kw-windows").textContent).toBe("dev:0:zsh,dev:1:logs");
    expect(screen.getByTestId("kw-killed-count").textContent).toBe("0");
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
        windows: [{ index: 0, name: "zsh", worktreePath: "/tmp", activity: "idle", isActiveWindow: true, activityTimestamp: 0 }],
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
      const merged = useMergedSessions(realSessions);
      return (
        <div>
          <span data-testid="fc-ghost-count">{ctx.ghosts.length}</span>
          <span data-testid="fc-merged-count">{merged.length}</span>
          <span data-testid="fc-merged-optimistic">
            {merged.filter((s) => s.optimistic).map((s) => s.name).join(",")}
          </span>
          <button
            data-testid="fc-add"
            onClick={() => { capturedId = ctx.addGhostSession("fail-sess"); }}
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
});
