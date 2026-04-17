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

  describe("resizable", () => {
    it("does not render a drag handle when resizable is false/omitted", () => {
      render(
        <CollapsiblePanel title="Test" storageKey="test-no-resize" defaultOpen={true}>
          <span>Content</span>
        </CollapsiblePanel>,
      );
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    });

    it("does not read or write localStorage height when resizable is false", () => {
      localStorage.setItem("test-no-resize-height", "300");
      render(
        <CollapsiblePanel title="Test" storageKey="test-no-resize" defaultOpen={true}>
          <span>Content</span>
        </CollapsiblePanel>,
      );
      // Height key untouched
      expect(localStorage.getItem("test-no-resize-height")).toBe("300");
    });

    it("renders a drag handle when resizable is true and panel is open", () => {
      render(
        <CollapsiblePanel title="Test" storageKey="test-resize" defaultOpen={true} resizable defaultHeight={140}>
          <span>Content</span>
        </CollapsiblePanel>,
      );
      expect(screen.getByRole("separator", { name: /Resize Test panel/ })).toBeInTheDocument();
    });

    it("hides the drag handle when the panel is collapsed", () => {
      render(
        <CollapsiblePanel title="Test" storageKey="test-resize-collapsed" defaultOpen={false} resizable>
          <span>Content</span>
        </CollapsiblePanel>,
      );
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    });

    it("initializes height from localStorage when a valid persisted value exists", () => {
      localStorage.setItem("test-init-height", "260");
      const { container } = render(
        <CollapsiblePanel title="Test" storageKey="test-init" defaultOpen={true} resizable defaultHeight={140}>
          <span>Content</span>
        </CollapsiblePanel>,
      );
      // The content area (div with transition-[height]) gets the inline height.
      const contentArea = container.querySelector("[class*='transition-[height]']") as HTMLElement;
      expect(contentArea).toBeTruthy();
      expect(contentArea.style.height).toBe("260px");
    });

    it("falls back to defaultHeight when persisted height is not a number", () => {
      localStorage.setItem("test-corrupt-height", "not-a-number");
      const { container } = render(
        <CollapsiblePanel title="Test" storageKey="test-corrupt" defaultOpen={true} resizable defaultHeight={140}>
          <span>Content</span>
        </CollapsiblePanel>,
      );
      const contentArea = container.querySelector("[class*='transition-[height]']") as HTMLElement;
      expect(contentArea.style.height).toBe("140px");
    });

    it("writes the clamped height to localStorage on drag end", () => {
      // jsdom does not compute layout, so we exercise the clamp logic by simulating
      // a pointer drag and asserting the persisted value.
      const { container } = render(
        <CollapsiblePanel
          title="Test"
          storageKey="test-drag"
          defaultOpen={true}
          resizable
          defaultHeight={140}
          minHeight={80}
          maxHeight={400}
        >
          <span>Content</span>
        </CollapsiblePanel>,
      );

      const handle = screen.getByRole("separator") as HTMLElement;
      const contentArea = container.querySelector("[class*='transition-[height]']") as HTMLElement;

      // Stub bounding rect to return a realistic starting height.
      vi.spyOn(contentArea, "getBoundingClientRect").mockReturnValue({
        top: 0, left: 0, right: 0, bottom: 140, width: 240, height: 140,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      fireEvent.pointerDown(handle, { clientY: 300 });
      fireEvent.pointerMove(document, { clientY: 400 }); // +100
      fireEvent.pointerUp(document, { clientY: 400 });

      // 140 + 100 = 240, within [80, 400]
      expect(localStorage.getItem("test-drag-height")).toBe("240");
    });

    it("clamps drag height to minHeight", () => {
      const { container } = render(
        <CollapsiblePanel
          title="Test"
          storageKey="test-min"
          defaultOpen={true}
          resizable
          defaultHeight={140}
          minHeight={80}
          maxHeight={400}
        >
          <span>Content</span>
        </CollapsiblePanel>,
      );

      const handle = screen.getByRole("separator") as HTMLElement;
      const contentArea = container.querySelector("[class*='transition-[height]']") as HTMLElement;
      vi.spyOn(contentArea, "getBoundingClientRect").mockReturnValue({
        top: 0, left: 0, right: 0, bottom: 140, width: 240, height: 140,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      fireEvent.pointerDown(handle, { clientY: 300 });
      fireEvent.pointerMove(document, { clientY: 100 }); // -200 → 140-200 = -60, clamps to 80
      fireEvent.pointerUp(document, { clientY: 100 });

      expect(localStorage.getItem("test-min-height")).toBe("80");
    });

    it("clamps drag height to maxHeight", () => {
      const { container } = render(
        <CollapsiblePanel
          title="Test"
          storageKey="test-max"
          defaultOpen={true}
          resizable
          defaultHeight={140}
          minHeight={80}
          maxHeight={300}
        >
          <span>Content</span>
        </CollapsiblePanel>,
      );

      const handle = screen.getByRole("separator") as HTMLElement;
      const contentArea = container.querySelector("[class*='transition-[height]']") as HTMLElement;
      vi.spyOn(contentArea, "getBoundingClientRect").mockReturnValue({
        top: 0, left: 0, right: 0, bottom: 140, width: 240, height: 140,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect);

      fireEvent.pointerDown(handle, { clientY: 300 });
      fireEvent.pointerMove(document, { clientY: 800 }); // +500 → 640, clamps to 300
      fireEvent.pointerUp(document, { clientY: 800 });

      expect(localStorage.getItem("test-max-height")).toBe("300");
    });

    it("collapse animates to 0 and does not lose the persisted height", () => {
      localStorage.setItem("test-toggle-height", "260");
      const { container } = render(
        <CollapsiblePanel title="Test" storageKey="test-toggle" defaultOpen={true} resizable defaultHeight={140}>
          <span>Content</span>
        </CollapsiblePanel>,
      );

      const button = screen.getByRole("button", { name: /Test/ });
      const contentArea = container.querySelector("[class*='transition-[height]']") as HTMLElement;
      expect(contentArea.style.height).toBe("260px");

      fireEvent.click(button); // collapse
      expect(contentArea.style.height).toBe("0px");
      // Persisted value untouched
      expect(localStorage.getItem("test-toggle-height")).toBe("260");

      fireEvent.click(button); // re-expand
      expect(contentArea.style.height).toBe("260px");
    });
  });
});
