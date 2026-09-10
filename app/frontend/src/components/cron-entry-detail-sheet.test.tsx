import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CronEntryDetailSheet } from "./cron-entry-detail-sheet";
import type { CronEntry } from "@/api/client";

const ENTRY: CronEntry = {
  id: "a3f9",
  name: "operator tick",
  schedule: { kind: "backoff", min: "60s", max: "30m" },
  target: { kind: "role", role: "operator" },
  payload: "tick",
  lastFired: 0,
  muted: false,
  pinned: false,
};

type RecordedCall = { url: string; body: Record<string, unknown> };

function installFetch() {
  const calls: RecordedCall[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", stub);
  return { stub, calls };
}

function renderSheet(entry: CronEntry = ENTRY, onClose = vi.fn()) {
  render(<CronEntryDetailSheet server="srv" entry={entry} onClose={onClose} />);
  return onClose;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CronEntryDetailSheet", () => {
  it("renders the alarm-app anatomy: name, plain-words schedule, never/unknown last/next", () => {
    installFetch();
    renderSheet();
    expect(screen.getByRole("dialog", { name: "Cron entry operator tick" })).toBeInTheDocument();
    expect(screen.getByText("backs off from 1 minute up to 30 minutes since last activity")).toBeInTheDocument();
    expect(screen.getByTestId("cron-entry-last-fired")).toHaveTextContent("never");
    expect(screen.getByTestId("cron-entry-next-fire")).toHaveTextContent("unknown");
  });

  it("mute toggle POSTs the flipped value and reflects it optimistically", async () => {
    const { calls } = installFetch();
    renderSheet();
    const toggle = screen.getByRole("switch", { name: "Mute entry" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    // Optimistic: the switch reflects the new state before the POST resolves.
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(calls).toEqual([
        { url: "/api/cron/mute?server=srv", body: { id: "a3f9", muted: true } },
      ]),
    );
  });

  it("pin row POSTs {id, pinned: true} and reflects it optimistically", async () => {
    const { calls } = installFetch();
    renderSheet();
    const toggle = screen.getByRole("switch", { name: "Pin entry" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(calls).toEqual([
        { url: "/api/cron/pin?server=srv", body: { id: "a3f9", pinned: true } },
      ]),
    );
  });

  it("delete requires the confirm step, POSTs {id}, then closes", async () => {
    const { calls } = installFetch();
    const onClose = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));
    // The confirm step replaces the plain row; nothing has fired yet.
    expect(screen.getByText("Delete this entry?")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(calls).toEqual([{ url: "/api/cron/delete?server=srv", body: { id: "a3f9" } }]),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("delete Cancel backs out without firing", () => {
    const { calls } = installFetch();
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete entry" })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("a failed mute reverts the optimistic toggle and shows the error inline", async () => {
    const stub = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "unknown entry" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", stub);
    renderSheet();
    const toggle = screen.getByRole("switch", { name: "Mute entry" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByRole("alert")).toHaveTextContent("unknown entry");
  });

  it("the default variant is modal: fixed backdrop, aria-modal, and the ✕ close control", () => {
    installFetch();
    const { container } = render(
      <CronEntryDetailSheet server="srv" entry={ENTRY} onClose={vi.fn()} />,
    );

    const sheet = screen.getByTestId("cron-entry-sheet");
    expect(sheet.className).toContain("fixed inset-0");
    // The full-viewport backdrop sibling.
    expect(container.querySelector(".bg-black\\/50")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Cron entry operator tick" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByRole("button", { name: "Close entry details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to activity" })).toBeNull();
  });

  it("the inline variant drops the modal shell: no backdrop, no aria-modal, absolute inset-0 panel", () => {
    installFetch();
    const { container } = render(
      <CronEntryDetailSheet server="srv" entry={ENTRY} onClose={vi.fn()} inline />,
    );

    const sheet = screen.getByTestId("cron-entry-sheet");
    expect(sheet.className).toContain("absolute inset-0");
    expect(container.querySelector(".fixed")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Cron entry operator tick" });
    expect(dialog).not.toHaveAttribute("aria-modal");
    // The ✕ close control is replaced by the back control.
    expect(screen.queryByRole("button", { name: "Close entry details" })).toBeNull();
  });

  it("the inline ‹ Activity back control calls onClose", () => {
    installFetch();
    const onClose = vi.fn();
    render(<CronEntryDetailSheet server="srv" entry={ENTRY} onClose={onClose} inline />);

    const back = screen.getByRole("button", { name: "Back to activity" });
    expect(back).toHaveTextContent("‹ Activity");
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape inside the inline panel closes the sheet and claims the key (defaultPrevented)", () => {
    installFetch();
    const onClose = vi.fn();
    render(<CronEntryDetailSheet server="srv" entry={ENTRY} onClose={onClose} inline />);

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
