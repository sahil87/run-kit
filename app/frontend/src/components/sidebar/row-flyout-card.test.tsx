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
} from "./row-flyout-card";
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
 *  buttons so tests can drive them like the row does. */
function Row({ win, suppressed = false }: { win: WindowInfo; suppressed?: boolean }) {
  const flyout = useRowFlyout(win, { suppressed });
  return (
    <div ref={flyout.setReference} {...flyout.referenceProps} data-testid="row">
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
  it("renders the dot label header + docs link on every card (plain shell pane)", () => {
    const win = makeWindow({ activity: "idle" });
    renderOpen(win);

    const card = screen.getByTestId("row-flyout-card");
    expect(card).toBeInTheDocument();
    // Header label = dotLabel (single source with the dot's aria-label).
    expect(card).toHaveTextContent(dotLabel(win, statusDotState(win)));
    const docs = screen.getByTestId("row-flyout-docs-link");
    expect(docs).toHaveAttribute("href", STATUS_DOT_DOCS_URL);
    expect(docs).toHaveAttribute("target", "_blank");
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
    expect(fail!.className).toContain("text-red-400");
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
