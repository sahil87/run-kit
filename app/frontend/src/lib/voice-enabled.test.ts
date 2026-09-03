import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SettingsEntry } from "@/api/client";

const getSettingsEntriesMock = vi.fn<() => Promise<SettingsEntry[]>>();
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return {
    ...actual,
    getSettingsEntries: () => getSettingsEntriesMock(),
  };
});

function registryEntry(key: string, value: unknown): SettingsEntry {
  return {
    key,
    kind: "bool",
    default: "false",
    description: "",
    category: "general",
    ui: true,
    live: false,
    value,
  };
}

// Flush the full promise chain (fetch → cache → listener notify).
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// The gate caches module-level, so each test re-imports a fresh module.
async function freshGate() {
  vi.resetModules();
  return await import("./voice-enabled");
}

beforeEach(() => {
  getSettingsEntriesMock.mockReset();
});

describe("voice-enabled gate", () => {
  it("is false before the registry read is triggered", async () => {
    const gate = await freshGate();
    expect(gate.isVoiceEnabled()).toBe(false);
    expect(getSettingsEntriesMock).not.toHaveBeenCalled();
  });

  it("reads false until the fetch settles, then true when the registry carries voice_enabled: true", async () => {
    getSettingsEntriesMock.mockResolvedValue([registryEntry("voice_enabled", true)]);
    const gate = await freshGate();
    const listener = vi.fn();
    gate.subscribeVoiceEnabled(listener);
    expect(gate.isVoiceEnabled()).toBe(false);
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(gate.isVoiceEnabled()).toBe(true);
  });

  it("stays false when the registry lacks the key or carries a non-true value", async () => {
    getSettingsEntriesMock.mockResolvedValue([
      registryEntry("auto_name", true),
      registryEntry("voice_enabled", "yes"),
    ]);
    const gate = await freshGate();
    gate.subscribeVoiceEnabled(() => {});
    await flush();
    expect(gate.isVoiceEnabled()).toBe(false);
  });

  it("fails closed when the registry fetch fails", async () => {
    getSettingsEntriesMock.mockRejectedValue(new Error("offline"));
    const gate = await freshGate();
    const listener = vi.fn();
    gate.subscribeVoiceEnabled(listener);
    await flush();
    expect(gate.isVoiceEnabled()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fetches once no matter how many subscribers", async () => {
    getSettingsEntriesMock.mockResolvedValue([registryEntry("voice_enabled", true)]);
    const gate = await freshGate();
    const first = vi.fn();
    const second = vi.fn();
    gate.subscribeVoiceEnabled(first);
    gate.subscribeVoiceEnabled(second);
    await flush();
    expect(getSettingsEntriesMock).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not notify after unsubscribe", async () => {
    getSettingsEntriesMock.mockResolvedValue([registryEntry("voice_enabled", true)]);
    const gate = await freshGate();
    const listener = vi.fn();
    const unsubscribe = gate.subscribeVoiceEnabled(listener);
    unsubscribe();
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
