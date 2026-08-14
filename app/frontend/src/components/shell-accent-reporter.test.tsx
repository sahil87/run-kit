import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { ShellAccentReporter } from "./shell-accent-reporter";
import { InstanceAccentValueProvider } from "@/contexts/instance-accent-context";
import type { InstanceAccent } from "@/contexts/instance-accent-context";

function accent(stripeHex: string | null): InstanceAccent {
  return {
    color: stripeHex === null ? null : "4",
    isExplicit: stripeHex !== null,
    stripeHex,
    washHex: null,
    titlebarHex: null,
    setColor: () => {},
  };
}

function bridgeWithAccent(): ReturnType<typeof vi.fn> {
  const set = vi.fn().mockResolvedValue({ ok: true });
  window.runkitShell = { version: "1.2.3", platform: "darwin", accent: { set } };
  return set;
}

function renderReporter(value: InstanceAccent) {
  return render(
    <InstanceAccentValueProvider value={value}>
      <ShellAccentReporter />
    </InstanceAccentValueProvider>,
  );
}

afterEach(() => {
  cleanup();
  delete window.runkitShell;
});

describe("ShellAccentReporter", () => {
  it("reports the resolved stripeHex on mount", async () => {
    const set = bridgeWithAccent();
    renderReporter(accent("#8b7ff0"));
    await waitFor(() => expect(set).toHaveBeenCalledWith("#8b7ff0"));
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("reports nothing while the accent is unresolved, then reports on resolve", async () => {
    const set = bridgeWithAccent();
    const { rerender } = renderReporter(accent(null));
    expect(set).not.toHaveBeenCalled();
    rerender(
      <InstanceAccentValueProvider value={accent("#34d399")}>
        <ShellAccentReporter />
      </InstanceAccentValueProvider>,
    );
    await waitFor(() => expect(set).toHaveBeenCalledWith("#34d399"));
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("does not re-report an unchanged hex, and a null never clears (change-only)", async () => {
    const set = bridgeWithAccent();
    const { rerender } = renderReporter(accent("#8b7ff0"));
    await waitFor(() => expect(set).toHaveBeenCalledWith("#8b7ff0"));
    // Same hex from a fresh value object → no second call.
    rerender(
      <InstanceAccentValueProvider value={accent("#8b7ff0")}>
        <ShellAccentReporter />
      </InstanceAccentValueProvider>,
    );
    expect(set).toHaveBeenCalledTimes(1);
    // Accent cleared → nothing reported (the shell has no unset path).
    rerender(
      <InstanceAccentValueProvider value={accent(null)}>
        <ShellAccentReporter />
      </InstanceAccentValueProvider>,
    );
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("reports a changed hex once per change", async () => {
    const set = bridgeWithAccent();
    const { rerender } = renderReporter(accent("#8b7ff0"));
    await waitFor(() => expect(set).toHaveBeenCalledWith("#8b7ff0"));
    rerender(
      <InstanceAccentValueProvider value={accent("#fb923c")}>
        <ShellAccentReporter />
      </InstanceAccentValueProvider>,
    );
    await waitFor(() => expect(set).toHaveBeenCalledWith("#fb923c"));
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("renders nothing and never throws in a plain browser (no bridge)", () => {
    const { container } = renderReporter(accent("#8b7ff0"));
    expect(container.innerHTML).toBe("");
  });
});
