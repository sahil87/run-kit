import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CronCreateDialog } from "./cron-create-dialog";

type RecordedCall = { url: string; body: Record<string, unknown> };

function installFetch() {
  const calls: RecordedCall[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    return new Response(JSON.stringify({ id: "a1b2" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", stub);
  return { stub, calls };
}

function renderDialog(onClose = vi.fn()) {
  render(<CronCreateDialog server="srv" onClose={onClose} />);
  return onClose;
}

/** The minimal valid form: a payload and the default `every` interval. */
function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Payload"), { target: { value: "wake up" } });
  fireEvent.change(screen.getByLabelText("Interval"), { target: { value: "5m" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CronCreateDialog", () => {
  it("default submit posts deliver:immediate with the fixed operator target", async () => {
    const { calls } = installFetch();
    const onClose = renderDialog();
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create entry" }));
    await waitFor(() =>
      expect(calls).toEqual([
        {
          url: "/api/cron/create?server=srv",
          body: {
            schedule: { kind: "every", interval: "5m" },
            target: { kind: "role", role: "operator" },
            payload: "wake up",
            deliver: "immediate",
          },
        },
      ]),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("selecting Skip if busy posts deliver:skip-if-busy", async () => {
    const { calls } = installFetch();
    renderDialog();
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Skip if busy" }));
    fireEvent.click(screen.getByRole("button", { name: "Create entry" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.deliver).toBe("skip-if-busy");
  });

  it("the Delivery group is keyboard-reachable and aria-pressed reflects the choice", () => {
    installFetch();
    renderDialog();
    const group = screen.getByRole("group", { name: "Delivery" });
    const immediate = screen.getByRole("button", { name: "Immediate" });
    const whenIdle = screen.getByRole("button", { name: "When idle" });
    const skipIfBusy = screen.getByRole("button", { name: "Skip if busy" });
    expect(group).toContainElement(immediate);
    expect(group).toContainElement(whenIdle);
    expect(group).toContainElement(skipIfBusy);
    expect(immediate).toHaveAttribute("aria-pressed", "true");
    expect(whenIdle).toHaveAttribute("aria-pressed", "false");
    expect(skipIfBusy).toHaveAttribute("aria-pressed", "false");
    skipIfBusy.focus();
    expect(skipIfBusy).toHaveFocus();
    fireEvent.click(skipIfBusy);
    expect(skipIfBusy).toHaveAttribute("aria-pressed", "true");
    expect(immediate).toHaveAttribute("aria-pressed", "false");
  });
});
