import { useCallback, useEffect, useState } from "react";

// In-module pub/sub keyed on storage key. The native `storage` event fires
// only across tabs, so same-tab sibling components (e.g., Sidebar reading the
// Server Pane's open state) need this dispatch to re-render on updates.
const subscribers = new Map<string, Set<(value: boolean) => void>>();

function notify(storageKey: string, value: boolean): void {
  const listeners = subscribers.get(storageKey);
  if (!listeners) return;
  for (const listener of listeners) listener(value);
}

function subscribe(storageKey: string, listener: (value: boolean) => void): () => void {
  let listeners = subscribers.get(storageKey);
  if (!listeners) {
    listeners = new Set();
    subscribers.set(storageKey, listeners);
  }
  listeners.add(listener);
  return () => {
    const set = subscribers.get(storageKey);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) subscribers.delete(storageKey);
  };
}

function readPersisted(storageKey: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // localStorage unavailable (SSR, privacy mode, sandboxed iframe)
  }
  return defaultValue;
}

/**
 * Persisted boolean backed by `localStorage[storageKey]`. Multiple components
 * subscribing to the same key stay in sync within a single tab via an
 * in-module pub/sub; cross-tab sync rides the native `storage` event for free.
 */
export function useLocalStorageBoolean(
  storageKey: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => readPersisted(storageKey, defaultValue));

  useEffect(() => {
    const unsubscribe = subscribe(storageKey, setValue);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setValue(readPersisted(storageKey, defaultValue));
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", onStorage);
    }
    // Resync in case another subscriber wrote between mount and effect.
    setValue(readPersisted(storageKey, defaultValue));
    return () => {
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
    };
  }, [storageKey, defaultValue]);

  const setter = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // localStorage unavailable
      }
      notify(storageKey, next);
    },
    [storageKey],
  );

  return [value, setter];
}
