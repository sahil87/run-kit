import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SessionTiles } from "./session-tiles";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import { ThemeProvider } from "@/contexts/theme-context";
import type { ProjectSession } from "@/types";

const nowSeconds = Math.floor(Date.now() / 1000);

const sessions: ProjectSession[] = [
  {
    name: "run-kit",
    windows: [
      {
        index: 0,
        windowId: "@0",
        name: "main",
        worktreePath: "~/code/run-kit",
        activity: "active",
        isActiveWindow: true,
        paneCommand: "claude",
        activityTimestamp: nowSeconds - 5,
        fabChange: "260313-txna-rich-sidebar-window-status",
        fabStage: "apply",
      },
    ],
  },
  {
    name: "ao-server",
    windows: [
      {
        index: 0,
        windowId: "@2",
        name: "dev",
        worktreePath: "~/code/ao-server",
        activity: "idle",
        isActiveWindow: true,
        paneCommand: "zsh",
        activityTimestamp: nowSeconds - 3600,
      },
    ],
  },
];

const SERVER = "test-server";

function renderTiles(opts: {
  onNavigate?: () => void;
  onCreateSession?: () => void;
  onCreateWindow?: (s: string) => void;
  setPreviewScope?: (server: string, expanded: string[]) => void;
  previews?: Record<string, string>;
} = {}) {
  const previewsByServer = new Map<string, Record<string, string>>();
  previewsByServer.set(SERVER, opts.previews ?? {});
  // ThemeProvider: the window-tile preview renders ANSI color via AnsiText,
  // which reads the active theme's palette through useTheme().
  return render(
    <ThemeProvider>
      <StandaloneSessionContextProvider
        value={{
          previewsByServer,
          setPreviewScope: opts.setPreviewScope ?? vi.fn(),
        }}
      >
        <SessionTiles
          server={SERVER}
          sessions={sessions}
          onNavigate={opts.onNavigate ?? vi.fn()}
          onCreateSession={opts.onCreateSession ?? vi.fn()}
          onCreateWindow={opts.onCreateWindow ?? vi.fn()}
        />
      </StandaloneSessionContextProvider>
    </ThemeProvider>,
  );
}

describe("SessionTiles", () => {
  beforeEach(() => {
    // ThemeProvider reads prefers-color-scheme on mount.
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
  afterEach(cleanup);

  it("renders one tile per session with the stats line", () => {
    renderTiles();
    expect(screen.getByTestId("session-tile-run-kit")).toBeInTheDocument();
    expect(screen.getByTestId("session-tile-ao-server")).toBeInTheDocument();
    expect(screen.getByText(/2 sessions, 2 windows/)).toBeInTheDocument();
  });

  it("hides window tiles until the session is expanded, then reveals them", () => {
    renderTiles();
    expect(
      screen.queryByTestId("window-tile-run-kit-0"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    expect(screen.getByTestId("window-tile-run-kit-0")).toBeInTheDocument();
  });

  it("shows the pane text preview as static text (no xterm/relay)", () => {
    renderTiles({ previews: { "@0": "line one\nline two\n$ claude" } });
    fireEvent.click(screen.getByLabelText("Expand run-kit"));

    const preview = screen.getByTestId("window-tile-preview-@0");
    expect(preview).toHaveTextContent("line one");
    expect(preview).toHaveTextContent("$ claude");
    // Static text container, not a terminal canvas.
    expect(preview.tagName).toBe("DIV");
    // No xterm instance is mounted anywhere in the tiles view.
    expect(document.querySelector(".xterm")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("renders ANSI color in the preview as styled spans (not raw escapes)", () => {
    // A red word wrapped in SGR codes, as `capture-pane -e` delivers it.
    const RED = "\x1b[31mERROR\x1b[0m ok";
    renderTiles({ previews: { "@0": RED } });
    fireEvent.click(screen.getByLabelText("Expand run-kit"));

    const preview = screen.getByTestId("window-tile-preview-@0");
    // The visible text is the content, with escape bytes stripped.
    expect(preview).toHaveTextContent("ERROR ok");
    expect(preview.textContent).not.toContain("\x1b");
    expect(preview.textContent).not.toContain("[31m");
    // The colored run is a span carrying an inline color (from the palette).
    const colored = Array.from(preview.querySelectorAll("span")).find(
      (s) => s.textContent === "ERROR",
    );
    expect(colored).toBeDefined();
    expect(colored?.style.color).not.toBe("");
  });

  it("navigates to the live terminal when a window tile is clicked", () => {
    const onNavigate = vi.fn();
    renderTiles({ onNavigate });
    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    fireEvent.click(screen.getByTestId("window-tile-run-kit-0"));
    expect(onNavigate).toHaveBeenCalledWith("@0");
  });

  it("declares the expanded session set to the backend on expand and collapse", () => {
    const setPreviewScope = vi.fn();
    renderTiles({ setPreviewScope });

    // Initial mount declares the empty set (nothing expanded).
    expect(setPreviewScope).toHaveBeenLastCalledWith(SERVER, []);

    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    expect(setPreviewScope).toHaveBeenLastCalledWith(SERVER, ["run-kit"]);

    fireEvent.click(screen.getByLabelText("Expand ao-server"));
    expect(setPreviewScope).toHaveBeenLastCalledWith(
      SERVER,
      ["ao-server", "run-kit"],
    );

    fireEvent.click(screen.getByLabelText("Collapse run-kit"));
    expect(setPreviewScope).toHaveBeenLastCalledWith(SERVER, ["ao-server"]);
  });

  it("wires the New Session and New Window actions", () => {
    const onCreateSession = vi.fn();
    const onCreateWindow = vi.fn();
    renderTiles({ onCreateSession, onCreateWindow });

    fireEvent.click(screen.getByText("+ New Session"));
    expect(onCreateSession).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    fireEvent.click(screen.getByText("+ New Window"));
    expect(onCreateWindow).toHaveBeenCalledWith("run-kit");
  });
});
