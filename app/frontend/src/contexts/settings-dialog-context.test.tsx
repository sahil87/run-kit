import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsDialogProvider, useSettingsDialog } from "./settings-dialog-context";

function Probe() {
  const { isOpen, openSettings, closeSettings } = useSettingsDialog();
  return (
    <div>
      <span data-testid="state">{isOpen ? "open" : "closed"}</span>
      <button onClick={openSettings}>open</button>
      <button onClick={closeSettings}>close</button>
    </div>
  );
}

describe("SettingsDialogContext", () => {
  it("starts closed; openSettings/closeSettings toggle the state", () => {
    render(
      <SettingsDialogProvider>
        <Probe />
      </SettingsDialogProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("closed");
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("state").textContent).toBe("open");
    fireEvent.click(screen.getByText("close"));
    expect(screen.getByTestId("state").textContent).toBe("closed");
  });

  it("useSettingsDialog throws outside the provider", () => {
    // Silence React's error boundary noise for the expected throw.
    const spy = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Probe />)).toThrow(
        "useSettingsDialog must be used within SettingsDialogProvider",
      );
    } finally {
      console.error = spy;
    }
  });
});
