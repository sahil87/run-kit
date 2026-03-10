import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";
import type { BreadcrumbDropdownItem } from "@/contexts/chrome-context";

const items: BreadcrumbDropdownItem[] = [
  { label: "project-a", href: "/p/project-a", current: true },
  { label: "project-b", href: "/p/project-b" },
  { label: "project-c", href: "/p/project-c" },
];

function clickChevron() {
  fireEvent.click(screen.getByRole("button", { name: /switch/i }));
}

describe("BreadcrumbDropdown", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a chevron button", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    expect(screen.getByRole("button", { name: /switch/i })).toBeInTheDocument();
  });

  it("renders icon as button content", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    expect(screen.getByRole("button", { name: /switch/i }).textContent).toBe("⬡");
  });

  it("falls back to ▾ when icon is omitted", () => {
    render(<BreadcrumbDropdown items={items} />);
    expect(screen.getByRole("button", { name: /switch/i }).textContent).toBe("▾");
  });

  it("dropdown is hidden by default", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens dropdown on chevron click", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("closes dropdown on second chevron click", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    clickChevron();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes dropdown on Escape", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes dropdown on outside click", () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <BreadcrumbDropdown items={items} icon="⬡" />
      </div>,
    );
    clickChevron();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("highlights current item with accent color", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    const currentItem = screen.getByText("project-a");
    expect(currentItem.className).toContain("text-accent");
  });

  it("non-current items have secondary color", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    const otherItem = screen.getByText("project-b");
    expect(otherItem.className).toContain("text-text-secondary");
  });

  it("renders correct hrefs on menu items", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    const links = screen.getAllByRole("menuitem");
    expect(links[0]).toHaveAttribute("href", "/p/project-a");
    expect(links[1]).toHaveAttribute("href", "/p/project-b");
    expect(links[2]).toHaveAttribute("href", "/p/project-c");
  });

  it("auto-focuses current item on open", async () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    const currentItem = screen.getAllByRole("menuitem")[0];
    await waitFor(() => expect(document.activeElement).toBe(currentItem));
  });

  it("navigates items with ArrowDown", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    const secondItem = screen.getAllByRole("menuitem")[1];
    expect(document.activeElement).toBe(secondItem);

    fireEvent.keyDown(document, { key: "ArrowDown" });
    const thirdItem = screen.getAllByRole("menuitem")[2];
    expect(document.activeElement).toBe(thirdItem);
  });

  it("navigates items with ArrowUp", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    const firstItem = screen.getAllByRole("menuitem")[0];
    expect(document.activeElement).toBe(firstItem);
  });

  it("ArrowDown wraps from last to first", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    const firstItem = screen.getAllByRole("menuitem")[0];
    expect(document.activeElement).toBe(firstItem);
  });

  it("ArrowUp wraps from first to last", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    const lastItem = screen.getAllByRole("menuitem")[2];
    expect(document.activeElement).toBe(lastItem);
  });

  it("uses contextual aria-label when label prop provided", () => {
    render(<BreadcrumbDropdown items={items} label="project" icon="⬡" />);
    expect(screen.getByRole("button", { name: "Switch project" })).toBeInTheDocument();
  });

  it("uses generic aria-label when no label prop", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    expect(screen.getByRole("button", { name: "Switch" })).toBeInTheDocument();
  });

  it("sets aria-expanded correctly", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    const button = screen.getByRole("button", { name: /switch/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    clickChevron();
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("closes dropdown when item is clicked", () => {
    render(<BreadcrumbDropdown items={items} icon="⬡" />);
    clickChevron();
    fireEvent.click(screen.getByText("project-b"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("handles single item list", () => {
    const singleItem = [{ label: "only-project", href: "/p/only-project", current: true }];
    render(<BreadcrumbDropdown items={singleItem} icon="⬡" />);
    clickChevron();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.getByText("only-project").className).toContain("text-accent");
  });
});
