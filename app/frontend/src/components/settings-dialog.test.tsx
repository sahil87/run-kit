import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
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
  getRiffPresets: vi.fn().mockRejectedValue(new Error("no API in test")),
  getKeybindings: vi.fn().mockResolvedValue([]),
}));
import { getSSHHost, setSSHHost } from "@/api/client";

// The Shortcuts tab's plumbing reads the session context, the route params,
// and the merged palette list — mock all three seams light (no current
// server/route → no add flow, the tmux section's empty state).
vi.mock("@/contexts/session-context", () => ({
  useSessionContext: () => ({ currentServer: null, sessionsByServer: new Map() }),
}));
vi.mock("@tanstack/react-router", () => ({
  useMatches: () => [],
}));
vi.mock("@/contexts/palette-actions-context", () => ({
  usePaletteActions: () => [],
}));

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
  titlebarHex: null,
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

/** Opens the dialog on mount (the palette/gear stand-in). `tab` deep-links. */
function OpenOnMount({ tab }: { tab?: "general" | "appearance" | "shortcuts" }) {
  const { openSettings } = useSettingsDialog();
  useEffect(() => {
    openSettings(tab);
  }, [openSettings, tab]);
  return null;
}

function renderDialog(
  instanceNameValue: InstanceName = makeInstanceName(),
  tab?: "general" | "appearance" | "shortcuts",
) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <ChromeProvider>
          <InstanceAccentValueProvider value={NULL_ACCENT}>
            <InstanceNameValueProvider value={instanceNameValue}>
              <SettingsDialogProvider>
                <OpenOnMount tab={tab} />
                <SettingsDialog />
              </SettingsDialogProvider>
            </InstanceNameValueProvider>
          </InstanceAccentValueProvider>
        </ChromeProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

