import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { ToastProvider } from "@/components/toast";
import { InstanceNameProvider, useInstanceName } from "./instance-name-context";

// Mock the API client module so no real HTTP calls happen in tests.
vi.mock("@/api/client", () => ({
  getHealth: vi.fn(),
  setInstanceName: vi.fn().mockResolvedValue(undefined),
}));
import { getHealth, setInstanceName } from "@/api/client";

function Probe() {
  const n = useInstanceName();
  return (
    <div>
      <span data-testid="hostname">{n.hostname}</span>
      <span data-testid="instance">{String(n.instanceName)}</span>
      <span data-testid="display">{n.displayName}</span>
      <button onClick={() => n.setInstanceName("my-box")}>rename</button>
      <button onClick={() => n.setInstanceName(null)}>clear</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ToastProvider>
      <InstanceNameProvider>
        <Probe />
      </InstanceNameProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getHealth).mockReset();
  vi.mocked(setInstanceName).mockClear();
  vi.mocked(setInstanceName).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("InstanceNameProvider", () => {
  it("displayName falls back to the health hostname when no override is set", async () => {
    vi.mocked(getHealth).mockResolvedValue({ status: "ok", hostname: "mac-mini" });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hostname").textContent).toBe("mac-mini"));
    expect(screen.getByTestId("instance").textContent).toBe("null");
    expect(screen.getByTestId("display").textContent).toBe("mac-mini");
  });

  it("displayName prefers the instanceName override from health", async () => {
    vi.mocked(getHealth).mockResolvedValue({
      status: "ok",
      hostname: "mac-mini",
      instanceName: "my-box",
    });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("display").textContent).toBe("my-box"));
    // The real hostname stays available for hostname-keyed consumers.
    expect(screen.getByTestId("hostname").textContent).toBe("mac-mini");
  });

  it("setInstanceName updates optimistically and POSTs; clearing reverts to hostname", async () => {
    vi.mocked(getHealth).mockResolvedValue({ status: "ok", hostname: "mac-mini" });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hostname").textContent).toBe("mac-mini"));

    fireEvent.click(screen.getByText("rename"));
    expect(screen.getByTestId("display").textContent).toBe("my-box");
    expect(setInstanceName).toHaveBeenCalledWith("my-box");

    fireEvent.click(screen.getByText("clear"));
    expect(screen.getByTestId("display").textContent).toBe("mac-mini");
    expect(setInstanceName).toHaveBeenCalledWith(null);
  });

  it("a failed POST surfaces a toast but keeps the optimistic value", async () => {
    vi.mocked(getHealth).mockResolvedValue({ status: "ok", hostname: "mac-mini" });
    vi.mocked(setInstanceName).mockRejectedValue(new Error("Instance name cannot contain control characters"));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hostname").textContent).toBe("mac-mini"));

    fireEvent.click(screen.getByText("rename"));
    await waitFor(() =>
      expect(screen.getByText("Instance name cannot contain control characters")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("display").textContent).toBe("my-box");
  });

  it("a failed health fetch leaves the tolerant-empty shape (no crash)", async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error("offline"));
    renderProvider();
    // Nothing to wait for — assert the stable empty state.
    expect(screen.getByTestId("hostname").textContent).toBe("");
    expect(screen.getByTestId("display").textContent).toBe("");
  });

  it("useInstanceName throws outside the provider", () => {
    const spy = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Probe />)).toThrow(
        "useInstanceName must be used within InstanceNameProvider",
      );
    } finally {
      console.error = spy;
    }
  });
});
