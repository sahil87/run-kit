import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import { SpawnAgentDialog } from "./spawn-agent-dialog";
import * as client from "@/api/client";

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    getRiffPresets: vi.fn(),
    spawnRiff: vi.fn(),
  };
});

const getRiffPresets = client.getRiffPresets as unknown as ReturnType<typeof vi.fn>;
const spawnRiff = client.spawnRiff as unknown as ReturnType<typeof vi.fn>;

function renderDialog(overrides?: { onSpawned?: () => void; onClose?: () => void }) {
  const onSpawned = overrides?.onSpawned ?? vi.fn();
  const onClose = overrides?.onClose ?? vi.fn();
  render(
    <StandaloneSessionContextProvider value={{ currentServer: "work" }}>
      <SpawnAgentDialog session="mysess" onSpawned={onSpawned} onClose={onClose} />
    </StandaloneSessionContextProvider>,
  );
  return { onSpawned, onClose };
}

describe("SpawnAgentDialog", () => {
  beforeEach(() => {
    getRiffPresets.mockReset();
    spawnRiff.mockReset();
    getRiffPresets.mockResolvedValue([]);
    spawnRiff.mockResolvedValue({ server: "work", session: "mysess", window: "riff-x", windowId: "@9" });
  });
  afterEach(cleanup);

  it("renders the TASK field and a Spawn button, and fetches presets on open", async () => {
    renderDialog();
    expect(screen.getByLabelText("Task")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /spawn/i })).toBeInTheDocument();
    await waitFor(() => expect(getRiffPresets).toHaveBeenCalledWith("work", "mysess"));
  });

  it("shows the PRESET dropdown only when the repo defines presets", async () => {
    getRiffPresets.mockResolvedValue([{ name: "ship", layout: "deck-h", paneCount: 2 }]);
    renderDialog();
    await waitFor(() => expect(screen.getByLabelText("Preset")).toBeInTheDocument());
    // The option label carries the name + layout/paneCount summary.
    expect(screen.getByRole("option", { name: /ship/i })).toBeInTheDocument();
  });

  it("does not render the PRESET dropdown when there are no presets", async () => {
    getRiffPresets.mockResolvedValue([]);
    renderDialog();
    await waitFor(() => expect(getRiffPresets).toHaveBeenCalled());
    expect(screen.queryByLabelText("Preset")).not.toBeInTheDocument();
  });

  it("Enter from the task field submits with the trimmed task", async () => {
    const { onSpawned, onClose } = renderDialog();
    const task = screen.getByLabelText("Task");
    fireEvent.change(task, { target: { value: "  fix the bug  " } });
    fireEvent.keyDown(task, { key: "Enter" });
    await waitFor(() => expect(spawnRiff).toHaveBeenCalledWith("work", "mysess", "fix the bug", undefined));
    await waitFor(() => expect(onSpawned).toHaveBeenCalledWith("@9"));
    expect(onClose).toHaveBeenCalled();
  });

  it("empty task submits as a blank session (task arg undefined)", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^spawn$/i }));
    await waitFor(() => expect(spawnRiff).toHaveBeenCalledWith("work", "mysess", undefined, undefined));
  });

  it("shows a busy pipeline label and disables the submit while spawning", async () => {
    let resolve!: (v: unknown) => void;
    spawnRiff.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^spawn$/i }));
    await waitFor(() => expect(screen.getByText(/worktree → window → agent/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /spawning/i })).toBeDisabled();
    resolve({ server: "work", session: "mysess", window: "riff-x", windowId: "@9" });
  });

  it("closes without navigating when the returned windowId is empty (best-effort backend)", async () => {
    // The backend windowId is best-effort — "" on a display-message resolve
    // failure. An empty id must NOT navigate (would hit a junk /$server/@ URL);
    // the dialog closes and the SSE stream surfaces the new row.
    spawnRiff.mockResolvedValue({ server: "work", session: "mysess", window: "riff-x", windowId: "" });
    const { onSpawned, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^spawn$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSpawned).not.toHaveBeenCalled();
  });

  it("renders a 400/500 error in-dialog and keeps the dialog open", async () => {
    spawnRiff.mockRejectedValue(new Error("The session's working directory is not inside a git repository"));
    const { onClose, onSpawned } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^spawn$/i }));
    await waitFor(() =>
      expect(screen.getByText(/not inside a git repository/i)).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onSpawned).not.toHaveBeenCalled();
    // Submit is re-enabled for correction.
    expect(screen.getByRole("button", { name: /^spawn$/i })).not.toBeDisabled();
  });
});
