import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { stubMatchMedia } from "@/test-utils/match-media";
import { makeSession, makeWindow } from "@/test-utils/fixtures";
import { ServerWatchedZone } from "./index";

// The mobile branch's zone is its own tested surface (cron-zone.test.tsx);
// here it is a marker so the fork can be asserted without the router/cron
// seams it reads.
vi.mock("./cron-zone", () => ({
  CronZone: ({ server }: { server: string }) => <div data-testid="clock-zone-cron">{server}</div>,
}));

function renderZone(matchMedia?: (query: string) => boolean) {
  stubMatchMedia(matchMedia ?? (() => false));
  return render(
    <ServerWatchedZone
      server="srv1"
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
  it("desktop renders the WATCHED zone only — no Cron section, no CRONS or RECENT DELIVERIES headings", () => {
    renderZone();
    const root = screen.getByTestId("server-clock-dashboard");
    expect(root.contains(screen.getByTestId("clock-zone-watched"))).toBe(true);
    expect(screen.queryByTestId("clock-zone-cron")).toBeNull();
    expect(screen.queryByTestId("clock-zone-crons")).toBeNull();
    expect(screen.queryByTestId("clock-zone-deliveries")).toBeNull();
  });

  it("mobile (narrow width OR coarse pointer) renders the Cron section for the server in place of WATCHED", () => {
    for (const predicate of [
      (query: string) => query.includes("max-width"),
      (query: string) => query.includes("any-pointer"),
    ]) {
      renderZone(predicate);
      const root = screen.getByTestId("server-clock-dashboard");
      expect(root.contains(screen.getByTestId("clock-zone-cron"))).toBe(true);
      expect(screen.getByTestId("clock-zone-cron")).toHaveTextContent("srv1");
      expect(screen.queryByTestId("clock-zone-watched")).toBeNull();
      cleanup();
    }
  });
});
