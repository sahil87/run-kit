import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { TopBar } from "./top-bar";
import { ChromeProvider } from "@/contexts/chrome-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/components/toast";
import {
  StandaloneSessionContextProvider,
  shouldReloadOnVersion,
} from "@/contexts/session-context";
import type { SessionContextType } from "@/contexts/session-context";

// Silence the push lib so NotificationControl doesn't touch real serviceWorker.
// getPushState returns a Promise (the hook calls .then), and "unsupported"
// makes NotificationControl render nothing — keeping the DOM focused on the chip.
vi.mock("@/lib/push", () => ({
  getPushState: vi.fn().mockResolvedValue("unsupported"),
  enablePushSubscription: vi.fn().mockResolvedValue("subscribed"),
  sendTestNotification: vi.fn().mockResolvedValue(true),
}));

beforeEach(() => {
  // ThemeProvider reads matchMedia; jsdom doesn't provide it.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderChip(sessionValue: Partial<SessionContextType>) {
  return render(
    <ToastProvider>
      <ThemeProvider>
        <ChromeProvider>
          <StandaloneSessionContextProvider value={sessionValue}>
            <TopBar
              mode="root"
              sessions={[]}
              currentSession={null}
              currentWindow={null}
              sessionName=""
              windowName=""
              isConnected={true}
              sidebarOpen={false}
              server="runkit"
              onNavigate={vi.fn()}
              onToggleSidebar={vi.fn()}
              onCreateSession={vi.fn()}
              onCreateWindow={vi.fn()}
            />
          </StandaloneSessionContextProvider>
        </ChromeProvider>
      </ThemeProvider>
    </ToastProvider>,
  );
}

describe("UpdateChip", () => {
  it("renders `⬆ v{latest}` and the v{current} → v{latest} transition title when a qualifying update is pending", () => {
    renderChip({
      daemonVersion: "0.5.3",
      updateAvailable: { current: "0.5.3", latest: "0.6.0" },
    });
    // The rest-state title/aria show the transition (both versions), not only
    // the target (260715-ifco R9).
    const chip = screen.getByLabelText("Update run-kit: v0.5.3 → v0.6.0");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("title", "Update run-kit: v0.5.3 → v0.6.0");
    // The visible chip label is unchanged — still `⬆ v{latest}`.
    expect(screen.getByText("⬆ v0.6.0")).toBeInTheDocument();
  });

  it("falls back to target-only wording when current is null", () => {
    // `current` null (shouldn't happen once the chip qualifies, but degrade
    // gracefully) → the pre-ifco `Update run-kit to v{latest}` wording.
    renderChip({
      daemonVersion: "0.5.3",
      updateAvailable: { current: null as unknown as string, latest: "0.6.0" },
    });
    expect(screen.getByLabelText("Update run-kit to v0.6.0")).toBeInTheDocument();
  });

  it("hides when no update is available", () => {
    renderChip({ daemonVersion: "0.5.3", updateAvailable: null });
    expect(screen.queryByText(/⬆ v/)).not.toBeInTheDocument();
  });

  it("hides when the daemon reports the dev version", () => {
    renderChip({
      daemonVersion: "dev",
      updateAvailable: { current: "dev", latest: "0.6.0" },
    });
    expect(screen.queryByText(/⬆ v/)).not.toBeInTheDocument();
  });

  it("hides when dismissed for the current latest", () => {
    renderChip({
      daemonVersion: "0.5.3",
      updateAvailable: { current: "0.5.3", latest: "0.6.0" },
      updateDismissedVersion: "0.6.0",
    });
    expect(screen.queryByText(/⬆ v/)).not.toBeInTheDocument();
  });

  it("re-shows for a newer latest even after an older dismissal", () => {
    renderChip({
      daemonVersion: "0.5.3",
      updateAvailable: { current: "0.5.3", latest: "0.7.0" },
      updateDismissedVersion: "0.6.0",
    });
    expect(screen.getByText("⬆ v0.7.0")).toBeInTheDocument();
  });

  it("leaves no empty flex item in the top bar when hidden (gap regression)", () => {
    // Self-hiding controls must carry their own responsive gating: an
    // always-rendered call-site wrapper stays in the gap-3 flex row as an
    // empty item while the child renders null, doubling the gap between
    // its neighbors.
    const { container } = renderChip({ daemonVersion: "0.5.3", updateAvailable: null });
    const emptyHidden = Array.from(container.querySelectorAll(".hidden")).filter(
      (el) => el.childNodes.length === 0,
    );
    expect(emptyHidden).toHaveLength(0);
  });

  it("carries the responsive `hidden sm:flex` gating on its own root", () => {
    renderChip({
      daemonVersion: "0.5.3",
      updateAvailable: { current: "0.5.3", latest: "0.6.0" },
    });
    const root = screen.getByLabelText("Update run-kit: v0.5.3 → v0.6.0").parentElement;
    expect(root).toHaveClass("hidden", "sm:flex");
  });

  it("clicking the chip triggers updateNow and enters updating…", async () => {
    let resolveUpdate!: () => void;
    const updateNow = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveUpdate = res;
        }),
    );
    renderChip({
      daemonVersion: "0.5.3",
      updateAvailable: { current: "0.5.3", latest: "0.6.0" },
      updateNow,
    });
    fireEvent.click(screen.getByLabelText("Update run-kit: v0.5.3 → v0.6.0"));
    expect(updateNow).toHaveBeenCalledTimes(1);
    // The chip flips to its disabled "Updating run-kit" state (accessible label);
    // the ✕ dismiss button is hidden while updating.
    await waitFor(() => expect(screen.getByLabelText("Updating run-kit")).toBeDisabled());
    // The VISIBLE busy label must be exactly "updating…" (real ellipsis, U+2026) —
    // guards against a JS escape sequence leaking into JSX text as literal chars.
    expect(screen.getByText("updating…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Dismiss update notice")).not.toBeInTheDocument();
    resolveUpdate();
  });

  it("re-enables and toasts on update failure", async () => {
    const updateNow = vi.fn(() => Promise.reject(new Error("not brew-installed")));
    renderChip({
      daemonVersion: "0.5.3",
      updateAvailable: { current: "0.5.3", latest: "0.6.0" },
      updateNow,
    });
    fireEvent.click(screen.getByLabelText("Update run-kit: v0.5.3 → v0.6.0"));
    // After the rejection settles, the chip is back to its rest label.
    await waitFor(() =>
      expect(screen.getByLabelText("Update run-kit: v0.5.3 → v0.6.0")).toBeInTheDocument(),
    );
    expect(screen.getByText("not brew-installed")).toBeInTheDocument();
  });

  it("clicking ✕ calls dismissUpdate", () => {
    const dismissUpdate = vi.fn();
    renderChip({
      daemonVersion: "0.5.3",
      updateAvailable: { current: "0.5.3", latest: "0.6.0" },
      dismissUpdate,
    });
    fireEvent.click(screen.getByLabelText("Dismiss update notice"));
    expect(dismissUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("shouldReloadOnVersion (reload guard)", () => {
  it("never reloads on the first version seen", () => {
    expect(shouldReloadOnVersion(null, null, "0.5.3", "b1")).toBe(false);
  });

  it("does not reload when version and boot are unchanged", () => {
    expect(shouldReloadOnVersion("0.5.3", "b1", "0.5.3", "b1")).toBe(false);
  });

  it("reloads when a later version differs from the first-seen one", () => {
    expect(shouldReloadOnVersion("0.5.3", "b1", "0.6.0", "b1")).toBe(true);
  });
});
