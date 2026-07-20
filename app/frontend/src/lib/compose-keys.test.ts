import { describe, it, expect } from "vitest";
import { classifyComposeEnter, type ComposeKeyInput } from "./compose-keys";

function key(overrides: Partial<ComposeKeyInput> = {}): ComposeKeyInput {
  return {
    key: "Enter",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    ...overrides,
  };
}

describe("classifyComposeEnter", () => {
  it("plain Enter submits on a fine pointer and defaults (newline) on coarse", () => {
    expect(classifyComposeEnter(key(), false)).toBe("submit");
    expect(classifyComposeEnter(key(), true)).toBe("default");
  });

  it("Cmd/Ctrl+Enter submits on every pointer type (universal escape hatch)", () => {
    for (const coarse of [false, true]) {
      expect(classifyComposeEnter(key({ metaKey: true }), coarse)).toBe("submit");
      expect(classifyComposeEnter(key({ ctrlKey: true }), coarse)).toBe("submit");
    }
  });

  it("Alt+Enter inserts without submitting on every pointer type", () => {
    expect(classifyComposeEnter(key({ altKey: true }), false)).toBe("insert");
    expect(classifyComposeEnter(key({ altKey: true }), true)).toBe("insert");
  });

  it("Shift+Enter is always the textarea default (newline)", () => {
    expect(classifyComposeEnter(key({ shiftKey: true }), false)).toBe("default");
    expect(classifyComposeEnter(key({ shiftKey: true }), true)).toBe("default");
  });

  it("modifier precedence: meta/ctrl beats alt beats shift", () => {
    // Cmd+Shift+Enter reads as the strongest intent — submit.
    expect(classifyComposeEnter(key({ metaKey: true, shiftKey: true }), false)).toBe("submit");
    expect(classifyComposeEnter(key({ ctrlKey: true, altKey: true }), true)).toBe("submit");
    // Alt+Shift+Enter inserts (alt outranks shift).
    expect(classifyComposeEnter(key({ altKey: true, shiftKey: true }), false)).toBe("insert");
  });

  it("an IME-composing Enter is never intercepted, regardless of modifiers/pointer", () => {
    for (const coarse of [false, true]) {
      expect(classifyComposeEnter(key({ isComposing: true }), coarse)).toBe("default");
      expect(classifyComposeEnter(key({ isComposing: true, metaKey: true }), coarse)).toBe("default");
      expect(classifyComposeEnter(key({ isComposing: true, altKey: true }), coarse)).toBe("default");
    }
  });

  it("non-Enter keys are always the default, even with modifiers", () => {
    expect(classifyComposeEnter(key({ key: "a" }), false)).toBe("default");
    expect(classifyComposeEnter(key({ key: "Escape", metaKey: true }), false)).toBe("default");
    expect(classifyComposeEnter(key({ key: "Tab", altKey: true }), true)).toBe("default");
  });
});
