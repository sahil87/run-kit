import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { IframeWindow } from "./iframe-window";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";

// Mock the API client. `IframeWindow` now only calls `updateWindowUrl` (the URL
// bar's Enter-commit — global substrate state). It NO LONGER imports
// `updateWindowType`: the `>_` button switches views via the `onSwitchToTty`
// callback (per-viewer view state), never a `@rk_type` mutation.
vi.mock("@/api/client", () => ({
  updateWindowUrl: vi.fn().mockResolvedValue({ ok: true }),
  listServers: vi.fn().mockResolvedValue([]),
}));

import { updateWindowUrl } from "@/api/client";

function renderIframe(
  props: Omit<React.ComponentProps<typeof IframeWindow>, "onSwitchToTty"> & {
    onSwitchToTty?: () => void;
  },
  server = "runkit",
) {
  const { onSwitchToTty = () => {}, ...rest } = props;
  // Bypass SSE by using StandaloneSessionContextProvider; only `currentServer`
  // matters — IframeWindow reads it directly from useSessionContext.
  return render(
    <StandaloneSessionContextProvider
      value={{
        sessionsByServer: new Map([[server, []]]),
        sessionOrderByServer: new Map([[server, []]]),
        isConnectedByServer: new Map([[server, false]]),
        metricsByServer: new Map(),
        currentServer: server,
        servers: [{ name: server, sessionCount: 0 }],
        refreshServers: vi.fn(),
      }}
    >
      <IframeWindow {...rest} onSwitchToTty={onSwitchToTty} />
    </StandaloneSessionContextProvider>,
  );
}

afterEach(cleanup);

describe("IframeWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders iframe with proxied URL", () => {
    renderIframe({
      windowId: "@2",
      rkUrl: "http://localhost:8080/docs",
    });

    const iframe = screen.getByTitle("Proxied content") as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain("/proxy/8080/docs");
  });

  it("displays current URL in the URL bar", () => {
    renderIframe({
      windowId: "@2",
      rkUrl: "http://localhost:8080/docs",
    });

    const input = screen.getByLabelText("URL") as HTMLInputElement;
    expect(input.value).toBe("http://localhost:8080/docs");
  });

  it("calls updateWindowUrl on Enter with server as first arg", () => {
    renderIframe(
      {
        windowId: "@2",
        rkUrl: "http://localhost:8080/docs",
      },
      "server-B",
    );

    const input = screen.getByLabelText("URL") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "http://localhost:8080/api" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateWindowUrl).toHaveBeenCalledWith("server-B", "@2", "http://localhost:8080/api");
  });

  it("renders refresh button", () => {
    renderIframe({
      windowId: "@2",
      rkUrl: "http://localhost:8080/docs",
    });

    const refreshBtn = screen.getByLabelText("Refresh");
    expect(refreshBtn).toBeTruthy();
  });

  it("passes through non-localhost URLs unchanged", () => {
    renderIframe({
      windowId: "@2",
      rkUrl: "https://example.com/docs",
    });

    const iframe = screen.getByTitle("Proxied content") as HTMLIFrameElement;
    expect(iframe.src).toContain("https://example.com/docs");
  });

  it("the >_ button invokes onSwitchToTty (view switch), not a @rk_type mutation", () => {
    const onSwitchToTty = vi.fn();
    renderIframe({
      windowId: "@2",
      rkUrl: "http://localhost:8080/docs",
      onSwitchToTty,
    });

    fireEvent.click(screen.getByLabelText("Switch to terminal"));
    expect(onSwitchToTty).toHaveBeenCalledTimes(1);
    // No @rk_url mutation from a view switch (the only remaining option-mutating
    // call is the URL bar's Enter-commit, which we did not trigger here).
    expect(updateWindowUrl).not.toHaveBeenCalled();
  });
});
