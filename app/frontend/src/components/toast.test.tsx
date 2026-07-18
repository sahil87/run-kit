import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { ToastProvider, useToast } from "./toast";

function TestConsumer({ onViewBoard }: { onViewBoard?: () => void } = {}) {
  const { addToast } = useToast();
  return (
    <div>
      <button onClick={() => addToast("Something failed", "error")}>Error Toast</button>
      <button onClick={() => addToast("Action completed", "info")}>Info Toast</button>
      <button onClick={() => addToast("Default variant")}>Default Toast</button>
      <button
        onClick={() =>
          addToast("Pinned to deploys", "info", {
            label: "View board",
            onSelect: () => onViewBoard?.(),
          })
        }
      >
        Action Toast
      </button>
    </div>
  );
}

describe("Toast system", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders no toasts initially", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a toast when addToast is called", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText("Error Toast").click();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Something failed");
  });

  it("auto-dismisses after 4 seconds", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText("Error Toast").click();
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows multiple toasts stacked vertically", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText("Error Toast").click();
      screen.getByText("Info Toast").click();
    });

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent("Something failed");
    expect(alerts[1]).toHaveTextContent("Action completed");
  });

  it("dismisses toasts independently", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText("Error Toast").click();
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    act(() => {
      screen.getByText("Info Toast").click();
    });

    expect(screen.getAllByRole("alert")).toHaveLength(2);

    // First toast auto-dismisses at t=4000
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const remaining = screen.getAllByRole("alert");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toHaveTextContent("Action completed");

    // Second toast auto-dismisses at t=6000
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("defaults to error variant when no variant is specified", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText("Default Toast").click();
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Default variant");
    // Error variant uses ansi-1 (red) accent
    expect(alert).toHaveStyle({ borderLeftColor: "var(--color-ansi-1)" });
  });

  it("error variant uses red accent", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText("Error Toast").click();
    });

    expect(screen.getByRole("alert")).toHaveStyle({ borderLeftColor: "var(--color-ansi-1)" });
  });

  it("info variant uses blue accent", () => {
    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>,
    );

    act(() => {
      screen.getByText("Info Toast").click();
    });

    expect(screen.getByRole("alert")).toHaveStyle({ borderLeftColor: "var(--color-ansi-4)" });
  });

  it("throws when useToast is used outside provider", () => {
    function Orphan() {
      useToast();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow("useToast must be used within ToastProvider");
  });

  describe("optional action button", () => {
    it("renders no action button for a message-only toast", () => {
      render(
        <ToastProvider>
          <TestConsumer />
        </ToastProvider>,
      );
      act(() => {
        screen.getByText("Info Toast").click();
      });
      expect(screen.queryByRole("button", { name: "View board" })).not.toBeInTheDocument();
    });

    it("renders the action as a button and runs onSelect + dismisses on activation", () => {
      const onViewBoard = vi.fn();
      render(
        <ToastProvider>
          <TestConsumer onViewBoard={onViewBoard} />
        </ToastProvider>,
      );
      act(() => {
        screen.getByText("Action Toast").click();
      });
      const actionBtn = screen.getByRole("button", { name: "View board" });
      expect(actionBtn).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Pinned to deploys");

      act(() => {
        actionBtn.click();
      });
      expect(onViewBoard).toHaveBeenCalledOnce();
      // Selecting the action dismisses the toast.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
