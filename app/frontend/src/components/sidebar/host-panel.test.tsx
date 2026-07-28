import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { HostPanel } from "./host-panel";
import { HostMetricsProvider, MetricsProvider } from "@/contexts/session-context";
import {
  InstanceAccentValueProvider,
  type InstanceAccent,
} from "@/contexts/instance-accent-context";
import {
  InstanceNameValueProvider,
  type InstanceName,
} from "@/contexts/instance-name-context";
import { ThemeProvider } from "@/contexts/theme-context";
import type { MetricsSnapshot } from "@/types";

// SwatchPopover (opened by the accent picker) reads useTheme; mock the API
// client so ThemeProvider makes no real HTTP calls.
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

function snapshot(hostname: string): MetricsSnapshot {
  return {
    hostname,
    cpu: { samples: [10, 20], current: 20, cores: 4 },
    memory: { used: 4 * 1024 ** 3, total: 16 * 1024 ** 3 },
    load: { avg1: 0.5, avg5: 0.4, avg15: 0.3, cpus: 4 },
    disk: { used: 100 * 1024 ** 3, total: 500 * 1024 ** 3 },
    uptime: 3600,
  };
}

function accentValue(overrides: Partial<InstanceAccent> = {}): InstanceAccent {
  return {
    color: null,
    isExplicit: false,
    stripeHex: null,
    washHex: null,
    setColor: vi.fn(),
    ...overrides,
  };
}

function nameValue(overrides: Partial<InstanceName> = {}): InstanceName {
  return {
    hostname: "",
    instanceName: null,
    displayName: "",
    setInstanceName: vi.fn(),
    ...overrides,
  };
}

function renderPanel({
  server,
  host,
  accent = accentValue(),
  name = nameValue(),
}: {
  server: MetricsSnapshot | null;
  host: MetricsSnapshot | null;
  accent?: InstanceAccent;
  name?: InstanceName;
}) {
  return render(
    <ThemeProvider>
      <InstanceAccentValueProvider value={accent}>
        <InstanceNameValueProvider value={name}>
          <MetricsProvider value={server}>
            <HostMetricsProvider value={host}>
              <HostPanel />
            </HostMetricsProvider>
          </MetricsProvider>
        </InstanceNameValueProvider>
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
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("HostPanel metrics fallback (260720-zx4i)", () => {
  it("renders server-scoped metrics when present (they win over the host broadcast)", () => {
    renderPanel({ server: snapshot("server-scoped"), host: snapshot("host-global") });
    expect(screen.getByText("server-scoped")).toBeInTheDocument();
    expect(screen.queryByText("host-global")).not.toBeInTheDocument();
    // Metric rows delegated to HostMetrics render.
    expect(screen.getByText(/cpu/)).toBeInTheDocument();
  });

  it("falls back to the host-global broadcast when server-scoped metrics are null (board route)", () => {
    renderPanel({ server: null, host: snapshot("host-global") });
    expect(screen.getByText("host-global")).toBeInTheDocument();
    expect(screen.queryByText("No metrics")).not.toBeInTheDocument();
    expect(screen.getByText(/cpu/)).toBeInTheDocument();
  });

  it("shows 'No metrics' when both sources are null", () => {
    renderPanel({ server: null, host: null });
    expect(screen.getByText("No metrics")).toBeInTheDocument();
  });

  it("renders no connection dot — the top-bar dot owns that signal", () => {
    renderPanel({ server: null, host: snapshot("h") });
    expect(screen.queryByTitle(/connected/i)).not.toBeInTheDocument();
  });
});

describe("HostPanel instance accent (1etw)", () => {
  it("tints the hostname with the accent stripe hex", () => {
    renderPanel({
      server: snapshot("tinted-host"),
      host: null,
      accent: accentValue({ color: "4", stripeHex: "#3355aa", washHex: "#111318" }),
    });
    const name = screen.getByText("tinted-host");
    expect(name).toHaveStyle({ color: "#3355aa" });
  });

  it("renders the hostname untinted when no accent is resolved", () => {
    renderPanel({ server: snapshot("plain-host"), host: null, accent: accentValue() });
    const name = screen.getByText("plain-host");
    expect(name.className).toContain("text-text-primary");
    expect(name.style.color).toBe("");
  });

  it("opens the color-only SwatchPopover from the header palette button", async () => {
    renderPanel({
      server: snapshot("h"),
      host: null,
      accent: accentValue({ color: "4", stripeHex: "#3355aa", washHex: "#111318" }),
    });
    fireEvent.click(screen.getByLabelText("Set instance color"));
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("a swatch pick writes through setColor and keeps the popover open (live toggling)", async () => {
    const setColor = vi.fn();
    renderPanel({
      server: snapshot("h"),
      host: null,
      accent: accentValue({ color: "4", isExplicit: true, stripeHex: "#3355aa", setColor }),
    });
    fireEvent.click(screen.getByLabelText("Set instance color"));
    // Pick the first color swatch (family/shade names are the option labels —
    // exact match, since "Color red-dark" also exists in the 20-value grid).
    fireEvent.click(screen.getByRole("option", { name: "Color red" }));
    expect(setColor).toHaveBeenCalledTimes(1);
    // The popover maps family → legacy descriptor at its write seam ("red" → "1").
    expect(setColor).toHaveBeenCalledWith("1");
    // Selection does NOT dismiss (the picker's dismissal contract) — the ✕
    // cell is the explicit close.
    expect(screen.getByText("Clear")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close picker"));
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("Clear sends null (restores the hash default)", async () => {
    const setColor = vi.fn();
    renderPanel({
      server: snapshot("h"),
      host: null,
      accent: accentValue({ color: "4", isExplicit: true, stripeHex: "#3355aa", setColor }),
    });
    fireEvent.click(screen.getByLabelText("Set instance color"));
    fireEvent.click(screen.getByText("Clear"));
    expect(setColor).toHaveBeenCalledWith(null);
  });

  it("the picker is available even when no metrics have arrived", async () => {
    renderPanel({ server: null, host: null, accent: accentValue() });
    expect(screen.getByLabelText("Set instance color")).toBeInTheDocument();
  });
});

describe("HostPanel instance display name (260723-o7q8)", () => {
  it("prefers the instance-name override over the metrics hostname", () => {
    renderPanel({
      server: snapshot("mac-mini"),
      host: null,
      name: nameValue({ hostname: "mac-mini", instanceName: "my-box", displayName: "my-box" }),
    });
    expect(screen.getByText("my-box")).toBeInTheDocument();
    expect(screen.queryByText("mac-mini")).not.toBeInTheDocument();
  });

  it("falls back to the metrics hostname when no override is set", () => {
    renderPanel({ server: snapshot("mac-mini"), host: null });
    expect(screen.getByText("mac-mini")).toBeInTheDocument();
  });
});
