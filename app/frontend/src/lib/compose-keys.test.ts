import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyComposeEnter,
  composeSubmitKeycap,
  type ComposeKeyInput,
  type ComposeSurface,
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

const SURFACES: ComposeSurface[] = ["strip", "broadcast"];

// 260802-lj98 policy: the classifier is surface-parameterized and the surfaces
// DELIBERATELY diverge on plain Enter — insert-line on the strip (transmit
// text + "\n"), the textarea default (newline) in broadcast. Everything else is
// shared: Shift+Enter = local newline, shift-less Cmd/Ctrl+Enter = the ONLY
// submit chord (exact on Shift — ⇧⌘⏎/⇧Ctrl+⏎ falls through for the global
// zen-toggle chord), Alt+Enter = byte-exact insert, IME-composing Enter never
// intercepted.
describe("classifyComposeEnter", () => {
  it("plain Enter diverges per surface: insert-line on the strip, default (newline) in broadcast", () => {
    expect(classifyComposeEnter(key(), "strip")).toBe("insert-line");
    expect(classifyComposeEnter(key(), "broadcast")).toBe("default");
  });

  it("Cmd/Ctrl+Enter is the only submit chord on BOTH surfaces", () => {
    for (const surface of SURFACES) {
      expect(classifyComposeEnter(key({ metaKey: true }), surface)).toBe("submit");
      expect(classifyComposeEnter(key({ ctrlKey: true }), surface)).toBe("submit");
    }
  });

  it("Alt+Enter inserts without submitting (byte-exact raw) on BOTH surfaces", () => {
    for (const surface of SURFACES) {
      expect(classifyComposeEnter(key({ altKey: true }), surface)).toBe("insert");
    }
  });

  it("Shift+Enter stays the default (local newline) on BOTH surfaces — the strip's only local multi-line compose", () => {
    for (const surface of SURFACES) {
      expect(classifyComposeEnter(key({ shiftKey: true }), surface)).toBe("default");
    }
  });

  it("shift-carrying meta/ctrl+Enter is exact-modifier fall-through (default) — bubbles to the zen chord, on BOTH surfaces", () => {
    for (const surface of SURFACES) {
      expect(classifyComposeEnter(key({ metaKey: true, shiftKey: true }), surface)).toBe("default");
      expect(classifyComposeEnter(key({ ctrlKey: true, shiftKey: true }), surface)).toBe("default");
      // The shift guard wins over alt inside the meta/ctrl branch.
      expect(
        classifyComposeEnter(key({ metaKey: true, shiftKey: true, altKey: true }), surface),
      ).toBe("default");
    }
  });

  it("modifier precedence: shift-less meta/ctrl beats alt; alt outranks shift, on BOTH surfaces", () => {
    for (const surface of SURFACES) {
      expect(classifyComposeEnter(key({ ctrlKey: true, altKey: true }), surface)).toBe("submit");
      // Alt+Shift+Enter inserts (alt outranks shift when no meta/ctrl is held).
      expect(classifyComposeEnter(key({ altKey: true, shiftKey: true }), surface)).toBe("insert");
    }
  });

  it("an IME-composing Enter is never intercepted, regardless of modifiers or surface", () => {
    for (const surface of SURFACES) {
      expect(classifyComposeEnter(key({ isComposing: true }), surface)).toBe("default");
      expect(classifyComposeEnter(key({ isComposing: true, metaKey: true }), surface)).toBe("default");
      expect(classifyComposeEnter(key({ isComposing: true, ctrlKey: true }), surface)).toBe("default");
      expect(classifyComposeEnter(key({ isComposing: true, altKey: true }), surface)).toBe("default");
    }
  });

  it("non-Enter keys are always the default, even with modifiers, on BOTH surfaces", () => {
    for (const surface of SURFACES) {
      expect(classifyComposeEnter(key({ key: "a" }), surface)).toBe("default");
      expect(classifyComposeEnter(key({ key: "Escape", metaKey: true }), surface)).toBe("default");
      expect(classifyComposeEnter(key({ key: "Tab", altKey: true }), surface)).toBe("default");
    }
  });
});

describe("classifyComposeEnter (quake surface)", () => {
  it("plain Enter submits — the docked compose has no pane to stage a line into", () => {
    expect(classifyComposeEnter(key(), "quake")).toBe("submit");
  });

  it("Shift+Enter is insert-line — the call site inserts the local newline", () => {
    expect(classifyComposeEnter(key({ shiftKey: true }), "quake")).toBe("insert-line");
  });

  it("Alt+Enter is insert-line — no visible pane for the byte-exact insert, so it joins Shift+Enter as the local newline", () => {
    expect(classifyComposeEnter(key({ altKey: true }), "quake")).toBe("insert-line");
  });

  it("shares the rest of the matrix: Cmd/Ctrl+Enter submits, IME-composing Enter is never intercepted", () => {
    expect(classifyComposeEnter(key({ metaKey: true }), "quake")).toBe("submit");
    expect(classifyComposeEnter(key({ ctrlKey: true }), "quake")).toBe("submit");
    expect(classifyComposeEnter(key({ metaKey: true, shiftKey: true }), "quake")).toBe("default");
    expect(classifyComposeEnter(key({ isComposing: true }), "quake")).toBe("default");
    expect(classifyComposeEnter(key({ key: "a" }), "quake")).toBe("default");
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
