import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { TerminalClient } from "./terminal-client";

// Mock all xterm-related modules to avoid actual terminal initialization
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
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
    hasSelection: vi.fn().mockReturnValue(false),
  })),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
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

  it("blocks focusin on .xterm elements when scrollLocked is true", async () => {
    const { container } = renderTerminalClient(true);

    // Wait for the terminal init effect to run
    await act(async () => {});

    const terminalDiv = container.querySelector("[role='application']");
    expect(terminalDiv).toBeTruthy();

    // Create a mock .xterm element inside the terminal container
    const xtermEl = document.createElement("textarea");
    xtermEl.className = "xterm-helper-textarea";
    const xtermWrapper = document.createElement("div");
    xtermWrapper.className = "xterm";
    xtermWrapper.appendChild(xtermEl);
    terminalDiv!.appendChild(xtermWrapper);

    // Spy on blur
    const blurSpy = vi.spyOn(xtermEl, "blur");

    // Dispatch focusin event
    act(() => {
      xtermEl.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(blurSpy).toHaveBeenCalled();
  });

  it("allows focusin on .xterm elements when scrollLocked is false", async () => {
    const { container } = renderTerminalClient(false);

    await act(async () => {});

    const terminalDiv = container.querySelector("[role='application']");
    expect(terminalDiv).toBeTruthy();

    const xtermEl = document.createElement("textarea");
    xtermEl.className = "xterm-helper-textarea";
    const xtermWrapper = document.createElement("div");
    xtermWrapper.className = "xterm";
    xtermWrapper.appendChild(xtermEl);
    terminalDiv!.appendChild(xtermWrapper);

    const blurSpy = vi.spyOn(xtermEl, "blur");

    act(() => {
      xtermEl.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(blurSpy).not.toHaveBeenCalled();
  });
});
