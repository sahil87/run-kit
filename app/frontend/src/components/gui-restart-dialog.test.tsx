import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/toast";
import { GuiRestartDialog } from "./gui-restart-dialog";
import { fetchGuiStatus, restartGui, type GuiStatus } from "@/api/client";

vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  fetchGuiStatus: vi.fn(),
  restartGui: vi.fn().mockResolvedValue({ ok: true }),
}));

function renderDialog(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <ToastProvider>
        <GuiRestartDialog onClose={onClose} />
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
    geometry: "auto",
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
  vi.mocked(restartGui).mockClear().mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("GuiRestartDialog", () => {
  it("fetches the status on open and names the running apps", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(
      status({
        apps: [
          { name: "chromium", count: 3 },
          { name: "xterm", count: 1 },
        ],
      }),
    );
    renderDialog();
    expect(screen.getByText("Checking what the GUI is running…")).toBeInTheDocument();
    await screen.findByText("Running apps will close: chromium ×3, xterm ×1");
    expect(vi.mocked(fetchGuiStatus)).toHaveBeenCalledTimes(1);
  });

  it("renders the empty-apps line with the display", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    renderDialog();
    await screen.findByText("No apps are running on display :10.");
  });

  it("a not-running display takes the next-restart line", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status({ reachable: false, display: "" }));
    renderDialog();
    await screen.findByText(
      "The desktop is not running — the new desktop starts on the next restart.",
    );
  });

  it("a failed status GET still renders the confirm with the generic line", async () => {
    vi.mocked(fetchGuiStatus).mockRejectedValue(new Error("down"));
    renderDialog();
    await screen.findByText(
      "Couldn't read the desktop status — restarting it closes any running apps.",
    );
    expect(screen.getByRole("button", { name: "Restart" })).toBeEnabled();
  });

  it("Later closes unconfirmed and never calls the restart route", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { onClose } = renderDialog();
    await screen.findByText(/No apps are running/);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(vi.mocked(restartGui)).not.toHaveBeenCalled();
  });

  it("Restart calls the restart route exactly once and closes confirmed", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { onClose } = renderDialog();
    await screen.findByText(/No apps are running/);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(vi.mocked(restartGui)).toHaveBeenCalledTimes(1);
  });

  it("a disabled-GUI answer toasts and closes cleanly (the written pin stands)", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    vi.mocked(restartGui).mockResolvedValue({ ok: false, disabled: true });
    const { onClose } = renderDialog();
    await screen.findByText(/No apps are running/);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await screen.findByText("The GUI is off — the new desktop starts when it turns on");
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("a thrown restart error toasts and closes cleanly", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    vi.mocked(restartGui).mockRejectedValue(new Error("restart failed"));
    const { onClose } = renderDialog();
    await screen.findByText(/No apps are running/);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await screen.findByText("restart failed");
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });
});