/** Switch to a tab by its rail/strip button. */
function selectTab(label: "General" | "Appearance" | "Shortcuts") {
  fireEvent.click(screen.getByRole("tab", { name: label }));
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
  it("renders the three tabs and opens on General by default", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    const tablist = screen.getByRole("tablist", { name: "Settings sections" });
    for (const label of ["General", "Appearance", "Shortcuts"]) {
      expect(within(tablist).getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    // General = instance name + SSH host (This host), notifications (This device).
    expect(screen.getByText("This host")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByLabelText("Instance name")).toBeInTheDocument();
    expect(screen.getByLabelText("SSH host")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });

  it("the Appearance tab carries the theme control + accent (This host) and terminal font (This device)", () => {
    renderDialog();
    selectTab("Appearance");
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("This host")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Theme mode" })).toBeInTheDocument();
    // The theme picker is the shared searchable core rendered inline — the
    // per-mode <select>s are gone. At rest a trigger shows the ACTIVE theme;
    // the search field + list live in a popover opened from it (collapsible).
    expect(screen.getByTestId("theme-picker-trigger")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Search themes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Themes" })).not.toBeInTheDocument();
    expect(document.querySelector("select")).toBeNull();
    expect(screen.getByRole("button", { name: "Set instance color" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Increase terminal font" })).toBeInTheDocument();
  });

  describe("Appearance inline theme picker (260819-qkow)", () => {
    /** Renders on the Appearance tab, opens the picker popover from its
     *  trigger, and returns the search input. */
    function openAppearance() {
      renderDialog(makeInstanceName(), "appearance");
      fireEvent.click(screen.getByTestId("theme-picker-trigger"));
      return screen.getByRole("combobox", { name: "Search themes" });
    }

    it("the trigger shows the ACTIVE theme at rest; clicking it opens the popover", () => {
      renderDialog(makeInstanceName(), "appearance");
      const trigger = screen.getByTestId("theme-picker-trigger");
      // matchMedia mocks matches:false → system resolves light → Default Light.
      expect(trigger).toHaveTextContent("Default Light");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox", { name: "Themes" })).not.toBeInTheDocument();
      fireEvent.click(trigger);
      // The trigger swaps to the focused search field with the list open.
      expect(screen.queryByTestId("theme-picker-trigger")).not.toBeInTheDocument();
      const input = screen.getByRole("combobox", { name: "Search themes" });
      expect(input).toHaveAttribute("aria-expanded", "true");
      expect(input).toHaveFocus();
      expect(screen.getByRole("listbox", { name: "Themes" })).toBeInTheDocument();
    });

    it("filters themes by search query in the open popover", () => {
      const input = openAppearance();
      fireEvent.change(input, { target: { value: "gru" } });
      const list = screen.getByRole("listbox", { name: "Themes" });
      expect(within(list).getByText("Gruvbox Dark")).toBeInTheDocument();
      expect(within(list).getByText("Gruvbox Light")).toBeInTheDocument();
      expect(within(list).queryByText("Dracula")).not.toBeInTheDocument();
    });

    it("shows checkmarks on BOTH preferred slots (dark and light)", () => {
      openAppearance();
      const list = screen.getByRole("listbox", { name: "Themes" });
      const checked = within(list)
        .getAllByLabelText("Current theme")
        .map((el) => el.closest('[role="option"]')!);
      expect(checked).toHaveLength(2);
      const names = checked.map((row) => row.textContent);
      expect(names).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Default Dark"),
          expect.stringContaining("Default Light"),
        ]),
      );
    });

    it("clicking a theme commits it through setTheme, closes the popover, and updates the trigger", () => {
      openAppearance();
      const list = screen.getByRole("listbox", { name: "Themes" });
      fireEvent.click(within(list).getByText("Dracula"));
      expect(localStorage.getItem("runkit-theme")).toBe("dracula");
      expect(localStorage.getItem("runkit-theme-dark")).toBe("dracula");
      // The dialog stays open; the commit closes the popover and the trigger
      // now names the committed theme.
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
      expect(screen.queryByRole("listbox", { name: "Themes" })).not.toBeInTheDocument();
      const trigger = screen.getByTestId("theme-picker-trigger");
      expect(trigger).toHaveTextContent("Dracula");
      // Reopening shows the DARK slot check moved to Dracula.
      fireEvent.click(trigger);
      const reopened = screen.getByRole("listbox", { name: "Themes" });
      const checkedNames = within(reopened)
        .getAllByLabelText("Current theme")
        .map((el) => el.closest('[role="option"]')!.textContent);
      expect(checkedNames).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Dracula"),
          expect.stringContaining("Default Light"),
        ]),
      );
    });

    it("Escape closes the POPOVER (not the dialog) and refocuses the trigger; an idle Escape closes the dialog", () => {
      const input = openAppearance();
      // ArrowDown starts a live preview in the open popover.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox", { name: "Themes" })).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
      const trigger = screen.getByTestId("theme-picker-trigger");
      expect(trigger).toHaveFocus();
      // Nothing open or previewing now — Escape bubbles to the focus trap.
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    });

    it("searching narrows the selection and Enter commits the first match", () => {
      const input = openAppearance();
      fireEvent.change(input, { target: { value: "drac" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(localStorage.getItem("runkit-theme")).toBe("dracula");
    });
  });

  it("the Shortcuts tab mounts the ported shortcuts panel", () => {
    renderDialog();
    selectTab("Shortcuts");
    expect(screen.getByTestId("settings-shortcuts-panel")).toBeInTheDocument();
    expect(screen.getByText("GLOBAL")).toBeInTheDocument();
  });

  it("arrow keys rove the tablist and activate on focus", () => {
    renderDialog();
    const general = screen.getByRole("tab", { name: "General" });
    general.focus();
    fireEvent.keyDown(general.closest('[role="tablist"]')!, { key: "ArrowDown" });
    const appearance = screen.getByRole("tab", { name: "Appearance" });
    expect(appearance).toHaveFocus();
    expect(appearance).toHaveAttribute("aria-selected", "true");
    // Roving tabindex: the active tab is the list's one Tab stop.
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("tabindex", "-1");
    expect(appearance).toHaveAttribute("tabindex", "0");
    // The other axis works too, and wraps.
    fireEvent.keyDown(general.closest('[role="tablist"]')!, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(general.closest('[role="tablist"]')!, { key: "ArrowUp" });
    expect(screen.getByRole("tab", { name: "Shortcuts" })).toHaveAttribute("aria-selected", "true");
  });

  it("a deep-linked open lands on the requested tab", () => {
    renderDialog(makeInstanceName(), "shortcuts");
    expect(screen.getByRole("tab", { name: "Shortcuts" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("settings-shortcuts-panel")).toBeInTheDocument();
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
    selectTab("Appearance");
    // Desktop default (matchMedia mocked to false) is 13px.
    expect(screen.getByText("13px")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Increase terminal font" }));
    expect(screen.getByText("14px")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("13px")).toBeInTheDocument();
  });

  it("opens the color-only SwatchPopover from the accent control", async () => {
    renderDialog();
    selectTab("Appearance");
    fireEvent.click(screen.getByRole("button", { name: "Set instance color" }));
    // The popover's color band header − is the color-only marker ("Clear color" + ✕).
    expect(await screen.findByRole("option", { name: "Clear color" })).toBeInTheDocument();
  });

  it("uses the xl dialog variant (fixed height, max-w-4xl) with the 190px/1fr preference-row grid (260724-6j1v)", () => {
    renderDialog();
    // Tabbed preference pane: the shared Dialog's xl width variant.
    const panel = screen.getByRole("dialog", { name: "Settings" });
    expect(panel.className).toContain("max-w-4xl");
    expect(panel.className).toContain("h-[min(40rem,calc(100vh-2rem))]");
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

  it("an armed rebind capture's Escape cancels the capture WITHOUT closing the dialog", async () => {
    renderDialog(makeInstanceName(), "shortcuts");
    fireEvent.click(screen.getByLabelText("Change binding for Next window"));
    expect(screen.getByText("press keys…")).toBeInTheDocument();
    // The capture-phase listener stopPropagations — the focus trap never sees
    // this Escape, so only the capture cancels.
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(screen.queryByText("press keys…")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    // A second Escape (no capture armed) closes the dialog.
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument(),
    );
  });
});
