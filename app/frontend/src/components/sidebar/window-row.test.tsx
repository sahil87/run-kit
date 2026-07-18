import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { WindowRow } from "./window-row";
import { ToastProvider } from "@/components/toast";
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
  // Pane panel (see status-panel.test.tsx). The former dashboard PrStatusLine
  // component was retired (260715-jykd) — the PR L3 register in the Pane panel is
  // now the sole PR text surface.
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

  // Row Minimalism (260706-y1ar; status-pyramid.md § Row Minimalism): the
  // trailing status cluster is REMOVED — the row renders NO stage word and NO
  // duration text. The leading StatusDot is the row's only externally visible
  // status signal; the exact stage word + durations live in the StatusDotTip
  // and the PANE panel's register view.
  describe("Row Minimalism — no stage word, no duration in the row", () => {
    it("renders no stage word for an active fab stage", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260612-epqk-x",
        fabStage: "review-pr",
        fabDisplayState: "active",
      });
      renderRow(win);
      // The stage word never appears as row text — only the leading dot + name.
      expect(screen.queryByText("review-pr")).toBeNull();
      expect(screen.getByText("zsh")).toBeInTheDocument();
    });

    it("renders no duration text (e.g. agent idle duration is not in the row)", () => {
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
      expect(screen.queryByText("2m")).toBeNull();
    });

    it("renders no stage word even for a failed stage (no red row text)", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        fabStage: "review",
        fabDisplayState: "failed",
      });
      renderRow(win);
      expect(screen.queryByText("review")).toBeNull();
    });
  });

  // The DOT carries all status (hue=phase, shape=status, additive halo=waiting).
  // A failed fab stage renders a dotted ring in the phase hue (green post-collapse)
  // + a red CENTER dot, never a whole-dot red.
  describe("dot status signals", () => {
    it("renders a failed fab stage as a green dotted ring + red CENTER dot (no whole-dot red)", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        fabStage: "review",
        fabDisplayState: "failed",
      });
      renderRow(win);
      const dot = screen.getByLabelText("review — failed");
      expect(dot.className).toContain("text-accent-green"); // green collapse (was amber)
      expect(dot.className).not.toContain("text-red-400"); // whole-dot red is gone
      expect(dot.getAttribute("style")).toContain("dotted");
      expect(dot.querySelector("span")!.className).toContain("bg-red-400"); // red center only
    });

    it("renders an additive yellow halo on a waiting window (core hue kept)", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        fabStage: "intake",
        fabDisplayState: "active",
        agentState: "waiting",
      });
      renderRow(win);
      const dot = screen.getByLabelText("intake — active — agent waiting");
      expect(dot.className).toContain("text-blue-400"); // core hue kept
      expect(dot.className).toContain("rk-waiting-halo"); // additive overlay
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
      expect(dot.className).toContain("rounded-none");
    });

    it("renders a purple dotted-ring + red center when prChecks is fail", () => {
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
      expect(dot.getAttribute("style")).toContain("dotted");
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

    it("D2: a closed-unmerged PR on a live fab change falls back to the green fab tier (not a dead PR dot)", () => {
      // Palette v3 D2 (status-pyramid.md decision-table row 20): a closed PR
      // never owns the dot — a live fab window shows its green stage instead of
      // a dead PR's skipped ring. With no stage/displayState the fab tier reads
      // "fab — active" (green solid), NOT "PR — closed".
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        fabStage: "apply",
        fabDisplayState: "active",
        prNumber: 386,
        prState: "closed",
      });
      renderRow(win);
      expect(screen.queryByLabelText("PR — closed")).toBeNull();
      const dot = screen.getByLabelText("apply — active");
      expect(dot.className).toContain("text-accent-green");
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

  // Pinned-row → board navigation (co9z): a pinned window's pin popover offers a
  // "Go to {board}" row that navigates to the owning board.
  describe("pinned-row board navigation (co9z)", () => {
    it("offers a 'Go to {board}' row in the pin popover that calls onNavigateToBoard", async () => {
      const win = makeWindow({ windowId: "@0", index: 0, name: "my-shell" });
      const onNavigateToBoard = vi.fn();
      render(
        <ToastProvider>
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
            pinnedBoard="work"
            onNavigateToBoard={onNavigateToBoard}
          />
        </ToastProvider>,
      );
      // Open the pin popover via the pin button.
      await act(async () => {
        screen.getByLabelText("Pin my-shell to a board").click();
      });
      const goto = screen.getByRole("button", { name: /Go to work/ });
      expect(goto).toBeInTheDocument();
      await act(async () => {
        goto.click();
      });
      expect(onNavigateToBoard).toHaveBeenCalledWith("work");
    });

    it("does not offer the 'Go to' row when the window is not pinned to a board", async () => {
      const win = makeWindow({ windowId: "@0", index: 0, name: "my-shell" });
      render(
        <ToastProvider>
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
            onNavigateToBoard={noop}
          />
        </ToastProvider>,
      );
      await act(async () => {
        screen.getByLabelText("Pin my-shell to a board").click();
      });
      expect(screen.queryByRole("button", { name: /Go to/ })).not.toBeInTheDocument();
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
