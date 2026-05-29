import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TmuxCommandsDialog } from "./tmux-commands-dialog";

afterEach(cleanup);

describe("TmuxCommandsDialog", () => {
  it("renders two command rows plus static detach hint", () => {
    render(
      <TmuxCommandsDialog
        server="runkit"
        session="devshell"
        windowId="@7"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Attach")).toBeInTheDocument();
    expect(screen.getByText("Send keys")).toBeInTheDocument();
    expect(screen.getByText(/Detach/)).toBeInTheDocument();
  });

  it("includes -L flag for named servers and targets the window by ID", () => {
    render(
      <TmuxCommandsDialog
        server="runkit"
        session="devshell"
        windowId="@7"
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("tmux -L runkit attach-session -t devshell \\; select-window -t @7"),
    ).toBeInTheDocument();
    expect(screen.getByText(/tmux -L runkit send-keys -t @7/)).toBeInTheDocument();
  });

  it("omits -L flag for default server", () => {
    render(
      <TmuxCommandsDialog
        server="default"
        session="devshell"
        windowId="@7"
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("tmux attach-session -t devshell \\; select-window -t @7"),
    ).toBeInTheDocument();
    expect(screen.getByText(/tmux send-keys -t @7/)).toBeInTheDocument();
  });

  it("copy button calls navigator.clipboard.writeText with correct command", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(
      <TmuxCommandsDialog
        server="runkit"
        session="devshell"
        windowId="@7"
        onClose={vi.fn()}
      />,
    );

    const copyButtons = screen.getAllByRole("button", { name: /copy .+ command/i });
    fireEvent.click(copyButtons[0]);

    expect(writeText).toHaveBeenCalledWith(
      "tmux -L runkit attach-session -t devshell \\; select-window -t @7",
    );
  });

  it("each command row has a copy button", () => {
    render(
      <TmuxCommandsDialog
        server="default"
        session="main"
        windowId="@3"
        onClose={vi.fn()}
      />,
    );

    const copyButtons = screen.getAllByRole("button", { name: /copy .+ command/i });
    expect(copyButtons).toHaveLength(2);
  });
});
