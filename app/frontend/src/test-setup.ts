import "@testing-library/jest-dom/vitest";

// Only install a stub when the environment does not already provide a
// ResizeObserver (jsdom/polyfills may supply one in the future). Use
// defineProperty so the assignment works even if a future environment
// exposes a non-writable accessor.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub as unknown as typeof ResizeObserver,
    writable: true,
    configurable: true,
  });
}
