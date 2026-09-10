import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/toast";
import { GuiOffDialog, guiOffBody, formatGuiUptime } from "./gui-off-dialog";
import { fetchGuiStatus, postSettings, type GuiStatus } from "@/api/client";

vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  fetchGuiStatus: vi.fn(),
  postSettings: vi.fn().mockResolvedValue(undefined),
}));

function renderDialog(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <ToastProvider>
        <GuiOffDialog onClose={onClose} />
      </ToastProvider>,
    ),
  };
}

function status(overrides: Partial<GuiStatus> = {}): GuiStatus {
  return {
    id: "host",
    enabled: true,
    backend: "Xtigervnc",
    reachable: true,
    display: ":10",
    width: 1920,
    height: 1080,
    viewers: 1,
    wm: "icewm-session",
    locked: false,
    geometry: "1920x1080",
    socket: "/run/host.sock",
    session: "rk-gui",
    reason: "",
    apps: [],
    uptime_seconds: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(fetchGuiStatus).mockReset();
  vi.mocked(postSettings).mockClear();
});

afterEach(cleanup);

describe("formatGuiUptime", () => {
  it("formats hours+minutes / minutes / seconds", () => {
    expect(formatGuiUptime(15120)).toBe("4h 12m");
    expect(formatGuiUptime(180)).toBe("3m");
    expect(formatGuiUptime(12)).toBe("12s");
    expect(formatGuiUptime(0)).toBe("0s");
  });
});

describe("guiOffBody — copy variants", () => {
  it("lists the apps with the uptime when apps are running", () => {
    const body = guiOffBody(
      status({
        apps: [
          { name: "chromium", count: 3 },
          { name: "xterm", count: 1 },
        ],
        uptime_seconds: 15120,
      }),
    );
    expect(body.line).toBe(
      "Turning the GUI off kills the rk-gui session and every app on display :10:",
    );
    expect(body.detail).toBe("chromium ×3, xterm ×1  (up 4h 12m)");
  });

  it("empty apps read 'No apps are running on display <display>.'", () => {
    const body = guiOffBody(status());
    expect(body.line).toBe("Turning the GUI off kills the rk-gui session.");
    expect(body.detail).toBe("No apps are running on display :10.");
  });

  it("an empty display (never ran) drops the display mention", () => {
    const body = guiOffBody(status({ display: "" }));
    expect(body.line).toBe("Turning the GUI off kills the rk-gui session.");
    expect(body.detail).toBeUndefined();
  });

  it("the macOS mirror closes nothing on the Mac", () => {
    const body = guiOffBody(status({ backend: "screen-sharing", display: "" }));
    expect(body.line).toBe(
      "Turning the GUI off stops the Screen Sharing mirror; nothing on your Mac is closed.",
    );
    expect(body.detail).toBeUndefined();
  });
});

describe("GuiOffDialog", () => {
  it("fetches the status on open and renders the apps line verbatim", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(
      status({
        apps: [
          { name: "chromium", count: 3 },
          { name: "xterm", count: 1 },
        ],
        uptime_seconds: 15120,
      }),
    );
    renderDialog();
    expect(screen.getByText("Checking what the GUI is running…")).toBeInTheDocument();
    await screen.findByText(/chromium ×3, xterm ×1/);
    expect(screen.getByText(/chromium ×3, xterm ×1/).textContent).toBe(
      "chromium ×3, xterm ×1  (up 4h 12m)",
    );
    expect(vi.mocked(fetchGuiStatus)).toHaveBeenCalledTimes(1);
  });

  it("a failed status GET still renders the confirm without app copy", async () => {
    vi.mocked(fetchGuiStatus).mockRejectedValue(new Error("down"));
    renderDialog();
    await waitFor(() =>
      expect(screen.queryByText("Checking what the GUI is running…")).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Turn off" })).toBeEnabled();
  });

  it("Cancel closes without any settings POST", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { onClose } = renderDialog();
    await screen.findByText(/No apps are running/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(vi.mocked(postSettings)).not.toHaveBeenCalled();
  });

  it("Turn off POSTs exactly {\"gui.enabled\": false} and closes confirmed", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { onClose } = renderDialog();
    await screen.findByText(/No apps are running/);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(vi.mocked(postSettings)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postSettings)).toHaveBeenCalledWith({ "gui.enabled": false });
  });

  it("a failed POST toasts and keeps the dialog open", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    vi.mocked(postSettings).mockRejectedValueOnce(new Error("save failed"));
    const { onClose } = renderDialog();
    await screen.findByText(/No apps are running/);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await screen.findByText("save failed");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("postOnConfirm=false defers the POST to the caller (the settings-seam path)", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <GuiOffDialog onClose={onClose} postOnConfirm={false} />
      </ToastProvider>,
    );
    await screen.findByText(/No apps are running/);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(onClose).toHaveBeenCalledWith(true);
    expect(vi.mocked(postSettings)).not.toHaveBeenCalled();
  });
});
