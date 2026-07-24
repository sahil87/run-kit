import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { useEffect } from "react";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/components/toast";
import { ChromeProvider } from "@/contexts/chrome-context";
import { InstanceAccentValueProvider, type InstanceAccent } from "@/contexts/instance-accent-context";
import { InstanceNameValueProvider, type InstanceName } from "@/contexts/instance-name-context";
import { SettingsDialogProvider, useSettingsDialog } from "@/contexts/settings-dialog-context";
import { SettingsDialog } from "./settings-dialog";

// Mock the API client module so no real HTTP calls happen in tests. Includes
// the theme-context imports since the whole module is replaced.
vi.mock("@/api/client", () => ({
  getThemePreference: vi.fn().mockRejectedValue(new Error("no API in test")),
  setThemePreference: vi.fn().mockResolvedValue(undefined),
  getSSHHost: vi.fn(),
  setSSHHost: vi.fn().mockResolvedValue(undefined),
}));
import { getSSHHost, setSSHHost } from "@/api/client";

// Mock the open-context store so the commit→invalidate seam is observable
// without dragging the real store (and its fetches) into dialog tests.
vi.mock("@/hooks/use-open-targets", () => ({
  invalidateOpenContext: vi.fn(),
}));
import { invalidateOpenContext } from "@/hooks/use-open-targets";

// Drive the Notifications row deterministically (260724-6j1v): mock the push
// lib so each test picks the reported state without touching real
// serviceWorker / Notification (the retired top-bar bell test pattern).
const getPushState = vi.fn();
const enablePushSubscription = vi.fn();
const sendTestNotification = vi.fn();
vi.mock("@/lib/push", () => ({
  getPushState: (...a: unknown[]) => getPushState(...a),
  enablePushSubscription: (...a: unknown[]) => enablePushSubscription(...a),
  sendTestNotification: (...a: unknown[]) => sendTestNotification(...a),
}));

function mockMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }),
  );
}

const NULL_ACCENT: InstanceAccent = {
  color: null,
  isExplicit: false,
  stripeHex: null,
  washHex: null,
  setColor: vi.fn(),
};

function makeInstanceName(overrides: Partial<InstanceName> = {}): InstanceName {
  return {
    hostname: "mac-mini",
    instanceName: null,
    displayName: "mac-mini",
    setInstanceName: vi.fn(),
    ...overrides,
  };
}

/** Opens the dialog on mount (the palette/gear stand-in). */
function OpenOnMount() {
  const { openSettings } = useSettingsDialog();
  useEffect(() => {
    openSettings();
  }, [openSettings]);
  return null;
}

