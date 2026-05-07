import { useEffect, useState } from "react";

/**
 * Detect the currently-active board from the URL pathname (`/board/<name>`).
 * Returns null when not on a board route.
 *
 * Listens to popstate plus history.pushState/replaceState (patched once,
 * idempotent) so SPA navigations update the value without a router-state
 * dependency.
 */
export function useActiveBoardName(): string | null {
  const [name, setName] = useState<string | null>(() => parse(getPathname()));

  useEffect(() => {
    patchHistoryEvents();
    const update = () => setName(parse(getPathname()));
    window.addEventListener("popstate", update);
    window.addEventListener("rk:locationchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("rk:locationchange", update);
    };
  }, []);

  return name;
}

function getPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname;
}

function parse(pathname: string): string | null {
  const m = pathname.match(/^\/board\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

let patched = false;
function patchHistoryEvents() {
  if (patched || typeof window === "undefined") return;
  patched = true;
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    origPush(...args);
    window.dispatchEvent(new Event("rk:locationchange"));
  };
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    origReplace(...args);
    window.dispatchEvent(new Event("rk:locationchange"));
  };
}
