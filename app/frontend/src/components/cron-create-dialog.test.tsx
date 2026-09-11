import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CronCreateDialog } from "./cron-create-dialog";
import type { CronEntry } from "@/api/client";

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

describe("CronCreateDialog (edit mode)", () => {
  const ENTRY: CronEntry = {
    id: "a3f9",
    name: "operator tick",
    schedule: { kind: "every", interval: "30m" },
    target: { kind: "role", role: "operator" },
    payload: "check the queue",
    deliver: "when-idle",
    lastFired: 0,
  };

  function renderEdit(entry: CronEntry = ENTRY, onClose = vi.fn()) {
    render(<CronCreateDialog server="srv" entry={entry} onClose={onClose} />);
    return onClose;
  }

  function installEditFetch(status = 200, body: unknown = { id: "a3f9" }) {
    const calls: RecordedCall[] = [];
    const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", stub);
    return { stub, calls };
  }

  it("shows Edit entry / Save with the entry's fields prefilled", () => {
    installEditFetch();
    renderEdit();
    expect(screen.getByRole("dialog", { name: "Edit entry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("operator tick");
    expect(screen.getByLabelText("Interval")).toHaveValue("30m");
    expect(screen.getByRole("button", { name: "When idle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders target and payload read-only (no editable controls for them)", () => {
    installEditFetch();
    renderEdit();
    expect(screen.getByTestId("cron-edit-target")).toHaveTextContent("role: operator");
    expect(screen.getByTestId("cron-edit-payload")).toHaveTextContent("check the queue");
    expect(screen.queryByLabelText("Payload")).toBeNull();
  });

  it("submits only the changed fields (name only → {id, name})", async () => {
    const { calls } = installEditFetch();
    const onClose = renderEdit();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls).toEqual([
        { url: "/api/cron/edit?server=srv", body: { id: "a3f9", name: "renamed" } },
      ]),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("a kind change replaces the whole schedule", async () => {
    const { calls } = installEditFetch();
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Cron" }));
    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "0 9 * * *" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({
      id: "a3f9",
      schedule: { kind: "cron", expr: "0 9 * * *" },
    });
  });

  it("switching a respawn entry's if-absent to Skip sends ifAbsent + respawn: [] (clear)", async () => {
    const { calls } = installEditFetch();
    renderEdit({ ...ENTRY, ifAbsent: "respawn", respawn: ["rk", "operator"] });
    expect(screen.getByLabelText("Respawn argv")).toHaveValue("rk operator");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ id: "a3f9", ifAbsent: "skip", respawn: [] });
  });

  it("a 400 renders the server's error text inline and the dialog stays open", async () => {
    const { calls } = installEditFetch(400, { error: "unknown deliver value" });
    const onClose = renderEdit();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("unknown deliver value");
    expect(screen.getByRole("dialog", { name: "Edit entry" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a 409 renders a retryable inline error and the dialog stays open", async () => {
    const { calls } = installEditFetch(409, { error: "cron tick in progress" });
    const onClose = renderEdit();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("cron tick in progress");
    expect(screen.getByRole("dialog", { name: "Edit entry" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Retryable: Save is armed again once the rejection settles.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });
});
