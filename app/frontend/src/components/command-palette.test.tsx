import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette, type PaletteAction } from "./command-palette";

function makeActions(labels: string[]): PaletteAction[] {
  return labels.map((label, i) => ({
    id: `action-${i}`,
    label,
    onSelect: vi.fn(),
  }));
}

function openPalette() {
  fireEvent.keyDown(document, { key: "k", code: "KeyK", metaKey: true });
}

describe("CommandPalette", () => {
  afterEach(cleanup);

  it("is hidden by default", () => {
    const actions = makeActions(["New Session", "Kill Window"]);
    const { container } = render(<CommandPalette actions={actions} />);
    expect(container.innerHTML).toBe("");
  });

  it.each([
    { label: "Cmd", modifier: "metaKey" },
    { label: "Ctrl", modifier: "ctrlKey" },
  ] as const)("opens and toggles closed with $label+K", ({ modifier }) => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    const chord = { key: "k", code: "KeyK", [modifier]: true };

    fireEvent.keyDown(document, chord);
    expect(screen.getByPlaceholderText(/^Type a command/)).toBeInTheDocument();
    fireEvent.keyDown(document, chord);
    expect(screen.queryByPlaceholderText(/^Type a command/)).not.toBeInTheDocument();
  });

  it("focuses the search input when opened", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByPlaceholderText(/^Type a command/)).toHaveFocus();
  });


  it("filters actions by search query (case-insensitive)", () => {
    const actions = makeActions(["New Session", "Kill Window", "New Window"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "new" } });

    expect(screen.getByText("New Session")).toBeInTheDocument();
    expect(screen.getByText("New Window")).toBeInTheDocument();
    expect(screen.queryByText("Kill Window")).not.toBeInTheDocument();
  });

  it("shows 'No results' when filter matches nothing", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "zzzzz" } });

    expect(screen.getByText(/^No results/)).toBeInTheDocument();
  });

  it("renders an optional description as secondary row text", () => {
    const actions: PaletteAction[] = [
      { id: "a", label: "Session: Create", description: "a new group of tabs", onSelect: vi.fn() },
      { id: "b", label: "Tab: Create", onSelect: vi.fn() },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("— a new group of tabs")).toBeInTheDocument();
    // Actions without a description render exactly as before.
    expect(screen.getByText("Tab: Create").querySelector("span span")).toBeNull();
  });

  it("filters by description as well as label", () => {
    const actions: PaletteAction[] = [
      { id: "a", label: "Session: Create", description: "a new group of tabs", onSelect: vi.fn() },
      { id: "b", label: "Tab: Create", onSelect: vi.fn() },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "group" } });

    expect(screen.getByText("Session: Create")).toBeInTheDocument();
    expect(screen.queryByText("Tab: Create")).not.toBeInTheDocument();
  });

  it("renders an optional action icon and finds the action through its description", () => {
    const actions: PaletteAction[] = [
      {
        id: "coordinator",
        label: "Tab: Switch to system › coordinator",
        description: "operator",
        icon: (
          <span data-testid="palette-action-icon" aria-hidden="true">
            icon
          </span>
        ),
        onSelect: vi.fn(),
      },
      { id: "worker", label: "Tab: Switch to work › worker", onSelect: vi.fn() },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "operator" } });

    expect(screen.getByTestId("palette-action-icon")).toBeInTheDocument();
    expect(screen.getByText("Tab: Switch to system › coordinator")).toBeInTheDocument();
    expect(screen.getByText("— operator")).toBeInTheDocument();
    expect(screen.queryByText("Tab: Switch to work › worker")).not.toBeInTheDocument();
  });

  it("selects action with Enter and closes palette", () => {
    const actions = makeActions(["New Session", "Kill Window"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(actions[0].onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByPlaceholderText(/^Type a command/)).not.toBeInTheDocument();
  });

  it("requires a second Enter for an action with a confirmation label", () => {
    const onSelect = vi.fn();
    const actions: PaletteAction[] = [
      {
        id: "close-two",
        label: "Selection: Close 2 windows",
        confirmLabel: "Close 2 windows — Enter to confirm",
        onSelect,
      },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    fireEvent.keyDown(screen.getByPlaceholderText(/^Type a command/), {
      key: "Enter",
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("Close 2 windows — Enter to confirm")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Confirm action...")).toHaveAttribute(
      "readonly",
    );

    fireEvent.keyDown(screen.getByPlaceholderText("Confirm action..."), {
      key: "Enter",
    });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByPlaceholderText("Confirm action...")).not.toBeInTheDocument();
  });

  it("Escape cancels a pending confirmation without running its action", () => {
    const onSelect = vi.fn();
    const actions: PaletteAction[] = [
      {
        id: "close-one",
        label: "Selection: Close 1 window",
        confirmLabel: "Close 1 window — Enter to confirm",
        onSelect,
      },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    fireEvent.keyDown(screen.getByPlaceholderText(/^Type a command/), {
      key: "Enter",
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Confirm action..."), {
      key: "Escape",
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Confirm action...")).not.toBeInTheDocument();
  });

  it("navigates with ArrowDown and ArrowUp", () => {
    const actions = makeActions(["First", "Second", "Third"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(actions[2].onSelect).toHaveBeenCalledOnce();
  });

  it("ArrowUp from first item stays at first", () => {
    const actions = makeActions(["First", "Second"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(actions[0].onSelect).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByPlaceholderText(/^Type a command/)).not.toBeInTheDocument();
  });

  it("closes on Escape when focus is on an option row (document-level trap)", () => {
    const actions = makeActions(["New Session", "Kill Window"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    // Options are non-focusable divs; the keydown still bubbles to the
    // document, where useFocusTrap owns Escape.
    const option = screen.getByText("Kill Window");
    fireEvent.keyDown(option, { key: "Escape" });

    expect(screen.queryByPlaceholderText(/^Type a command/)).not.toBeInTheDocument();
  });

  it("keeps Tab focus inside the palette (wraps on the sole focusable input)", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    expect(input).toHaveFocus();

    // The input is the palette's only focusable element, so the trap wraps
    // Tab and Shift+Tab back onto it — focus can never leave the modal.
    // fireEvent returns false when the trap preventDefault()ed the keydown,
    // which is the observable proof of interception in jsdom (which never
    // moves focus on Tab by itself).
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);
    expect(input).toHaveFocus();

    expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(false);
    expect(input).toHaveFocus();
  });

  it("closes on backdrop click", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    fireEvent.click(screen.getByTestId("palette-overlay"));

    expect(screen.queryByPlaceholderText(/^Type a command/)).not.toBeInTheDocument();
  });

  it("renders shortcut badges when provided", () => {
    const actions: PaletteAction[] = [
      { id: "a1", label: "New Session", shortcut: "N", onSelect: vi.fn() },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("N")).toBeInTheDocument();
  });


  it("shows theme actions with (current) suffix on active preference", () => {
    const actions: PaletteAction[] = [
      { id: "theme-system", label: "Theme: System (current)", onSelect: vi.fn() },
      { id: "theme-light", label: "Theme: Light", onSelect: vi.fn() },
      { id: "theme-dark", label: "Theme: Dark", onSelect: vi.fn() },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Theme: System (current)")).toBeInTheDocument();
    expect(screen.getByText("Theme: Light")).toBeInTheDocument();
    expect(screen.getByText("Theme: Dark")).toBeInTheDocument();
  });

  it("filters theme actions when typing 'theme'", () => {
    const actions: PaletteAction[] = [
      { id: "create-session", label: "Create new session", onSelect: vi.fn() },
      { id: "theme-system", label: "Theme: System", onSelect: vi.fn() },
      { id: "theme-light", label: "Theme: Light", onSelect: vi.fn() },
      { id: "theme-dark", label: "Theme: Dark", onSelect: vi.fn() },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "theme" } });

    expect(screen.getByText("Theme: System")).toBeInTheDocument();
    expect(screen.getByText("Theme: Light")).toBeInTheDocument();
    expect(screen.getByText("Theme: Dark")).toBeInTheDocument();
    expect(screen.queryByText("Create new session")).not.toBeInTheDocument();
  });

  it("scrolls selected item into view on ArrowDown", () => {
    const actions = makeActions(["First", "Second", "Third"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const listbox = screen.getByRole("listbox");
    const options = listbox.querySelectorAll('[role="option"]');
    const secondOption = options[1];
    const scrollSpy = vi.fn();
    (secondOption as unknown as HTMLElement).scrollIntoView = scrollSpy;

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const selected = listbox.querySelector('[aria-selected="true"]');
    expect(selected).toBeTruthy();
    expect(selected).toBe(secondOption);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("copy tmux attach command action copies correct string to clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const sessionName = "main";
    const windowName = "editor";
    const actions: PaletteAction[] = [
      {
        id: "copy-tmux-attach",
        label: "Copy: tmux Attach Command",
        onSelect: () => {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(`tmux attach-session -t ${sessionName}:${windowName}`).catch(() => {});
          }
        },
      },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(writeText).toHaveBeenCalledWith("tmux attach-session -t main:editor");

    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  it("calls onSelect for theme action when selected", () => {
    const setLight = vi.fn();
    const actions: PaletteAction[] = [
      { id: "theme-light", label: "Theme: Light", onSelect: setLight },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(setLight).toHaveBeenCalledOnce();
  });

  describe("optionPicker sub-step", () => {
    function makePickerAction(onApply = vi.fn()): PaletteAction {
      return {
        id: "sort-windows",
        label: "Session: Sort windows…",
        optionPicker: {
          options: [
            { key: "status", label: "By status" },
            { key: "created", label: "By created" },
            { key: "name", label: "By name" },
          ],
          onApply,
        },
        onSelect: vi.fn(),
      };
    }

    function enterPicker() {
      const input = screen.getByPlaceholderText(/^Type a command/);
      fireEvent.keyDown(input, { key: "Enter" });
      return screen.getByPlaceholderText("Pick options — Space toggle · Enter apply");
    }

    it("swaps the list to option rows with a readOnly instructional input", () => {
      render(<CommandPalette actions={[makePickerAction()]} />);
      openPalette();

      const input = enterPicker();

      expect(input).toHaveAttribute("readonly");
      expect(screen.getByText("By status")).toBeInTheDocument();
      expect(screen.getByText("By created")).toBeInTheDocument();
      expect(screen.getByText("By name")).toBeInTheDocument();
      expect(screen.queryByText("Session: Sort windows…")).not.toBeInTheDocument();
    });

    it("Space toggles options with order badges reflecting selection order", () => {
      render(<CommandPalette actions={[makePickerAction()]} />);
      openPalette();
      const input = enterPicker();

      // Select "created" then "name": badges 1 and 2 in selection order.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: " " });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: " " });

      const createdRow = screen.getByText("By created").closest("[role='option']")!;
      const nameRow = screen.getByText("By name").closest("[role='option']")!;
      expect(createdRow.textContent).toContain("1");
      expect(nameRow.textContent).toContain("2");
      expect(screen.getByText("By status").closest("[role='option']")!.textContent).not.toContain("1");

      // Untoggling "created" renumbers "name" to 1.
      fireEvent.keyDown(input, { key: "ArrowUp" });
      fireEvent.keyDown(input, { key: " " });
      expect(nameRow.textContent).toContain("1");
      expect(createdRow.textContent).not.toContain("2");
    });

    it("click toggles an option", () => {
      render(<CommandPalette actions={[makePickerAction()]} />);
      openPalette();
      enterPicker();

      fireEvent.click(screen.getByText("By name"));

      expect(screen.getByText("By name").closest("[role='option']")!.textContent).toContain("1");
    });

    it("Enter applies the ordered selected keys and closes", () => {
      const onApply = vi.fn();
      render(<CommandPalette actions={[makePickerAction(onApply)]} />);
      openPalette();
      const input = enterPicker();

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: " " });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: " " });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onApply).toHaveBeenCalledWith(["created", "name"]);
      expect(screen.queryByPlaceholderText("Pick options — Space toggle · Enter apply")).not.toBeInTheDocument();
    });

    it("Enter with zero selected is a no-op, not a dismiss", () => {
      const onApply = vi.fn();
      render(<CommandPalette actions={[makePickerAction(onApply)]} />);
      openPalette();
      const input = enterPicker();

      fireEvent.keyDown(input, { key: "Enter" });

      expect(onApply).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText("Pick options — Space toggle · Enter apply")).toBeInTheDocument();
    });

    it("Escape cancels without applying", () => {
      const onApply = vi.fn();
      render(<CommandPalette actions={[makePickerAction(onApply)]} />);
      openPalette();
      const input = enterPicker();

      fireEvent.keyDown(input, { key: " " });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(onApply).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText("Pick options — Space toggle · Enter apply")).not.toBeInTheDocument();
    });

    it("backdrop click cancels without applying", () => {
      const onApply = vi.fn();
      render(<CommandPalette actions={[makePickerAction(onApply)]} />);
      openPalette();
      enterPicker();

      fireEvent.click(screen.getByTestId("palette-overlay"));

      expect(onApply).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText("Pick options — Space toggle · Enter apply")).not.toBeInTheDocument();
    });

    it("the parent action's onSelect never fires (the picker owns completion)", () => {
      const action = makePickerAction();
      render(<CommandPalette actions={[action]} />);
      openPalette();
      const input = enterPicker();

      fireEvent.keyDown(input, { key: " " });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(action.onSelect).not.toHaveBeenCalled();
    });
  });

  describe("Ask-operator fallback row", () => {
    const noMatch = makeActions(["New Session"]);

    function typeQuery(value: string) {
      const input = screen.getByPlaceholderText(/^Type a command/);
      fireEvent.change(input, { target: { value } });
      return input;
    }

    it("renders the row at zero matches on an operator-bearing server, and Enter delivers the trimmed query", () => {
      const onAsk = vi.fn();
      render(<CommandPalette actions={noMatch} askOperator={{ hasOperator: true, onAsk }} />);
      openPalette();
      const input = typeQuery("  restart the worker  ");

      const row = screen.getByText('Ask operator: "restart the worker"');
      expect(row).toBeInTheDocument();
      expect(screen.queryByText(/^No results/)).not.toBeInTheDocument();

      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAsk).toHaveBeenCalledWith("restart the worker");
      // The palette closes behind the handoff (the console opens next).
      expect(screen.queryByPlaceholderText(/^Type a command/)).not.toBeInTheDocument();
    });

    it("is omitted while any action matches the query", () => {
      const onAsk = vi.fn();
      render(<CommandPalette actions={noMatch} askOperator={{ hasOperator: true, onAsk }} />);
      openPalette();
      typeQuery("new");

      expect(screen.queryByText(/^Ask operator:/)).not.toBeInTheDocument();
      expect(screen.getByText("New Session")).toBeInTheDocument();
    });

    it("is omitted without an operator on the resolved server", () => {
      render(<CommandPalette actions={noMatch} askOperator={{ hasOperator: false, onAsk: vi.fn() }} />);
      openPalette();
      typeQuery("restart the worker");

      expect(screen.queryByText(/^Ask operator:/)).not.toBeInTheDocument();
      expect(screen.getByText(/^No results/)).toBeInTheDocument();
    });

    it("is omitted below the query-length floor", () => {
      render(<CommandPalette actions={noMatch} askOperator={{ hasOperator: true, onAsk: vi.fn() }} />);
      openPalette();
      typeQuery("hi");

      expect(screen.queryByText(/^Ask operator:/)).not.toBeInTheDocument();
      expect(screen.getByText(/^No results/)).toBeInTheDocument();
    });

    it("clicking the row fires the same handoff", () => {
      const onAsk = vi.fn();
      render(<CommandPalette actions={noMatch} askOperator={{ hasOperator: true, onAsk }} />);
      openPalette();
      typeQuery("rename the tab");

      fireEvent.click(screen.getByText('Ask operator: "rename the tab"'));
      expect(onAsk).toHaveBeenCalledWith("rename the tab");
    });
  });
});
