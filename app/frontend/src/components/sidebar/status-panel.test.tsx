import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { StatusPanel } from "./status-panel";
import { TIP_OPEN_DELAY_MS } from "@/components/tip";
import { makeWindow, makeWindowWithPanes } from "@/test-utils/fixtures";

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/api/client", () => ({
  refreshStatus: vi.fn(() => Promise.resolve({ status: "started" })),
}));
import { refreshStatus } from "@/api/client";

// Controllable status-refresh subscription: tests capture the button's handler
// and invoke it to simulate the server-global `status-refresh` completion event.
const statusRefreshHandlers = new Set<() => void>();
function fireStatusRefreshEvent() {
  for (const h of statusRefreshHandlers) h();
}
vi.mock("@/contexts/session-context", () => ({
  useSessionContext: () => ({
    subscribeStatusRefresh: (handler: () => void) => {
      statusRefreshHandlers.add(handler);
      return () => statusRefreshHandlers.delete(handler);
    },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  // Deterministic clock for the leaf `useNow()` inside WindowContent. Most
  // tests use activityTimestamp: 0 with epoch 0 → elapsed 0 → no idle duration
  // (the prior `nowSeconds={0}` behavior). The idle-duration tests override
  // this to 3700s below.
  vi.setSystemTime(0);
});

afterEach(() => {
  cleanup();
  statusRefreshHandlers.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("StatusPanel", () => {
  it("shows placeholder when no window selected", () => {
    render(<StatusPanel window={null} />);
    expect(screen.getByText("No tab selected")).toBeInTheDocument();
  });

  it("shows CWD from active pane — basename-first, the abbreviated parent yields", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/Users/sahil/code/run-kit", command: "zsh", isActive: true },
      ],
    });
    render(<StatusPanel window={win} />);
    // Two spans: the dim head-truncating parent (dir="rtl" + a bdi keeping the
    // text ltr) and the shrink-0 primary basename.
    const basename = screen.getByText("run-kit");
    expect(basename.className).toContain("shrink-0");
    expect(basename.className).toContain("text-text-primary");
    const parent = screen.getByText("~/code/");
    expect(parent.tagName).toBe("BDI");
    const parentSpan = parent.closest("span[dir='rtl']");
    expect(parentSpan).not.toBeNull();
    expect(parentSpan!.className).toContain("text-text-secondary");
  });

  it("falls back to worktreePath when no panes", () => {
    const win = makeWindow({ worktreePath: "/Users/sahil/projects/foo" });
    render(<StatusPanel window={win} />);
    expect(screen.getByText("~/projects/")).toBeInTheDocument();
    expect(screen.getByText("foo")).toBeInTheDocument();
  });

  it("a root-level path renders whole as the basename — no parent span", () => {
    const win = makeWindow({ worktreePath: "/var" });
    render(<StatusPanel window={win} />);
    expect(screen.getByText("/var")).toBeInTheDocument();
    expect(document.querySelector("[dir='rtl']")).toBeNull();
  });

  it("title and copy value keep the full unabbreviated path", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/Users/sahil/code/org/repo/src", command: "zsh", isActive: true },
      ],
    });
    render(<StatusPanel window={win} />);
    const cwdButton = document.querySelector("[title='/Users/sahil/code/org/repo/src']");
    expect(cwdButton).not.toBeNull();
    expect(cwdButton?.textContent).toContain("src");
    expect(cwdButton?.textContent).toContain("~/code/org/repo/");
  });

  it("marks the cwd as deleted when the active pane's cwd is missing — both spans red", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/sahil/wt/gone", command: "zsh", isActive: true, cwdMissing: true },
      ],
    });
    render(<StatusPanel window={win} />);
    // Stale path is kept as a breadcrumb alongside the "(deleted)" tag.
    expect(screen.getByText("gone").className).toContain("text-signal-red");
    expect(screen.getByText("~/wt/").closest("span")!.className).toContain("text-signal-red");
    expect(screen.getByTestId("cwd-deleted")).toHaveTextContent("(deleted)");
    expect(screen.getByTestId("cwd-deleted").className).toContain("text-signal-red");
  });

  it("does not mark the cwd as deleted when the active pane's cwd exists", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/sahil/wt/here", command: "zsh", isActive: true },
      ],
    });
    render(<StatusPanel window={win} />);
    expect(screen.queryByTestId("cwd-deleted")).not.toBeInTheDocument();
  });

  it("dims the six-digit date prefix on the git row; the rest stays primary", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home", command: "zsh", isActive: true, gitBranch: "260913-png4-compose-default-on" },
      ],
    });
    render(<StatusPanel window={win} />);
    expect(screen.getByText("260913-").className).toContain("text-text-secondary");
    expect(screen.getByText(/png4-compose-default-on/)).toBeInTheDocument();
  });

  it("renders no dim prefix for a branch without the date form", () => {
    render(<StatusPanel window={makeWindowWithPanes()} />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText(/\d{6}-/)).toBeNull();
  });

  it("shows window name", () => {
    const win = makeWindow({ name: "my-shell" });
    render(<StatusPanel window={win} />);
    expect(screen.getByText("my-shell")).toBeInTheDocument();
  });

  it("tmx renders the pane id alone for a single pane (ordinal only disambiguates)", () => {
    const win = makeWindow({
      panes: [{ paneId: "%5", paneIndex: 1, cwd: "/home", command: "zsh", isActive: true }],
    });
    render(<StatusPanel window={win} />);
    expect(screen.getByRole("button", { name: /%5/ })).toBeInTheDocument();
    expect(screen.queryByText(/1\/1/)).toBeNull();
  });

  it("multi-pane tmx: the id leads and the ordinal disambiguates", () => {
    const win = makeWindow({
      name: "editor",
      panes: [
        { paneId: "%1", paneIndex: 0, cwd: "/home", command: "vim", isActive: true },
        { paneId: "%2", paneIndex: 1, cwd: "/home", command: "zsh", isActive: false },
      ],
    });
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/%1 · 1\/2/)).toBeInTheDocument();
  });

  it("shows fab state when available, with the state token in the fab hue vocabulary", () => {
    const win = makeWindow({
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
      fabDisplayState: "failed",
    });
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/rx38/)).toBeInTheDocument();
    expect(screen.getByText(/apply/)).toBeInTheDocument();
    expect(screen.getByText("· failed").className).toContain("text-signal-red");
  });

  it("an unknown fab displayState renders the token with no colour class", () => {
    const win = makeWindow({
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
      fabDisplayState: "dancing",
    });
    render(<StatusPanel window={win} />);
    const token = screen.getByText("· dancing");
    expect(token.className).not.toContain("text-signal");
    expect(token.className).not.toContain("text-accent-green");
  });

  it("a fab branch carrying the change drops the slug from the register", () => {
    const win = makeWindow({
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home", command: "zsh", isActive: true, gitBranch: "260405-rx38-pane-cwd-tracking" },
      ],
    });
    render(<StatusPanel window={win} />);
    expect(screen.getByText("rx38 · apply")).toBeInTheDocument();
    // The git row still carries the full branch — the slug's one spelling —
    // and no empty continuation line is rendered.
    expect(screen.getByText(/rx38-pane-cwd-tracking/)).toBeInTheDocument();
    expect(screen.queryByTestId("fab-line-cont")).toBeNull();
    // Single-line form: the row stays the classic truncating button.
    const row = screen.getByText("rx38 · apply").closest("button")!;
    expect(row.className).toContain("truncate");
    expect(row.className).not.toContain("flex-col");
  });

  it("an off-change branch moves the slug to a dim continuation line (the off-branch signal)", () => {
    render(<StatusPanel window={makeWindowWithPanes({
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
      fabDisplayState: "active",
    })} />);
    // The key line holds only the decisive tokens — never the slug.
    const key = screen.getByText("rx38 · apply");
    expect(key).toHaveTextContent("rx38 · apply · active");
    expect(key).not.toHaveTextContent("pane-cwd-tracking");
    // The slug continues under the value column (4-advance key + 2-advance
    // icon cell), dim, truncating on its own.
    const cont = screen.getByTestId("fab-line-cont");
    expect(cont).toHaveTextContent("pane-cwd-tracking");
    for (const cls of ["pl-[6ch]", "text-text-secondary", "truncate", "w-full"]) {
      expect(cont.className).toContain(cls);
    }
    // Both lines live inside the ONE copy button (a click anywhere copies),
    // which stacks them instead of truncating as one line.
    const row = cont.closest("button")!;
    expect(row).toBe(key.closest("button"));
    expect(row.className).toContain("flex-col");
    expect(row.className).not.toMatch(/(^| )truncate( |$)/);
    // Exactly two lines: the key line and the continuation.
    expect(row.children).toHaveLength(2);
  });

  it("shows process info as fallback when no fab state", () => {
    const win = makeWindow({
      activity: "idle",
      activityTimestamp: 100,
      panes: [
        { paneId: "%1", paneIndex: 0, cwd: "/home", command: "zsh", isActive: true },
      ],
    });
    vi.setSystemTime(3_700_000);
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/zsh · idle 1h/)).toBeInTheDocument();
  });

  it("renders fab and run rows independently when both are present", () => {
    const win = makeWindow({
      activity: "idle",
      activityTimestamp: 100,
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
      panes: [
        { paneId: "%1", paneIndex: 0, cwd: "/home", command: "claude", isActive: true },
      ],
    });
    vi.setSystemTime(3_700_000);
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/rx38/)).toBeInTheDocument();
    expect(screen.getByText(/apply/)).toBeInTheDocument();
    expect(screen.getByText(/claude · idle 1h/)).toBeInTheDocument();
  });

  it("run row still shows idle duration when an agent is present", () => {
    const win = makeWindow({
      activity: "idle",
      activityTimestamp: 100,
      agentState: "waiting",
      agentIdleDuration: "2m",
      panes: [
        { paneId: "%1", paneIndex: 0, cwd: "/home", command: "claude", isActive: true },
      ],
    });
    vi.setSystemTime(3_700_000);
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/claude · idle 1h/)).toBeInTheDocument();
    expect(screen.getByText(/waiting 2m/)).toBeInTheDocument();
  });
});

