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

// jsdom does not implement the FontFaceSet API (document.fonts). The terminal
// init routine awaits document.fonts.load(...) for three weights before
// opening xterm. Stub the bare minimum surface the code path requires: a
// load() that resolves immediately so tests proceed past the await.
if (typeof document !== "undefined" && !(document as unknown as { fonts?: unknown }).fonts) {
  Object.defineProperty(document, "fonts", {
    value: {
      load: () => Promise.resolve([]),
      ready: Promise.resolve(),
    },
    writable: true,
    configurable: true,
  });
}
