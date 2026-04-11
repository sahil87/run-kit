import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CollapsiblePanel } from "./collapsible-panel";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CollapsiblePanel", () => {
  it("renders title in header", () => {
    render(
      <CollapsiblePanel title="Test" storageKey="test-panel">
        <span>Content</span>
      </CollapsiblePanel>,
    );
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("shows content when defaultOpen is true", () => {
    render(
      <CollapsiblePanel title="Test" storageKey="test-panel" defaultOpen={true}>
        <span>Visible Content</span>
      </CollapsiblePanel>,
    );
    expect(screen.getByText("Visible Content")).toBeInTheDocument();
  });

  it("hides content when defaultOpen is false", () => {
    render(
      <CollapsiblePanel title="Test" storageKey="test-panel" defaultOpen={false}>
        <span>Hidden Content</span>
      </CollapsiblePanel>,
    );
    // Content element exists in DOM but panel is collapsed (max-height: 0px)
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles content on header click", () => {
    render(
      <CollapsiblePanel title="Test" storageKey="test-panel" defaultOpen={true}>
        <span>Content</span>
      </CollapsiblePanel>,
    );

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("persists collapsed state to localStorage", () => {
    render(
      <CollapsiblePanel title="Test" storageKey="test-persist" defaultOpen={true}>
        <span>Content</span>
      </CollapsiblePanel>,
    );

    const button = screen.getByRole("button");
    fireEvent.click(button); // collapse

    expect(localStorage.getItem("test-persist")).toBe("false");

    fireEvent.click(button); // expand
    expect(localStorage.getItem("test-persist")).toBe("true");
  });

  it("reads initial state from localStorage", () => {
    localStorage.setItem("test-restore", "false");

    render(
      <CollapsiblePanel title="Test" storageKey="test-restore" defaultOpen={true}>
        <span>Content</span>
      </CollapsiblePanel>,
    );

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("falls back to defaultOpen when localStorage is empty", () => {
    render(
      <CollapsiblePanel title="Test" storageKey="nonexistent" defaultOpen={false}>
        <span>Content</span>
      </CollapsiblePanel>,
    );

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("header is always visible regardless of collapse state", () => {
    render(
      <CollapsiblePanel title="Always Visible" storageKey="test-header" defaultOpen={false}>
        <span>Content</span>
      </CollapsiblePanel>,
    );

    expect(screen.getByText("Always Visible")).toBeInTheDocument();
  });
});
