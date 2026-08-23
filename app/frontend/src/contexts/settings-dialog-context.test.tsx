import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SettingsDialogProvider, useSettingsDialog } from "./settings-dialog-context";

afterEach(cleanup);

function Probe() {
  const { isOpen, activeTab, openSettings, closeSettings, setActiveTab } = useSettingsDialog();
  return (
    <div>
      <span data-testid="state">{isOpen ? "open" : "closed"}</span>
      <span data-testid="tab">{activeTab}</span>
      <button onClick={() => openSettings()}>open</button>
      <button onClick={() => openSettings("shortcuts")}>open-shortcuts</button>
      <button onClick={() => openSettings("appearance")}>open-appearance</button>
      <button onClick={() => openSettings("all")}>open-all</button>
      <button onClick={() => setActiveTab("shortcuts")}>tab-shortcuts</button>
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
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("state").textContent).toBe("open");
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.getByTestId("state").textContent).toBe("closed");
  });

  it("a tab-less open lands on General; a tabbed open activates that tab", () => {
    render(
      <SettingsDialogProvider>
        <Probe />
      </SettingsDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("tab").textContent).toBe("general");
    fireEvent.click(screen.getByRole("button", { name: "open-shortcuts" }));
    expect(screen.getByTestId("state").textContent).toBe("open");
    expect(screen.getByTestId("tab").textContent).toBe("shortcuts");
  });

  it("a tab-less open while already open is a tab-preserving no-op", () => {
    render(
      <SettingsDialogProvider>
        <Probe />
      </SettingsDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open-appearance" }));
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("tab").textContent).toBe("appearance");
  });

  it("openSettings('all') opens on the All settings tab", () => {
    render(
      <SettingsDialogProvider>
        <Probe />
      </SettingsDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open-all" }));
    expect(screen.getByTestId("state").textContent).toBe("open");
    expect(screen.getByTestId("tab").textContent).toBe("all");
  });

  it("a tabbed open while open on another tab switches without closing", () => {
    render(
      <SettingsDialogProvider>
        <Probe />
      </SettingsDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open-appearance" }));
    fireEvent.click(screen.getByRole("button", { name: "open-shortcuts" }));
    expect(screen.getByTestId("state").textContent).toBe("open");
    expect(screen.getByTestId("tab").textContent).toBe("shortcuts");
  });

  it("no last-tab persistence: a tab-less reopen after close lands General", () => {
    render(
      <SettingsDialogProvider>
        <Probe />
      </SettingsDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open-shortcuts" }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByTestId("tab").textContent).toBe("general");
  });

  it("setActiveTab switches the active tab", () => {
    render(
      <SettingsDialogProvider>
        <Probe />
      </SettingsDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "tab-shortcuts" }));
    expect(screen.getByTestId("tab").textContent).toBe("shortcuts");
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
