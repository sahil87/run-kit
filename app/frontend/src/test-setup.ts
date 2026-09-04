import "@testing-library/jest-dom/vitest";

// Node >= 25 defines global localStorage/sessionStorage accessors that return
// undefined unless --localstorage-file is passed, and their mere presence makes
// vitest's jsdom environment skip copying jsdom's real Storage onto the global
// (it only copies window keys absent from the Node global) — so every
// localStorage consumer sees undefined. The disabling flag
// (--no-experimental-webstorage) cannot be used: Node 20 (CI) rejects it in
// NODE_OPTIONS/execArgv as an unknown option. Install an in-memory Web Storage
// whenever the global one is missing or unusable; on Node versions where
// vitest copied jsdom's working Storage this is a no-op.
// Items are stored as enumerable OWN properties of the instance (so
// `Object.keys(localStorage)` enumerates keys, as with real Web Storage) while
// the methods live on the prototype (so `vi.spyOn(Storage.prototype, ...)`
// intercepts instance calls). The global `Storage` is re-pointed at this class
// for the same spyOn reason — otherwise tests would patch Node's Storage while
// the instances dispatch through this one.
class MemoryStorage {
  get length(): number {
    return Object.keys(this).length;
  }
  key(index: number): string | null {
    return Object.keys(this)[index] ?? null;
  }
  getItem(key: string): string | null {
    const k = String(key);
    return Object.prototype.hasOwnProperty.call(this, k)
      ? (this as Record<string, unknown>)[k] as string
      : null;
  }
  setItem(key: string, value: string): void {
    (this as Record<string, unknown>)[String(key)] = String(value);
  }
  removeItem(key: string): void {
    delete (this as Record<string, unknown>)[String(key)];
  }
  clear(): void {
    for (const k of Object.keys(this)) delete (this as Record<string, unknown>)[k];
  }
}

let storageUsable = false;
try {
  const existing = (globalThis as Record<string, unknown>).localStorage as Storage | undefined;
  storageUsable = !!existing && typeof existing.getItem === "function";
} catch {
  storageUsable = false;
}
if (!storageUsable) {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: new MemoryStorage(),
    });
  }
  Object.defineProperty(globalThis, "Storage", {
    configurable: true,
    writable: true,
    value: MemoryStorage,
  });
}

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
