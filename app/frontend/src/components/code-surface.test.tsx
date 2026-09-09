import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { CodeSurface, codeServerSrc, codeServerWorkspaceSrc } from "./code-surface";

afterEach(cleanup);

describe("codeServerSrc", () => {
  it("builds the stable relative /code/?folder=<root> URL (260811-a2bo)", () => {
    expect(codeServerSrc("/home/user/repo")).toBe(
      "/code/?folder=%2Fhome%2Fuser%2Frepo",
    );
  });

  it("never composes an absolute origin and never carries the port", () => {
    expect(codeServerSrc("/repo").startsWith("/code/")).toBe(true);
    expect(codeServerSrc("/repo")).not.toMatch(/^https?:/);
    expect(codeServerSrc("/repo")).not.toMatch(/\d{2,5}/);
  });
});

describe("codeServerWorkspaceSrc", () => {
  it("builds the stable relative /code/?workspace=<path> URL", () => {
    const path = "/home/u/.local/state/run-kit/code/default/@7-3fa1c9.code-workspace";
    expect(codeServerWorkspaceSrc(path)).toBe(`/code/?workspace=${encodeURIComponent(path)}`);
  });

  it("never composes an absolute origin and never carries a port", () => {
    // The path itself carries digits (@7, the hash), so the port check is
    // structural: no scheme, no `//` authority, and the pathname is exactly
    // /code/ — a port could only live in an authority component.
    const src = codeServerWorkspaceSrc("/state/code/default/@7-3fa1c9.code-workspace");
    expect(src.startsWith("/code/")).toBe(true);
    expect(src).not.toMatch(/^https?:/);
    expect(src).not.toContain("//");
    expect(src.split("?")[0]).toBe("/code/");
  });

  it("differs per workspace path", () => {
    expect(codeServerWorkspaceSrc("/state/@7-aaaaaa.code-workspace")).not.toBe(
      codeServerWorkspaceSrc("/state/@7-bbbbbb.code-workspace"),
    );
  });
});

