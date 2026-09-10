import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { resetFlyoutWarmState } from "@/components/sidebar/row-flyout-card";
import { stubMatchMedia } from "@/test-utils/match-media";
import { makeSession, makeWindow } from "@/test-utils/fixtures";
import {
  CRONS_SCROLL_EVENT,
  requestCronsScroll,
  consumePendingCronsScroll,
} from "@/lib/server-clock-dashboard-scroll";
import { ServerClockDashboard } from "./index";
import type { CronEntry } from "@/api/client";

function makeEntry(overrides: Partial<CronEntry> = {}): CronEntry {
  return {
    id: "aaaa",
    name: "operator tick",
    schedule: { kind: "backoff", min: "60s", max: "30m" },
    target: { kind: "role", role: "operator" },
    payload: "tick",
    lastFired: 0,
    ...overrides,
  };
}

function renderDashboard(matchMedia?: (query: string) => boolean) {
  stubMatchMedia(matchMedia ?? (() => false));
  return render(
    <ServerClockDashboard
      sessions={[
        makeSession({
          windows: [makeWindow({ windowId: "@1", monitored: true })],
        }),
      ]}
      cronData={{ entries: [makeEntry()], deliveries: [] }}
      onNavigate={vi.fn()}
      cronHandlers={{
        onCreate: vi.fn(),
        onMute: vi.fn(),
        onPin: vi.fn(),
        onDelete: vi.fn(),
      }}
    />,
  );
}

beforeEach(() => {
  resetFlyoutWarmState();
  // jsdom lacks scrollIntoView; the scroll seam asserts against this mock.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  resetFlyoutWarmState();
  vi.unstubAllGlobals();
  consumePendingCronsScroll();
});

describe("ServerClockDashboard", () => {
  it("renders the three zones in order: WATCHED, CRONS, RECENT DELIVERIES", () => {
    renderDashboard();
    const root = screen.getByTestId("server-clock-dashboard");
    const zones = ["clock-zone-watched", "clock-zone-crons", "clock-zone-deliveries"].map(
      (id) => screen.getByTestId(id),
    );
    for (const zone of zones) expect(root.contains(zone)).toBe(true);
    // Each zone follows its predecessor in document order.
    expect(
      zones[0].compareDocumentPosition(zones[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      zones[1].compareDocumentPosition(zones[2]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders nothing on mobile (narrow width OR coarse pointer)", () => {
    renderDashboard((query) => query.includes("max-width"));
    expect(screen.queryByTestId("server-clock-dashboard")).toBeNull();
    cleanup();
    renderDashboard((query) => query.includes("any-pointer"));
    expect(screen.queryByTestId("server-clock-dashboard")).toBeNull();
  });

  it("scrolls the CRONS heading into view when the document event fires", () => {
    renderDashboard();
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    expect(scroll).not.toHaveBeenCalled();

    document.dispatchEvent(new CustomEvent(CRONS_SCROLL_EVENT));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });

  it("covers the mount-after-dispatch race via the pending flag", () => {
    requestCronsScroll();
    renderDashboard();
    expect(vi.mocked(Element.prototype.scrollIntoView)).toHaveBeenCalledTimes(1);
  });
});
