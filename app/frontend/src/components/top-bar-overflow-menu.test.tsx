import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { TopBarOverflowMenu } from "./top-bar-overflow-menu";
import { ToastProvider } from "@/components/toast";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import type { SessionContextType, UpdateAvailable, UpdateTool } from "@/contexts/session-context";
import { checkForUpdates } from "@/api/client";
import type { UpdateCheckResult } from "@/api/client";

// Partial-mock the API client: only checkForUpdates is intercepted (the check
// affordance's single network seam); everything else keeps its real shape.
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, checkForUpdates: vi.fn() };
});
const checkForUpdatesMock = vi.mocked(checkForUpdates);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Builds an UpdateAvailable payload from matched tools, deriving the composite
// key (sorted tool@latest) and the legacy current/latest from the run-kit row
// (same helper shape as update-chip.test.tsx).
function updateAvailable(tools: UpdateTool[]): UpdateAvailable {
  const key = tools
    .map((t) => `${t.tool}@${t.latest}`)
    .sort()
    .join(",");
  const rk = tools.find((t) => t.tool === "run-kit");
  return { tools, key, current: rk?.current ?? "", latest: rk?.latest ?? "" };
}

const emptyResult: UpdateCheckResult = { tools: [], key: "", source: "released" };

function renderMenu(
  sessionValue: Partial<SessionContextType>,
  { updateOverflowed = false }: { updateOverflowed?: boolean } = {},
) {
  return render(
    <ToastProvider>
      <StandaloneSessionContextProvider value={sessionValue}>
        <TopBarOverflowMenu rows={[]} updateOverflowed={updateOverflowed} />
      </StandaloneSessionContextProvider>
    </ToastProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByLabelText("More controls"));
  return screen.getByRole("menu", { name: "More controls" });
}

