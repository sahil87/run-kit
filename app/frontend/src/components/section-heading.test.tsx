import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { SectionHeading } from "./section-heading";

describe("SectionHeading", () => {
  afterEach(cleanup);

  it("renders the label as a level-2 heading whose accessible name is the label only", () => {
    render(<SectionHeading label="Sessions" />);
    // Brackets, caret, and rule are decorative (aria-hidden), so the <h2>
    // accessible name is just the label text.
    expect(
      screen.getByRole("heading", { level: 2, name: "Sessions" }),
    ).toBeInTheDocument();
  });

  it("keeps brackets, caret, and rule decorative (aria-hidden) — heading name is clean", () => {
    const { container } = render(<SectionHeading label="Host Health" />);
    // The specific decorative elements — the `[`/`]` brackets, the reserved
    // `▊` caret cell, and the trailing rule — must each be aria-hidden so the
    // <h2> accessible name is the label only. (Asserting the specific elements
    // rather than counting all aria-hidden nodes keeps this robust to future
    // decorative additions elsewhere, e.g. inside TypedLabel.)
    const decorative = [
      ".rk-bracket-open",
      ".rk-bracket-caret",
      ".rk-bracket-close",
      ".flex-1.border-t",
    ];
    for (const selector of decorative) {
      const el = container.querySelector(selector);
      expect(el, selector).not.toBeNull();
      expect(el!.getAttribute("aria-hidden")).toBe("true");
    }
    expect(
      screen.getByRole("heading", { level: 2, name: "Host Health" }),
    ).toBeInTheDocument();
  });

  it("carries the TypedLabel typed-sweep inside the brackets", () => {
    const { container } = render(<SectionHeading label="Boards" />);
    // The label renders via TypedLabel (rk-typed-label), and it sits inside the
    // bracket group that scopes the brackets+caret hover treatment.
    const group = container.querySelector(".rk-bracket-group");
    expect(group).not.toBeNull();
    const typed = group!.querySelector(".rk-typed-label");
    expect(typed).not.toBeNull();
    expect(typed!.textContent).toBe("Boards");
  });

  it("renders right-aligned side text after the rule when provided", () => {
    render(<SectionHeading label="Sessions" side="3 sessions, 9 windows" />);
    expect(screen.getByText("3 sessions, 9 windows")).toBeInTheDocument();
    // Side text is not part of the heading's accessible name.
    expect(
      screen.getByRole("heading", { level: 2, name: "Sessions" }),
    ).toBeInTheDocument();
  });

  it("omits the side slot when no side is provided", () => {
    const { container } = render(<SectionHeading label="Services" />);
    // No trailing side span — only the rule follows the bracket group.
    // The rule is aria-hidden; the label heading is the only non-hidden text.
    expect(
      screen.getByRole("heading", { level: 2, name: "Services" }),
    ).toBeInTheDocument();
    // Exactly one flex-1 rule element, and nothing after it.
    const rule = container.querySelector(".flex-1.border-t");
    expect(rule).not.toBeNull();
    expect(rule!.nextElementSibling).toBeNull();
  });
});
