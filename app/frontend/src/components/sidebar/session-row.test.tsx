import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { SessionRow } from "./session-row";
import type { ProjectSession } from "@/types";

afterEach(() => {
  cleanup();
});

const noop = () => {};

function makeSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  return {
    name: "alpha",
    windows: [
      { windowId: "@0", index: 0, name: "zsh", worktreePath: "/home/user", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
    ],
    ...overrides,
  } as ProjectSession;
}

function rowProps(session: ProjectSession) {
  return {
    server: "srv",
    session,
    isCollapsed: false,
    isSessionDropTarget: false,
    editingSession: null,
    editingSessionName: "",
    sessionInputRef: { current: null },
    orderedNames: [session.name] as string[],
    onDragStart: noop,
    onDragEnd: noop,
    onToggleCollapse: noop,
    onSelectFirstWindow: noop,
    onCreateWindow: noop,
    onKillClick: noop,
    onDoubleClickName: noop,
    onSessionNameChange: noop,
    onSessionRenameKeyDown: noop as React.KeyboardEventHandler<HTMLInputElement>,
    onSessionRenameBlur: noop,
    onDragOver: noop,
    onReorderOver: noop,
    onDragLeave: noop,
    onDrop: noop,
    onColorChange: noop,
  };
}

describe("SessionRow", () => {
  it("renders the session name", () => {
    const session = makeSession({ name: "agent-work" });
    render(<SessionRow {...rowProps(session)} />);
    expect(screen.getByText("agent-work")).toBeInTheDocument();
  });

  it("exposes create-window and kill affordances", () => {
    const session = makeSession({ name: "agent-work" });
    render(<SessionRow {...rowProps(session)} />);
    expect(screen.getByLabelText("New window in agent-work")).toBeInTheDocument();
    expect(screen.getByLabelText("Kill session agent-work")).toBeInTheDocument();
  });

  // React.memo only pays off when the parent passes referentially-stable props.
  // Proves the memo'd SessionRow does NOT re-render its body when its PARENT
  // re-renders with an identical prop set.
  //
  // We count the row's OWN render-body executions (not Profiler commits — a
  // Profiler fires on its parent's commit even when its memo'd child bails). The
  // signal is a getter on `session.name`: `SessionRowInner` reads `session.name`
  // at the top of every render (`const name = session.name`), so the getter fires
  // once per body execution. The parent (`Harness`) creates a FRESH <SessionRow>
  // element each render from a hoisted, stable props object, defeating React's
  // element-identity bailout — so only `React.memo` can stop the body from
  // re-running. An un-memoized row would read `session.name` again and fail.
  describe("React.memo", () => {
    it("does not re-render the row body when the parent re-renders with stable props", () => {
      let nameReads = 0;
      const base = makeSession({ name: "stable" });
      const session = new Proxy(base, {
        get(target, prop, receiver) {
          if (prop === "name") nameReads += 1;
          return Reflect.get(target, prop, receiver);
        },
      });
      const stableProps = rowProps(session); // hoisted once — identical refs each render

      let forceParent: () => void = () => {};
      function Harness() {
        const [, setTick] = useState(0);
        forceParent = () => setTick((n) => n + 1);
        return <SessionRow {...stableProps} />;
      }

      render(<Harness />);
      const afterMount = nameReads;
      expect(afterMount).toBeGreaterThan(0);

      act(() => { forceParent(); });
      expect(nameReads).toBe(afterMount); // memo bailed → body did not re-run
    });
  });
});
