import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { WindowRow } from "./window-row";
import * as optimisticContext from "@/contexts/optimistic-context";
import type { WindowInfo } from "@/types";
import type { MergedWindow } from "@/store/window-store";

afterEach(() => {
  cleanup();
});

function makeWindow(overrides: Partial<WindowInfo> & { windowId: string; index: number }): WindowInfo {
  return {
    name: "zsh",
    worktreePath: "/home/user",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

const noop = () => {};
const noopDrag = (e: React.DragEvent) => { e.preventDefault(); };

function renderRow(win: WindowInfo) {
  return render(
    <WindowRow
      win={win}
      session="alpha"
      isSelected={false}
      isDragOver={false}
      editingWindow={null}
      editingName=""
      inputRef={{ current: null }}
      onSelectWindow={noop}
      onStartEditing={noop}
      onWindowNameChange={noop}
      onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
      onRenameBlur={noop}
      onKillClick={noop}
      onDragStart={noopDrag}
      onDragOver={noopDrag}
      onDrop={noopDrag}
      onDragEnd={noop}
    />,
  );
}

/** Render with `server` and `onColorChange` wired so all three hover-revealed
 *  icons (pin / color swatch / kill) exist in the DOM. */
function renderRowWithIcons(win: WindowInfo) {
  return render(
    <WindowRow
      win={win}
      session="alpha"
      isSelected={false}
      isDragOver={false}
      editingWindow={null}
      editingName=""
      inputRef={{ current: null }}
      onSelectWindow={noop}
      onStartEditing={noop}
      onWindowNameChange={noop}
      onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
      onRenameBlur={noop}
      onKillClick={noop}
      onDragStart={noopDrag}
      onDragOver={noopDrag}
      onDrop={noopDrag}
      onDragEnd={noop}
      onColorChange={noop}
      server="srv"
    />,
  );
}

function makeGhostWindow(overrides: Partial<MergedWindow> = {}): MergedWindow {
  return {
    name: "ghost-win",
    worktreePath: "",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    index: -1,
    windowId: "",
    optimistic: true,
    optimisticId: "ghost-1",
    ...overrides,
  };
}

function renderGhostRow(win: MergedWindow) {
  return render(
    <WindowRow
      win={win}
      session="alpha"
      isSelected={false}
      isDragOver={false}
      editingWindow={null}
      editingName=""
      inputRef={{ current: null }}
      onSelectWindow={noop}
      onStartEditing={noop}
      onWindowNameChange={noop}
      onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
      onRenameBlur={noop}
      onKillClick={noop}
      onDragStart={noopDrag}
      onDragOver={noopDrag}
      onDrop={noopDrag}
      onDragEnd={noop}
    />,
  );
}

describe("WindowRow", () => {
  it("renders window name", () => {
    const win = makeWindow({ windowId: "@0", index: 0, name: "my-shell" });
    renderRow(win);
    expect(screen.getByText("my-shell")).toBeInTheDocument();
  });

  it("does not render tooltip (removed in favor of status panel)", () => {
    const win = makeWindow({ windowId: "@0", index: 0 });
    const { container } = renderRow(win);
    const tooltip = container.querySelector(".top-full.opacity-0.group-hover\\:opacity-100");
    expect(tooltip).toBeNull();
  });

  it("renders ghost window with reduced opacity", () => {
    const win = makeGhostWindow();
    const { container } = renderGhostRow(win);
    expect(container.querySelector(".opacity-50.animate-pulse")).not.toBeNull();
  });

  // PR status is no longer rendered in the sidebar window row — it moved to the
  // Pane panel (see status-panel.test.tsx). The dashboard card retains its own
  // PrStatusLine (see pr-status-line.test.tsx).
  it("does not render a PR status line even for a change-bound window with a PR", () => {
    const win = makeWindow({
      windowId: "@0",
      index: 0,
      fabChange: "260610-596o-x",
      prNumber: 386,
      prUrl: "https://github.com/o/r/pull/386",
      prState: "open",
      prChecks: "pass",
    });
    renderRow(win);
    expect(screen.queryByTestId("pr-status-line")).toBeNull();
  });

  // Quiet parked rows: fab pane map display_state === "done" means the change
  // is parked (fully shipped, awaiting archive) — the stage text is stale and
  // is suppressed; the duration stands alone. Any other value, unknown future
  // values, or an absent field keeps today's show-stage behavior.
  describe("fab stage quiet-row policy", () => {
    it("suppresses stage text when fabDisplayState is done, keeping the duration", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260612-epqk-x",
        fabStage: "review-pr",
        fabDisplayState: "done",
        agentState: "idle",
        agentIdleDuration: "2m",
      });
      renderRow(win);
      expect(screen.queryByText("review-pr")).toBeNull();
      expect(screen.getByText("2m")).toBeInTheDocument();
    });

    it("shows stage text when fabDisplayState is active", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabStage: "review-pr",
        fabDisplayState: "active",
      });
      renderRow(win);
      expect(screen.getByText("review-pr")).toBeInTheDocument();
    });

    it("shows stage text when fabDisplayState is ready", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabStage: "intake",
        fabDisplayState: "ready",
      });
      renderRow(win);
      expect(screen.getByText("intake")).toBeInTheDocument();
    });

    it("shows stage text when fabDisplayState is absent (older fab binary)", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabStage: "apply",
      });
      renderRow(win);
      expect(screen.getByText("apply")).toBeInTheDocument();
    });

    it("shows stage text for unknown future fabDisplayState values", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabStage: "apply",
        fabDisplayState: "paused",
      });
      renderRow(win);
      expect(screen.getByText("apply")).toBeInTheDocument();
    });
  });

  // Triage signals: a failed fab stage colors the separate stage TEXT red
  // (window-row's own text, unchanged by the lifecycle dot). The DOT now follows
  // the lifecycle journey (hue=phase, shape=status) — a failed stage/PR renders
  // a dashed ring in the phase hue + a red CENTER dot, never a whole-dot red.
  describe("triage signals", () => {
    it("colors the stage text red when fabDisplayState is failed", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabStage: "review",
        fabDisplayState: "failed",
      });
      renderRow(win);
      const stage = screen.getByText("review");
      expect(stage.className).toContain("text-red-400");
      expect(stage.className).not.toContain("text-text-secondary");
    });

    it("keeps the secondary token on the stage text for a non-failed stage", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabStage: "apply",
        fabDisplayState: "active",
      });
      renderRow(win);
      const stage = screen.getByText("apply");
      expect(stage.className).toContain("text-text-secondary");
      expect(stage.className).not.toContain("text-red-400");
    });

    it("renders a failed fab stage as a dashed ring + red CENTER dot (no whole-dot red)", () => {
      // The lifecycle dot replaces the old whole-dot red tint: a failed stage
      // keeps its phase hue (review→amber) with a dashed border and only a small
      // red center child. Requires a fabChange (else it's the tmux fallback).
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        fabStage: "review",
        fabDisplayState: "failed",
      });
      renderRow(win);
      const dot = screen.getByLabelText("review — failed");
      expect(dot.className).toContain("text-amber-400");
      expect(dot.className).not.toContain("text-red-400"); // whole-dot red is gone
      expect(dot.getAttribute("style")).toContain("dashed");
      expect(dot.querySelector("span")!.className).toContain("bg-red-400"); // red center only
    });

    it("renders a plain (non-fab, non-PR) window via the monochrome tmux fallback", () => {
      // No fabChange + no PR → gray, NOT a red tint even with a stray
      // fabDisplayState (which a non-change-bound window would never carry).
      const win = makeWindow({ windowId: "@0", index: 0, activity: "idle" });
      renderRow(win);
      const dot = screen.getByLabelText("idle");
      expect(dot.className).toContain("text-text-secondary");
      expect(dot.className).not.toContain("text-red-400");
    });

    it("renders a purple square (done) for a merged PR (first match wins over historical checks)", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prState: "merged",
        prChecks: "fail", // historical — must be ignored, merged is first
      });
      renderRow(win);
      const dot = screen.getByLabelText("PR — merged");
      expect(dot).toBeInTheDocument();
      expect(dot.className).toContain("text-purple-400");
      expect(dot.className).toContain("rounded-[3px]");
    });

    it("renders a purple dashed-ring + red center when prChecks is fail", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prState: "open",
        prChecks: "fail",
      });
      renderRow(win);
      const dot = screen.getByLabelText("PR — failing");
      expect(dot).toBeInTheDocument();
      expect(dot.className).toContain("text-purple-400");
      expect(dot.getAttribute("style")).toContain("dashed");
      expect(dot.querySelector("span")!.className).toContain("bg-red-400");
    });

    it("renders a failed dot when prReview is changes_requested (fail beats healthy)", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prState: "open",
        prChecks: "pass", // would be healthy, but changes_requested wins
        prReview: "changes_requested",
      });
      renderRow(win);
      const dot = screen.getByLabelText("PR — failing");
      expect(dot).toBeInTheDocument();
      expect(dot.className).toContain("text-purple-400");
    });

    it("renders a purple ring (pending) when checks are running", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prState: "open",
        prChecks: "pending",
      });
      renderRow(win);
      const dot = screen.getByLabelText("PR — checks running");
      expect(dot).toBeInTheDocument();
      expect(dot.className).toContain("text-purple-400");
      expect(dot.getAttribute("style")).toContain("transparent");
    });

    it("renders a purple solid (active) when checks pass and review is clean", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prState: "open",
        prChecks: "pass",
        prReview: "approved",
      });
      renderRow(win);
      const dot = screen.getByLabelText("PR — open");
      expect(dot).toBeInTheDocument();
      expect(dot.className).toContain("text-purple-400");
    });

    it("renders a purple solid for a draft with passing checks (green=health → solid)", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prState: "open",
        prIsDraft: true,
        prChecks: "pass",
      });
      renderRow(win);
      const dot = screen.getByLabelText("PR — open");
      expect(dot).toBeInTheDocument();
      expect(dot.className).toContain("text-purple-400");
    });

    it("renders a purple solid (neutral→solid) for an open PR with no decisive checks signal", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prState: "open",
      });
      renderRow(win);
      const dot = screen.getByLabelText("PR — open");
      expect(dot).toBeInTheDocument();
      expect(dot.className).toContain("text-purple-400");
      expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
    });

    it("renders a gray skipped ring for a closed-unmerged PR (labelled 'PR — closed')", () => {
      // A closed PR with no failing checks flows past merged/fail/pending/healthy
      // to neutral; prShape maps the closed-neutral case to the gray `skipped`
      // ring (docs/specs/status-dot.md line 61/82), NOT a purple solid.
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prState: "closed",
      });
      renderRow(win);
      const dot = screen.getByLabelText("PR — closed");
      expect(dot).toBeInTheDocument();
      expect(dot.className).toContain("text-text-secondary");
      expect(dot.className).not.toContain("text-purple-400");
    });

    it("does not render the PR phase when the window has no PR (fab phase instead)", () => {
      // fabChange but no prNumber → fab drives the dot, not PR.
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        fabStage: "apply",
        fabDisplayState: "active",
        prChecks: "fail",
      });
      renderRow(win);
      expect(screen.queryByLabelText("PR — merged")).toBeNull();
      expect(screen.queryByLabelText("PR — failing")).toBeNull();
      expect(screen.queryByLabelText("PR — open")).toBeNull();
      expect(screen.getByLabelText("apply — active")).toBeInTheDocument();
    });

    it("does not render the PR phase when the window is not change-bound (no fabChange)", () => {
      // A non-change-bound window with a populated prNumber falls to the tmux
      // fallback — the PR gate is `fabChange && prNumber`.
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        activity: "idle",
        prNumber: 386,
        prState: "open",
        prChecks: "fail",
        prReview: "changes_requested",
      });
      renderRow(win);
      expect(screen.queryByLabelText("PR — failing")).toBeNull();
      expect(screen.queryByLabelText("PR — open")).toBeNull();
      expect(screen.getByLabelText("idle")).toBeInTheDocument();
    });
  });

  // jsdom does not evaluate :hover / @media (pointer: coarse) / :has() as
  // computed styles, so the hardening contract is asserted as class strings.
  describe("hover-icon cluster hardening", () => {
    it("icon container is inert at rest and restores interactivity on hover, coarse pointers, and focus within", () => {
      const win = makeWindow({ windowId: "@0", index: 0 });
      const { container } = renderRowWithIcons(win);
      const cluster = container.querySelector("div.absolute.right-2");
      expect(cluster).not.toBeNull();
      expect(cluster!.className).toContain("pointer-events-none");
      expect(cluster!.className).toContain("group-hover:pointer-events-auto");
      expect(cluster!.className).toContain("coarse:pointer-events-auto");
      expect(cluster!.className).toContain("has-[:focus-visible]:pointer-events-auto");
    });

    it("hover-revealed buttons reveal themselves on keyboard focus", () => {
      const win = makeWindow({ windowId: "@0", index: 0, name: "my-shell" });
      renderRowWithIcons(win);
      const pin = screen.getByLabelText("Pin my-shell to a board");
      const swatch = screen.getByLabelText("Set color for my-shell");
      const kill = screen.getByLabelText("Kill window my-shell");
      for (const btn of [pin, swatch, kill]) {
        expect(btn.className).toContain("opacity-0");
        expect(btn.className).toContain("focus-visible:opacity-100");
      }
    });

    it("pinned pin button stays permanently visible (no geometry/visibility change)", () => {
      const win = makeWindow({ windowId: "@0", index: 0, name: "my-shell" });
      render(
        <WindowRow
          win={win}
          session="alpha"
          isSelected={false}
          isDragOver={false}
          editingWindow={null}
          editingName=""
          inputRef={{ current: null }}
          onSelectWindow={noop}
          onStartEditing={noop}
          onWindowNameChange={noop}
          onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
          onRenameBlur={noop}
          onKillClick={noop}
          server="srv"
          isPinnedToAny={true}
        />,
      );
      const pin = screen.getByLabelText("Pin my-shell to a board");
      expect(pin.className).toContain("opacity-100");
      expect(pin.className).not.toContain("opacity-0 ");
    });
  });

  // W3C-APG tree leaf semantics (Wave 3 sidebar-keyboard-nav). The window row
  // wrapper is the treeitem; the roving model in index.tsx threads tabIndex +
  // level/set/pos metadata. Level-2 leaves carry NO aria-expanded.
  describe("tree ARIA + roving tabindex", () => {
    function row(el: HTMLElement): HTMLElement {
      // The treeitem is the [data-window-id] wrapper carrying role="treeitem".
      const item = el.querySelector<HTMLElement>('[role="treeitem"][data-window-id]');
      expect(item).not.toBeNull();
      return item!;
    }

    it("renders role=treeitem at aria-level 2 with no aria-expanded", () => {
      const win = makeWindow({ windowId: "@3", index: 0, name: "edit" });
      const { container } = render(
        <WindowRow
          win={win}
          session="alpha"
          isSelected={false}
          isDragOver={false}
          editingWindow={null}
          editingName=""
          inputRef={{ current: null }}
          onSelectWindow={noop}
          onStartEditing={noop}
          onWindowNameChange={noop}
          onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
          onRenameBlur={noop}
          onKillClick={noop}
          ariaLevel={2}
          ariaSetSize={1}
          ariaPosInSet={1}
          tabIndex={-1}
        />,
      );
      const item = row(container);
      expect(item).toHaveAttribute("role", "treeitem");
      expect(item).toHaveAttribute("aria-level", "2");
      expect(item).not.toHaveAttribute("aria-expanded");
    });

    it("reflects aria-setsize / aria-posinset when passed", () => {
      const win = makeWindow({ windowId: "@3", index: 1, name: "test" });
      const { container } = render(
        <WindowRow
          win={win}
          session="alpha"
          isSelected={false}
          isDragOver={false}
          editingWindow={null}
          editingName=""
          inputRef={{ current: null }}
          onSelectWindow={noop}
          onStartEditing={noop}
          onWindowNameChange={noop}
          onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
          onRenameBlur={noop}
          onKillClick={noop}
          ariaLevel={2}
          ariaSetSize={2}
          ariaPosInSet={2}
          tabIndex={0}
        />,
      );
      const item = row(container);
      expect(item).toHaveAttribute("aria-setsize", "2");
      expect(item).toHaveAttribute("aria-posinset", "2");
    });

    it("defaults tabIndex to -1 and reflects an explicit roving tabIndex of 0", () => {
      const win = makeWindow({ windowId: "@3", index: 0 });
      const { container: a } = renderRow(win);
      expect(row(a)).toHaveAttribute("tabindex", "-1");

      const { container: b } = render(
        <WindowRow
          win={win}
          session="alpha"
          isSelected={false}
          isDragOver={false}
          editingWindow={null}
          editingName=""
          inputRef={{ current: null }}
          onSelectWindow={noop}
          onStartEditing={noop}
          onWindowNameChange={noop}
          onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
          onRenameBlur={noop}
          onKillClick={noop}
          tabIndex={0}
        />,
      );
      expect(row(b)).toHaveAttribute("tabindex", "0");
    });
  });

  // React.memo only pays off when the parent passes referentially-stable props.
  // This proves the memo'd WindowRow does NOT re-render its body when its PARENT
  // re-renders with an identical prop set — the property the whole change depends
  // on (an unrelated SSE tick re-renders Sidebar but must not churn the row).
  //
  // We count the row's OWN render-body executions via a spy on `isGhostWindow`,
  // which `WindowRowInner` calls at the very top of every render (`const ghost =
  // isGhostWindow(win)`). The parent (`Harness`) creates a FRESH <WindowRow>
  // element each render from a hoisted, stable props object, defeating React's
  // element-identity bailout — so only `React.memo` can stop the body from
  // re-running. An un-memoized WindowRow would call `isGhostWindow` again and
  // fail. (A Profiler-commit count would be confounded: a Profiler fires on its
  // parent's commit even when its memo'd child bails.)
  describe("React.memo", () => {
    it("does not re-render the row body when the parent re-renders with stable props", () => {
      const win = makeWindow({ windowId: "@0", index: 0, name: "stable" });
      const ghostSpy = vi.spyOn(optimisticContext, "isGhostWindow");

      // Hoisted once — every Harness render passes these identical references.
      const stableProps = {
        win,
        session: "alpha",
        isSelected: false,
        isDragOver: false,
        editingWindow: null,
        editingName: "",
        inputRef: { current: null },
        onSelectWindow: noop,
        onStartEditing: noop,
        onWindowNameChange: noop,
        onRenameKeyDown: noop as React.KeyboardEventHandler<HTMLInputElement>,
        onRenameBlur: noop,
        onKillClick: noop,
        onDragStart: noopDrag,
        onDragOver: noopDrag,
        onDrop: noopDrag,
        onDragEnd: noop,
      };

      let forceParent: () => void = () => {};
      function Harness() {
        const [, setTick] = useState(0);
        forceParent = () => setTick((n) => n + 1);
        // Fresh element each render, but identical prop references.
        return <WindowRow {...stableProps} />;
      }

      render(<Harness />);
      const afterMount = ghostSpy.mock.calls.length;
      expect(afterMount).toBeGreaterThan(0);

      // Force a parent re-render (the SSE-tick analogue). A NEW <WindowRow>
      // element is created, but its props are the same references, so memo skips
      // the row body — `isGhostWindow` is not called again.
      act(() => { forceParent(); });
      expect(ghostSpy.mock.calls.length).toBe(afterMount);

      ghostSpy.mockRestore();
    });
  });
});
