import { describe, it, expect, vi } from "vitest";
import {
  WEB_CAPTURE_ACTION_ID,
  WEB_INSPECT_ACTION_ID,
  WEB_NATIVE_ENGINE_ACTION_ID,
  buildWebCaptureActions,
  buildWebEngineActions,
  buildWebInspectActions,
} from "./web-engine";

// buildWebEngineActions backs the shell-gated `Web: Use embedded browser`
// palette entry wired in app.tsx. Covering the availability gate, both label
// forms, and the toggle wiring proves the action's behavior without mounting
// the shell.

describe("buildWebEngineActions", () => {
  it("yields no entries when the shell offers no web group", () => {
    expect(buildWebEngineActions({ available: false, enabled: true, onToggle: vi.fn() })).toEqual(
      [],
    );
  });

  it("carries the ✓ suffix while the native engine is selected", () => {
    const actions = buildWebEngineActions({ available: true, enabled: true, onToggle: vi.fn() });
    expect(actions.map((a) => [a.id, a.label])).toEqual([
      [WEB_NATIVE_ENGINE_ACTION_ID, "Web: Use embedded browser ✓"],
    ]);
  });

  it("drops the suffix while the iframe engine is selected", () => {
    const actions = buildWebEngineActions({ available: true, enabled: false, onToggle: vi.fn() });
    expect(actions[0].label).toBe("Web: Use embedded browser");
  });

  it("onSelect toggles to the negation", () => {
    const onToggle = vi.fn();
    buildWebEngineActions({ available: true, enabled: true, onToggle })[0].onSelect();
    expect(onToggle).toHaveBeenCalledWith(false);
    buildWebEngineActions({ available: true, enabled: false, onToggle })[0].onSelect();
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe("buildWebInspectActions", () => {
  it("yields no entries unless available (native engine + web content)", () => {
    expect(buildWebInspectActions({ available: false, onSelect: vi.fn() })).toEqual([]);
  });

  it("yields the Web: Inspect page entry whose onSelect is the dispatch", () => {
    const onSelect = vi.fn();
    const actions = buildWebInspectActions({ available: true, onSelect });
    expect(actions.map((a) => [a.id, a.label])).toEqual([
      [WEB_INSPECT_ACTION_ID, "Web: Inspect page"],
    ]);
    actions[0].onSelect();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("buildWebCaptureActions", () => {
  it("yields no entries unless available (web tile open with content, fine pointer)", () => {
    expect(
      buildWebCaptureActions({ available: false, captured: false, onToggle: vi.fn() }),
    ).toEqual([]);
  });

  it("is one state-labelled row with its own id and the hand-set chord hint", () => {
    const released = buildWebCaptureActions({
      available: true,
      captured: false,
      shortcut: "⇧⌘G",
      onToggle: vi.fn(),
    });
    expect(released.map((a) => [a.id, a.label, a.shortcut])).toEqual([
      [WEB_CAPTURE_ACTION_ID, "Web: Capture keyboard", "⇧⌘G"],
    ]);
    expect(released[0].description).toBe("hand every chord to the page");
    const latched = buildWebCaptureActions({
      available: true,
      captured: true,
      shortcut: "⇧⌘G",
      onToggle: vi.fn(),
    });
    expect(latched[0].label).toBe("Web: Release keyboard");
  });

  it("carries no shortcut key when the toggle chord is unbound (a dead hint would lie)", () => {
    const actions = buildWebCaptureActions({ available: true, captured: false, onToggle: vi.fn() });
    expect("shortcut" in actions[0]).toBe(false);
  });

  it("onSelect toggles to the negation of the latch", () => {
    const onToggle = vi.fn();
    buildWebCaptureActions({ available: true, captured: false, onToggle })[0].onSelect();
    expect(onToggle).toHaveBeenCalledWith(true);
    buildWebCaptureActions({ available: true, captured: true, onToggle })[0].onSelect();
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("its id never collides with the gui row's registry actionId", () => {
    expect(WEB_CAPTURE_ACTION_ID).not.toBe("gui-capture-toggle");
  });
});
