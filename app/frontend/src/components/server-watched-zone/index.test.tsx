import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { stubMatchMedia } from "@/test-utils/match-media";
import { makeSession, makeWindow } from "@/test-utils/fixtures";
import { ServerWatchedZone } from "./index";

function renderZone(matchMedia?: (query: string) => boolean) {
  stubMatchMedia(matchMedia ?? (() => false));
  return render(
    <ServerWatchedZone
      sessions={[
        makeSession({
          windows: [makeWindow({ windowId: "@1", monitored: true })],
        }),
      ]}
      onNavigate={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ServerWatchedZone", () => {
  it("renders the WATCHED zone only — no CRONS or RECENT DELIVERIES headings", () => {
    renderZone();
    const root = screen.getByTestId("server-clock-dashboard");
    expect(root.contains(screen.getByTestId("clock-zone-watched"))).toBe(true);
    expect(screen.queryByTestId("clock-zone-crons")).toBeNull();
    expect(screen.queryByTestId("clock-zone-deliveries")).toBeNull();
  });

  it("renders nothing on mobile (narrow width OR coarse pointer)", () => {
    renderZone((query) => query.includes("max-width"));
    expect(screen.queryByTestId("server-clock-dashboard")).toBeNull();
    cleanup();
    renderZone((query) => query.includes("any-pointer"));
    expect(screen.queryByTestId("server-clock-dashboard")).toBeNull();
  });
});
