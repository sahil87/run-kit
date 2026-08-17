import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { SessionRow } from "./session-row";
import { IDENTITY_TIP_OPEN_DELAY_MS } from "./identity-tip";
import { resetFlyoutWarmState } from "./row-flyout-card";
import type { ProjectSession } from "@/types";
import { makeSession, makeWindow } from "@/test-utils/fixtures";
import { stubMatchMedia } from "@/test-utils/match-media";
import { ThemeProvider } from "@/contexts/theme-context";
import { computeRowTints, DEFAULT_DARK_THEME } from "@/themes";

afterEach(() => {
  cleanup();
});

const noop = () => {};

function rowProps(session: ProjectSession) {
  return {
    server: "srv",
    session,
    isCollapsed: false,
    isSessionDropTarget: false,
    editingSession: null,
    editingSessionName: "",
    sessionInputRef: { current: null },
    orderedNames: [session.name] as string[],
    onDragStart: noop,
    onDragEnd: noop,
    onToggleCollapse: noop,
    onSelectFirstWindow: noop,
    onCreateWindow: noop,
    onKillClick: noop,
    onDoubleClickName: noop,
    onSessionNameChange: noop,
    onSessionRenameKeyDown: noop as React.KeyboardEventHandler<HTMLInputElement>,
    onSessionRenameBlur: noop,
    onDragOver: noop,
    onReorderOver: noop,
    onDragLeave: noop,
    onDrop: noop,
    onColorChange: noop,
  };
}

