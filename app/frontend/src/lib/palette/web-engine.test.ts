import { describe, it, expect, vi } from "vitest";
import { WEB_NATIVE_ENGINE_ACTION_ID, buildWebEngineActions } from "./web-engine";

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
