import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { IframeWindow } from "./iframe-window";
import { ChromeProvider } from "@/contexts/chrome-context";
import { SessionProvider } from "@/contexts/session-context";

// Mock the API client — updateWindowType is referenced in the "switch to terminal"
// button and must be stubbed to avoid throwing during render.
vi.mock("@/api/client", () => ({
  updateWindowUrl: vi.fn().mockResolvedValue({ ok: true }),
  updateWindowType: vi.fn().mockResolvedValue({ ok: true }),
  listServers: vi.fn().mockResolvedValue([]),
}));

import { updateWindowUrl } from "@/api/client";

function renderIframe(props: React.ComponentProps<typeof IframeWindow>, server = "runkit") {
  return render(
    <ChromeProvider>
      <SessionProvider server={server}>
        <IframeWindow {...props} />
      </SessionProvider>
    </ChromeProvider>,
  );
}

afterEach(cleanup);

describe("IframeWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // EventSource stub for SessionProvider's SSE connection.
    class MockEventSource {
      addEventListener = vi.fn();
      close = vi.fn();
      onerror: unknown = null;
      onopen: unknown = null;
    }
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  });

  it("renders iframe with proxied URL", () => {
    renderIframe({
      sessionName: "dev",
      windowIndex: 0,
      rkUrl: "http://localhost:8080/docs",
    });

    const iframe = screen.getByTitle("Proxied content") as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain("/proxy/8080/docs");
  });

  it("displays current URL in the URL bar", () => {
    renderIframe({
      sessionName: "dev",
      windowIndex: 0,
      rkUrl: "http://localhost:8080/docs",
    });

    const input = screen.getByLabelText("URL") as HTMLInputElement;
    expect(input.value).toBe("http://localhost:8080/docs");
  });

  it("calls updateWindowUrl on Enter with server as first arg", () => {
    renderIframe(
      {
        sessionName: "dev",
        windowIndex: 2,
        rkUrl: "http://localhost:8080/docs",
      },
      "server-B",
    );

    const input = screen.getByLabelText("URL") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "http://localhost:8080/api" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateWindowUrl).toHaveBeenCalledWith("server-B", "dev", 2, "http://localhost:8080/api");
  });

  it("renders refresh button", () => {
    renderIframe({
      sessionName: "dev",
      windowIndex: 0,
      rkUrl: "http://localhost:8080/docs",
    });

    const refreshBtn = screen.getByLabelText("Refresh");
    expect(refreshBtn).toBeTruthy();
  });

  it("passes through non-localhost URLs unchanged", () => {
    renderIframe({
      sessionName: "dev",
      windowIndex: 0,
      rkUrl: "https://example.com/docs",
    });

    const iframe = screen.getByTitle("Proxied content") as HTMLIFrameElement;
    expect(iframe.src).toContain("https://example.com/docs");
  });
});
