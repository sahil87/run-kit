import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FindBar } from "@/components/find-bar";
import { stubMatchMedia } from "@/test-utils/match-media";

/**
 * Unit tests for the shared `FindBar` presentational component. The web and
 * tty consumers' mechanism depth is covered by their own suites; these tests
 * pin the component contract: counter rendering, keyboard/click navigation
 * wiring, autofocus, the disabled + statusText state, toggles, the scope
 * note, and coarse-pointer hint suppression.
 */

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function renderBar(overrides: Partial<Parameters<typeof FindBar>[0]> = {}) {
  const props = {
    query: "x",
    matchIndex: 2,
    matchCount: 7,
    onQueryChange: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<FindBar {...props} />);
  return props;
}

describe("FindBar — counter and rendering", () => {
  it("renders the counter as matchIndex+1/matchCount with the ordinal in accent green", () => {
    renderBar();
    const counter = screen.getByLabelText("Match count");
    expect(counter.textContent).toBe("3/7");
    const ordinal = counter.querySelector(".text-accent-green");
    expect(ordinal?.textContent).toBe("3");
  });

  it("renders 0/0 when nothing matches", () => {
    renderBar({ matchIndex: 0, matchCount: 0 });
    expect(screen.getByLabelText("Match count").textContent).toBe("0/0");
  });

  it("autofocuses the input on mount", () => {
    renderBar();
    expect(document.activeElement).toBe(screen.getByLabelText("Find query"));
  });

  it("reports query edits through onQueryChange", () => {
    const props = renderBar({ query: "" });
    fireEvent.change(screen.getByLabelText("Find query"), { target: { value: "abc" } });
    expect(props.onQueryChange).toHaveBeenCalledWith("abc");
  });
});

describe("FindBar — navigation", () => {
  it("Enter invokes onNext; ⇧Enter invokes onPrev; Escape invokes onClose", () => {
    const props = renderBar();
    const input = screen.getByLabelText("Find query");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it("the ∧/∨/✕ buttons invoke onPrev/onNext/onClose", () => {
    const props = renderBar();
    fireEvent.click(screen.getByLabelText("Previous match"));
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(props.onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Close find bar"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("FindBar — optional slots", () => {
  it("statusText replaces the counter; disabled greys input and navigation but not ✕", () => {
    renderBar({ statusText: "page is cross-origin — find unavailable", disabled: true });
    expect(screen.getByText("page is cross-origin — find unavailable")).toBeTruthy();
    expect(screen.queryByLabelText("Match count")).toBeNull();
    expect((screen.getByLabelText("Find query") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Next match") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Previous match") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Close find bar") as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders consumer toggles between the navigation buttons and ✕", () => {
    renderBar({ toggles: <button aria-label="Toggle case sensitivity">Aa</button> });
    const next = screen.getByLabelText("Next match");
    const toggle = screen.getByLabelText("Toggle case sensitivity");
    const close = screen.getByLabelText("Close find bar");
    expect(
      next.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      toggle.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("appends the scope note to the hint area when provided", () => {
    renderBar({ scopeNote: "client buffer only (since attach)" });
    expect(screen.getByLabelText("Search scope").textContent).toBe(
      "client buffer only (since attach)",
    );
  });
});

describe("FindBar — key hint", () => {
  it("shows the key hint on fine pointers and suppresses it on coarse pointers", () => {
    stubMatchMedia(() => false);
    const { unmount } = render(
      <FindBar
        query=""
        matchIndex={0}
        matchCount={0}
        onQueryChange={() => {}}
        onNext={() => {}}
        onPrev={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Enter next · ⇧Enter prev · Esc close")).toBeTruthy();
    unmount();

    stubMatchMedia((query) => ["(pointer: coarse)", "(any-pointer: coarse)"].includes(query));
    render(
      <FindBar
        query=""
        matchIndex={0}
        matchCount={0}
        onQueryChange={() => {}}
        onNext={() => {}}
        onPrev={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("Enter next · ⇧Enter prev · Esc close")).toBeNull();
  });

  it("keeps the scope note visible on coarse pointers (it is not a key hint)", () => {
    stubMatchMedia((query) => ["(pointer: coarse)", "(any-pointer: coarse)"].includes(query));
    renderBar({ scopeNote: "client buffer only (since attach)" });
    expect(screen.getByLabelText("Search scope")).toBeTruthy();
    expect(screen.queryByText("Enter next · ⇧Enter prev · Esc close")).toBeNull();
  });
});
