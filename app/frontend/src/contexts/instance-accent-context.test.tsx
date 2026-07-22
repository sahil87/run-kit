import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/components/toast";
import { InstanceAccentProvider, useInstanceAccent } from "./instance-accent-context";
import { readInstanceColorEcho, writeInstanceColorEcho, deriveAccentHexes } from "@/instance-accent";
import { DEFAULT_DARK_THEME } from "@/themes";

// Mock the API client module so no real HTTP calls happen in tests.
vi.mock("@/api/client", () => ({
  getThemePreference: vi.fn().mockRejectedValue(new Error("no API in test")),
  setThemePreference: vi.fn().mockResolvedValue(undefined),
  getInstanceColor: vi.fn(),
  setInstanceColor: vi.fn().mockResolvedValue(undefined),
}));
import { getInstanceColor, setInstanceColor } from "@/api/client";

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

function Probe() {
  const a = useInstanceAccent();
  return (
    <div>
      <span data-testid="color">{String(a.color)}</span>
      <span data-testid="explicit">{String(a.isExplicit)}</span>
      <span data-testid="stripe">{String(a.stripeHex)}</span>
      <span data-testid="wash">{String(a.washHex)}</span>
      <button onClick={() => a.setColor("5")}>pick5</button>
      <button onClick={() => a.setColor(null)}>clear</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <InstanceAccentProvider>
          <Probe />
        </InstanceAccentProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockMatchMedia();
  document.head.innerHTML = '<meta name="theme-color" content="#0f1117" />';
  vi.mocked(getInstanceColor).mockReset();
  vi.mocked(setInstanceColor).mockClear();
  vi.mocked(setInstanceColor).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.head.innerHTML = "";
});

describe("InstanceAccentProvider resolution chain", () => {
  it("explicit setting wins over the localStorage echo", async () => {
    writeInstanceColorEcho({ value: "2", hex: "#00ff00" });
    vi.mocked(getInstanceColor).mockResolvedValue("5");

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("color").textContent).toBe("5"));
    expect(screen.getByTestId("explicit").textContent).toBe("true");
    expect(screen.getByTestId("stripe").textContent).toMatch(/^#[0-9a-f]{6}$/i);
    // Echo rewritten with the authoritative value.
    await waitFor(() => expect(readInstanceColorEcho()?.value).toBe("5"));
    // Meta carries the subtle titlebar blend (mock parity) — NOT the full-hue
    // stripe hex — and the echo's hex matches it for the pre-paint script.
    const meta = document.querySelector('meta[name="theme-color"]');
    const titlebarHex = deriveAccentHexes("5", DEFAULT_DARK_THEME)?.titlebarHex;
    expect(meta?.getAttribute("content")).toBe(titlebarHex);
    expect(meta?.getAttribute("content")).not.toBe(screen.getByTestId("stripe").textContent);
    expect(readInstanceColorEcho()?.hex).toBe(meta?.getAttribute("content"));
  });

  it("defaults to no accent when no explicit color is set (no derived default)", async () => {
    vi.mocked(getInstanceColor).mockResolvedValue(null);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("color").textContent).toBe("null"));
    expect(screen.getByTestId("explicit").textContent).toBe("false");
    expect(screen.getByTestId("stripe").textContent).toBe("null");
    expect(screen.getByTestId("wash").textContent).toBe("null");
  });

  it("seeds the first paint from the echo while the fetch is pending", async () => {
    writeInstanceColorEcho({ value: "3", hex: "#aabb00" });
    vi.mocked(getInstanceColor).mockReturnValue(new Promise(() => {}));

    renderProvider();
    expect(screen.getByTestId("color").textContent).toBe("3");
    expect(screen.getByTestId("explicit").textContent).toBe("false");
  });

  it("clears a stale echo once the fetch resolves to no explicit color", async () => {
    writeInstanceColorEcho({ value: "3", hex: "#aabb00" });
    vi.mocked(getInstanceColor).mockResolvedValue(null);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("color").textContent).toBe("null"));
    expect(screen.getByTestId("stripe").textContent).toBe("null");
    await waitFor(() => expect(readInstanceColorEcho()).toBeNull());
  });
});

describe("InstanceAccentProvider setColor", () => {
  it("persists a pick through the API and flips to explicit", async () => {
    vi.mocked(getInstanceColor).mockResolvedValue(null);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("explicit").textContent).toBe("false"));

    fireEvent.click(screen.getByText("pick5"));
    expect(screen.getByTestId("color").textContent).toBe("5");
    expect(screen.getByTestId("explicit").textContent).toBe("true");
    expect(setInstanceColor).toHaveBeenCalledWith("5");
  });

  it("clearing removes the accent entirely without reload", async () => {
    vi.mocked(getInstanceColor).mockResolvedValue("5");

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("color").textContent).toBe("5"));

    fireEvent.click(screen.getByText("clear"));
    await waitFor(() => expect(screen.getByTestId("color").textContent).toBe("null"));
    expect(screen.getByTestId("explicit").textContent).toBe("false");
    expect(screen.getByTestId("stripe").textContent).toBe("null");
    expect(setInstanceColor).toHaveBeenCalledWith(null);
    await waitFor(() => expect(readInstanceColorEcho()).toBeNull());
  });
});
