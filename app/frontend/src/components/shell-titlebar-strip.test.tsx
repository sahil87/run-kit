import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { ShellTitlebarStrip } from "./shell-titlebar-strip";
import {
  InstanceAccentValueProvider,
  type InstanceAccent,
} from "@/contexts/instance-accent-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { SHELL_STRIP_MARKER_CLASS } from "@/lib/shell-strip";

// ThemeProvider makes no real HTTP calls in tests.
vi.mock("@/api/client", () => ({
  getThemePreference: vi.fn().mockRejectedValue(new Error("no API in test")),
  setThemePreference: vi.fn().mockResolvedValue(undefined),
}));

function mockMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }),
  );
}

function accentValue(overrides: Partial<InstanceAccent> = {}): InstanceAccent {
  return {
    color: null,
    isExplicit: false,
    stripeHex: null,
    washHex: null,
    titlebarHex: null,
    setColor: vi.fn(),
    ...overrides,
  };
}

function shellBridge(servers: unknown[] | null): void {
  window.runkitShell = {
    version: "1.2.3",
    platform: "darwin",
    servers: {
      list: () =>
        servers === null
          ? Promise.reject(new Error("ipc gone"))
          : Promise.resolve({ ok: true, servers }),
      switch: () => Promise.resolve({ ok: true }),
    },
  };
}

function renderStrip(accent: InstanceAccent = accentValue()) {
  return render(
    <ThemeProvider>
      <InstanceAccentValueProvider value={accent}>
        <ShellTitlebarStrip />
      </InstanceAccentValueProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockMatchMedia();
});

afterEach(() => {
  cleanup();
  delete window.runkitShell;
  vi.unstubAllGlobals();
  document.documentElement.classList.remove(SHELL_STRIP_MARKER_CLASS);
});

describe("ShellTitlebarStrip", () => {
  it("marks <html> with the rk-shell-strip class while mounted (version-skew fallback key)", () => {
    shellBridge([]);
    const { unmount } = renderStrip();
    expect(document.documentElement.classList.contains(SHELL_STRIP_MARKER_CLASS)).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains(SHELL_STRIP_MARKER_CLASS)).toBe(false);
  });

  it("shows the active shell host's name from servers.list", async () => {
    shellBridge([
      { id: "a", name: "studio-mac", url: "http://a:3000", active: true },
      { id: "b", name: "lab", url: "http://b:3000", active: false },
    ]);
    renderStrip();
    await waitFor(() => {
      expect(screen.getByText("studio-mac")).toBeInTheDocument();
    });
  });

  it("falls back to location.hostname when the list call fails (older shell / denial)", async () => {
    shellBridge(null);
    renderStrip();
    await waitFor(() => {
      expect(screen.getByText(window.location.hostname)).toBeInTheDocument();
    });
  });

  it("uses the accent titlebar blend as the background when an accent is set", () => {
    shellBridge([]);
    renderStrip(accentValue({ color: "4", titlebarHex: "#3a2b4c" }));
    const strip = screen.getByTestId("shell-titlebar-strip");
    expect(strip.style.backgroundColor).toBe("rgb(58, 43, 76)");
  });

  it("falls back to the theme background (still draggable) when no accent is set", () => {
    shellBridge([]);
    renderStrip();
    const strip = screen.getByTestId("shell-titlebar-strip");
    // No accent → non-empty theme background, and the band stays a drag region.
    expect(strip.style.backgroundColor).not.toBe("");
    expect(strip.className).toContain("rk-shell-drag");
  });
});
