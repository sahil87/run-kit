import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Router mock: capture navigate + drive useActiveBoardName off a fixed pathname.
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/board/review" } }),
}));

// useBoards seam: the real hook needs the SessionContext SSE pool; mock at the
// hook boundary. useBoardListReorder (the drag hook under test for wiring) stays
// REAL — it only touches @/api/boards on drag, which we don't trigger here.
let mockBoards: { name: string; pinCount: number }[] = [];
vi.mock("@/hooks/use-boards", () => ({
  useBoards: () => ({ boards: mockBoards, isLoading: false, error: null }),
}));

// Toast seam: BoardsSection wires useToast().addToast into useBoardListReorder as
// the reorder-POST onError handler. Mock at the hook boundary (mirrors the
// Host host-overview-page test) so no ToastProvider tree is needed here.
const addToastMock = vi.fn();
vi.mock("@/components/toast", () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

import { BoardsSection } from "./boards-section";

afterEach(() => {
  cleanup();
  mockBoards = [];
  mockNavigate.mockClear();
  localStorage.clear();
});

describe("BoardsSection — reorder wiring", () => {
  it("renders board rows as draggable buttons (useBoardListReorder wiring)", () => {
    mockBoards = [
      { name: "deploys", pinCount: 2 },
      { name: "review", pinCount: 1 },
    ];
    render(<BoardsSection />);

    const deploys = screen.getByText("deploys").closest("button");
    expect(deploys).not.toBeNull();
    expect(deploys).toHaveAttribute("draggable", "true");
    const review = screen.getByText("review").closest("button");
    expect(review).toHaveAttribute("draggable", "true");
  });

  it("marks the active board's row with aria-current=page", () => {
    mockBoards = [
      { name: "deploys", pinCount: 2 },
      { name: "review", pinCount: 1 },
    ];
    render(<BoardsSection />);
    // Router pathname mock → /board/review, so "review" is active.
    const review = screen.getByText("review").closest("button");
    expect(review).toHaveAttribute("aria-current", "page");
    const deploys = screen.getByText("deploys").closest("button");
    expect(deploys).not.toHaveAttribute("aria-current");
  });

  it("shows the pin-to-start hint (no draggable rows) when no boards exist", () => {
    render(<BoardsSection />);
    expect(screen.getByText("Pin a window to start a board")).toBeInTheDocument();
  });
});

describe("BoardsSection — default-open + header PinIcon", () => {
  it("defaults open when boards exist (no stored preference)", () => {
    mockBoards = [{ name: "deploys", pinCount: 2 }];
    render(<BoardsSection />);
    // The CollapsiblePanel toggle exposes aria-expanded; boards present → open.
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("defaults closed when no boards exist (no stored preference)", () => {
    render(<BoardsSection />);
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  it("respects a stored collapse preference over the board-count default", () => {
    // User explicitly collapsed → stored 'false' wins even with boards present.
    localStorage.setItem("runkit-panel-boards", "false");
    mockBoards = [{ name: "deploys", pinCount: 2 }];
    render(<BoardsSection />);
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  it("renders the shared PinIcon in the header with boards present", () => {
    mockBoards = [{ name: "deploys", pinCount: 2 }];
    const { container } = render(<BoardsSection />);
    // PinIcon is a 16-viewBox inline SVG (aria-hidden); assert one is present.
    expect(container.querySelector('svg[viewBox="0 0 16 16"]')).not.toBeNull();
    // Count still rendered alongside the icon.
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders the header PinIcon even in zero-board hint mode", () => {
    const { container } = render(<BoardsSection />);
    expect(container.querySelector('svg[viewBox="0 0 16 16"]')).not.toBeNull();
  });
});
