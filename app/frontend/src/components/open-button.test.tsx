import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OpenButton, OpenMenuRows } from "./open-button";
import { ToastProvider } from "./toast";
import { openInApp } from "@/api/client";
import { LAST_USED_OPEN_TARGET_KEY, type OpenTarget } from "@/lib/open-in-app";

vi.mock("@/api/client", () => ({
  openInApp: vi.fn().mockResolvedValue({ ok: true }),
}));

const deeplinkTarget: OpenTarget = {
  kind: "deeplink",
  id: "deeplink:vscode",
  label: "VS Code",
  url: "vscode://vscode-remote/ssh-remote+devbox/Users/x/proj",
};
const hostTarget: OpenTarget = {
  kind: "host",
  id: "host:iterm",
  label: "iTerm",
  appId: "iterm",
};

function renderButton(targets: OpenTarget[]) {
  return render(
    <ToastProvider>
      <OpenButton targets={targets} server="runkit" path="/Users/x/proj" />
    </ToastProvider>,
  );
}

/** Stub window.location.href assignment (jsdom navigation is unimplemented). */
function stubLocation(): { get href(): string } {
  const state = { href: "" };
  const original = window.location;
  Object.defineProperty(window, "location", {
    value: {
      ...original,
      get href() {
        return state.href;
      },
      set href(v: string) {
        state.href = v;
      },
    },
    writable: true,
    configurable: true,
  });
  return state;
}

describe("OpenButton", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(openInApp).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing with zero targets", () => {
    const { container } = renderButton([]);
    expect(container.querySelector("button")).toBeNull();
  });

  it("primary click opens the menu when no last-used preference is stored", () => {
    renderButton([deeplinkTarget, hostTarget]);
    fireEvent.click(screen.getByRole("button", { name: "Open in app" }));
    expect(screen.getByRole("menu", { name: "Open in app" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "VS Code" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "iTerm" })).toBeInTheDocument();
  });

  it("chevron always opens the menu", () => {
    localStorage.setItem(LAST_USED_OPEN_TARGET_KEY, "host:iterm");
    renderButton([deeplinkTarget, hostTarget]);
    fireEvent.click(screen.getByRole("button", { name: "Open in… (choose app)" }));
    expect(screen.getByRole("menu", { name: "Open in app" })).toBeInTheDocument();
  });

  it("primary click re-runs a stored last-used host target without opening the menu", () => {
    localStorage.setItem(LAST_USED_OPEN_TARGET_KEY, "host:iterm");
    renderButton([deeplinkTarget, hostTarget]);
    fireEvent.click(screen.getByRole("button", { name: "Open in iTerm" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(openInApp).toHaveBeenCalledWith("runkit", "/Users/x/proj", "iterm");
  });

  it("primary click falls back to the menu when the stored target is stale", () => {
    localStorage.setItem(LAST_USED_OPEN_TARGET_KEY, "deeplink:windsurf");
    renderButton([deeplinkTarget, hostTarget]);
    fireEvent.click(screen.getByRole("button", { name: "Open in app" }));
    expect(screen.getByRole("menu", { name: "Open in app" })).toBeInTheDocument();
    expect(openInApp).not.toHaveBeenCalled();
  });

  it("a deeplink menu item navigates via location.href and persists last-used", () => {
    const loc = stubLocation();
    renderButton([deeplinkTarget, hostTarget]);
    fireEvent.click(screen.getByRole("button", { name: "Open in… (choose app)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "VS Code" }));
    expect(loc.href).toBe("vscode://vscode-remote/ssh-remote+devbox/Users/x/proj");
    expect(localStorage.getItem(LAST_USED_OPEN_TARGET_KEY)).toBe("deeplink:vscode");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a host menu item POSTs and persists last-used", () => {
    renderButton([deeplinkTarget, hostTarget]);
    fireEvent.click(screen.getByRole("button", { name: "Open in… (choose app)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "iTerm" }));
    expect(openInApp).toHaveBeenCalledWith("runkit", "/Users/x/proj", "iterm");
    expect(localStorage.getItem(LAST_USED_OPEN_TARGET_KEY)).toBe("host:iterm");
  });

  it("labels the host section when the menu carries both kinds", () => {
    renderButton([deeplinkTarget, hostTarget]);
    fireEvent.click(screen.getByRole("button", { name: "Open in… (choose app)" }));
    expect(screen.getByText("on host")).toBeInTheDocument();
  });

  it("omits the host section header for a single-kind (local) list", () => {
    renderButton([hostTarget]);
    fireEvent.click(screen.getByRole("button", { name: "Open in app" }));
    expect(screen.queryByText("on host")).toBeNull();
  });

  it("shows an error toast when the host launch fails", async () => {
    vi.mocked(openInApp).mockRejectedValueOnce(new Error("unknown app"));
    renderButton([hostTarget]);
    fireEvent.click(screen.getByRole("button", { name: "Open in app" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "iTerm" }));
    expect(await screen.findByText("unknown app")).toBeInTheDocument();
  });
});

describe("OpenMenuRows", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(openInApp).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  function renderRows(targets: OpenTarget[]) {
    return render(
      <ToastProvider>
        <div role="menu" aria-label="More controls">
          <OpenMenuRows targets={targets} server="runkit" path="/Users/x/proj" />
        </div>
      </ToastProvider>,
    );
  }

  it("renders one Open: row per target, suffixing host rows when both kinds present", () => {
    renderRows([deeplinkTarget, hostTarget]);
    expect(screen.getByRole("menuitem", { name: "Open: VS Code" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Open: iTerm (on host)" }),
    ).toBeInTheDocument();
  });

  it("drops the suffix for a single-kind list", () => {
    renderRows([hostTarget]);
    expect(screen.getByRole("menuitem", { name: "Open: iTerm" })).toBeInTheDocument();
  });

  it("renders nothing with zero targets", () => {
    const { container } = renderRows([]);
    expect(container.querySelector("[role=menuitem]")).toBeNull();
  });

  it("a row click runs the target", () => {
    renderRows([hostTarget]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open: iTerm" }));
    expect(openInApp).toHaveBeenCalledWith("runkit", "/Users/x/proj", "iterm");
  });
});
