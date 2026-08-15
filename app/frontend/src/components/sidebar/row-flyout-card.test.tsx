import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import {
  useRowFlyout,
  flyoutOpenDelay,
  resetFlyoutWarmState,
  prFetchedAtEpoch,
  FreshnessLine,
  FLYOUT_OPEN_DELAY_MS,
  STATUS_DOT_DOCS_URL,
  FORK_TOOLTIP,
  canForkWindow,
} from "./row-flyout-card";
import { notchFill, POPUP_TITLE_BAR_HEIGHT_PX } from "./popup-title-bar";
import { dotLabel } from "@/components/status-dot-label";
import { statusDotState } from "@/components/pr-status-model";
import type { WindowInfo } from "@/types";
import { makeWindow, makeWindowWithPanes } from "@/test-utils/fixtures";

// The row-hover register flyout card (93dy) — the tier-2 surface replacing the
// retired StatusDotTip. The card opens on hover of its REFERENCE element after
// a delay; these tests drive fake timers to open it deterministically and to
// pin the useNow()-driven lines.

beforeEach(() => {
  vi.useFakeTimers();
  resetFlyoutWarmState();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetFlyoutWarmState();
});

/** Minimal consumer mirroring WindowRow's wiring: the hook's reference props
 *  ride a plain row element, and the card renders as a sibling. The imperative
 *  seams (`openNow` = the coarse dot-tap, `close` = drag start) are exposed as
 *  buttons so tests can drive them like the row does. `onFork` mirrors the row's
 *  bound fork handler (omitted ⇒ no fork affordance); `onRowClick` stands in for
 *  the real row's select-on-click so stopPropagation can be asserted. */
function Row({
  win,
  suppressed = false,
  onFork,
  onRowClick,
}: {
  win: WindowInfo;
  suppressed?: boolean;
  onFork?: () => Promise<void>;
  onRowClick?: () => void;
}) {
  const flyout = useRowFlyout(win, { suppressed, onFork });
  return (
    <div
      ref={flyout.setReference}
      {...flyout.referenceProps}
      onClick={onRowClick}
      data-testid="row"
    >
      row
      <button type="button" data-testid="open-now" onClick={() => flyout.openNow()} />
      <button type="button" data-testid="close-now" onClick={() => flyout.close()} />
      {flyout.card}
    </div>
  );
}

/** Hover the row and advance past the (cold) open delay. */
function hoverOpen(testid = "row") {
  const row = screen.getByTestId(testid);
  act(() => {
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    fireEvent.mouseEnter(row);
    vi.advanceTimersByTime(FLYOUT_OPEN_DELAY_MS + 50);
  });
}

function renderOpen(win: WindowInfo) {
  render(<Row win={win} />);
  hoverOpen();
}