describe("StatusPanel copy behavior", () => {
  it("clicking cwd row copies full path", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    expect(cwdButton).not.toBeNull();
    expect(cwdButton.tagName).toBe("BUTTON");

    fireEvent.click(cwdButton);

    expect(copyToClipboard).toHaveBeenCalledWith("/home/user/code/run-kit");
  });

  it("clicking git row copies branch name", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const gitButton = screen.getByRole("button", { name: /main/ });
    fireEvent.click(gitButton);

    expect(copyToClipboard).toHaveBeenCalledWith("main");
  });

  it("clicking tmx row copies pane ID", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const tmxButton = screen.getByRole("button", { name: /tmx %5/ });
    fireEvent.click(tmxButton);

    expect(copyToClipboard).toHaveBeenCalledWith("%5");
  });

  it("clicking fab row copies change ID", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes({
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
    });
    render(<StatusPanel window={win} />);

    const fabButton = screen.getByRole("button", { name: /rx38/ });
    fireEvent.click(fabButton);

    expect(copyToClipboard).toHaveBeenCalledWith("rx38");
  });

  it("shows 'copied' feedback after click and reverts after 1000ms", async () => {
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    fireEvent.click(cwdButton);

    // Should show "copied" feedback
    expect(screen.getByText(/copied \u2713/)).toBeInTheDocument();

    // After 1000ms, should revert
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText(/copied \u2713/)).not.toBeInTheDocument();
    expect(screen.getByText("cwd")).toBeInTheDocument();
  });

  it("feedback moves between rows — clicking git while cwd shows 'copied' swaps immediately", async () => {
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    // Click cwd
    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    fireEvent.click(cwdButton);
    expect(screen.getByText(/copied \u2713/)).toBeInTheDocument();

    // Click git within the feedback window
    const gitButton = screen.getByRole("button", { name: /main/ });
    fireEvent.click(gitButton);

    // Only one "copied" indicator at a time — the one on git row
    const copiedElements = screen.getAllByText(/copied \u2713/);
    expect(copiedElements).toHaveLength(1);
    // cwd label should have reverted
    expect(screen.getByText("cwd")).toBeInTheDocument();
  });

  it("active text selection suppresses copy", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    vi.mocked(copyToClipboard).mockClear();

    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    // Mock active text selection
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "selected text",
    } as Selection);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    fireEvent.click(cwdButton);

    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(screen.queryByText(/copied \u2713/)).not.toBeInTheDocument();

    getSelectionSpy.mockRestore();
  });

  it("output register (L0) is not rendered as a button (informational, always present)", () => {
    const win = makeWindowWithPanes({
      fabChange: undefined,
      fabStage: undefined,
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "zsh", isActive: true },
      ],
    });
    render(<StatusPanel window={win} />);

    // The L0 register uses the fixed-width 3-char key "out" (status-pyramid.md
    // § Row Minimalism) and is a div, not a button.
    const outputText = screen.getByText("out");
    expect(outputText.closest("button")).toBeNull();
    expect(outputText.closest("div")).not.toBeNull();
  });

  it("renders the fixed-width 3-char register keys out/agt (not output/agent)", () => {
    // Row Minimalism (status-pyramid.md): the L0/L1 register keys are normalized
    // to 3 chars — `out`/`agt` — matching tmx/cwd/git. The old `output`/`agent`
    // prefixes must be gone.
    const win = makeWindowWithPanes({
      agentState: "waiting",
      agentIdleDuration: "3m",
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "claude", isActive: true },
      ],
    });
    render(<StatusPanel window={win} />);

    expect(screen.getByText("out")).toBeInTheDocument();
    expect(screen.getByText("agt")).toBeInTheDocument();
    expect(screen.queryByText("output")).toBeNull();
    expect(screen.queryByText("agent")).toBeNull();
  });

  it("empty paneId renders non-interactive tmx row", () => {
    const win = makeWindowWithPanes({
      panes: [
        { paneId: "", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "zsh", isActive: true, gitBranch: "main" },
      ],
    });
    render(<StatusPanel window={win} />);

    // The tmx row should be a div, not a button
    const tmxText = screen.getByText("tmx");
    expect(tmxText.closest("button")).toBeNull();
    expect(tmxText.closest("div")).not.toBeNull();
  });

  it("keyboard activation (Enter) triggers copy on cwd row", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    vi.mocked(copyToClipboard).mockClear();

    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    cwdButton.focus();
    fireEvent.keyDown(cwdButton, { key: "Enter" });
    fireEvent.keyUp(cwdButton, { key: "Enter" });
    // Button elements natively handle Enter via click event
    fireEvent.click(cwdButton);

    expect(copyToClipboard).toHaveBeenCalledWith("/home/user/code/run-kit");
  });

  describe("pr row", () => {
    it("renders the pr row for a change-bound window with a PR", () => {
      const win = makeWindow({
        fabChange: "260610-596o-pr-status-sidebar",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
        prChecks: "pass",
        prReview: "approved",
      });
      render(<StatusPanel window={win} />);
      // Identity on the key line; the health facts continue on the dim second
      // line, each segment keeping its own hue.
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#241 · open");
      expect(screen.getByTestId("pr-line")).not.toHaveTextContent("checks");
      const cont = screen.getByTestId("pr-line-cont");
      expect(cont).toHaveTextContent("checks pass · review: approved");
      for (const cls of ["pl-[6ch]", "text-text-secondary", "truncate", "w-full"]) {
        expect(cont.className).toContain(cls);
      }
    });

    it("the anchor spans both lines (open-first covers the block); the copy icon is anchored to the key line", () => {
      const win = makeWindow({
        fabChange: "260610-596o-pr-status-sidebar",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
        prChecks: "pass",
        prReview: "approved",
      });
      render(<StatusPanel window={win} />);
      const link = screen.getByRole("link", { name: "Open PR #241 in a new tab" });
      expect(link).toContainElement(screen.getByTestId("pr-line"));
      expect(link).toContainElement(screen.getByTestId("pr-line-cont"));
      expect(link.className).toContain("flex-col");
      // The ↗ stays on the key line, after the identity span.
      const arrow = screen.getByText("↗");
      expect(arrow.parentElement).toBe(screen.getByTestId("pr-line").parentElement);
      // The hover copy icon is a SIBLING of the anchor whose container is
      // one text line tall from the top — centred on the key line, never on
      // the two-line block.
      const copyButton = screen.getByRole("button", { name: "Copy PR URL" });
      expect(link).not.toContainElement(copyButton);
      const container = copyButton.parentElement!;
      expect(container.className).toContain("top-0");
      expect(container.className).toContain("h-[1lh]");
      expect(container.className).not.toContain("top-1/2");
    });

    it("renders no continuation line when the PR has no health facts (`none` checks/review)", () => {
      const win = makeWindow({
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
        prChecks: "none",
        prReview: "none",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#241 · open");
      expect(screen.queryByTestId("pr-line-cont")).toBeNull();
    });

    it("colors the segments by state: open/pass/approved are green", () => {
      const win = makeWindow({
        fabChange: "260610-596o-pr-status-sidebar",
        prNumber: 241,
        prState: "open",
        prChecks: "pass",
        prReview: "approved",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByText("open").className).toContain("text-accent-green");
      expect(screen.getByText("checks pass").className).toContain("text-accent-green");
      expect(screen.getByText("review: approved").className).toContain("text-accent-green");
      expect(screen.getByText("#241").className).toContain("text-text-primary");
    });

    it("colors pending checks yellow", () => {
      const win = makeWindow({
        fabChange: "260610-596o-pr-status-sidebar",
        prNumber: 241,
        prState: "open",
        prChecks: "pending",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByText("checks pending").className).toContain("text-signal-yellow");
    });

    it("colors a draft's open state green (green = health, not readiness)", () => {
      // Under the health-not-readiness color story, a draft follows the same
      // state color as any open PR — green — so all three PR surfaces agree.
      const win = makeWindow({
        fabChange: "260610-596o-pr-status-sidebar",
        prNumber: 241,
        prState: "open",
        prIsDraft: true,
        prChecks: "pending",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByText("open (draft)").className).toContain("text-accent-green");
    });

    it("SHOWS the PR register even when NOT change-bound (L3 universal derivation, Principle X)", () => {
      // Palette v3 (status-pyramid.md § Signal Inventory L3): the PANE panel's PR
      // register is ungated from fabChange — it shows for ANY pane with a
      // prNumber (a plain shell on a branch with a PR still surfaces its PR
      // here, even though the DOT stays on the gray floor via D1).
      const win = makeWindow({
        fabChange: undefined,
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#241");
    });

    it("hides the pr register when there is no PR", () => {
      const win = makeWindow({ fabChange: "260610-596o-x", prNumber: undefined });
      render(<StatusPanel window={win} />);
      expect(screen.queryByText(/^#\d+/)).toBeNull();
    });

    it("copies the PR URL from the hover copy icon (and does not navigate)", async () => {
      const { copyToClipboard } = await import("@/lib/clipboard");
      vi.mocked(copyToClipboard).mockClear();

      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);

      // The row body is now a link (open-first); copy lives on a hover-revealed
      // icon button that is a SIBLING of the anchor (not nested inside it). Its
      // handler still calls preventDefault() as belt-and-suspenders, which we
      // assert below via fireEvent.click's boolean return.
      const copyButton = screen.getByRole("button", { name: "Copy PR URL" });
      // fireEvent.click wraps the dispatch in act() and returns false when the
      // event's default was prevented — so a false return proves the handler
      // called preventDefault() (the click would not navigate).
      const notDefaultPrevented = fireEvent.click(copyButton);

      expect(copyToClipboard).toHaveBeenCalledWith(
        "https://github.com/sahil87/run-kit/pull/241",
      );
      expect(notDefaultPrevented).toBe(false);
    });

    it("renders an always-visible inline ↗ that is not hover-gated", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);
      const arrow = screen.getByText("↗");
      expect(arrow).toBeInTheDocument();
      // The arrow signals "opens" — it must be always VISIBLE, never opacity-gated
      // like the hover-revealed copy icon. (It may still carry the shared
      // group-hover:text-accent COLOR treatment — that is affordance, not gating.)
      expect(arrow.className).not.toContain("opacity-0");
      expect(arrow.className).not.toContain("group-hover:opacity");
      expect(arrow.className).toContain("shrink-0");
    });

    it("shows 'copied' feedback via the copy icon on the link row", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);

      const copyButton = screen.getByRole("button", { name: "Copy PR URL" });
      fireEvent.click(copyButton);
      expect(screen.getByText(/copied ✓/)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText(/copied ✓/)).not.toBeInTheDocument();
    });

    it("shows the terminal state and suppresses checks/review for a merged PR", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 247,
        prUrl: "https://github.com/sahil87/run-kit/pull/247",
        prState: "merged",
        prChecks: "pass",
        prReview: "approved",
      });
      render(<StatusPanel window={win} />);
      // Merged PRs show "#247 · merged" only — checks/review are historical
      // once a PR lands, so they're suppressed and the row is ONE line.
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#247 · merged");
      expect(screen.queryByText(/checks/)).toBeNull();
      expect(screen.queryByTestId("pr-line-cont")).toBeNull();
      expect(screen.getByText("merged").className).toContain("text-signal-purple");
    });

    it("shows the terminal state and suppresses checks/review for a closed PR", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 247,
        prUrl: "https://github.com/sahil87/run-kit/pull/247",
        prState: "closed",
        prChecks: "fail",
        prReview: "changes_requested",
      });
      render(<StatusPanel window={win} />);
      // Closed PRs show "#247 · closed" only — same suppression as merged.
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#247 · closed");
    });

    it("suppresses a hidden failed check for a closed PR; only the state is red", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 247,
        prState: "closed",
        prChecks: "fail",
      });
      render(<StatusPanel window={win} />);
      // The failure text is suppressed for a terminal-state PR — the red on the
      // state segment refers to "closed" itself (GitHub convention), never to a
      // hidden failure reason, which must not leak into other segments.
      expect(screen.queryByText(/checks/)).toBeNull();
      expect(screen.getByText("closed").className).toContain("text-signal-red");
      expect(screen.getByText("#247").className).not.toContain("text-signal-red");
    });

    it("renders the row body itself as an open-in-new-tab link to the PR URL", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);
      // Open-first: the ROW BODY is the anchor (spanning the PR text), not a
      // separate right-aligned ↗ link. It carries the title (keeping the e2e
      // [title] locator) and the PR segment text.
      const link = screen.getByRole("link", {
        name: "Open PR #241 in a new tab",
      }) as HTMLAnchorElement;
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/sahil87/run-kit/pull/241",
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAttribute(
        "title",
        "https://github.com/sahil87/run-kit/pull/241",
      );
      expect(link).toHaveTextContent("#241");
      expect(link).toHaveTextContent("open");
    });

    it("renders no link and stays a copy row (copying the line text) when the PR has no URL", async () => {
      const { copyToClipboard } = await import("@/lib/clipboard");
      vi.mocked(copyToClipboard).mockClear();

      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: undefined,
        prState: "open",
        prChecks: "pass",
      });
      render(<StatusPanel window={win} />);

      // No URL → nothing to open: no anchor, no inline ↗, no hover copy icon.
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByText("↗")).toBeNull();
      expect(screen.queryByRole("button", { name: "Copy PR URL" })).toBeNull();

      // The no-URL row splits the same way as the anchor: identity on the key
      // line, health on the continuation — both inside the copy button.
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#241 · open");
      expect(screen.getByTestId("pr-line-cont")).toHaveTextContent("checks pass");
      const prRow = screen.getByTestId("pr-line").closest("button") as HTMLButtonElement;
      expect(prRow).not.toBeNull();
      expect(prRow).toContainElement(screen.getByTestId("pr-line-cont"));
      // The row body itself is the copy action, copying the joined full text.
      fireEvent.click(prRow);
      expect(copyToClipboard).toHaveBeenCalledWith("#241 · open · checks pass");
    });

    it("applies the red token to the failing checks segment", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prState: "open",
        prChecks: "fail",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#241 · open");
      expect(screen.getByTestId("pr-line-cont")).toHaveTextContent("checks fail");
      expect(screen.getByText("checks fail").className).toContain("text-signal-red");
      // The failure is scoped to its segment — the still-open state stays green.
      expect(screen.getByText("open").className).toContain("text-accent-green");
    });
  });
});

