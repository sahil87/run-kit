import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { Terminal } from "@xterm/xterm";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebglAddon } from "@xterm/addon-webgl";
import { TerminalClient } from "./terminal-client";

// Mock all xterm-related modules to avoid actual terminal initialization
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function () {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      onData: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      reset: vi.fn(),
      write: vi.fn(),
      scrollToBottom: vi.fn(),
      cols: 80,
      rows: 24,
      options: { fontSize: 13 },
      unicode: { activeVersion: "6" },
      hasSelection: vi.fn().mockReturnValue(false),
    };
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return { fit: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-unicode-graphemes", () => ({
  UnicodeGraphemesAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ uploadFiles: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("@/contexts/theme-context", () => ({
  useTheme: () => ({
    theme: { palette: {} },
    preference: "dark",
    resolved: "dark",
  }),
  useThemeActions: () => ({ setTheme: vi.fn() }),
}));

vi.mock("@/themes", () => ({
  deriveXtermTheme: () => ({}),
}));

vi.mock("@/components/compose-buffer", () => ({
  ComposeBuffer: () => null,
}));

function createWsRef(): React.MutableRefObject<WebSocket | null> {
  return { current: null };
}

function renderTerminalClient(scrollLocked = false) {
  return render(
    <TerminalClient
      sessionName="test-session"
      windowIndex="0"
      server="default"
      wsRef={createWsRef()}
      composeOpen={false}
      setComposeOpen={vi.fn()}
      scrollLocked={scrollLocked}
    />,
  );
}

describe("TerminalClient scroll-lock focus prevention", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prevents focus via touchend preventDefault when scrollLocked is true", async () => {
    const { container } = renderTerminalClient(true);

    await act(async () => {});

    const terminalDiv = container.querySelector("[role='application']");
    expect(terminalDiv).toBeTruthy();

    // Dispatch a touchend event — it should be preventDefault'd
    const touchEnd = new TouchEvent("touchend", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(touchEnd, "preventDefault");

    act(() => {
      terminalDiv!.dispatchEvent(touchEnd);
    });

    expect(preventSpy).toHaveBeenCalled();
  });

  it("does not prevent touchend when scrollLocked is false", async () => {
    const { container } = renderTerminalClient(false);

    await act(async () => {});

    const terminalDiv = container.querySelector("[role='application']");
    expect(terminalDiv).toBeTruthy();

    const touchEnd = new TouchEvent("touchend", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(touchEnd, "preventDefault");

    act(() => {
      terminalDiv!.dispatchEvent(touchEnd);
    });

    expect(preventSpy).not.toHaveBeenCalled();
  });
});

describe("TerminalClient Unicode width init", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    // The component opens a real WebSocket in a separate effect; stub it so
    // the test environment doesn't try to connect to a relay endpoint.
    vi.stubGlobal("WebSocket", vi.fn().mockImplementation(function () {
      return {
        readyState: 0,
        binaryType: "",
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
    }));
    vi.mocked(Terminal).mockClear();
    vi.mocked(UnicodeGraphemesAddon).mockClear();
    vi.mocked(WebglAddon).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads UnicodeGraphemesAddon and activates 15-graphemes before WebGL", async () => {
    renderTerminalClient(false);

    // Init is async (font loads + dynamic addon imports). Wait for the
    // addon constructors to fire — guards against regressions in load order
    // or accidental removal of the Unicode width setup.
    await waitFor(() => {
      expect(vi.mocked(UnicodeGraphemesAddon)).toHaveBeenCalled();
      expect(vi.mocked(WebglAddon)).toHaveBeenCalled();
    });

    // Terminal must be constructed with allowProposedApi so the proposed
    // unicode-graphemes API is available to the addon.
    const ctorArgs = vi.mocked(Terminal).mock.calls[0]?.[0];
    expect(ctorArgs?.allowProposedApi).toBe(true);

    // Unicode addon must be instantiated before the WebGL addon so the
    // renderer measures cells against the Unicode 15 width table on first
    // paint (see terminal-client.tsx comment above the addon load).
    const unicodeOrder = vi.mocked(UnicodeGraphemesAddon).mock.invocationCallOrder[0];
    const webglOrder = vi.mocked(WebglAddon).mock.invocationCallOrder[0];
    expect(unicodeOrder).toBeLessThan(webglOrder);

    // The terminal instance's activeVersion must be flipped to the
    // grapheme-aware Unicode 15 table after the addon registers it.
    const terminalInstance = vi.mocked(Terminal).mock.results[0]?.value as
      | { unicode: { activeVersion: string } }
      | undefined;
    expect(terminalInstance?.unicode.activeVersion).toBe("15-graphemes");
  });
});
