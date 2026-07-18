import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

// Router seam: capture navigate so we can assert the "View board" action target.
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

// API seam: control pin/unpin resolution/rejection.
const pinWindow = vi.fn();
const unpinWindow = vi.fn();
const reorderPin = vi.fn();
vi.mock("@/api/boards", () => ({
  pinWindow: (...args: unknown[]) => pinWindow(...args),
  unpinWindow: (...args: unknown[]) => unpinWindow(...args),
  reorderPin: (...args: unknown[]) => reorderPin(...args),
}));

// last-used seam: assert the single write site fires only on success.
const writeLastPinnedBoard = vi.fn();
vi.mock("@/lib/last-pinned-board", () => ({
  writeLastPinnedBoard: (name: string) => writeLastPinnedBoard(name),
}));

import { ToastProvider } from "@/components/toast";
import { usePinActions } from "./use-pin-actions";

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

beforeEach(() => {
  pinWindow.mockReset().mockResolvedValue({ ok: true });
  unpinWindow.mockReset().mockResolvedValue({ ok: true });
  writeLastPinnedBoard.mockReset();
  mockNavigate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePinActions.pin", () => {
  it("writes the last-used board and shows the info toast with a working View board action", async () => {
    const { result } = renderHook(() => usePinActions(), { wrapper });
    await act(async () => {
      await result.current.pin("srvA", "@3", "deploys");
    });
    expect(pinWindow).toHaveBeenCalledWith("srvA", "@3", "deploys");
    expect(writeLastPinnedBoard).toHaveBeenCalledWith("deploys");

    // The success toast + action navigate to the board.
    const { screen, fireEvent } = await import("@testing-library/react");
    expect(screen.getByRole("alert")).toHaveTextContent("Pinned to deploys");
    fireEvent.click(screen.getByRole("button", { name: "View board" }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/board/$name", params: { name: "deploys" } });
  });

  it("shows an error toast and writes nothing when the pin fails", async () => {
    pinWindow.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => usePinActions(), { wrapper });
    await act(async () => {
      await result.current.pin("srvA", "@3", "deploys");
    });
    expect(writeLastPinnedBoard).not.toHaveBeenCalled();
    const { screen } = await import("@testing-library/react");
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    expect(screen.queryByRole("button", { name: "View board" })).toBeNull();
  });
});

describe("usePinActions.unpin", () => {
  it("stays error-only (no success toast, no last-used write) on success", async () => {
    const { result } = renderHook(() => usePinActions(), { wrapper });
    await act(async () => {
      await result.current.unpin("srvA", "@3", "deploys");
    });
    expect(unpinWindow).toHaveBeenCalledWith("srvA", "@3", "deploys");
    expect(writeLastPinnedBoard).not.toHaveBeenCalled();
    const { screen } = await import("@testing-library/react");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
