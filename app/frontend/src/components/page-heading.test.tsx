import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PageHeading } from "./page-heading";

describe("PageHeading", () => {
  afterEach(cleanup);

  it("renders a standalone page word as a primary level-1 heading", () => {
    render(<PageHeading page="cockpit" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "cockpit" }),
    ).toBeInTheDocument();
  });

  it("renders page word + instance name in one heading, name verbatim", () => {
    render(<PageHeading page="server cabin" name="testServer" />);
    // Accessible name excludes the aria-hidden `·` separator and brackets.
    expect(
      screen.getByRole("heading", { level: 1, name: "server cabin testServer" }),
    ).toBeInTheDocument();
    // No case transform on the instance name.
    expect(screen.getByText("testServer")).toBeInTheDocument();
    expect(screen.queryByText("TESTSERVER")).not.toBeInTheDocument();
  });

  it("de-emphasizes the page word only when an instance name follows", () => {
    render(<PageHeading page="server cabin" name="testServer" />);
    expect(screen.getByText("server cabin")).toHaveClass("text-text-secondary");
    expect(screen.getByText("testServer")).toHaveClass("text-text-primary");
    cleanup();
    render(<PageHeading page="cockpit" />);
    expect(screen.getByText("cockpit")).toHaveClass("text-text-primary");
  });

  it("renders right-aligned side-text after the rule when provided", () => {
    render(
      <PageHeading page="server cabin" name="s1" side="3 sessions, 9 windows" />,
    );
    expect(screen.getByText("3 sessions, 9 windows")).toBeInTheDocument();
  });

  it("keeps brackets, separator, caret, and rule decorative — heading name is clean", () => {
    const { container } = render(
      <PageHeading page="server cabin" name="testServer" />,
    );
    // `[` + reserved `▊` caret cell + `]` + `·` + trailing rule.
    // The reserved caret cell (260703-5ilm brackets+caret vocabulary) is
    // aria-hidden and transparent at rest, so it does not appear in the
    // accessible heading name.
    const decorations = container.querySelectorAll("span[aria-hidden='true']");
    expect(decorations.length).toBe(5);
    expect(
      screen.getByRole("heading", { level: 1, name: "server cabin testServer" }),
    ).toBeInTheDocument();
  });
});
