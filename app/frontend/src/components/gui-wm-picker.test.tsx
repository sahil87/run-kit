import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { GuiStatus, SettingsEntry } from "@/api/client";
import { OTHER_WM, DESKTOP_SET_OFF_TOAST } from "@/lib/gui-desktop";

// Confirm seam: the AppLayout-mounted restart dialog's request.
const request = vi.fn();
vi.mock("@/contexts/gui-restart-context", () => ({
  useGuiRestartRequest: () => ({ request }),
}));

// Toast seam: capture the off-GUI info toast without the provider.
const addToast = vi.fn();
vi.mock("@/components/toast", () => ({
  useToast: () => ({ addToast }),
}));

vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  fetchGuiStatus: vi.fn(),
  restartGui: vi.fn().mockResolvedValue({ ok: true }),
}));

import { fetchGuiStatus, restartGui } from "@/api/client";
import { GuiWMPicker } from "./gui-wm-picker";

const ENTRY: SettingsEntry = {
  key: "gui.wm",
  kind: "string",
  default: "",
  description: "Window manager",
  category: "behavior",
  ui: true,
  live: false,
  value: "",
};

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
    wm_candidates: [
      { name: "icewm-session", label: "IceWM", kind: "wm", installed: true },
      { name: "startlxqt", label: "LXQt", kind: "session", installed: true },
    ],
    ...overrides,
  };
}

function renderPicker(value = "", commit = vi.fn().mockResolvedValue(undefined)) {
  return {
    commit,
    ...render(<GuiWMPicker entry={ENTRY} value={value} commit={commit} />),
  };
}

beforeEach(() => {
  request.mockReset().mockResolvedValue(true);
  addToast.mockReset();
  vi.mocked(fetchGuiStatus).mockReset();
  vi.mocked(restartGui).mockClear();
});

afterEach(cleanup);

describe("GuiWMPicker", () => {
  it("renders the free-text control while the status fetch pends", () => {
    vi.mocked(fetchGuiStatus).mockReturnValue(new Promise(() => {}));
    renderPicker();
    expect(document.getElementById("setting-gui.wm")).toBeInstanceOf(HTMLInputElement);
  });

  it("lists Auto (ladder) → candidates → Other… once the document resolves", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    renderPicker();
    const select = await screen.findByRole("combobox");
    expect(select).toHaveAttribute("id", "setting-gui.wm");
    expect(
      Array.from(select.querySelectorAll("option")).map((o) => [o.value, o.textContent]),
    ).toEqual([
      ["", "Auto (ladder)"],
      ["icewm-session", "IceWM"],
      ["startlxqt", "LXQt"],
      [OTHER_WM, "Other…"],
    ]);
  });

  it("choosing a candidate commits it through the seam and never calls the restart route", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { commit } = renderPicker();
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "startlxqt" } });
    await waitFor(() => expect(commit).toHaveBeenCalledWith("startlxqt"));
    expect(vi.mocked(restartGui)).not.toHaveBeenCalled();
    // The enabled document sends the flow into the restart confirm.
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
  });

  it("choosing Auto commits the unset convention (null)", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { commit } = renderPicker("icewm-session");
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(commit).toHaveBeenCalledWith(null));
  });

  it("Other… reveals the text field without writing anything", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { commit } = renderPicker();
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: OTHER_WM } });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(commit).not.toHaveBeenCalled();
  });

  it("a typed name commits through the pick flow", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { commit } = renderPicker();
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: OTHER_WM } });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "xfwm4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(commit).toHaveBeenCalledWith("xfwm4"));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
  });

  it("a stored non-candidate pin selects Other… with the field pre-filled", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    renderPicker("xfwm4");
    const select = await screen.findByRole("combobox");
    expect(select).toHaveValue(OTHER_WM);
    expect(screen.getByRole("textbox")).toHaveValue("xfwm4");
  });

  it("an empty candidate list offers exactly Auto (ladder) and Other…", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status({ wm_candidates: [] }));
    renderPicker();
    const select = await screen.findByRole("combobox");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "Auto (ladder)",
      "Other…",
    ]);
  });

  it("a rejected fetch keeps the free-text control, committing as before", async () => {
    vi.mocked(fetchGuiStatus).mockRejectedValue(new Error("down"));
    const { commit } = renderPicker();
    const input = await screen.findByRole("textbox");
    expect(input.id).toBe("setting-gui.wm");
    fireEvent.change(input, { target: { value: "openbox" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(commit).toHaveBeenCalledWith("openbox"));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("renders the install hint footer only when the document carries it", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(
      status({
        wm_candidates: [
          { name: "icewm-session", label: "IceWM", kind: "wm", installed: true },
        ],
        wm_candidates_hint: "sudo apt install --no-install-recommends lxqt-core",
      }),
    );
    const { unmount } = renderPicker();
    await screen.findByRole("combobox");
    expect(screen.getByTestId("gui-wm-install-hint").textContent).toBe(
      "Install more: sudo apt install --no-install-recommends lxqt-core",
    );
    unmount();

    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    renderPicker();
    await screen.findByRole("combobox");
    expect(screen.queryByTestId("gui-wm-install-hint")).toBeNull();
  });

  it("a disabled GUI writes, skips the confirm, and toasts the takes-effect-later line", async () => {
    vi.mocked(fetchGuiStatus)
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({ enabled: false, reachable: false, display: "" }));
    const { commit } = renderPicker();
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "startlxqt" } });
    await waitFor(() => expect(commit).toHaveBeenCalledWith("startlxqt"));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(DESKTOP_SET_OFF_TOAST, "info"),
    );
    expect(request).not.toHaveBeenCalled();
    expect(vi.mocked(restartGui)).not.toHaveBeenCalled();
  });
});