describe("RowFlyout card content", () => {
  it("renders the identity title bar first, the docs link inside it, and the dot label as the first body line", () => {
    const win = makeWindow({ activity: "idle" });
    renderOpen(win);

    const card = screen.getByTestId("row-flyout-card");
    expect(card).toBeInTheDocument();
    const bar = screen.getByTestId("popup-title-bar");
    // Identity title (degraded form — the fixture carries no panes).
    expect(bar).toHaveTextContent("Window @0");
    // The docs affordance rides the bar's right edge.
    const docs = screen.getByTestId("row-flyout-docs-link");
    expect(bar).toContainElement(docs);
    expect(docs).toHaveAttribute("href", STATUS_DOT_DOCS_URL);
    expect(docs).toHaveAttribute("target", "_blank");
    // dotLabel demoted to the FIRST BODY LINE, still single-sourced with the
    // dot's aria-label (the shared import). ("idle" also appears in the `out`
    // register, so match the primary-text body span exactly.)
    const labelText = dotLabel(win, statusDotState(win));
    const label = Array.from(card.querySelectorAll("span")).find(
      (s) => s.textContent === labelText && s.className.includes("text-text-primary"),
    )!;
    expect(label).toBeTruthy();
    expect(bar.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("composes the full identity title — `Window @N · pane %N · N panes`", () => {
    renderOpen(
      makeWindowWithPanes({
        windowId: "@31",
        panes: [
          { paneId: "%7", paneIndex: 0, cwd: "/x", command: "zsh", isActive: false },
          { paneId: "%425", paneIndex: 1, cwd: "/x", command: "claude", isActive: true },
        ],
      }),
    );
    const bar = screen.getByTestId("popup-title-bar");
    expect(bar).toHaveTextContent("Window @31 · pane %425 · 2 panes");
    // Handles primary, literals secondary.
    expect(bar.querySelector("span")?.className).toContain("text-text-primary");
    const secondary = Array.from(bar.querySelectorAll("span")).find((s) =>
      s.className.includes("text-text-secondary"),
    );
    expect(secondary).toBeTruthy();
  });

  it("uses the singular `1 pane`", () => {
    renderOpen(makeWindowWithPanes({ windowId: "@31" }));
    expect(screen.getByTestId("popup-title-bar")).toHaveTextContent("Window @31 · pane %5 · 1 pane");
  });

  it("degrades to `Window @N` alone when panes are absent, and drops only the pane segment when none is active", () => {
    renderOpen(makeWindow({ windowId: "@31" }));
    expect(screen.getByTestId("popup-title-bar")).toHaveTextContent("Window @31");
    expect(screen.getByTestId("popup-title-bar")).not.toHaveTextContent("pane");

    cleanup();
    renderOpen(
      makeWindow({
        windowId: "@31",
        panes: [
          { paneId: "%7", paneIndex: 0, cwd: "/x", command: "zsh", isActive: false },
          { paneId: "%8", paneIndex: 1, cwd: "/x", command: "zsh", isActive: false },
        ],
      }),
    );
    expect(screen.getByTestId("popup-title-bar")).toHaveTextContent("Window @31 · 2 panes");
  });

  it("notch fill follows the band: inset inside the title bar, card surface below", () => {
    // jsdom has no layout, so the arrow middleware's y is unresolvable there —
    // the fill decision is pinned through its exported seam.
    expect(notchFill(0)).toBe("var(--color-bg-inset)");
    expect(notchFill(POPUP_TITLE_BAR_HEIGHT_PX - 1)).toBe("var(--color-bg-inset)");
    expect(notchFill(POPUP_TITLE_BAR_HEIGHT_PX)).toBe("var(--color-bg-primary)");
    expect(notchFill(120)).toBe("var(--color-bg-primary)");
    expect(notchFill(null)).toBe("var(--color-bg-primary)");
    expect(notchFill(undefined)).toBe("var(--color-bg-primary)");
  });

  it("absent layers render as absent: a plain shell pane shows ONLY the out register", () => {
    renderOpen(makeWindow({ activity: "idle" }));
    expect(screen.getByTestId("row-flyout-out")).toBeInTheDocument();
    expect(screen.queryByTestId("row-flyout-agt")).toBeNull();
    expect(screen.queryByTestId("row-flyout-fab")).toBeNull();
    expect(screen.queryByTestId("row-flyout-pr")).toBeNull();
    expect(screen.queryByTestId("row-flyout-pr-link")).toBeNull();
    expect(screen.queryByTestId("row-flyout-checked")).toBeNull();
  });

  it("renders all four registers + freshness + PR link for a fully-loaded window", () => {
    vi.setSystemTime(new Date("2026-08-05T10:00:30Z"));
    renderOpen(
      makeWindowWithPanes({
        activity: "active",
        agentState: "waiting",
        agentIdleDuration: "3m",
        fabChange: "260805-93dy-row-flyout",
        fabStage: "apply",
        fabDisplayState: "active",
        prNumber: 386,
        prUrl: "https://github.com/o/r/pull/386",
        prState: "open",
        prChecks: "pass",
        prReview: "approved",
        prFetchedAt: "2026-08-05T10:00:00Z",
      }),
    );

    expect(screen.getByTestId("row-flyout-out")).toHaveTextContent("active · zsh");
    expect(screen.getByTestId("row-flyout-agt")).toHaveTextContent("agt waiting 3m");
    expect(screen.getByTestId("row-flyout-fab")).toHaveTextContent("fab 93dy row-flyout · apply · active");
    const pr = screen.getByTestId("row-flyout-pr");
    expect(pr).toHaveTextContent("#386");
    // Register lines ellipsize INSIDE the max-w-xs card (panel parity —
    // status-panel.tsx `min-w-0 truncate`); jsdom has no layout, so the
    // classes are pinned here and the real no-overflow box is asserted in
    // e2e (row-flyout.spec.ts).
    for (const id of ["row-flyout-out", "row-flyout-agt", "row-flyout-fab", "row-flyout-pr"]) {
      expect(screen.getByTestId(id).className).toContain("truncate");
    }
    expect(pr).toHaveTextContent("open");
    expect(pr).toHaveTextContent("checks pass");
    expect(pr).toHaveTextContent("review: approved");
    expect(screen.getByTestId("row-flyout-checked")).toHaveTextContent("checked 30s ago");
    // The pr register LINE is the open-first anchor (PrLinkRow idiom): the
    // segments live inside it, with the always-visible inline ↗ after them.
    const link = screen.getByTestId("row-flyout-pr-link");
    expect(link).toContainElement(pr);
    expect(link).toHaveTextContent("↗");
    expect(link).toHaveAttribute("aria-label", "Open PR #386 in a new tab");
    expect(link).toHaveAttribute("href", "https://github.com/o/r/pull/386");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The anchor's prefix is EXACTLY "pr" + 2 NBSPs — the 4-advance column the
    // `out `/`agt `/`fab ` prefixes (and status-panel.tsx's pr rows) use. Pin
    // the codepoints so a mojibake re-encode (the cycle-1 `prÂ  ` regression,
    // U+00C2 U+00A0) can never silently return.
    const prPrefix = link.querySelector("span")!.textContent!;
    expect(Array.from(prPrefix).map((c) => c.codePointAt(0))).toEqual([
      0x70, 0x72, 0x00a0, 0x00a0,
    ]);
    // Row-aligned notch (E1): the arrow SVG renders inside the card.
    expect(screen.getByTestId("row-flyout-arrow")).toBeInTheDocument();
  });

  it("colors the PR segments via the shared vocabulary (fail → red)", () => {
    renderOpen(
      makeWindow({
        prNumber: 7,
        prState: "open",
        prChecks: "fail",
      }),
    );
    const pr = screen.getByTestId("row-flyout-pr");
    const fail = Array.from(pr.querySelectorAll("span")).find(
      (s) => s.textContent === "checks fail",
    );
    expect(fail).toBeTruthy();
    expect(fail!.className).toContain("text-signal-red");
    // No URL → the line stays plain read-only text, no anchor. Its RegisterLine
    // prefix carries the same pinned "pr" + 2-NBSP codepoints.
    expect(screen.queryByTestId("row-flyout-pr-link")).toBeNull();
    const plainPrefix = pr.querySelector("span")!.textContent!;
    expect(Array.from(plainPrefix).map((c) => c.codePointAt(0))).toEqual([
      0x70, 0x72, 0x00a0, 0x00a0,
    ]);
  });

  it("renders a bare 'open PR' anchor when prUrl exists without prNumber", () => {
    renderOpen(makeWindow({ prUrl: "https://github.com/o/r/pull/9" }));
    const link = screen.getByTestId("row-flyout-pr-link");
    expect(link).toHaveTextContent("open PR");
    expect(link).toHaveTextContent("↗");
    expect(link).toHaveAttribute("aria-label", "Open PR in a new tab");
    // No segment span without a prNumber (getPrSegments gate).
    expect(screen.queryByTestId("row-flyout-pr")).toBeNull();
  });

  it("does not mount the card at rest and does not open while suppressed", () => {
    const win = makeWindow({});
    const { rerender } = render(<Row win={win} suppressed />);
    expect(screen.queryByTestId("row-flyout-card")).toBeNull();
    hoverOpen();
    // Suppressed (popover open / ghost): hover never opens the card.
    expect(screen.queryByTestId("row-flyout-card")).toBeNull();
    rerender(<Row win={win} suppressed={false} />);
    expect(screen.queryByTestId("row-flyout-card")).toBeNull();
  });

  it("openNow (the coarse dot-tap) honors the suppressed gate", () => {
    const win = makeWindow({});
    const { rerender } = render(<Row win={win} suppressed />);
    // A dot-tap while a row popover is open must not flash the card.
    act(() => {
      fireEvent.click(screen.getByTestId("open-now"));
    });
    expect(screen.queryByTestId("row-flyout-card")).toBeNull();
    // Unsuppressed, the same tap opens immediately (no hover delay).
    rerender(<Row win={win} suppressed={false} />);
    act(() => {
      fireEvent.click(screen.getByTestId("open-now"));
    });
    expect(screen.getByTestId("row-flyout-card")).toBeInTheDocument();
  });
});

describe("Fork affordance (260806-s4av)", () => {
  // The fork link is DOUBLE-gated: the window must carry a claude chat AND the
  // consumer must have wired a handler. Both halves are asserted, plus the
  // stopPropagation contract (forking must never also select the row) and the
  // in-flight guard (the POST creates a tmux window, so N clicks would fork N
  // times).

  /** A settled fork handler — the app's real one surfaces its own errors and
   *  resolves either way, so a resolved promise is the faithful stand-in. */
  const forkResolved = () => vi.fn<() => Promise<void>>(() => Promise.resolve());

  it("renders beside the docs link for a claude-chat window with a handler", () => {
    const onFork = forkResolved();
    render(<Row win={makeWindow({ chatProvider: "claude" })} onFork={onFork} />);
    hoverOpen();

    const fork = screen.getByTestId("row-flyout-fork-link");
    expect(fork).toBeInTheDocument();
    // Copy names the same-directory semantics — what distinguishes a fork from
    // the spawn dialog's fresh (usually new-worktree) agent.
    expect(fork).toHaveAttribute("title", FORK_TOOLTIP);
    expect(fork).toHaveAttribute("aria-label", FORK_TOOLTIP);
    expect(FORK_TOOLTIP).toContain("same directory");
    // Both affordances live in the title bar's right-edge cluster.
    const cluster = fork.parentElement!;
    expect(cluster).toContainElement(screen.getByTestId("row-flyout-docs-link"));
    expect(screen.getByTestId("popup-title-bar")).toContainElement(cluster);
  });

  it("is absent for a window with no chat provider", () => {
    render(<Row win={makeWindow({})} onFork={forkResolved()} />);
    hoverOpen();
    expect(screen.queryByTestId("row-flyout-fork-link")).toBeNull();
    // The docs link is unaffected — the card still renders normally.
    expect(screen.getByTestId("row-flyout-docs-link")).toBeInTheDocument();
  });

  it("is absent for a non-claude provider (fork is a Claude Code mechanism)", () => {
    render(<Row win={makeWindow({ chatProvider: "codex" })} onFork={forkResolved()} />);
    hoverOpen();
    expect(screen.queryByTestId("row-flyout-fork-link")).toBeNull();
  });

  it("is absent when the consumer wired no handler (board-route sidebar / bare row)", () => {
    render(<Row win={makeWindow({ chatProvider: "claude" })} />);
    hoverOpen();
    expect(screen.queryByTestId("row-flyout-fork-link")).toBeNull();
  });

  it("clicking calls the handler and does not bubble to the row", () => {
    const onFork = forkResolved();
    const onRowClick = vi.fn();
    render(<Row win={makeWindow({ chatProvider: "claude" })} onFork={onFork} onRowClick={onRowClick} />);
    hoverOpen();

    act(() => {
      fireEvent.click(screen.getByTestId("row-flyout-fork-link"));
    });
    expect(onFork).toHaveBeenCalledTimes(1);
    // stopPropagation: forking must never also select the underlying row.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("disables the button while a fork is in flight, so a second click fires no second POST", async () => {
    // A handler that stays PENDING until the test resolves it — the in-flight
    // window the guard has to cover. The POST creates a tmux window, so a second
    // click getting through would create a second fork.
    let settle: () => void = () => {};
    const onFork = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    render(<Row win={makeWindow({ chatProvider: "claude" })} onFork={onFork} />);
    hoverOpen();

    const fork = screen.getByTestId("row-flyout-fork-link");
    expect(fork).toBeEnabled();

    act(() => {
      fireEvent.click(fork);
    });
    expect(onFork).toHaveBeenCalledTimes(1);
    expect(fork).toBeDisabled();

    act(() => {
      fireEvent.click(fork);
    });
    expect(onFork).toHaveBeenCalledTimes(1);

    // Settling re-enables it — a failed fork must stay retryable (the app's
    // handler resolves on error too, after surfacing a toast).
    await act(async () => {
      settle();
    });
    expect(screen.getByTestId("row-flyout-fork-link")).toBeEnabled();
  });

  it("canForkWindow gates on the claude provider exactly", () => {
    expect(canForkWindow(makeWindow({ chatProvider: "claude" }))).toBe(true);
    expect(canForkWindow(makeWindow({ chatProvider: "codex" }))).toBe(false);
    expect(canForkWindow(makeWindow({}))).toBe(false);
  });
});

describe("Flyout warm-window delay group (module-scoped)", () => {
  it("cold: full open delay; warm after a close: instant within the window", () => {
    vi.setSystemTime(new Date("2026-08-05T10:00:00Z"));
    expect(flyoutOpenDelay()).toEqual({ open: FLYOUT_OPEN_DELAY_MS, close: 0 });

    // Open then close a card — the cluster is now warm. Close via Escape
    // (useDismiss) — deterministic in jsdom, where safePolygon's zero-rect
    // pointer-leave geometry is not.
    render(<Row win={makeWindow({})} />);
    hoverOpen();
    expect(screen.getByTestId("row-flyout-card")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId("row-flyout-card")).toBeNull();

    // Within the 500ms warm window → instant open.
    expect(flyoutOpenDelay()).toEqual({ open: 0, close: 0 });
    // After the warm window lapses → cold again.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(flyoutOpenDelay()).toEqual({ open: FLYOUT_OPEN_DELAY_MS, close: 0 });
  });

  it("while a card is open elsewhere the cluster is warm (instant retarget)", () => {
    render(<Row win={makeWindow({})} />);
    hoverOpen();
    expect(screen.getByTestId("row-flyout-card")).toBeInTheDocument();
    expect(flyoutOpenDelay()).toEqual({ open: 0, close: 0 });
  });

  it("a no-op close (card never opened) does not arm the warm window", () => {
    vi.setSystemTime(new Date("2026-08-05T10:00:00Z"));
    render(<Row win={makeWindow({})} />);
    // Drag-start fires `close()` even when the 350ms delay never elapsed and
    // the card never opened — that must NOT stamp lastClosedAt (a false warm
    // window would make the next unrelated hover open instantly).
    act(() => {
      fireEvent.click(screen.getByTestId("close-now"));
    });
    expect(flyoutOpenDelay()).toEqual({ open: FLYOUT_OPEN_DELAY_MS, close: 0 });
  });

  it("opening a second row's card closes the first (single open card)", () => {
    render(
      <>
        <Row win={makeWindow({ windowId: "@1", name: "a" })} />
        <Row win={makeWindow({ windowId: "@2", name: "b" })} />
      </>,
    );
    const rows = screen.getAllByTestId("row");
    act(() => {
      fireEvent.pointerEnter(rows[0], { pointerType: "mouse" });
      fireEvent.mouseEnter(rows[0]);
      vi.advanceTimersByTime(FLYOUT_OPEN_DELAY_MS + 50);
    });
    expect(screen.getAllByTestId("row-flyout-card")).toHaveLength(1);
    // Cold open carries the slide-out entrance class (E1 base cue)…
    expect(screen.getByTestId("row-flyout-card").className).toContain("rk-flyout-in");
    act(() => {
      fireEvent.pointerEnter(rows[1], { pointerType: "mouse" });
      fireEvent.mouseEnter(rows[1]);
      // Warm (first card open) → instant open; the coordinator closes card #1.
      vi.advanceTimersByTime(50);
    });
    expect(screen.getAllByTestId("row-flyout-card")).toHaveLength(1);
    // …but a warm retarget snaps — no re-animation on every sweep.
    expect(screen.getByTestId("row-flyout-card").className).not.toContain("rk-flyout-in");
  });
});

describe("prFetchedAtEpoch + FreshnessLine (migrated from the dot tip)", () => {
  it("parses prFetchedAt to epoch seconds", () => {
    expect(prFetchedAtEpoch(makeWindow({ prFetchedAt: "2026-07-15T10:00:00Z" }))).toBe(
      Math.floor(Date.parse("2026-07-15T10:00:00Z") / 1000),
    );
  });

  it("null when absent or unparseable", () => {
    expect(prFetchedAtEpoch(makeWindow({}))).toBeNull();
    expect(prFetchedAtEpoch(makeWindow({ prFetchedAt: "garbage" }))).toBeNull();
  });

  it("FreshnessLine renders the relative time and omits itself on null", () => {
    vi.setSystemTime(new Date("2026-07-15T10:00:30Z"));
    render(<FreshnessLine fetchedAtEpoch={Math.floor(Date.parse("2026-07-15T10:00:00Z") / 1000)} />);
    expect(screen.getByTestId("row-flyout-checked")).toHaveTextContent("checked 30s ago");
    cleanup();
    render(<FreshnessLine fetchedAtEpoch={null} />);
    expect(screen.queryByTestId("row-flyout-checked")).toBeNull();
  });
});
