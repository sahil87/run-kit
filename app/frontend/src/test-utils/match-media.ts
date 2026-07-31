import { vi } from "vitest";

/** Install a matchMedia stub via `vi.stubGlobal` (tests-only — imported
 *  per-test, never auto-installed; some tests assert real/absent matchMedia
 *  behavior). `matches` is decided per-query by the predicate (default:
 *  always false); listeners are fire-and-forget `vi.fn()` stubs — for
 *  controllable MQLs (change events, listener bookkeeping) build a bespoke
 *  `mockReturnValue(mql)` instead. Returns the installed mock for per-test
 *  customization. The stub is a configurable property, so a test may
 *  `delete window.matchMedia` to restore jsdom's default (undefined). */
export function stubMatchMedia(predicate: (query: string) => boolean = () => false) {
  const mock = vi.fn().mockImplementation((query: string) => ({
    matches: predicate(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal("matchMedia", mock);
  return mock;
}
