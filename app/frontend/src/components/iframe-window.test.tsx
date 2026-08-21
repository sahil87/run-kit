import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { IframeWindow } from "./iframe-window";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";

// Mock the API client. `IframeWindow` calls `updateWindowUrl` (the URL bar's
// Enter-commit — global substrate state) and `checkFrame` (the frame-refusal
// probe for external URLs — default embeddable so existing tests render the
// iframe).
vi.mock("@/api/client", () => ({
  updateWindowUrl: vi.fn().mockResolvedValue({ ok: true }),
  checkFrame: vi.fn().mockResolvedValue({ reachable: true, embeddable: true, status: 200, reason: "" }),
  listServers: vi.fn().mockResolvedValue([]),
}));

import { updateWindowUrl, checkFrame } from "@/api/client";

function iframeElement(
  props: React.ComponentProps<typeof IframeWindow>,
  server = "runkit",
) {
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
      <IframeWindow {...props} />
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

  it("rest shows the display form; focus reveals the raw value (260819-v6y4 R7)", () => {
    renderIframe({
      windowId: "@2",
      rkUrl: "http://localhost:8080/docs",
    });

    const input = screen.getByLabelText("URL") as HTMLInputElement;
    // At rest the proxied display form — the http://localhost plumbing hidden.
    expect(input.value).toBe("localhost:8080/docs");
    // Focus enters edit mode with the raw stored value.
    fireEvent.focus(input);
    expect(input.value).toBe("http://localhost:8080/docs");
    // Blur (unchanged) returns to the display form.
    fireEvent.blur(input);
    expect(input.value).toBe("localhost:8080/docs");
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

  // The `>_` switch-to-terminal button is removed (260819-v6y4 R13): the
  // top-bar surface toggles own view switching, and its R7 zero-POST concern
  // is covered by the surface-toggle path web-view-lens.spec.ts asserts.
  it("no switch-to-terminal button renders in the URL bar", () => {
    renderIframe({
      windowId: "@2",
      rkUrl: "http://localhost:8080/docs",
    });
    expect(screen.queryByLabelText("Switch to terminal")).toBeNull();
  });

  // Chord reclaim (260819-ie2i R1): the seam reports onInteract first, then
  // consumes ONLY predicate-matching chords in the frame and re-dispatches a
  // synthetic bubbling keydown on the parent document.
  describe("chord reclaim seam", () => {
    const getIframe = () =>
      screen.getByTitle("Proxied content") as HTMLIFrameElement;

    it("a matching chord is prevented in the frame and re-dispatched on the parent document", () => {
      const onInteract = vi.fn();
      renderIframe({
        windowId: "@2",
        rkUrl: "http://localhost:8080/docs",
        onInteract,
        shouldReclaimChord: (e) => e.code === "KeyK",
      });
      const parentReceived = vi.fn();
      document.addEventListener("keydown", parentReceived);
      try {
        const doc = getIframe().contentDocument!;
        const event = new KeyboardEvent("keydown", {
          key: "k",
          code: "KeyK",
          metaKey: true,
          cancelable: true,
        });
        doc.dispatchEvent(event);
        // onInteract reported first; the frame's event was consumed…
        expect(onInteract).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
        // …and a synthetic copy (key/code/modifiers, bubbling) landed on the
        // parent document.
        expect(parentReceived).toHaveBeenCalledTimes(1);
        const synthetic = parentReceived.mock.calls[0][0] as KeyboardEvent;
        expect(synthetic.code).toBe("KeyK");
        expect(synthetic.metaKey).toBe(true);
        expect(synthetic.bubbles).toBe(true);
      } finally {
        document.removeEventListener("keydown", parentReceived);
      }
    });

    it("a non-matching keydown passes through untouched (no prevent, no re-dispatch)", () => {
      const onInteract = vi.fn();
      renderIframe({
        windowId: "@2",
        rkUrl: "http://localhost:8080/docs",
        onInteract,
        shouldReclaimChord: () => false,
      });
      const parentReceived = vi.fn();
      document.addEventListener("keydown", parentReceived);
      try {
        const doc = getIframe().contentDocument!;
        const event = new KeyboardEvent("keydown", {
          key: "a",
          code: "KeyA",
          cancelable: true,
        });
        doc.dispatchEvent(event);
        expect(onInteract).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(false);
        expect(parentReceived).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener("keydown", parentReceived);
      }
    });

    it("without the predicate the seam stays report-only (legacy behavior)", () => {
      const onInteract = vi.fn();
      renderIframe({ windowId: "@2", rkUrl: "http://localhost:8080/docs", onInteract });
      const parentReceived = vi.fn();
      document.addEventListener("keydown", parentReceived);
      try {
        const doc = getIframe().contentDocument!;
        const event = new KeyboardEvent("keydown", {
          key: "k",
          code: "KeyK",
          metaKey: true,
          cancelable: true,
        });
        doc.dispatchEvent(event);
        expect(onInteract).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(false);
        expect(parentReceived).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener("keydown", parentReceived);
      }
    });
  });

  // Find bar (260819-ie2i R5/R7/R8): open seams, counter/navigation, the
  // cross-origin disabled state, and reset-on-load.
  describe("find bar", () => {
    const getIframe = () =>
      screen.getByTitle("Proxied content") as HTMLIFrameElement;

    /** Swap in a fresh same-origin frame document carrying `html` and fire
     *  `load` — the attach seam's re-attach path (jsdom's initial frame
     *  document is bare, so we shadow the whole contentDocument, the
     *  existing seam tests' pattern). */
    function seedFrameDocument(html: string) {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = html;
      Object.defineProperty(getIframe(), "contentDocument", {
        value: doc,
        configurable: true,
      });
      fireEvent.load(getIframe());
    }

    function openBarViaEvent() {
      // fireEvent (not a raw dispatchEvent) so the state update lands inside act().
      fireEvent(document, new CustomEvent("web-find:open"));
    }

    it("opens via the web-find:open CustomEvent with the input focused, and via the ⌕ button", () => {
      renderIframe({ windowId: "@2", rkUrl: "http://localhost:8080/docs" });
      expect(screen.queryByTestId("web-find-bar")).toBeNull();
      openBarViaEvent();
      const input = screen.getByLabelText("Find query") as HTMLInputElement;
      expect(input).toHaveFocus();
      fireEvent.click(screen.getByLabelText("Close find bar"));
      expect(screen.queryByTestId("web-find-bar")).toBeNull();
      fireEvent.click(screen.getByLabelText("Find in page"));
      expect(screen.getByTestId("web-find-bar")).toBeTruthy();
    });

    it("counts matches, Enter/Shift+Enter cycle with wrap, Escape closes", () => {
      renderIframe({ windowId: "@2", rkUrl: "http://localhost:8080/docs" });
      seedFrameDocument("<p>version one</p><p>the version floor</p><p>Version</p>");
      openBarViaEvent();
      const input = screen.getByLabelText("Find query");
      const counter = () => screen.getByLabelText("Match count").textContent;

      fireEvent.change(input, { target: { value: "version" } });
      expect(counter()).toBe("1/3");

      fireEvent.keyDown(input, { key: "Enter" });
      expect(counter()).toBe("2/3");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(counter()).toBe("3/3");
      // Wraps forward past the last and backward before the first.
      fireEvent.keyDown(input, { key: "Enter" });
      expect(counter()).toBe("1/3");
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
      expect(counter()).toBe("3/3");

      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByTestId("web-find-bar")).toBeNull();
    });

    it("a query with no matches reads 0/0 and navigation is a no-op; clearing the query clears the count", () => {
      renderIframe({ windowId: "@2", rkUrl: "http://localhost:8080/docs" });
      seedFrameDocument("<p>nothing here</p>");
      openBarViaEvent();
      const input = screen.getByLabelText("Find query");
      const counter = () => screen.getByLabelText("Match count").textContent;

      fireEvent.change(input, { target: { value: "absent" } });
      expect(counter()).toBe("0/0");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(counter()).toBe("0/0");
      fireEvent.change(input, { target: { value: "" } });
      expect(counter()).toBe("0/0");
    });

    it("a cross-origin frame renders the bar disabled with the hint (R7)", () => {
      renderIframe({ windowId: "@2", rkUrl: "https://example.com/docs" });
      const iframe = getIframe();
      // Simulate cross-origin: contentDocument/contentWindow access throws.
      Object.defineProperty(iframe, "contentDocument", {
        get() {
          throw new Error("cross-origin");
        },
        configurable: true,
      });
      Object.defineProperty(iframe, "contentWindow", {
        get() {
          throw new Error("cross-origin");
        },
        configurable: true,
      });
      fireEvent.load(iframe);

      fireEvent.click(screen.getByLabelText("Find in page"));
      expect(
        screen.getByText("page is cross-origin — find unavailable"),
      ).toBeTruthy();
      expect((screen.getByLabelText("Find query") as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByLabelText("Next match") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByLabelText("Previous match") as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByLabelText("Match count")).toBeNull();
    });

    it("a frame navigation resets matches and the query (R8)", () => {
      renderIframe({ windowId: "@2", rkUrl: "http://localhost:8080/docs" });
      seedFrameDocument("<p>version one</p>");
      openBarViaEvent();
      const input = screen.getByLabelText("Find query") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "version" } });
      expect(screen.getByLabelText("Match count").textContent).toBe("1/1");

      // A navigation replaces the document — the seed helper IS that path.
      seedFrameDocument("<p>version version</p>");

      // The term does not persist across navigations (assumption 7).
      expect(input.value).toBe("");
      expect(screen.getByLabelText("Match count").textContent).toBe("0/0");
    });
  });

  // ── 260819-v6y4: browser chrome, display/edit address bar, error states ──

  describe("address bar display/edit split (R7) + submit normalization (R4)", () => {
    it("Enter normalizes bare loopback input and POSTs the proxy path", () => {
      renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/docs" }, "server-B");
      const input = screen.getByLabelText("URL") as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "localhost:5173" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(updateWindowUrl).toHaveBeenCalledWith("server-B", "@2", "/proxy/5173/");
    });

    it("Escape reverts the edit to the rest display form without a POST", () => {
      renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/docs" });
      const input = screen.getByLabelText("URL") as HTMLInputElement;
      fireEvent.focus(input);
      expect(input.value).toBe("/proxy/8080/docs");
      fireEvent.change(input, { target: { value: "example.com" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(updateWindowUrl).not.toHaveBeenCalled();
      expect(input.value).toBe("localhost:8080/docs");
    });

    it("an invalid scheme surfaces inline feedback and fires NO POST", () => {
      renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/docs" });
      const input = screen.getByLabelText("URL") as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(updateWindowUrl).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("http");
      // The next keystroke clears the inline rejection.
      fireEvent.change(input, { target: { value: "javascript:alert(2)" } });
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("same-origin in-frame navigation tracks the display form only — @rk_url untouched", () => {
      renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/docs" });
      const iframe = screen.getByTitle("Proxied content") as HTMLIFrameElement;
      const realWin = iframe.contentWindow!;
      Object.defineProperty(iframe, "contentWindow", {
        value: new Proxy(realWin, {
          get: (t, p) =>
            p === "location"
              ? { origin: window.location.origin, pathname: "/proxy/8080/next", search: "?x=1", hash: "" }
              : Reflect.get(t, p),
        }),
        configurable: true,
      });
      fireEvent.load(iframe);
      const input = screen.getByLabelText("URL") as HTMLInputElement;
      expect(input.value).toBe("localhost:8080/next?x=1");
      expect(updateWindowUrl).not.toHaveBeenCalled();
    });
  });

  describe("back/forward + open-in-browser chrome (R5/R9)", () => {
    it("renders back/forward/refresh/find/open with their register data-icon SVGs on a same-origin tile", () => {
      renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/docs" });
      // Glyph identity via the ControlGlyph data-icon seam (the pjqd
      // precedent) — the buttons render register SVGs, not unicode spans.
      const glyphs: Array<[string, string]> = [
        ["Back", "web-back"],
        ["Forward", "web-forward"],
        ["Refresh", "refresh"],
        ["Find in page", "find"],
        ["Open in browser", "open-external"],
      ];
      for (const [label, icon] of glyphs) {
        const button = screen.getByLabelText(label);
        expect(button.querySelector(`svg[data-icon="${icon}"]`)).toBeTruthy();
      }
    });

    it("hides back/forward on a cross-origin frame", () => {
      renderIframe({ windowId: "@2", rkUrl: "https://example.com/docs" });
      const iframe = screen.getByTitle("Proxied content") as HTMLIFrameElement;
      Object.defineProperty(iframe, "contentDocument", {
        get() {
          throw new Error("cross-origin");
        },
        configurable: true,
      });
      Object.defineProperty(iframe, "contentWindow", {
        get() {
          throw new Error("cross-origin");
        },
        configurable: true,
      });
      fireEvent.load(iframe);
      expect(screen.queryByLabelText("Back")).toBeNull();
      expect(screen.queryByLabelText("Forward")).toBeNull();
      // Reload and ↗ stay — the bounce fallback and the escape hatch.
      expect(screen.getByLabelText("Refresh")).toBeTruthy();
      expect(screen.getByLabelText("Open in browser")).toBeTruthy();
    });

    it("↗ opens the current address in a new tab without touching @rk_url", () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      renderIframe({ windowId: "@2", rkUrl: "/present/@320/file.html?server=runKit" });
      fireEvent.click(screen.getByLabelText("Open in browser"));
      expect(open).toHaveBeenCalledWith("/present/@320/file.html?server=runKit", "_blank", "noopener");
      expect(updateWindowUrl).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it("the web-open-external CustomEvent opens the current address (palette seam)", () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/docs" });
      fireEvent(document, new CustomEvent("web-open-external"));
      expect(open).toHaveBeenCalledWith("/proxy/8080/docs", "_blank", "noopener");
      open.mockRestore();
    });
  });

  describe("error states (R8)", () => {
    it("frame-refusal: a probed-blocked external URL renders the refusal state with the escape hatch", async () => {
      vi.mocked(checkFrame).mockResolvedValue({
        reachable: true,
        embeddable: false,
        status: 200,
        reason: "X-Frame-Options: DENY",
      });
      renderIframe({ windowId: "@2", rkUrl: "https://github.com/sahil87/run-kit" });
      const box = await screen.findByTestId("web-tile-error");
      expect(box.textContent).toContain("github.com refuses embedding");
      expect(box.textContent).toContain("X-Frame-Options: DENY");
      // The iframe is hidden while the error renders.
      expect((screen.getByTitle("Proxied content") as HTMLIFrameElement).className).toContain("hidden");
    });

    it("unreachable external: reachable:false renders the connection-error state", async () => {
      vi.mocked(checkFrame).mockResolvedValue({
        reachable: false,
        embeddable: false,
        status: 0,
        reason: "connect failed: connection refused",
      });
      renderIframe({ windowId: "@2", rkUrl: "https://dead.example/" });
      const box = await screen.findByTestId("web-tile-error");
      expect(box.textContent).toContain("dead.example can't be reached");
      expect(box.textContent).toContain("connect failed");
    });

    it("dead proxied port: a 502 from the same-origin probe renders the Retry state", async () => {
      const fetchStub = vi.fn().mockResolvedValue({ status: 502 });
      vi.stubGlobal("fetch", fetchStub);
      try {
        renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/" });
        const box = await screen.findByTestId("web-tile-error");
        expect(box.textContent).toContain("nothing listening on :8080");
        expect(box.textContent).toContain("connection refused — the dev server may have stopped");
        // Retry re-runs detection (and re-shows the error while 502 persists).
        fetchStub.mockClear();
        fireEvent.click(screen.getByLabelText("Retry"));
        await screen.findByTestId("web-tile-error");
        expect(fetchStub).toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("page meta + address focus seams (R10/R12)", () => {
    it("reports the same-origin document title on load; null cross-origin", () => {
      const onPageMeta = vi.fn();
      renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/docs", onPageMeta });
      const iframe = screen.getByTitle("Proxied content") as HTMLIFrameElement;
      const doc = document.implementation.createHTMLDocument("tmux Version Floor");
      Object.defineProperty(iframe, "contentDocument", { value: doc, configurable: true });
      fireEvent.load(iframe);
      expect(onPageMeta).toHaveBeenLastCalledWith({ title: "tmux Version Floor" });

      Object.defineProperty(iframe, "contentDocument", {
        get() {
          throw new Error("cross-origin");
        },
        configurable: true,
      });
      Object.defineProperty(iframe, "contentWindow", {
        get() {
          throw new Error("cross-origin");
        },
        configurable: true,
      });
      fireEvent.load(iframe);
      expect(onPageMeta).toHaveBeenLastCalledWith({ title: null });
    });

    it("the web-address:focus CustomEvent focuses the input in edit mode, selected (⌘L)", () => {
      renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/docs" });
      const input = screen.getByLabelText("URL") as HTMLInputElement;
      fireEvent(document, new CustomEvent("web-address:focus"));
      expect(input).toHaveFocus();
      expect(input.value).toBe("/proxy/8080/docs");
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    });
  });

  describe("load progress line (R11)", () => {
    it("renders from mount/src-change until the frame's load event clears it", () => {
      renderIframe({ windowId: "@2", rkUrl: "/proxy/8080/docs" });
      // src is set at mount → loading until the first load event.
      expect(screen.getByTestId("web-load-progress")).toBeTruthy();
      fireEvent.load(screen.getByTitle("Proxied content"));
      expect(screen.queryByTestId("web-load-progress")).toBeNull();

      // An external src change re-arms it until the next load.
      const { rerender } = renderIframe({ windowId: "@3", rkUrl: "/proxy/8080/docs" });
      const second = screen.getAllByTitle("Proxied content")[1];
      fireEvent.load(second);
      expect(screen.queryAllByTestId("web-load-progress")).toHaveLength(0);
      rerender(iframeElement({ windowId: "@3", rkUrl: "/proxy/9000/other" }));
      expect(screen.getByTestId("web-load-progress")).toBeTruthy();
      fireEvent.load(second);
      expect(screen.queryByTestId("web-load-progress")).toBeNull();
    });
  });
});
