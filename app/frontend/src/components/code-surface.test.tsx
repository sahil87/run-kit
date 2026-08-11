import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { CodeSurface, codeServerSrc } from "./code-surface";

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

describe("CodeSurface", () => {
  it("renders the iframe at the derived proxy src when reachable", () => {
    const { getByTitle } = render(<CodeSurface gitRoot="/repo" reachable={true} />);
    const iframe = getByTitle("Code editor");
    // jsdom resolves the relative src against the document base — assert the
    // path+query shape, which is what the component controls.
    expect(iframe.getAttribute("src")).toBe("/code/?folder=%2Frepo");
  });

  it("carries allow-downloads in the sandbox (VS Code file downloads)", () => {
    const { getByTitle } = render(<CodeSurface gitRoot="/repo" reachable={true} />);
    expect(getByTitle("Code editor").getAttribute("sandbox")).toContain("allow-downloads");
  });

  it("renders the not-running empty state (no iframe) when unreachable", () => {
    const { getByTestId, queryByTitle } = render(
      <CodeSurface gitRoot="/repo" reachable={false} />,
    );
    expect(getByTestId("code-surface-empty")).toHaveTextContent(
      "code-server not running — check rk doctor",
    );
    expect(queryByTitle("Code editor")).toBeNull();
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

    const { rerender, getByTitle, unmount } = render(
      <CodeSurface gitRoot="/repo" reachable={true} shouldReclaimChord={reclaimAll} />,
    );
    const doc1 = iframeDoc(getByTitle("Code editor"));
    doc1.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true }));
    expect(parentSpy).toHaveBeenCalledTimes(1);

    // Flip down (iframe unmounts) then back up (fresh iframe) — the effect is
    // keyed on `reachable`, so the NEW iframe's document gets the listener.
    rerender(<CodeSurface gitRoot="/repo" reachable={false} shouldReclaimChord={reclaimAll} />);
    rerender(<CodeSurface gitRoot="/repo" reachable={true} shouldReclaimChord={reclaimAll} />);
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
