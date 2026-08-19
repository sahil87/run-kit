import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SurfaceLayout } from "./surface-layout";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import { stubMatchMedia } from "@/test-utils/match-media";

stubMatchMedia(() => false);

vi.mock("@/components/terminal-client", () => ({
  TerminalClient: () => <div data-testid="mock-terminal" />,
}));
vi.mock("@/api/client", () => ({
  updateWindowUrl: vi.fn().mockResolvedValue({ ok: true }),
  checkFrame: vi.fn().mockResolvedValue({ reachable: true, embeddable: true, status: 200, reason: "" }),
  listServers: vi.fn().mockResolvedValue([]),
}));

afterEach(cleanup);

describe("integration: SurfaceLayout + real IframeWindow", () => {
  it("renders without an update-depth loop", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <StandaloneSessionContextProvider
        value={{
          sessionsByServer: new Map([["srv", []]]),
          sessionOrderByServer: new Map([["srv", []]]),
          isConnectedByServer: new Map([["srv", false]]),
          metricsByServer: new Map(),
          currentServer: "srv",
          servers: [{ name: "srv", sessionCount: 0 }],
          refreshServers: vi.fn(),
        }}
      >
      <SurfaceLayout
        layout={{ shape: "split-h", order: ["tty", "web"] }}
        server="srv"
        windowId="@1"
        sessionName="sess"
        window={{ rkUrl: "/proxy/8080/docs" }}
        isMobile={false}
        wsRef={{ current: null }}
        focusRef={{ current: null }}
        scrollLocked={false}
        onSessionNotFound={vi.fn()}
        chat={{ events: [], pending: null, connected: true, error: null, onSend: vi.fn(), busy: false }}
        codeReachable
        onPromote={vi.fn()}
        onSwap={vi.fn()}
        onClose={vi.fn()}
      />
      </StandaloneSessionContextProvider>,
    );
    await new Promise((r) => setTimeout(r, 300));
    // Simulate the frame's load event (the presented-page path) — the e2e
    // rig showed a Maximum-update-depth loop when real same-origin content
    // loaded; guard the seam here.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.load(document.querySelector("iframe")!);
    await new Promise((r) => setTimeout(r, 300));
    const depthErrors = errSpy.mock.calls.filter((c) =>
      String(c[0]).includes("Maximum update depth"),
    );
    errSpy.mockRestore();
    expect(depthErrors).toHaveLength(0);
  });
});