function renderDialog(instanceNameValue: InstanceName = makeInstanceName()) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <ChromeProvider>
          <InstanceAccentValueProvider value={NULL_ACCENT}>
            <InstanceNameValueProvider value={instanceNameValue}>
              <SettingsDialogProvider>
                <OpenOnMount />
                <SettingsDialog />
              </SettingsDialogProvider>
            </InstanceNameValueProvider>
          </InstanceAccentValueProvider>
        </ChromeProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockMatchMedia();
  vi.mocked(getSSHHost).mockReset();
  vi.mocked(getSSHHost).mockResolvedValue(null);
  vi.mocked(setSSHHost).mockClear();
  vi.mocked(setSSHHost).mockResolvedValue(undefined);
  vi.mocked(invalidateOpenContext).mockClear();
  getPushState.mockReset().mockResolvedValue("default");
  enablePushSubscription.mockReset().mockResolvedValue("subscribed");
  sendTestNotification.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("SettingsDialog", () => {
  it("renders the This-host / This-device scope split with the expected controls", async () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("This host")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByLabelText("Instance name")).toBeInTheDocument();
    expect(screen.getByLabelText("SSH host")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set instance color" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Theme mode" })).toBeInTheDocument();
    expect(screen.getByLabelText("Dark theme")).toBeInTheDocument();
    expect(screen.getByLabelText("Light theme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Increase terminal font" })).toBeInTheDocument();
  });

  it("shows the stored SSH host SETTING (empty when unset) and commits on blur", async () => {
    vi.mocked(getSSHHost).mockResolvedValue("devbox");
    renderDialog();
    const input = screen.getByLabelText("SSH host") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("devbox"));

    fireEvent.change(input, { target: { value: "user@host" } });
    fireEvent.blur(input);
    await waitFor(() => expect(setSSHHost).toHaveBeenCalledWith("user@host"));
  });

  it("clearing the SSH host commits null", async () => {
    vi.mocked(getSSHHost).mockResolvedValue("devbox");
    renderDialog();
    const input = screen.getByLabelText("SSH host") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("devbox"));

    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    await waitFor(() => expect(setSSHHost).toHaveBeenCalledWith(null));
  });

  it("a successful SSH host commit invalidates the open context (260723-l317)", async () => {
    vi.mocked(getSSHHost).mockResolvedValue("devbox");
    renderDialog();
    const input = screen.getByLabelText("SSH host") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("devbox"));

    fireEvent.change(input, { target: { value: "sahil@mini" } });
    fireEvent.blur(input);
    await waitFor(() => expect(setSSHHost).toHaveBeenCalledWith("sahil@mini"));
    await waitFor(() => expect(invalidateOpenContext).toHaveBeenCalledTimes(1));
  });

  it("a rejected SSH host commit does NOT invalidate the open context", async () => {
    vi.mocked(setSSHHost).mockRejectedValue(new Error("bad host"));
    renderDialog();
    const input = screen.getByLabelText("SSH host") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "dev box" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("bad host")).toBeInTheDocument());
    expect(invalidateOpenContext).not.toHaveBeenCalled();
  });

  it("a rejected SSH host commit surfaces an inline error and keeps the typed value", async () => {
    vi.mocked(setSSHHost).mockRejectedValue(
      new Error("SSH host cannot contain whitespace or control characters"),
    );
    renderDialog();
    const input = screen.getByLabelText("SSH host") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "dev box" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(
        screen.getByText("SSH host cannot contain whitespace or control characters"),
      ).toBeInTheDocument(),
    );
    expect(input.value).toBe("dev box");
  });

  it("commits the instance name through the context (empty clears)", async () => {
    const value = makeInstanceName({ instanceName: "old-name", displayName: "old-name" });
    renderDialog(value);
    const input = screen.getByLabelText("Instance name") as HTMLInputElement;
    expect(input.value).toBe("old-name");

    fireEvent.change(input, { target: { value: "my-box" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(value.setInstanceName).toHaveBeenCalledWith("my-box");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(value.setInstanceName).toHaveBeenCalledWith(null);
  });

  it("the instance-name placeholder is the real hostname (the unset fallback)", () => {
    renderDialog();
    const input = screen.getByLabelText("Instance name") as HTMLInputElement;
    expect(input.placeholder).toBe("mac-mini");
  });

  it("font stepper steps the shared ChromeContext preference", async () => {
    renderDialog();
    // Desktop default (matchMedia mocked to false) is 13px.
    expect(screen.getByText("13px")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Increase terminal font" }));
    expect(screen.getByText("14px")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("13px")).toBeInTheDocument();
  });

  it("opens the color-only SwatchPopover from the accent control", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Set instance color" }));
    // The popover's removal row is the color-only marker ("Clear" + ✕).
    expect(await screen.findByText("Clear")).toBeInTheDocument();
  });

  it("uses the wide lg dialog variant with the 190px/1fr preference-row grid (260724-6j1v)", () => {
    renderDialog();
    // Desktop preference pane: the shared Dialog's lg width variant.
    const panel = screen.getByRole("dialog", { name: "Settings" });
    expect(panel.className).toContain("max-w-2xl");
    // Each setting is a preference row — a two-column grid at ≥480px that
    // collapses to one column below (single markup path).
    const input = screen.getByLabelText("Instance name");
    const row = input.closest(".grid")!;
    expect(row.className).toContain("min-[480px]:grid-cols-[190px_1fr]");
    expect(row.className).toContain("grid-cols-1");
  });

  describe("Notifications row (260724-6j1v — moved from the top-bar bell)", () => {
    /** Render and flush the mount-time getPushState() promise. */
    async function renderWithPushState(state: string) {
      getPushState.mockResolvedValue(state);
      renderDialog();
      // The row label renders regardless of state; flush the async state fetch.
      await waitFor(() => expect(getPushState).toHaveBeenCalled());
    }

    it("shows the not-subscribed status with Enable and a disabled test button", async () => {
      await renderWithPushState("default");
      expect(screen.getByText("Notifications")).toBeInTheDocument();
      expect(await screen.findByText("Not subscribed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enable notifications" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send test notification" })).toBeDisabled();
    });

    it("shows the subscribed status and enables the test send", async () => {
      await renderWithPushState("subscribed");
      expect(await screen.findByText("Subscribed on this device")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Enable notifications" })).not.toBeInTheDocument();
      const testBtn = screen.getByRole("button", { name: "Send test notification" });
      expect(testBtn).not.toBeDisabled();
      fireEvent.click(testBtn);
      await waitFor(() => expect(sendTestNotification).toHaveBeenCalledTimes(1));
    });

    it("calls enablePushSubscription when Enable is clicked", async () => {
      await renderWithPushState("default");
      await screen.findByText("Not subscribed");
      fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));
      await waitFor(() => expect(enablePushSubscription).toHaveBeenCalledTimes(1));
    });

    it("shows the blocked status plus the re-allow note when denied", async () => {
      await renderWithPushState("denied");
      expect(await screen.findByText("Blocked in browser settings")).toBeInTheDocument();
      expect(
        screen.getByText(/Re-allow notifications for this site/),
      ).toBeInTheDocument();
    });

    it("explains absence with a note (no buttons) when push is unsupported", async () => {
      await renderWithPushState("unsupported");
      expect(await screen.findByText("Not supported in this browser")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Enable notifications" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Send test notification" })).not.toBeInTheDocument();
    });

    it("links the setup & troubleshooting guide in a safe new tab", async () => {
      await renderWithPushState("default");
      await screen.findByText("Not subscribed");
      const guide = screen.getByRole("link", { name: /Setup & troubleshooting guide/ });
      expect(guide).toHaveAttribute("href", expect.stringContaining("docs/site/notifications.md"));
      expect(guide).toHaveAttribute("target", "_blank");
      expect(guide).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  it("Escape closes the dialog (focus-trap contract)", async () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument(),
    );
  });
});
