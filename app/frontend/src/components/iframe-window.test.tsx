import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { IframeWindow } from "./iframe-window";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";

// Mock the API client. `IframeWindow` only calls `updateWindowUrl` (the URL
// bar's Enter-commit — global substrate state). The `>_` button switches views
// via the `onSwitchToTty` callback (per-viewer view state), never a `@rk_type`
// mutation.
vi.mock("@/api/client", () => ({
  updateWindowUrl: vi.fn().mockResolvedValue({ ok: true }),
  listServers: vi.fn().mockResolvedValue([]),
}));

import { updateWindowUrl } from "@/api/client";

function iframeElement(
  props: Omit<React.ComponentProps<typeof IframeWindow>, "onSwitchToTty"> & {
    onSwitchToTty?: () => void;
  },
  server = "runkit",
) {
  const { onSwitchToTty = () => {}, ...rest } = props;
  // Bypass SSE by using StandaloneSessionContextProvider; only `currentServer`
  // matters — IframeWindow reads it directly from useSessionContext.
  return (
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
    </StandaloneSessionContextProvider>
  );
}

function renderIframe(
  props: Parameters<typeof iframeElement>[0],
  server = "runkit",
) {
  return render(iframeElement(props, server));
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

  // Interaction seam: parent-document listeners never hear in-frame clicks
  // (events stay in the frame's document; focus entering it fires no focusin
  // in the parent), so the component reports them via onInteract —
  // contentDocument listeners same-origin, window-blur fallback cross-origin.
  describe("onInteract seam", () => {
    const getIframe = () =>
      screen.getByTitle("Proxied content") as HTMLIFrameElement;

    it("fires on pointerdown and keydown inside the frame document", () => {
      const onInteract = vi.fn();
      renderIframe({
        windowId: "@2",
        rkUrl: "http://localhost:8080/docs",
        onInteract,
      });
      const doc = getIframe().contentDocument!;
      doc.dispatchEvent(new Event("pointerdown"));
      expect(onInteract).toHaveBeenCalledTimes(1);
      doc.dispatchEvent(new Event("keydown"));
      expect(onInteract).toHaveBeenCalledTimes(2);
    });

    it("a same-document load does not double-attach; a replaced document is re-attached", () => {
      const onInteract = vi.fn();
      renderIframe({
        windowId: "@2",
        rkUrl: "http://localhost:8080/docs",
        onInteract,
      });
      const iframe = getIframe();
      const doc = iframe.contentDocument!;

      // Same document across a load: still exactly one listener pair.
      fireEvent.load(iframe);
      doc.dispatchEvent(new Event("pointerdown"));
      expect(onInteract).toHaveBeenCalledTimes(1);

      // A navigation replaces the document — simulate by shadowing the
      // instance getter with a fresh document, then firing load.
      const freshDoc = document.implementation.createHTMLDocument();
      Object.defineProperty(iframe, "contentDocument", {
        value: freshDoc,
        configurable: true,
      });
      fireEvent.load(iframe);
      freshDoc.dispatchEvent(new Event("keydown"));
      expect(onInteract).toHaveBeenCalledTimes(2);
    });

    it("blur fallback fires only when the iframe is the active element, and dies on unmount", () => {
      const onInteract = vi.fn();
      const { unmount } = renderIframe({
        windowId: "@2",
        rkUrl: "http://localhost:8080/docs",
        onInteract,
      });
      const iframe = getIframe();

      // Focus elsewhere at blur: no report.
      fireEvent.blur(window);
      expect(onInteract).not.toHaveBeenCalled();

      Object.defineProperty(document, "activeElement", {
        value: iframe,
        configurable: true,
      });
      try {
        fireEvent.blur(window);
        expect(onInteract).toHaveBeenCalledTimes(1);

        unmount();
        fireEvent.blur(window);
        expect(onInteract).toHaveBeenCalledTimes(1);
      } finally {
        delete (document as { activeElement?: Element | null }).activeElement;
      }
    });

    it("reports nothing and errors nothing when the prop is omitted", () => {
      renderIframe({ windowId: "@2", rkUrl: "http://localhost:8080/docs" });
      const iframe = getIframe();
      expect(() => {
        iframe.contentDocument!.dispatchEvent(new Event("pointerdown"));
        fireEvent.load(iframe);
        fireEvent.blur(window);
      }).not.toThrow();
    });

    it("a handler supplied after mount reports (hidden tile with slot -1 becoming visible)", () => {
      const onInteract = vi.fn();
      const { rerender } = renderIframe({
        windowId: "@2",
        rkUrl: "http://localhost:8080/docs",
      });
      rerender(
        iframeElement(
          { windowId: "@2", rkUrl: "http://localhost:8080/docs", onInteract },
          "runkit",
        ),
      );
      getIframe().contentDocument!.dispatchEvent(new Event("pointerdown"));
      expect(onInteract).toHaveBeenCalledTimes(1);
    });

    it("unmount removes the frame-document listeners", () => {
      const onInteract = vi.fn();
      const { unmount } = renderIframe({
        windowId: "@2",
        rkUrl: "http://localhost:8080/docs",
        onInteract,
      });
      const doc = getIframe().contentDocument!;
      unmount();
      doc.dispatchEvent(new Event("pointerdown"));
      doc.dispatchEvent(new Event("keydown"));
      expect(onInteract).not.toHaveBeenCalled();
    });
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
