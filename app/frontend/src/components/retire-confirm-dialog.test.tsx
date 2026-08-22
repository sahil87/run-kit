import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { RetireConfirmDialog } from "./retire-confirm-dialog";
import { ToastProvider } from "@/components/toast";
import { sendOperatorRequest } from "@/api/client";

// The retire confirm dialog (260822-rfz2 R8) — the per-action confirmation for
// the operator seam's first destructive template, shared by the palette entry
// and the flyout row. Asserted here: cancel/Escape fire no request; confirm
// fires exactly ONE retire-tab POST behind an in-flight guard (re-clicks are
// no-ops) and toasts the hand-off; failure toasts the server's message.

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, sendOperatorRequest: vi.fn() };
});

const sendOperatorRequestMock = vi.mocked(sendOperatorRequest);

function renderDialog(onClose = vi.fn()) {
  return render(
    <ToastProvider>
      <RetireConfirmDialog server="default" windowId="@5" onClose={onClose} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  sendOperatorRequestMock.mockReset();
});

afterEach(cleanup);

describe("RetireConfirmDialog (260822-rfz2)", () => {
  it("asks the confirmation question and Cancel closes with no request", () => {
    const onClose = vi.fn();
    renderDialog(onClose);

    expect(
      screen.getByText("Ask the operator to summarize and close this tab? The window will be killed."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sendOperatorRequestMock).not.toHaveBeenCalled();
  });

  it("Escape closes with no request", () => {
    const onClose = vi.fn();
    renderDialog(onClose);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sendOperatorRequestMock).not.toHaveBeenCalled();
  });

  it("confirm fires exactly one retire-tab request, closes, and toasts the hand-off", async () => {
    sendOperatorRequestMock.mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderDialog(onClose);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    });

    expect(sendOperatorRequestMock).toHaveBeenCalledTimes(1);
    expect(sendOperatorRequestMock).toHaveBeenCalledWith("default", "@5", "retire-tab");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sent to operator — tab will be summarized and closed")).toBeInTheDocument();
  });

  it("re-clicks during flight are no-ops — one POST total", async () => {
    let settle: () => void = () => {};
    sendOperatorRequestMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    renderDialog();

    const confirm = screen.getByRole("button", { name: "Retire" });
    fireEvent.click(confirm);
    expect(sendOperatorRequestMock).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);
    expect(sendOperatorRequestMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle();
    });
  });

  it("a failed request toasts the server's message and still closes", async () => {
    sendOperatorRequestMock.mockRejectedValue(new Error("operator is busy (active) — request not delivered"));
    const onClose = vi.fn();
    renderDialog(onClose);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    });

    expect(sendOperatorRequestMock).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/operator is busy \(active\)/)).toBeInTheDocument();
  });
});