describe("version-row check affordance (260720-ml7k)", () => {
  it("renders the ⟳ 'Check for updates' button on the resting version row", () => {
    renderMenu({ daemonVersion: "0.6.2", updateAvailable: null });
    const menu = openMenu();
    expect(within(menu).getByText("RunKit v0.6.2")).toBeInTheDocument();
    const check = within(menu).getByLabelText("Check for updates");
    expect(check).toBeInTheDocument();
    // Hover hint is a styled Tip now (260722-73al) — no native title.
    expect(check).not.toHaveAttribute("title");
    // A plain control, not a terminal menu action: no menuitem role, so a click
    // must not close the menu (the spinner state stays visible).
    expect(check).not.toHaveAttribute("role");
  });

  it("renders the affordance before any version event (null daemonVersion counts as non-dev)", () => {
    renderMenu({ daemonVersion: null, updateAvailable: null });
    const menu = openMenu();
    expect(within(menu).getByText("RunKit")).toBeInTheDocument();
    expect(within(menu).getByLabelText("Check for updates")).toBeInTheDocument();
  });

  it("hides the affordance on the dev sentinel — a dev daemon never checks", () => {
    renderMenu({ daemonVersion: "dev", updateAvailable: null });
    const menu = openMenu();
    expect(within(menu).getByText("RunKit dev")).toBeInTheDocument();
    expect(within(menu).queryByLabelText("Check for updates")).not.toBeInTheDocument();
  });

  it("click runs the plain notable check and reports via the existing info toast; the menu stays open", async () => {
    checkForUpdatesMock.mockResolvedValue(emptyResult);
    renderMenu({ daemonVersion: "0.6.2", updateAvailable: null });
    const menu = openMenu();
    fireEvent.click(within(menu).getByLabelText("Check for updates"));
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
    // Result reports through the existing composeCheckToast flow.
    expect(await screen.findByText("All tools up to date")).toBeInTheDocument();
    // The ⟳ is not a role="menuitem", so the container's terminal-action close
    // handler must not have fired.
    expect(screen.getByRole("menu", { name: "More controls" })).toBeInTheDocument();
  });

  it("surfaces a failed check as an error toast and re-enables the affordance", async () => {
    checkForUpdatesMock.mockRejectedValue(new Error("shll not found on PATH"));
    renderMenu({ daemonVersion: "0.6.2", updateAvailable: null });
    const menu = openMenu();
    fireEvent.click(within(menu).getByLabelText("Check for updates"));
    expect(await screen.findByText("shll not found on PATH")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(menu).getByLabelText("Check for updates")).toBeEnabled(),
    );
  });

  it("is single-flight: repeat clicks while in flight are no-ops, and it re-arms after settle", async () => {
    let resolveCheck!: (r: UpdateCheckResult) => void;
    checkForUpdatesMock.mockImplementation(
      () =>
        new Promise<UpdateCheckResult>((res) => {
          resolveCheck = res;
        }),
    );
    renderMenu({ daemonVersion: "0.6.2", updateAvailable: null });
    const menu = openMenu();
    const check = within(menu).getByLabelText("Check for updates");
    // Same-tick double-click: the ref guard must swallow the second call before
    // the state flush.
    fireEvent.click(check);
    fireEvent.click(check);
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
    // In-flight form: disabled (the spinner replaces the glyph).
    await waitFor(() => expect(within(menu).getByLabelText("Check for updates")).toBeDisabled());
    fireEvent.click(within(menu).getByLabelText("Check for updates"));
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
    // Settle → rest form returns and a new check is possible.
    resolveCheck(emptyResult);
    await waitFor(() => expect(within(menu).getByLabelText("Check for updates")).toBeEnabled());
    fireEvent.click(within(menu).getByLabelText("Check for updates"));
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(2);
  });

  it("yields to the update surface when the chip is overflowed (no ⟳)", () => {
    renderMenu(
      {
        daemonVersion: "0.5.3",
        updateAvailable: updateAvailable([{ tool: "run-kit", current: "0.5.3", latest: "0.6.0" }]),
      },
      { updateOverflowed: true },
    );
    expect(screen.getByTestId("overflow-attention")).toBeInTheDocument();
    const menu = openMenu();
    expect(within(menu).getByText("RunKit v0.5.3 → v0.6.0 ⬆")).toBeInTheDocument();
    expect(within(menu).queryByLabelText("Check for updates")).not.toBeInTheDocument();
  });

  it("shows the update surface — not the ⟳ — for a DISMISSED pending update, with no chevron badge", () => {
    const verdict = updateAvailable([{ tool: "run-kit", current: "0.5.3", latest: "0.6.0" }]);
    renderMenu(
      {
        daemonVersion: "0.5.3",
        updateAvailable: verdict,
        // Dismissed for the current composite key → showChip false, chip gone
        // from the bar; the menu row is the stronger pending-update affordance.
        updateDismissedKey: verdict.key,
      },
      { updateOverflowed: false },
    );
    // Dismissal silences ambient chrome: no attention badge.
    expect(screen.queryByTestId("overflow-attention")).not.toBeInTheDocument();
    const menu = openMenu();
    expect(within(menu).getByText("RunKit v0.5.3 → v0.6.0 ⬆")).toBeInTheDocument();
    expect(within(menu).queryByLabelText("Check for updates")).not.toBeInTheDocument();
  });

  it("keeps the plain copy row + ⟳ when a pending update's chip is IN-BAR (not overflowed, not dismissed)", () => {
    renderMenu(
      {
        daemonVersion: "0.5.3",
        updateAvailable: updateAvailable([{ tool: "run-kit", current: "0.5.3", latest: "0.6.0" }]),
      },
      { updateOverflowed: false },
    );
    expect(screen.queryByTestId("overflow-attention")).not.toBeInTheDocument();
    const menu = openMenu();
    expect(within(menu).getByText("RunKit v0.5.3")).toBeInTheDocument();
    expect(within(menu).queryByText(/⬆/)).not.toBeInTheDocument();
    expect(within(menu).getByLabelText("Check for updates")).toBeInTheDocument();
  });
});
