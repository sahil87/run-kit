/**
 * xterm's RenderService registers a page-level `IntersectionObserver` on the
 * terminal's screen element at `open()` to pause rendering while the terminal
 * is off-screen. Blink recomputes intersections on every compositor frame,
 * and while any continuously-advancing composited animation runs on the page
 * (the flair overlays) that recompute drags a full main-thread style
 * lifecycle along with it — every running animation's style re-applied every
 * frame (~1800 RecalcStyleCount / 30 s on a tty route against a ~200 floor).
 * No flair-side change can unregister a page-level observer, so the observer
 * must never be created: `open()` runs with this shim installed, and xterm's
 * registration binds to run-kit's own visibility signal instead — the tile
 * layer already knows when it display-hides a terminal, and the document
 * visibility API covers backgrounded tabs.
 */

export interface TerminalVisibilityEntry {
  isIntersecting: boolean;
  intersectionRatio: number;
}

type VisibilityCallback = (entries: TerminalVisibilityEntry[]) => void;

interface VisibilityHandle {
  callback: VisibilityCallback | null;
  locallyVisible: boolean;
  /** null until the first report so the initial state always fires. */
  lastReported: boolean | null;
}

export interface TerminalVisibilityShim {
  /** Put the real `IntersectionObserver` back. Idempotent. */
  restore(): void;
  /** Update run-kit's own visibility signal for the observed terminal. */
  setLocallyVisible(visible: boolean): void;
  /** Drop the handle (terminal unmounted) — nothing reports afterwards. */
  dispose(): void;
}

const handles = new Set<VisibilityHandle>();
let listening = false;

function effectiveVisible(handle: VisibilityHandle): boolean {
  return handle.locallyVisible && !document.hidden;
}

function report(handle: VisibilityHandle): void {
  if (!handle.callback) return;
  const visible = effectiveVisible(handle);
  if (handle.lastReported === visible) return;
  handle.lastReported = visible;
  handle.callback([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
}

function onDocumentVisibilityChange(): void {
  for (const handle of handles) report(handle);
}

function syncListener(): void {
  if (handles.size > 0 && !listening) {
    document.addEventListener("visibilitychange", onDocumentVisibilityChange);
    listening = true;
  } else if (handles.size === 0 && listening) {
    document.removeEventListener("visibilitychange", onDocumentVisibilityChange);
    listening = false;
  }
}

const NOOP_SHIM: TerminalVisibilityShim = {
  restore() {},
  setLocallyVisible() {},
  dispose() {},
};

/**
 * Swap `window.IntersectionObserver` for a handle-bound shim until `restore()`
 * is called. The swap is meant to bracket one synchronous `terminal.open()` —
 * the only registration xterm makes. Without a platform `IntersectionObserver`
 * (jsdom, old engines) xterm would skip registration anyway, so this is a
 * no-op shim.
 */
export function installTerminalVisibilityShim(initiallyVisible: boolean): TerminalVisibilityShim {
  const original = window.IntersectionObserver;
  if (typeof original !== "function") return NOOP_SHIM;

  const handle: VisibilityHandle = { callback: null, locallyVisible: initiallyVisible, lastReported: null };
  handles.add(handle);
  syncListener();

  class TerminalVisibilityObserverShim {
    constructor(callback: VisibilityCallback, _options?: unknown) {
      handle.callback = callback;
    }
    observe(): void {
      // A real observer delivers the initial state asynchronously; xterm
      // waits on it to leave its paused state.
      queueMicrotask(() => report(handle));
    }
    unobserve(): void {
      handle.callback = null;
    }
    disconnect(): void {
      handle.callback = null;
    }
    takeRecords(): TerminalVisibilityEntry[] {
      return [];
    }
    get root(): null {
      return null;
    }
    get rootMargin(): string {
      return "0px";
    }
    get thresholds(): readonly number[] {
      return [0];
    }
  }

  window.IntersectionObserver = TerminalVisibilityObserverShim as unknown as typeof IntersectionObserver;

  let restored = false;
  return {
    restore() {
      if (restored) return;
      restored = true;
      // Never clobber a third-party observer installed after this shim.
      if (window.IntersectionObserver === (TerminalVisibilityObserverShim as unknown)) {
        window.IntersectionObserver = original;
      }
    },
    setLocallyVisible(visible: boolean) {
      handle.locallyVisible = visible;
      report(handle);
    },
    dispose() {
      handle.callback = null;
      handles.delete(handle);
      syncListener();
    },
  };
}
