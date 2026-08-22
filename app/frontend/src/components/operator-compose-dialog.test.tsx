import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { OperatorComposeDialog } from "./operator-compose-dialog";
import { ToastProvider } from "./toast";

vi.mock("@/api/client", () => ({
  sendServerOperatorRequest: vi.fn(() => Promise.resolve()),
}));

import { sendServerOperatorRequest } from "@/api/client";

const mockSend = vi.mocked(sendServerOperatorRequest);

function renderDialog(opts: { initialMode?: "spawn" | "find"; onClose?: () => void } = {}) {
  return render(
    <ToastProvider>
      <OperatorComposeDialog
        server="srv"
        initialMode={opts.initialMode ?? "spawn"}
        onClose={opts.onClose ?? (() => {})}
      />
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  mockSend.mockReset();
  mockSend.mockResolvedValue(undefined);
});

describe("OperatorComposeDialog", () => {
  it("pre-selects the entry point's mode and focuses the input", () => {
    renderDialog({ initialMode: "find" });
    expect(screen.getByRole("button", { name: "Find discussion" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Spawn task" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("textbox", { name: "Find discussion" })).toHaveFocus();
  });

  it("Enter submits spawn-task with the typed text and toasts the spawn wording", async () => {
    renderDialog();
    const input = screen.getByRole("textbox", { name: "Spawn task" });
    fireEvent.change(input, { target: { value: "fix the flaky test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith("srv", "spawn-task", "fix the flaky test"),
    );
    expect(await screen.findByText("Sent to operator — it will spawn the agent")).toBeInTheDocument();
  });

  it("switching the segmented control submits the find verb with its wording", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Find discussion" }));
    const input = screen.getByRole("textbox", { name: "Find discussion" });
    fireEvent.change(input, { target: { value: "the fence length" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith("srv", "find-discussion", "the fence length"),
    );
    expect(
      await screen.findByText("Sent to operator — the answer appears in the operator tab"),
    ).toBeInTheDocument();
  });

  it("whitespace-only input is a guarded no-op — no POST, dialog stays open", () => {
    renderDialog();
    const input = screen.getByRole("textbox", { name: "Spawn task" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to operator" })).toBeDisabled();
  });

  it("re-submits during flight fire exactly one POST", async () => {
    let release!: () => void;
    mockSend.mockReturnValue(new Promise((res) => { release = () => res(undefined); }));
    renderDialog();
    const input = screen.getByRole("textbox", { name: "Spawn task" });
    fireEvent.change(input, { target: { value: "do the thing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Send to operator" }));
    expect(mockSend).toHaveBeenCalledTimes(1);
    release();
    // Await the settle path (then → finally) via its observable outcome — an
    // immediately-true assertion would let the settle state updates land after
    // the test finishes (act warnings).
    expect(await screen.findByText("Sent to operator — it will spawn the agent")).toBeInTheDocument();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("closes on settle after a successful submit", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    const input = screen.getByRole("textbox", { name: "Spawn task" });
    fireEvent.change(input, { target: { value: "do the thing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("failure toasts the server's structured message", async () => {
    mockSend.mockRejectedValue(new Error("operator is busy (active) — request not delivered; try again when it is idle"));
    renderDialog();
    const input = screen.getByRole("textbox", { name: "Spawn task" });
    fireEvent.change(input, { target: { value: "do the thing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(/operator is busy \(active\)/)).toBeInTheDocument();
  });

  it("Escape cancels without submitting", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
