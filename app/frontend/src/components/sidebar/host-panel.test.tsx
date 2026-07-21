import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HostPanel } from "./host-panel";
import { HostMetricsProvider, MetricsProvider } from "@/contexts/session-context";
import type { MetricsSnapshot } from "@/types";

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

function renderPanel({
  server,
  host,
  isConnected = true,
}: {
  server: MetricsSnapshot | null;
  host: MetricsSnapshot | null;
  isConnected?: boolean;
}) {
  return render(
    <MetricsProvider value={server}>
      <HostMetricsProvider value={host}>
        <HostPanel isConnected={isConnected} />
      </HostMetricsProvider>
    </MetricsProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
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

  it("dot reflects the isConnected prop in the fallback state too", () => {
    renderPanel({ server: null, host: snapshot("h"), isConnected: true });
    expect(screen.getByTitle("SSE connected")).toBeInTheDocument();
    cleanup();
    renderPanel({ server: null, host: snapshot("h"), isConnected: false });
    expect(screen.getByTitle("SSE disconnected")).toBeInTheDocument();
  });
});