describe("PANE header refresh button (260715-jykd; feedback 260715-nwla)", () => {
  // Read the button's discriminated state from its `data-state` attribute — the
  // clean state consumer the component already exposes — rather than sniffing the
  // spinner SVG's className.baseVal.
  function spinning(button: HTMLButtonElement): boolean {
    return button.getAttribute("data-state") === "spinning";
  }

  it("renders the refresh button even with no window selected (server-global)", () => {
    render(<StatusPanel window={null} />);
    expect(screen.getByTestId("pane-refresh")).toBeInTheDocument();
  });

  it("started: spins on click and does NOT clear when the POST settles (waits for the event)", async () => {
    vi.mocked(refreshStatus).mockResolvedValueOnce({ status: "started" });

    render(<StatusPanel window={makeWindow()} />);
    const button = screen.getByTestId("pane-refresh") as HTMLButtonElement;

    // Click + let the resolved POST run its .then (which arms the fallback).
    await act(async () => {
      fireEvent.click(button);
    });
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    // Still spinning AFTER the POST settled — the spinner tracks the SSE event,
    // not the POST (this is the core behavior change vs jykd).
    expect(button.disabled).toBe(true);
    expect(spinning(button)).toBe(true);
    expect(screen.queryByTestId("pane-refresh-check")).toBeNull();
  });

  it("started: the status-refresh event clears the spinner and shows the checkmark", async () => {
    vi.mocked(refreshStatus).mockResolvedValueOnce({ status: "started" });

    render(<StatusPanel window={makeWindow()} />);
    const button = screen.getByTestId("pane-refresh") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(spinning(button)).toBe(true);

    // Simulate the server-global completion event.
    await act(async () => {
      fireStatusRefreshEvent();
    });
    expect(spinning(button)).toBe(false);
    expect(screen.getByTestId("pane-refresh-check")).toBeInTheDocument();

    // The checkmark auto-reverts to the idle icon after REFRESH_CHECK_MS.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId("pane-refresh-check")).toBeNull();
    expect(button.disabled).toBe(false);
  });

  it("no phantom checkmark: the event clearing the spinner cancels the fallback", async () => {
    // The completion event can beat the POST settle. The fallback timer is armed
    // at click entry, so flashCheck() (fired by the event) must clear it — else a
    // stray fallback would re-flash a phantom checkmark ~15s later. Idle after the
    // check reverts must stay idle across the whole fallback window.
    vi.mocked(refreshStatus).mockResolvedValueOnce({ status: "started" });

    render(<StatusPanel window={makeWindow()} />);
    const button = screen.getByTestId("pane-refresh") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      fireStatusRefreshEvent(); // event beats the POST fallback window
    });
    // Check flashes, then reverts.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId("pane-refresh-check")).toBeNull();

    // Advance well past REFRESH_FALLBACK_MS — no phantom checkmark reappears.
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    expect(screen.queryByTestId("pane-refresh-check")).toBeNull();
    expect(spinning(button)).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("throttled: shows the checkmark flash without ever spinning", async () => {
    vi.mocked(refreshStatus).mockResolvedValueOnce({ status: "throttled" });

    render(<StatusPanel window={makeWindow()} />);
    const button = screen.getByTestId("pane-refresh") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });
    // No spin — a throttled click gets an immediate "already fresh" checkmark.
    expect(spinning(button)).toBe(false);
    expect(screen.getByTestId("pane-refresh-check")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId("pane-refresh-check")).toBeNull();
  });

  it("coalesced: spins until the completion event (no distinct visual)", async () => {
    vi.mocked(refreshStatus).mockResolvedValueOnce({ status: "coalesced" });

    render(<StatusPanel window={makeWindow()} />);
    const button = screen.getByTestId("pane-refresh") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(spinning(button)).toBe(true);

    await act(async () => {
      fireStatusRefreshEvent();
    });
    expect(spinning(button)).toBe(false);
    expect(screen.getByTestId("pane-refresh-check")).toBeInTheDocument();
  });

  it("fallback: clears the spinner if no completion event arrives", async () => {
    vi.mocked(refreshStatus).mockResolvedValueOnce({ status: "started" });

    render(<StatusPanel window={makeWindow()} />);
    const button = screen.getByTestId("pane-refresh") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(spinning(button)).toBe(true);

    // No event; the 15s fallback fires and flashes the checkmark instead.
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(spinning(button)).toBe(false);
    expect(screen.getByTestId("pane-refresh-check")).toBeInTheDocument();
  });

  it("rejected POST: returns to idle without a stuck spinner", async () => {
    vi.mocked(refreshStatus).mockRejectedValueOnce(new Error("boom"));

    render(<StatusPanel window={makeWindow()} />);
    const button = screen.getByTestId("pane-refresh") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(spinning(button)).toBe(false);
    expect(button.disabled).toBe(false);
    expect(screen.queryByTestId("pane-refresh-check")).toBeNull();
  });

  it("clicking the header button does not toggle the panel open/closed", async () => {
    vi.mocked(refreshStatus).mockResolvedValueOnce({ status: "started" });
    render(<StatusPanel window={makeWindow()} />);
    // The panel is open by default; its content (the window name) is visible.
    expect(screen.getByText("zsh")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("pane-refresh"));
    });
    // CollapsiblePanel stops headerAction clicks from toggling — content stays.
    expect(screen.getByText("zsh")).toBeInTheDocument();
  });
});

