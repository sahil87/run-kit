import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyComposeEnter,
  composeSubmitKeycap,
  type ComposeKeyInput,
} from "./compose-keys";

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

// 260801-hsxm policy: Enter (and Shift+Enter) are the textarea default
// (newline) on every pointer type; Cmd/Ctrl+Enter is the ONLY submit chord;
// Alt+Enter inserts without submitting. The classifier has no pointer
// parameter — the fine/coarse distinction ended with the flip.
describe("classifyComposeEnter", () => {
  it("plain Enter is the textarea default (newline) — never submits", () => {
    expect(classifyComposeEnter(key())).toBe("default");
  });

  it("Cmd/Ctrl+Enter is the only submit chord", () => {
    expect(classifyComposeEnter(key({ metaKey: true }))).toBe("submit");
    expect(classifyComposeEnter(key({ ctrlKey: true }))).toBe("submit");
  });

  it("Alt+Enter inserts without submitting", () => {
    expect(classifyComposeEnter(key({ altKey: true }))).toBe("insert");
  });

  it("Shift+Enter stays the default (newline — kept for muscle memory, redundant with plain Enter)", () => {
    expect(classifyComposeEnter(key({ shiftKey: true }))).toBe("default");
  });

  it("modifier precedence: meta/ctrl beats alt beats shift", () => {
    // Cmd+Shift+Enter reads as the strongest intent — submit.
    expect(classifyComposeEnter(key({ metaKey: true, shiftKey: true }))).toBe("submit");
    expect(classifyComposeEnter(key({ ctrlKey: true, altKey: true }))).toBe("submit");
    // Alt+Shift+Enter inserts (alt outranks shift).
    expect(classifyComposeEnter(key({ altKey: true, shiftKey: true }))).toBe("insert");
  });

  it("an IME-composing Enter is never intercepted, regardless of modifiers", () => {
    expect(classifyComposeEnter(key({ isComposing: true }))).toBe("default");
    expect(classifyComposeEnter(key({ isComposing: true, metaKey: true }))).toBe("default");
    expect(classifyComposeEnter(key({ isComposing: true, ctrlKey: true }))).toBe("default");
    expect(classifyComposeEnter(key({ isComposing: true, altKey: true }))).toBe("default");
  });

  it("non-Enter keys are always the default, even with modifiers", () => {
    expect(classifyComposeEnter(key({ key: "a" }))).toBe("default");
    expect(classifyComposeEnter(key({ key: "Escape", metaKey: true }))).toBe("default");
    expect(classifyComposeEnter(key({ key: "Tab", altKey: true }))).toBe("default");
  });
});

describe("composeSubmitKeycap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("formats the submit chord for the mac keycap platform", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "test" });
    expect(composeSubmitKeycap()).toBe("⌘Enter");
  });

  it("formats the submit chord for non-mac platforms (jsdom default included)", () => {
    // jsdom's UA contains neither mac nor iOS markers → "other".
    expect(composeSubmitKeycap()).toBe("Ctrl+Enter");
  });
});
