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
// Cockpit server-list-page test) so no ToastProvider tree is needed here.
const addToastMock = vi.fn();
vi.mock("@/components/toast", () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

import { BoardsSection } from "./boards-section";

afterEach(() => {
  cleanup();
  mockBoards = [];
  mockNavigate.mockClear();
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