describe("Register-label tips (260723-fm08)", () => {
  // Tier-1 Tip wiring on the register LABELS (tmx/cwd/git/pr/out/agt/fab).
  // Deep tooltip behavior is pinned once in tip.test.tsx; these tests assert
  // the per-site label wiring plus that the copy affordance survives the wrap.
  // jsdom has no matchMedia → useCoarsePointer reads a fine pointer, so Tip
  // is active by default.

  it("hovering the out register label opens its tip after the delay", () => {
    render(<StatusPanel window={makeWindowWithPanes()} />);
    const label = screen.getByText("out");
    act(() => {
      fireEvent.mouseEnter(label);
    });
    // Not yet — the 300ms open delay is pending (hover-only, no warm group here).
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Output activity");
    // The label stays a non-focusable span — no new tab stop was added.
    expect(label.tagName).toBe("SPAN");
    expect(label).not.toHaveAttribute("tabindex");
  });

  it("cwd prefix tip names the register while the row keeps copy-on-click", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    vi.mocked(copyToClipboard).mockClear();
    render(<StatusPanel window={makeWindowWithPanes()} />);

    const label = screen.getByText("cwd");
    act(() => {
      fireEvent.mouseEnter(label);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Working directory");

    // The Tip wraps the prefix span only — the row button's click still
    // copies, and the prefix swaps to the transient "copied ✓" feedback.
    const row = label.closest("button") as HTMLButtonElement;
    expect(row).not.toBeNull();
    fireEvent.click(row);
    expect(copyToClipboard).toHaveBeenCalledWith("/home/user/code/run-kit");
    expect(screen.getByText(/copied ✓/)).toBeInTheDocument();
    // The cwd state-reveal stays a native title on the row (73al promotion rule).
    expect(row).toHaveAttribute("title", "/home/user/code/run-kit");
  });
});

describe("opr register (operator watchlist)", () => {
  // The panel's fifth register — `opr watched · stage · tick age · repo ·
  // branch` after the fab row, present only for monitored windows; stale dims
  // the value text and marks the row (the note-stale idiom).
  it("renders register-operator for a monitored window, after the fab row", () => {
    vi.setSystemTime(10_000_000);
    render(
      <StatusPanel
        window={makeWindow({
          fabChange: "260805-93dy-row-flyout",
          fabStage: "apply",
          monitored: true,
          monitoredStage: "apply",
          monitoredRepo: "run-kit",
          monitoredBranch: "fab/wuiu",
        })}
        operator={{ stale: false, lastTickAt: 10_000_000 / 1000 - 120 }}
      />,
    );
    const opr = screen.getByTestId("register-operator");
    expect(opr).toHaveTextContent("opr watched · apply · tick 2m ago · run-kit · fab/wuiu");
    const fab = screen.getByText("93dy · apply").closest("button")!;
    expect(fab.compareDocumentPosition(opr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(opr.getAttribute("data-stale")).toBeNull();
  });

  it("is absent for an unmonitored window", () => {
    render(<StatusPanel window={makeWindow({})} operator={{ stale: false }} />);
    expect(screen.queryByTestId("register-operator")).toBeNull();
  });

  it("stale dims the value text and marks the row", () => {
    vi.setSystemTime(10_000_000);
    render(
      <StatusPanel
        window={makeWindow({ monitored: true })}
        operator={{ stale: true, lastTickAt: 10_000_000 / 1000 - 2460 }}
      />,
    );
    const opr = screen.getByTestId("register-operator");
    expect(opr).toHaveTextContent("opr watched · tick 41m ago");
    expect(opr).toHaveAttribute("data-stale", "true");
    expect(opr.querySelector("span:last-child")!.className).toContain("text-text-secondary");
  });

  it("the register label tip reads 'Operator watchlist'", () => {
    render(<StatusPanel window={makeWindow({ monitored: true })} operator={{ stale: false }} />);
    const label = screen.getByText("opr");
    act(() => {
      fireEvent.mouseEnter(label);
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Operator watchlist");
  });

  it("renders the done head for an owner-only window — never stale, even with a stale operator", () => {
    render(
      <StatusPanel
        window={makeWindow({ owner: "operator" })}
        operator={{ stale: true, lastTickAt: 10_000_000 / 1000 - 2460 }}
      />,
    );
    const opr = screen.getByTestId("register-operator");
    expect(opr).toHaveTextContent("opr done · operator-touched");
    expect(opr.getAttribute("data-stale")).toBeNull();
    expect(opr.querySelector("span:last-child")!.className).toContain("text-text-primary");
  });
});

describe("StatusPanel register key column", () => {
  // The key column is 4 monospace advances (3-char key + gap). The cwd row is
  // a flex row, and a flex container trims a flex item's trailing collapsible
  // space, so its gap must be an NBSP; inline rows keep the plain space.
  it("the flex-mode cwd row ends its key in an NBSP, at rest and while showing copied feedback", () => {
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);
    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    expect(cwdButton.textContent).toMatch(/^cwd\u00a0/);

    fireEvent.click(cwdButton);
    expect(cwdButton.textContent).toMatch(/^copied \u2713\u00a0/);
  });

  it("inline rows keep a plain-space gap after the key", () => {
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);
    const tmxButton = screen.getByRole("button", { name: /tmx %5/ });
    expect(tmxButton.textContent).toMatch(/^tmx\u0020/);
    const gitButton = screen.getByRole("button", { name: /main/ });
    expect(gitButton.textContent).toMatch(/^git\u0020/);
  });
});