describe("CodeSurface", () => {
  it("renders the iframe at the workspace src when reachable and resolved", () => {
    const { getByTitle } = render(
      <CodeSurface gitRoot="/repo" workspaceSrc={codeServerSrc("/repo")} reachable={true} />,
    );
    const iframe = getByTitle("Code editor");
    // jsdom resolves the relative src against the document base — assert the
    // path+query shape, which is what the component controls.
    expect(iframe.getAttribute("src")).toBe("/code/?folder=%2Frepo");
  });

  it("carries allow-downloads in the sandbox (VS Code file downloads)", () => {
    const { getByTitle } = render(
      <CodeSurface gitRoot="/repo" workspaceSrc={codeServerSrc("/repo")} reachable={true} />,
    );
    expect(getByTitle("Code editor").getAttribute("sandbox")).toContain("allow-downloads");
  });

  it("renders the not-running empty state (no iframe) when unreachable", () => {
    const { getByTestId, queryByTitle } = render(
      <CodeSurface gitRoot="/repo" workspaceSrc={codeServerSrc("/repo")} reachable={false} />,
    );
    expect(getByTestId("code-surface-empty")).toHaveTextContent(
      "code-server not running — check rk doctor",
    );
    expect(queryByTitle("Code editor")).toBeNull();
  });

  it("renders the pending state (no iframe) while the workspace src is unresolved", () => {
    const { getByTestId, queryByTitle } = render(
      <CodeSurface gitRoot="/repo" workspaceSrc={null} reachable={true} />,
    );
    expect(getByTestId("code-surface-pending")).toHaveTextContent("opening…");
    expect(queryByTitle("Code editor")).toBeNull();
  });

  it("keeps precedence: unreachable renders the empty state, never pending", () => {
    const { getByTestId, queryByTestId } = render(
      <CodeSurface gitRoot="/repo" workspaceSrc={null} reachable={false} />,
    );
    expect(getByTestId("code-surface-empty")).toBeTruthy();
    expect(queryByTestId("code-surface-pending")).toBeNull();
  });

  it("mounts the iframe once the workspace src resolves (pending → resolved)", () => {
    const wsSrc = codeServerWorkspaceSrc("/state/code/default/@7-3fa1c9.code-workspace");
    const { rerender, getByTestId, getByTitle, queryByTestId } = render(
      <CodeSurface gitRoot="/repo" workspaceSrc={null} reachable={true} />,
    );
    expect(getByTestId("code-surface-pending")).toBeTruthy();
    rerender(<CodeSurface gitRoot="/repo" workspaceSrc={wsSrc} reachable={true} />);
    expect(queryByTestId("code-surface-pending")).toBeNull();
    expect(getByTitle("Code editor").getAttribute("src")).toBe(wsSrc);
  });

  // Latched folder (260813-if5d R3): the `src` is per iframe MOUNT GENERATION.
  // A src change on a LIVE frame must not touch the attribute — re-setting
  // `src` re-navigates the frame and takes the editor state with it (P3).
  it("never changes a mounted iframe's src when the workspace src prop changes", () => {
    const { rerender, getByTitle } = render(
      <CodeSurface gitRoot="/repo" workspaceSrc={codeServerSrc("/repo")} reachable={true} />,
    );
    const iframe = getByTitle("Code editor");
    expect(iframe.getAttribute("src")).toBe("/code/?folder=%2Frepo");
    rerender(
      <CodeSurface
        gitRoot="/other"
        workspaceSrc={codeServerWorkspaceSrc("/state/@7-bbbbbb.code-workspace")}
        reachable={true}
      />,
    );
    expect(getByTitle("Code editor").getAttribute("src")).toBe("/code/?folder=%2Frepo");
  });

  it("picks up the current src when the iframe genuinely remounts (reachability flip)", () => {
    const { rerender, getByTitle } = render(
      <CodeSurface gitRoot="/repo" workspaceSrc={codeServerSrc("/repo")} reachable={true} />,
    );
    const otherSrc = codeServerWorkspaceSrc("/state/@7-bbbbbb.code-workspace");
    rerender(<CodeSurface gitRoot="/other" workspaceSrc={otherSrc} reachable={false} />);
    rerender(<CodeSurface gitRoot="/other" workspaceSrc={otherSrc} reachable={true} />);
    // A fresh workbench boots at where the editor last was, not the seed.
    expect(getByTitle("Code editor").getAttribute("src")).toBe(otherSrc);
  });

  // The follow rule's re-navigation gate: a fresh follow nonce lands the frame
  // on the re-derived workspace URL (the editor already navigated itself);
  // anything else — a repeated nonce, an ordinary payload tick — never
  // re-navigates a live frame.
  describe("followSrc (the one sanctioned parent re-navigation)", () => {
    it("a fresh follow nonce re-navigates the live frame to the new workspace URL", () => {
      const first = codeServerWorkspaceSrc("/state/@7-aaaaaa.code-workspace");
      const second = codeServerWorkspaceSrc("/state/@7-bbbbbb.code-workspace");
      const { rerender, getByTitle } = render(
        <CodeSurface gitRoot="/repo" workspaceSrc={first} reachable={true} />,
      );
      expect(getByTitle("Code editor").getAttribute("src")).toBe(first);
      rerender(
        <CodeSurface
          gitRoot="/other"
          workspaceSrc={first}
          followSrc={{ src: second, nonce: 1 }}
          reachable={true}
        />,
      );
      expect(getByTitle("Code editor").getAttribute("src")).toBe(second);
    });

    it("an already-seen nonce never re-navigates the frame again", () => {
      const first = codeServerWorkspaceSrc("/state/@7-aaaaaa.code-workspace");
      const second = codeServerWorkspaceSrc("/state/@7-bbbbbb.code-workspace");
      const { rerender, getByTitle } = render(
        <CodeSurface gitRoot="/repo" workspaceSrc={first} reachable={true} />,
      );
      rerender(
        <CodeSurface
          gitRoot="/other"
          workspaceSrc={first}
          followSrc={{ src: second, nonce: 1 }}
          reachable={true}
        />,
      );
      expect(getByTitle("Code editor").getAttribute("src")).toBe(second);
      // The follow prop lingers across ordinary payload ticks — its nonce is
      // spent, so the frame stays put even as the mount src prop moves on.
      rerender(
        <CodeSurface
          gitRoot="/other"
          workspaceSrc={second}
          followSrc={{ src: second, nonce: 1 }}
          reachable={true}
        />,
      );
      expect(getByTitle("Code editor").getAttribute("src")).toBe(second);
    });
  });

  // Follow rule (if5d R3): the load seam reports where the EDITOR navigated
  // itself (File > Open Folder → /code/?folder=<new>), which the parent latches.
  describe("onFolderNavigated (follow-the-editor seam)", () => {
    /** Stub the frame's location — jsdom never navigates an iframe, so the
     *  post-navigation state is injected. `configurable` lets each test replace
     *  it (contentWindow is a prototype getter). */
    const stubFrameSearch = (el: HTMLElement, search: string) => {
      Object.defineProperty(el, "contentWindow", {
        configurable: true,
        value: { location: { search } },
      });
    };
    const WS_SRC = codeServerWorkspaceSrc("/state/@7-3fa1c9.code-workspace");

    it("reports a different folder from the frame's ?folder= on load (decoded)", () => {
      const onFolderNavigated = vi.fn();
      const { getByTitle } = render(
        <CodeSurface gitRoot="/repo" workspaceSrc={WS_SRC} reachable={true} onFolderNavigated={onFolderNavigated} />,
      );
      const iframe = getByTitle("Code editor");
      stubFrameSearch(iframe, "?folder=%2Fhome%2Fuser%2Fother");
      fireEvent.load(iframe);
      expect(onFolderNavigated).toHaveBeenCalledWith("/home/user/other");
    });

    it("stays silent when the frame is already at the current folder", () => {
      const onFolderNavigated = vi.fn();
      const { getByTitle } = render(
        <CodeSurface gitRoot="/repo" workspaceSrc={WS_SRC} reachable={true} onFolderNavigated={onFolderNavigated} />,
      );
      const iframe = getByTitle("Code editor");
      stubFrameSearch(iframe, "?folder=%2Frepo");
      fireEvent.load(iframe);
      expect(onFolderNavigated).not.toHaveBeenCalled();
    });

    it("stays silent when the frame carries no folder param", () => {
      const onFolderNavigated = vi.fn();
      const { getByTitle } = render(
        <CodeSurface gitRoot="/repo" workspaceSrc={WS_SRC} reachable={true} onFolderNavigated={onFolderNavigated} />,
      );
      const iframe = getByTitle("Code editor");
      stubFrameSearch(iframe, "?other=1");
      fireEvent.load(iframe);
      expect(onFolderNavigated).not.toHaveBeenCalled();
    });

    it("stays silent for a frame at ?workspace= (no folder param to follow)", () => {
      const onFolderNavigated = vi.fn();
      const { getByTitle } = render(
        <CodeSurface gitRoot="/repo" workspaceSrc={WS_SRC} reachable={true} onFolderNavigated={onFolderNavigated} />,
      );
      const iframe = getByTitle("Code editor");
      stubFrameSearch(iframe, "?workspace=%2Fstate%2F%407-3fa1c9.code-workspace");
      fireEvent.load(iframe);
      expect(onFolderNavigated).not.toHaveBeenCalled();
    });

    it("skips a cross-origin frame silently (no throw, no report)", () => {
      const onFolderNavigated = vi.fn();
      const { getByTitle } = render(
        <CodeSurface gitRoot="/repo" workspaceSrc={WS_SRC} reachable={true} onFolderNavigated={onFolderNavigated} />,
      );
      const iframe = getByTitle("Code editor");
      Object.defineProperty(iframe, "contentWindow", {
        configurable: true,
        get() {
          throw new Error("SecurityError: cross-origin");
        },
      });
      expect(() => fireEvent.load(iframe)).not.toThrow();
      expect(onFolderNavigated).not.toHaveBeenCalled();
    });

    it("does not re-navigate the mounted frame after reporting a new folder", () => {
      // The parent latches the reported folder and re-renders with it; the
      // attribute must stay put (P3 — that is the whole hazard this guards).
      const onFolderNavigated = vi.fn();
      const { rerender, getByTitle } = render(
        <CodeSurface gitRoot="/repo" workspaceSrc={WS_SRC} reachable={true} onFolderNavigated={onFolderNavigated} />,
      );
      const iframe = getByTitle("Code editor");
      stubFrameSearch(iframe, "?folder=%2Fother");
      fireEvent.load(iframe);
      rerender(
        <CodeSurface gitRoot="/other" workspaceSrc={WS_SRC} reachable={true} onFolderNavigated={onFolderNavigated} />,
      );
      expect(getByTitle("Code editor").getAttribute("src")).toBe(WS_SRC);
      // …and the frame's own location is now the baseline: no repeat report.
      onFolderNavigated.mockClear();
      fireEvent.load(getByTitle("Code editor"));
      expect(onFolderNavigated).not.toHaveBeenCalled();
    });
  });

  // Chord-reclaim effect coverage (review rework): the listener must attach
  // when the iframe mounts AND re-attach after a reachability flip remounts
  // it — the []-deps version silently lost reclaim on false→true.
  it("reclaims matching chords from inside the iframe, across a reachability flip", () => {
    const iframeDoc = (el: HTMLElement): Document => {
      if (!(el instanceof HTMLIFrameElement)) throw new Error("expected an iframe");
      return el.contentDocument!;
    };
    const parentSpy = vi.fn();
    document.addEventListener("keydown", parentSpy);
    const reclaimAll = () => true;
    const WS_SRC = codeServerWorkspaceSrc("/state/@7-3fa1c9.code-workspace");

    const { rerender, getByTitle, unmount } = render(
      <CodeSurface gitRoot="/repo" workspaceSrc={WS_SRC} reachable={true} shouldReclaimChord={reclaimAll} />,
    );
    const doc1 = iframeDoc(getByTitle("Code editor"));
    doc1.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true }));
    expect(parentSpy).toHaveBeenCalledTimes(1);

    // Flip down (iframe unmounts) then back up (fresh iframe) — the effect is
    // keyed on `reachable` and `src`, so the NEW iframe's document gets the
    // listener.
    rerender(<CodeSurface gitRoot="/repo" workspaceSrc={WS_SRC} reachable={false} shouldReclaimChord={reclaimAll} />);
    rerender(<CodeSurface gitRoot="/repo" workspaceSrc={WS_SRC} reachable={true} shouldReclaimChord={reclaimAll} />);
    const doc2 = iframeDoc(getByTitle("Code editor"));
    doc2.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true }));
    expect(parentSpy).toHaveBeenCalledTimes(2);

    // Cleanup removes the listener: after unmount, a dispatch on the stale
    // document must not reach the parent.
    unmount();
    doc2.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true }));
    expect(parentSpy).toHaveBeenCalledTimes(2);
    document.removeEventListener("keydown", parentSpy);
  });
});
