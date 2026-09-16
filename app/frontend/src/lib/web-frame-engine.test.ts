import { describe, it, expect, vi, afterEach } from "vitest";
import { redispatchChord } from "./web-frame-engine";

describe("redispatchChord", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches one bubbling keydown on document with the six chord fields copied", () => {
    const received = vi.fn();
    document.addEventListener("keydown", received);
    try {
      redispatchChord({
        key: "k",
        code: "KeyK",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      });
      expect(received).toHaveBeenCalledTimes(1);
      const event = received.mock.calls[0][0] as KeyboardEvent;
      expect(event).toBeInstanceOf(KeyboardEvent);
      expect(event.type).toBe("keydown");
      expect(event.key).toBe("k");
      expect(event.code).toBe("KeyK");
      expect(event.metaKey).toBe(true);
      expect(event.ctrlKey).toBe(false);
      expect(event.shiftKey).toBe(false);
      expect(event.altKey).toBe(false);
      expect(event.bubbles).toBe(true);
    } finally {
      document.removeEventListener("keydown", received);
    }
  });

  it("copies every modifier independently", () => {
    const received = vi.fn();
    document.addEventListener("keydown", received);
    try {
      redispatchChord({
        key: "F",
        code: "KeyF",
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
      });
      const event = received.mock.calls[0][0] as KeyboardEvent;
      expect(event.metaKey).toBe(false);
      expect(event.ctrlKey).toBe(true);
      expect(event.shiftKey).toBe(true);
      expect(event.altKey).toBe(true);
    } finally {
      document.removeEventListener("keydown", received);
    }
  });
});
