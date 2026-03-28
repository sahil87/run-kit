import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TmuxCommandsDialog } from "./tmux-commands-dialog";

afterEach(cleanup);

describe("TmuxCommandsDialog", () => {
  it("renders three command rows with correct labels", () => {
    render(
      <TmuxCommandsDialog
        server="runkit"
        session="devshell"
        window="editor"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Attach")).toBeInTheDocument();
    expect(screen.getByText("New window")).toBeInTheDocument();
    expect(screen.getByText("Detach")).toBeInTheDocument();
  });

  it("includes -L flag for named servers", () => {
    render(
      <TmuxCommandsDialog
        server="runkit"
        session="devshell"
        window="editor"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("tmux -L runkit attach-session -t devshell:editor")).toBeInTheDocument();
    expect(screen.getByText("tmux -L runkit new-window -t devshell")).toBeInTheDocument();
    expect(screen.getByText("tmux -L runkit detach-client -t devshell")).toBeInTheDocument();
  });

  it("omits -L flag for default server", () => {
    render(
      <TmuxCommandsDialog
        server="default"
        session="devshell"
        window="editor"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("tmux attach-session -t devshell:editor")).toBeInTheDocument();
    expect(screen.getByText("tmux new-window -t devshell")).toBeInTheDocument();
    expect(screen.getByText("tmux detach-client -t devshell")).toBeInTheDocument();
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
        window="editor"
        onClose={vi.fn()}
      />,
    );

    const copyButtons = screen.getAllByRole("button", { name: /copy .+ command/i });
    fireEvent.click(copyButtons[0]);

    expect(writeText).toHaveBeenCalledWith("tmux -L runkit attach-session -t devshell:editor");
  });

  it("each row has a copy button", () => {
    render(
      <TmuxCommandsDialog
        server="default"
        session="main"
        window="zsh"
        onClose={vi.fn()}
      />,
    );

    const copyButtons = screen.getAllByRole("button", { name: /copy .+ command/i });
    expect(copyButtons).toHaveLength(3);
  });
});
