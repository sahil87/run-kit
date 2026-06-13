import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WindowRow } from "./window-row";
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
      nowSeconds={0}
      editingWindow={null}
      editingName=""
      inputRef={{ current: null }}
      onSelectWindow={noop}
      onDoubleClickName={noop}
      onWindowNameChange={noop}
      onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
      onRenameBlur={noop}
      onKillClick={noop as React.MouseEventHandler}
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
      nowSeconds={0}
      editingWindow={null}
      editingName=""
      inputRef={{ current: null }}
      onSelectWindow={noop}
      onDoubleClickName={noop}
      onWindowNameChange={noop}
      onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
      onRenameBlur={noop}
      onKillClick={noop as React.MouseEventHandler}
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
      nowSeconds={0}
      editingWindow={null}
      editingName=""
      inputRef={{ current: null }}
      onSelectWindow={noop}
      onDoubleClickName={noop}
      onWindowNameChange={noop}
      onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
      onRenameBlur={noop}
      onKillClick={noop as React.MouseEventHandler}
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

  // Triage signals: a failed fab stage colors the stage text and activity dot
  // red; a PR in trouble (checks failing or changes requested) surfaces a small
  // red glyph. These reuse the existing red token (text-red-400) and the shared
  // isFailish predicate — pure presentation over already-transmitted fields.
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

    it("colors the activity dot red when fabDisplayState is failed", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        activity: "idle",
        fabDisplayState: "failed",
      });
      renderRow(win);
      const dot = screen.getByLabelText("idle");
      expect(dot.className).toContain("text-red-400");
      expect(dot.className).not.toContain("text-text-secondary");
    });

    it("renders the PR-fail glyph when prChecks is fail", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prChecks: "fail",
      });
      renderRow(win);
      const glyph = screen.getByLabelText("PR needs attention");
      expect(glyph).toBeInTheDocument();
      expect(glyph.className).toContain("text-red-400");
    });

    it("renders the PR-fail glyph when prReview is changes_requested", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prChecks: "pass",
        prReview: "changes_requested",
      });
      renderRow(win);
      expect(screen.getByLabelText("PR needs attention")).toBeInTheDocument();
    });

    it("does not render the PR-fail glyph when checks pass and review is clean", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        fabChange: "260613-o20f-x",
        prNumber: 386,
        prChecks: "pass",
        prReview: "approved",
      });
      renderRow(win);
      expect(screen.queryByLabelText("PR needs attention")).toBeNull();
    });

    it("does not render the PR-fail glyph when the window has no PR", () => {
      const win = makeWindow({
        windowId: "@0",
        index: 0,
        prChecks: "fail",
      });
      renderRow(win);
      expect(screen.queryByLabelText("PR needs attention")).toBeNull();
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
          nowSeconds={0}
          editingWindow={null}
          editingName=""
          inputRef={{ current: null }}
          onSelectWindow={noop}
          onDoubleClickName={noop}
          onWindowNameChange={noop}
          onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
          onRenameBlur={noop}
          onKillClick={noop as React.MouseEventHandler}
          server="srv"
          isPinnedToAny={true}
        />,
      );
      const pin = screen.getByLabelText("Pin my-shell to a board");
      expect(pin.className).toContain("opacity-100");
      expect(pin.className).not.toContain("opacity-0 ");
    });
  });
});
