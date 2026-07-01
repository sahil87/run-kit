import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HostMetrics, formatUptime, formatDisk } from "./host-metrics";
import type { MetricsSnapshot } from "@/types";

afterEach(cleanup);

const METRICS: MetricsSnapshot = {
  hostname: "test-box",
  cpu: { samples: [10, 20, 30, 40], current: 42, cores: 8 },
  memory: { used: 4 * 1024 ** 3, total: 16 * 1024 ** 3 }, // 4G / 16G
  load: { avg1: 4.0, avg5: 2.0, avg15: 0.8, cpus: 8 }, // 50% / 25% / 10%
  disk: { used: 100 * 1024 ** 3, total: 500 * 1024 ** 3 }, // 100/500G
  uptime: 90000, // 1d 1h
};

describe("HostMetrics", () => {
  it("renders CPU current, memory, disk, uptime, and normalized load", () => {
    render(<HostMetrics metrics={METRICS} />);

    // CPU current percentage
    expect(screen.getByText("42%")).toBeInTheDocument();
    // Memory used/total (formatMemory → "4G/16G")
    expect(screen.getByText("4G/16G")).toBeInTheDocument();
    // Disk used/total
    expect(screen.getByText("100/500G")).toBeInTheDocument();
    // Uptime — 90000s = 1d 1h
    expect(screen.getByText("1d 1h")).toBeInTheDocument();
    // Normalized load averages (avg / cpus * 100, rounded)
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });
});

describe("formatUptime", () => {
  it("formats days+hours, hours+minutes, minutes, and the zero floor", () => {
    expect(formatUptime(90000)).toBe("1d 1h"); // 25h
    expect(formatUptime(3660)).toBe("1h 1m");
    expect(formatUptime(120)).toBe("2m");
    expect(formatUptime(0)).toBe("0m");
    expect(formatUptime(-5)).toBe("0m");
  });
});

describe("formatDisk", () => {
  it("rounds bytes to whole GB used/total", () => {
    expect(formatDisk(100 * 1024 ** 3, 500 * 1024 ** 3)).toBe("100/500G");
  });
});
