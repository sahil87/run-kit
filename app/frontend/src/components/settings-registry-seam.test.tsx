import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsRegistry } from "./settings-registry-seam";
import type { SettingsEntry } from "@/api/client";

const getSettingsEntries = vi.fn();
const postSettings = vi.fn();
vi.mock("@/api/client", () => ({
  getSettingsEntries: (...a: unknown[]) => getSettingsEntries(...a),
  postSettings: (...a: unknown[]) => postSettings(...a),
}));

const setColor = vi.fn();
const accentMock = { color: null as string | null, isExplicit: false, setColor };
vi.mock("@/contexts/instance-accent-context", () => ({
  useInstanceAccent: () => accentMock,
}));

vi.mock("@/contexts/instance-name-context", () => ({
  useInstanceName: () => ({ instanceName: null, setInstanceName: vi.fn() }),
}));

vi.mock("@/contexts/theme-context", () => ({
  useTheme: () => ({ preference: "system", themeDark: "default-dark", themeLight: "default-light" }),
  useThemeActions: () => ({ setTheme: vi.fn() }),
}));

const addToast = vi.fn();
vi.mock("@/components/toast", () => ({
  useToast: () => ({ addToast }),
}));

vi.mock("@/hooks/use-open-targets", () => ({
  invalidateOpenContext: vi.fn(),
}));

function entry(key: string, value: unknown, extra?: Partial<SettingsEntry>): SettingsEntry {
  return {
    key,
    kind: "string",
    default: "",
    description: "",
    category: "appearance",
    ui: true,
    live: true,
    value,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  accentMock.color = null;
  accentMock.isExplicit = false;
});

describe("useSettingsRegistry write-through", () => {
  it("keeps a cleared instance_color in the effective read path when the accent overlay drops", async () => {
    // Post-clear worst case: isExplicit is false (the overlay is absent), so
    // without the write-through the read path falls back to the stale fetch.
    getSettingsEntries.mockResolvedValue([entry("instance_color", "4", { kind: "color" })]);
    const { result } = renderHook(() => useSettingsRegistry());
    await waitFor(() => expect(result.current.settingValue("instance_color")).toBe("4"));

    await act(async () => {
      await result.current.commitSetting("instance_color", null);
    });

    expect(setColor).toHaveBeenCalledWith(null);
    expect(result.current.settingValue("instance_color")).toBeNull();
  });

  it("applies a generic write optimistically and rolls back on rejection", async () => {
    getSettingsEntries.mockResolvedValue([entry("auto_name", false, { kind: "bool", category: "behavior" })]);
    let reject: (e: Error) => void = () => {};
    postSettings.mockReturnValue(
      new Promise<void>((_res, rej) => {
        reject = rej;
      }),
    );
    const { result } = renderHook(() => useSettingsRegistry());
    await waitFor(() => expect(result.current.settingValue("auto_name")).toBe(false));

    let commit!: Promise<void>;
    act(() => {
      commit = result.current.commitSetting("auto_name", true);
      commit.catch(() => {});
    });
    // Optimistic: the toggle's value flips before the POST resolves.
    expect(result.current.settingValue("auto_name")).toBe(true);

    await act(async () => {
      reject(new Error("nope"));
      await commit.catch(() => {});
    });
    // Rolled back, surfaced via toast, and the rejection propagated.
    expect(result.current.settingValue("auto_name")).toBe(false);
    expect(addToast).toHaveBeenCalledWith("nope", "error");
  });
});
