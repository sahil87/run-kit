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
    // The popover's removal row is the color-only marker ("Clear color").
    expect(await screen.findByText("Clear color")).toBeInTheDocument();
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
