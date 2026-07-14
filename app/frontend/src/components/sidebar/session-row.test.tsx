import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
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

  // gsmu: the spawn-agent bot button is an OPTIONAL affordance (mirrors
  // onColorChange) — present only when an onSpawnAgent handler is supplied, and
  // positioned immediately LEFT of the "+" create-window button so +/✕ keep
  // their edge positions.
  describe("spawn-agent bot button", () => {
    it("is absent when no onSpawnAgent handler is supplied", () => {
      const session = makeSession({ name: "agent-work" });
      render(<SessionRow {...rowProps(session)} />);
      expect(screen.queryByLabelText("Spawn agent in agent-work")).not.toBeInTheDocument();
    });

    it("renders left of the + button and calls onSpawnAgent(server, name) on click", () => {
      const onSpawnAgent = vi.fn();
      const session = makeSession({ name: "agent-work" });
      render(<SessionRow {...rowProps(session)} onSpawnAgent={onSpawnAgent} />);

      const bot = screen.getByLabelText("Spawn agent in agent-work");
      const plus = screen.getByLabelText("New window in agent-work");
      expect(bot).toBeInTheDocument();
      // DOM order: bot precedes + (Node.DOCUMENT_POSITION_FOLLOWING = 4).
      expect(bot.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      fireEvent.click(bot);
      expect(onSpawnAgent).toHaveBeenCalledWith("srv", "agent-work");
    });
  });

  // W3C-APG tree node semantics (Wave 3 sidebar-keyboard-nav). The session row
  // wrapper is a level-1 treeitem; its aria-expanded mirrors the chevron's, and
  // aria-controls points at the window-list group id. The roving model in
  // index.tsx threads tabIndex + set/pos and the data-session-row handle.
  describe("tree ARIA + roving tabindex", () => {
    function treeitem(container: HTMLElement): HTMLElement {
      const item = container.querySelector<HTMLElement>('[role="treeitem"]');
      expect(item).not.toBeNull();
      return item!;
    }

    it("renders role=treeitem at aria-level 1 with aria-expanded mirroring !isCollapsed", () => {
      const session = makeSession({ name: "api" });
      const { container, rerender } = render(
        <SessionRow {...rowProps(session)} isCollapsed={false} />,
      );
      const expanded = treeitem(container);
      expect(expanded).toHaveAttribute("role", "treeitem");
      expect(expanded).toHaveAttribute("aria-level", "1");
      expect(expanded).toHaveAttribute("aria-expanded", "true");

      rerender(<SessionRow {...rowProps(session)} isCollapsed={true} />);
      expect(treeitem(container)).toHaveAttribute("aria-expanded", "false");
    });

    it("wires aria-controls to the window-group id and exposes the data-session-row handle", () => {
      const session = makeSession({ name: "api" });
      const { container } = render(
        <SessionRow
          {...rowProps(session)}
          windowGroupId="windows-srv-api"
          sessionRowKey="srv:api"
        />,
      );
      const item = treeitem(container);
      expect(item).toHaveAttribute("aria-controls", "windows-srv-api");
      expect(item).toHaveAttribute("data-session-row", "srv:api");
    });

    // SF-5: the role="group" window list is mounted only while expanded, so the
    // session row must reference it via aria-controls ONLY when expanded — a
    // collapsed row pointing at an unmounted id is invalid ARIA.
    it("emits aria-controls only while expanded (absent when collapsed)", () => {
      const session = makeSession({ name: "api" });
      const { container, rerender } = render(
        <SessionRow
          {...rowProps(session)}
          isCollapsed={false}
          windowGroupId="windows-srv-api"
          sessionRowKey="srv:api"
        />,
      );
      expect(treeitem(container)).toHaveAttribute("aria-controls", "windows-srv-api");

      rerender(
        <SessionRow
          {...rowProps(session)}
          isCollapsed={true}
          windowGroupId="windows-srv-api"
          sessionRowKey="srv:api"
        />,
      );
      expect(treeitem(container)).not.toHaveAttribute("aria-controls");
    });

    it("reflects aria-setsize / aria-posinset and the roving tabIndex", () => {
      const session = makeSession({ name: "api" });
      const { container } = render(
        <SessionRow
          {...rowProps(session)}
          ariaSetSize={3}
          ariaPosInSet={2}
          tabIndex={0}
        />,
      );
      const item = treeitem(container);
      expect(item).toHaveAttribute("aria-setsize", "3");
      expect(item).toHaveAttribute("aria-posinset", "2");
      expect(item).toHaveAttribute("tabindex", "0");
    });

    it("defaults tabIndex to -1 when not the roving row", () => {
      const session = makeSession({ name: "api" });
      const { container } = render(<SessionRow {...rowProps(session)} />);
      expect(treeitem(container)).toHaveAttribute("tabindex", "-1");
    });
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