describe("SessionRow", () => {
  it("renders the session name", () => {
    const session = makeSession({ name: "agent-work" });
    render(<SessionRow {...rowProps(session)} />);
    expect(screen.getByText("agent-work")).toBeInTheDocument();
  });

  it("exposes create-window and kill affordances", () => {
    const session = makeSession({ name: "agent-work" });
    render(<SessionRow {...rowProps(session)} />);
    expect(screen.getByLabelText("New window in agent-work")).toBeInTheDocument();
    expect(screen.getByLabelText("Kill session agent-work")).toBeInTheDocument();
  });

  // Flair overlay (decoration-only channel): an always-on ambient CSS-only
  // animation mounted whenever the session carries a flair value — gated on
  // `session.flair` alone, in every row state.
  describe("flair overlay", () => {
    it("mounts the rk-flair overlay span when the session carries a flair", () => {
      const session = makeSession({ name: "agent-work", flair: "onepiece" });
      const { container } = render(<SessionRow {...rowProps(session)} />);
      const overlay = container.querySelector(".rk-flair-onepiece");
      expect(overlay).not.toBeNull();
      expect(overlay!.getAttribute("aria-hidden")).toBe("true");
    });

    it("mounts NO flair overlay when the session has no flair", () => {
      const session = makeSession({ name: "agent-work" });
      const { container } = render(<SessionRow {...rowProps(session)} />);
      expect(container.querySelector("[class*='rk-flair-']")).toBeNull();
    });
  });

  // One icon system (260724-2bmy): + and ✕ are stroke SVGs (PlusIcon/CloseIcon)
  // matching PaletteIcon/BotIcon, so the row's icon cluster reads at one ink
  // weight — the former text glyphs made even center gaps look uneven.
  it("renders the + and ✕ actions as stroke SVG icons, not text glyphs", () => {
    const session = makeSession({ name: "agent-work" });
    render(<SessionRow {...rowProps(session)} />);
    const plus = screen.getByLabelText("New window in agent-work");
    const kill = screen.getByLabelText("Kill session agent-work");
    for (const btn of [plus, kill]) {
      expect(btn.querySelector("svg")).not.toBeNull();
      expect(btn.textContent).toBe("");
    }
  });

  // gsmu: the spawn-agent bot button is an OPTIONAL affordance (mirrors
  // onColorChange) — present only when an onSpawnAgent handler is supplied, and
  // positioned immediately LEFT of the "+" create-window button so +/✕ keep
  // their edge positions.
  describe("spawn-agent bot button", () => {
    it("is absent when no onSpawnAgent handler is supplied", () => {
      const session = makeSession({ name: "agent-work" });
      render(<SessionRow {...rowProps(session)} />);
      expect(screen.queryByLabelText("Spawn agent in agent-work")).not.toBeInTheDocument();
    });

    it("renders left of the + button and calls onSpawnAgent(server, name) on click", () => {
      const onSpawnAgent = vi.fn();
      const session = makeSession({ name: "agent-work" });
      render(<SessionRow {...rowProps(session)} onSpawnAgent={onSpawnAgent} />);

      const bot = screen.getByLabelText("Spawn agent in agent-work");
      const plus = screen.getByLabelText("New window in agent-work");
      expect(bot).toBeInTheDocument();
      // DOM order: bot precedes + (Node.DOCUMENT_POSITION_FOLLOWING = 4).
      expect(bot.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      fireEvent.click(bot);
      expect(onSpawnAgent).toHaveBeenCalledWith("srv", "agent-work");
    });
  });

  // W3C-APG tree node semantics (Wave 3 sidebar-keyboard-nav). The session row
  // wrapper is a level-1 treeitem; its aria-expanded mirrors the chevron's, and
  // aria-controls points at the window-list group id. The roving model in
  // index.tsx threads tabIndex + set/pos and the data-session-row handle.
  describe("tree ARIA + roving tabindex", () => {
    function treeitem(container: HTMLElement): HTMLElement {
      const item = container.querySelector<HTMLElement>('[role="treeitem"]');
      expect(item).not.toBeNull();
      return item!;
    }

    it("renders role=treeitem at aria-level 1 with aria-expanded mirroring !isCollapsed", () => {
      const session = makeSession({ name: "api" });
      const { container, rerender } = render(
        <SessionRow {...rowProps(session)} isCollapsed={false} />,
      );
      const expanded = treeitem(container);
      expect(expanded).toHaveAttribute("role", "treeitem");
      expect(expanded).toHaveAttribute("aria-level", "1");
      expect(expanded).toHaveAttribute("aria-expanded", "true");

      rerender(<SessionRow {...rowProps(session)} isCollapsed={true} />);
      expect(treeitem(container)).toHaveAttribute("aria-expanded", "false");
    });

    it("wires aria-controls to the window-group id and exposes the data-session-row handle", () => {
      const session = makeSession({ name: "api" });
      const { container } = render(
        <SessionRow
          {...rowProps(session)}
          windowGroupId="windows-srv-api"
          sessionRowKey="srv:api"
        />,
      );
      const item = treeitem(container);
      expect(item).toHaveAttribute("aria-controls", "windows-srv-api");
      expect(item).toHaveAttribute("data-session-row", "srv:api");
    });

    // SF-5: the role="group" window list is mounted only while expanded, so the
    // session row must reference it via aria-controls ONLY when expanded — a
    // collapsed row pointing at an unmounted id is invalid ARIA.
    it("emits aria-controls only while expanded (absent when collapsed)", () => {
      const session = makeSession({ name: "api" });
      const { container, rerender } = render(
        <SessionRow
          {...rowProps(session)}
          isCollapsed={false}
          windowGroupId="windows-srv-api"
          sessionRowKey="srv:api"
        />,
      );
      expect(treeitem(container)).toHaveAttribute("aria-controls", "windows-srv-api");

      rerender(
        <SessionRow
          {...rowProps(session)}
          isCollapsed={true}
          windowGroupId="windows-srv-api"
          sessionRowKey="srv:api"
        />,
      );
      expect(treeitem(container)).not.toHaveAttribute("aria-controls");
    });

    it("reflects aria-setsize / aria-posinset and the roving tabIndex", () => {
      const session = makeSession({ name: "api" });
      const { container } = render(
        <SessionRow
          {...rowProps(session)}
          ariaSetSize={3}
          ariaPosInSet={2}
          tabIndex={0}
        />,
      );
      const item = treeitem(container);
      expect(item).toHaveAttribute("aria-setsize", "3");
      expect(item).toHaveAttribute("aria-posinset", "2");
      expect(item).toHaveAttribute("tabindex", "0");
    });

    it("defaults tabIndex to -1 when not the roving row", () => {
      const session = makeSession({ name: "api" });
      const { container } = render(<SessionRow {...rowProps(session)} />);
      expect(treeitem(container)).toHaveAttribute("tabindex", "-1");
    });
  });

  // React.memo only pays off when the parent passes referentially-stable props.
  // Proves the memo'd SessionRow does NOT re-render its body when its PARENT
  // re-renders with an identical prop set.
  //
  // We count the row's OWN render-body executions (not Profiler commits — a
  // Profiler fires on its parent's commit even when its memo'd child bails). The
  // signal is a getter on `session.name`: `SessionRowInner` reads `session.name`
  // at the top of every render (`const name = session.name`), so the getter fires
  // once per body execution. The parent (`Harness`) creates a FRESH <SessionRow>
  // element each render from a hoisted, stable props object, defeating React's
  // element-identity bailout — so only `React.memo` can stop the body from
  // re-running. An un-memoized row would read `session.name` again and fail.
  describe("React.memo", () => {
    it("does not re-render the row body when the parent re-renders with stable props", () => {
      let nameReads = 0;
      const base = makeSession({ name: "stable" });
      const session = new Proxy(base, {
        get(target, prop, receiver) {
          if (prop === "name") nameReads += 1;
          return Reflect.get(target, prop, receiver);
        },
      });
      const stableProps = rowProps(session); // hoisted once — identical refs each render

      let forceParent: () => void = () => {};
      function Harness() {
        const [, setTick] = useState(0);
        forceParent = () => setTick((n) => n + 1);
        return <SessionRow {...stableProps} />;
      }

      render(<Harness />);
      const afterMount = nameReads;
      expect(afterMount).toBeGreaterThan(0);

      act(() => { forceParent(); });
      expect(nameReads).toBe(afterMount); // memo bailed → body did not re-run
    });
  });

  // 260723-fm08: tier-1 tips on the icon action cluster. Deep tooltip behavior
  // is pinned in tip.test.tsx; these assert the per-site wiring — short
  // generic tip labels while the aria-labels keep per-session specificity —
  // and that click behavior survives the Tip wrap.
  describe("action-cluster tips (260723-fm08)", () => {
    it("each action button opens its generic-label tip on focus", () => {
      const cases: Array<[string, string]> = [
        ["Set color for agent-work", "Set session color"],
        ["Spawn agent in agent-work", "Spawn agent"],
        ["New window in agent-work", "New window"],
        ["Kill session agent-work", "Kill session"],
      ];
      // Fresh render per case: blur closes the tip on a floating-ui timeout,
      // so sequential focuses in one tree would accumulate open tooltips.
      for (const [ariaName, tipLabel] of cases) {
        const session = makeSession({ name: "agent-work" });
        const view = render(<SessionRow {...rowProps(session)} onSpawnAgent={noop} />);
        const btn = screen.getByLabelText(ariaName);
        act(() => { fireEvent.focus(btn); });
        expect(screen.getByRole("tooltip")).toHaveTextContent(tipLabel);
        expect(btn.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
        view.unmount();
      }
    });

    it("kill click still reaches onKillClick through the Tip wrap", () => {
      const onKillClick = vi.fn();
      const session = makeSession({ name: "agent-work" });
      render(<SessionRow {...rowProps(session)} onKillClick={onKillClick} />);

      fireEvent.click(screen.getByLabelText("Kill session agent-work"));
      expect(onKillClick).toHaveBeenCalledWith("srv", "agent-work", 1, false);
    });
  });

  // Row-level identity tip: `Session <full name>` title bar + one plain-text
  // body line ($N id · window count · ~-abbreviated root path). Hover/focus
  // open, Escape/leave dismiss, never on touch, suppressed while the row's
  // color popover is open, closed on drag start. NO TipGroup/warm-window
  // coupling — the delay is always the plain cold delay.
  describe("identity tip", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    function hoverRow() {
      const row = screen.getByRole("treeitem");
      act(() => {
        fireEvent.pointerEnter(row, { pointerType: "mouse" });
        fireEvent.mouseEnter(row);
        vi.advanceTimersByTime(IDENTITY_TIP_OPEN_DELAY_MS + 50);
      });
      return row;
    }

    it("opens on row hover with the full name in the title bar and the facts line in the body", () => {
      const session = makeSession({
        name: "code-surface-latch-distill",
        sessionId: "$4",
        sessionPath: "/home/sahil/code/sahil87/run-kit",
        windows: [makeWindow({}), makeWindow({ windowId: "@2" }), makeWindow({ windowId: "@3" })],
      });
      render(<SessionRow {...rowProps(session)} />);
      expect(screen.queryByTestId("session-tip")).toBeNull();

      hoverRow();
      const card = screen.getByTestId("session-tip");
      const bar = screen.getByTestId("popup-title-bar");
      expect(card).toContainElement(bar);
      expect(bar).toHaveTextContent("Session code-surface-latch-distill");
      expect(card).toHaveTextContent("$4 · 3 windows · ~/code/sahil87/run-kit");
      // Tier-1 weight: no interactive content at all.
      expect(card.querySelector("a, button")).toBeNull();
      expect(card.className).toContain("pointer-events-none");
    });

    it("omits underivable body segments (old payloads without sessionId/sessionPath)", () => {
      const session = makeSession({ name: "alpha", windows: [makeWindow({}), makeWindow({ windowId: "@2" }), makeWindow({ windowId: "@3" })] });
      render(<SessionRow {...rowProps(session)} />);
      hoverRow();
      const card = screen.getByTestId("session-tip");
      expect(card).toHaveTextContent("3 windows");
      expect(card).not.toHaveTextContent("$");
      expect(card).not.toHaveTextContent("~");
    });

    it("opens on keyboard row focus and dismisses on Escape", () => {
      render(<SessionRow {...rowProps(makeSession({ name: "api" }))} />);
      const row = screen.getByRole("treeitem");
      act(() => {
        fireEvent.focus(row);
      });
      expect(screen.getByTestId("session-tip")).toBeInTheDocument();
      act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
        vi.advanceTimersByTime(50);
      });
      expect(screen.queryByTestId("session-tip")).toBeNull();
    });

    it("never opens on a coarse pointer", () => {
      stubMatchMedia((query) => query === "(pointer: coarse)");
      render(<SessionRow {...rowProps(makeSession({ name: "api" }))} />);
      const row = screen.getByRole("treeitem");
      act(() => {
        fireEvent.pointerEnter(row, { pointerType: "touch" });
        fireEvent.mouseEnter(row);
        fireEvent.focus(row);
        vi.advanceTimersByTime(IDENTITY_TIP_OPEN_DELAY_MS + 100);
      });
      expect(screen.queryByTestId("session-tip")).toBeNull();
    });

    it("is suppressed while the row's color popover is open", () => {
      // ThemeProvider (SwatchPopover dep) needs a matchMedia stub; fine pointer.
      stubMatchMedia(() => false);
      render(
        <ThemeProvider>
          <SessionRow {...rowProps(makeSession({ name: "api" }))} />
        </ThemeProvider>,
      );
      fireEvent.click(screen.getByLabelText("Set color for api"));
      hoverRow();
      expect(screen.queryByTestId("session-tip")).toBeNull();
    });

    it("closes on drag start", () => {
      const onDragStart = vi.fn();
      render(<SessionRow {...rowProps(makeSession({ name: "api" }))} draggable onDragStart={onDragStart} />);
      const row = hoverRow();
      expect(screen.getByTestId("session-tip")).toBeInTheDocument();
      act(() => {
        fireEvent.dragStart(row);
      });
      expect(screen.queryByTestId("session-tip")).toBeNull();
      expect(onDragStart).toHaveBeenCalled();
    });
  });

  // Coarse rail + session card (260817-ve5m): the rail extends the one
  // continuous strip to session rows, the 4-icon cluster is render-gated
  // `!coarse` (its actions live in the rail-triggered card), and the card
  // carries the title/facts/action rows. jsdom evaluates no media queries, so
  // the pointer is stubbed and geometry is asserted as classes/inline styles.
  describe("coarse rail + session card (260817-ve5m)", () => {
    beforeEach(() => {
      resetFlyoutWarmState();
      // Coarse pointer + dark scheme (ThemeProvider/SwatchPopover need the
      // color-scheme query answered too).
      stubMatchMedia((q) => q === "(pointer: coarse)" || q === "(prefers-color-scheme: dark)");
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      resetFlyoutWarmState();
    });

    function tapRail() {
      act(() => {
        fireEvent.pointerDown(screen.getByTestId("status-rail"), { pointerId: 1, pointerType: "touch" });
      });
    }

    it("renders the 56px tier-tinted rail with an empty glyph slot + chevron, and gates the cluster out of the DOM", () => {
      const rowTints = computeRowTints(DEFAULT_DARK_THEME.palette);
      const session = makeSession({ name: "agent-work", sessionColor: "2" });
      render(<SessionRow {...rowProps(session)} sessionColor="2" rowTints={rowTints} onSpawnAgent={noop} />);
      const rail = screen.getByTestId("status-rail");
      expect(rail.style.width).toBe("56px");
      expect(rail.className).toContain("bg-bg-inset");
      expect(rail.className).toContain("border-l");
      expect(rail.className).toContain("touch-none");
      // Per-tier band tint: the session's family tint mixed into the inset
      // base (the shared color-mix idiom — never a new token).
      expect(rail.style.backgroundColor).toContain("color-mix(in srgb, var(--color-bg-inset) 55%");
      // The 16px glyph slot is ALWAYS an empty span on this tier; the 12px
      // chevron is muted ~55% aria-hidden decoration.
      const chevron = Array.from(rail.querySelectorAll("span")).find((s) => s.textContent === "›")!;
      expect(chevron.className).toContain("w-3");
      expect(chevron.className).toContain("opacity-55");
      const glyphSlot = chevron.previousElementSibling as HTMLElement;
      expect(glyphSlot.className).toContain("w-4");
      expect(glyphSlot.children).toHaveLength(0);
      // The row root carries the shared scrub hit-test handle.
      expect(screen.getByRole("treeitem")).toHaveAttribute("data-rail-row");
      // Render-gated, not CSS-hidden: no cluster buttons exist on coarse.
      expect(screen.queryByLabelText("Set color for agent-work")).toBeNull();
      expect(screen.queryByLabelText("Spawn agent in agent-work")).toBeNull();
      expect(screen.queryByLabelText("New window in agent-work")).toBeNull();
      expect(screen.queryByLabelText("Kill session agent-work")).toBeNull();
    });

    it("renders no rail and the unchanged cluster on fine pointers", () => {
      stubMatchMedia((q) => q === "(prefers-color-scheme: dark)");
      const session = makeSession({ name: "agent-work" });
      render(<SessionRow {...rowProps(session)} />);
      expect(screen.queryByTestId("status-rail")).toBeNull();
      expect(screen.getByLabelText("Set color for agent-work")).toBeInTheDocument();
      expect(screen.getByLabelText("New window in agent-work")).toBeInTheDocument();
      expect(screen.getByLabelText("Kill session agent-work")).toBeInTheDocument();
    });

    it("rail tap opens the session card — title, facts line, action rows in order, actions route", () => {
      const onSpawnAgent = vi.fn();
      const onCreateWindow = vi.fn();
      const onKillClick = vi.fn();
      const session = makeSession({
        name: "agent-work",
        sessionId: "$4",
        sessionPath: "/home/sahil/code/run-kit",
        windows: [makeWindow({}), makeWindow({ windowId: "@2" })],
      });
      render(
        <SessionRow
          {...rowProps(session)}
          onSpawnAgent={onSpawnAgent}
          onCreateWindow={onCreateWindow}
          onKillClick={onKillClick}
        />,
      );
      tapRail();
      const card = screen.getByTestId("row-flyout-card");
      expect(screen.getByTestId("popup-title-bar")).toHaveTextContent("Session agent-work");
      // The identity tip's facts line verbatim (omission-degrading).
      expect(card).toHaveTextContent("$4 · 2 windows · ~/code/run-kit");
      // Fixed order: Change color… → Spawn agent… → New window → Kill session.
      const color = screen.getByTestId("row-flyout-color-action");
      const spawn = screen.getByTestId("row-flyout-spawn-action");
      const create = screen.getByTestId("row-flyout-create-action");
      const kill = screen.getByTestId("row-flyout-kill-action");
      expect(color).toHaveTextContent("Change color…");
      expect(spawn).toHaveTextContent("Spawn agent…");
      expect(create).toHaveTextContent("New window");
      expect(kill).toHaveTextContent("Kill session");
      expect(kill).toHaveTextContent("confirms first");
      expect(kill.className).toContain("hover:text-signal-red");
      expect(color.compareDocumentPosition(spawn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(spawn.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(create.compareDocumentPosition(kill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      act(() => { fireEvent.click(spawn); });
      expect(onSpawnAgent).toHaveBeenCalledWith("srv", "agent-work");
      act(() => { fireEvent.click(create); });
      expect(onCreateWindow).toHaveBeenCalledWith("srv", "agent-work");
      act(() => { fireEvent.click(kill); });
      // The existing kill-dialog path — never a force-kill on touch.
      expect(onKillClick).toHaveBeenCalledWith("srv", "agent-work", 2, false);
    });

    it("omits the Spawn agent… row when no onSpawnAgent is wired (the board-route sidebar)", () => {
      render(<SessionRow {...rowProps(makeSession({ name: "agent-work" }))} />);
      tapRail();
      expect(screen.queryByTestId("row-flyout-spawn-action")).toBeNull();
      expect(screen.getByTestId("row-flyout-color-action")).toBeInTheDocument();
      expect(screen.getByTestId("row-flyout-create-action")).toBeInTheDocument();
      expect(screen.getByTestId("row-flyout-kill-action")).toBeInTheDocument();
    });

    it("Change color… closes the card and opens the color popover; the open popover inhibits re-opening", () => {
      render(
        <ThemeProvider>
          <SessionRow {...rowProps(makeSession({ name: "agent-work" }))} />
        </ThemeProvider>,
      );
      tapRail();
      act(() => { fireEvent.click(screen.getByTestId("row-flyout-color-action")); });
      expect(screen.queryByTestId("row-flyout-card")).toBeNull();
      expect(screen.getByRole("listbox", { name: "Color picker" })).toBeInTheDocument();
      // Popover-over-card precedence: the suppressed gate holds while the
      // popover is open — a rail tap flashes nothing.
      tapRail();
      expect(screen.queryByTestId("row-flyout-card")).toBeNull();
    });

    it("lightens the rail only while the card is open (held treatment travels with the card)", () => {
      render(<SessionRow {...rowProps(makeSession({ name: "agent-work" }))} />);
      const rail = screen.getByTestId("status-rail");
      expect(rail.style.backgroundColor).toBe("");
      tapRail();
      expect(rail.style.backgroundColor).toContain("color-mix(in srgb, var(--color-bg-inset) 40%");
      expect(rail.style.borderColor).toBe("var(--color-text-secondary)");
      act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
      });
      expect(screen.queryByTestId("row-flyout-card")).toBeNull();
      expect(rail.style.backgroundColor).toBe("");
    });

    it("ghost sessions get no rail and no card", () => {
      const ghost = { ...makeSession({ name: "ghosty" }), optimistic: true };
      render(<SessionRow {...rowProps(ghost)} />);
      expect(screen.queryByTestId("status-rail")).toBeNull();
      expect(screen.getByRole("treeitem")).not.toHaveAttribute("data-rail-row");
    });
  });
});
