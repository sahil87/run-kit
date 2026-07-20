import { useCallback, useEffect, useState } from "react";

// In-module pub/sub keyed on storage key — the enum-typed sibling of
// `use-local-storage-boolean.ts`. The native `storage` event fires only
// across tabs, so same-tab sibling components (e.g., the Sidebar's scope
// chip, the session list, and the command-palette entry all reading the
// sessions-scope key) need this dispatch to re-render on updates.
const subscribers = new Map<string, Set<(value: string) => void>>();

function notify(storageKey: string, value: string): void {
  const listeners = subscribers.get(storageKey);
  if (!listeners) return;
  for (const listener of listeners) listener(value);
}

function subscribe(storageKey: string, listener: (value: string) => void): () => void {
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

function readPersisted<T extends string>(
  storageKey: string,
  defaultValue: T,
  allowedValues: readonly T[],
): T {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored != null && (allowedValues as readonly string[]).includes(stored)) {
      return stored as T;
    }
  } catch {
    // localStorage unavailable (SSR, privacy mode, sandboxed iframe)
  }
  return defaultValue;
}

/**
 * Persisted string-enum backed by `localStorage[storageKey]`. Values outside
 * `allowedValues` (including unset) resolve to `defaultValue`. Multiple
 * components subscribing to the same key stay in sync within a single tab via
 * an in-module pub/sub; cross-tab sync rides the native `storage` event for
 * free. Mirrors `useLocalStorageBoolean`.
 */
export function useLocalStorageEnum<T extends string>(
  storageKey: string,
  defaultValue: T,
  allowedValues: readonly T[],
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() =>
    readPersisted(storageKey, defaultValue, allowedValues),
  );

  useEffect(() => {
    const onNotify = (raw: string) => {
      setValue(
        (allowedValues as readonly string[]).includes(raw) ? (raw as T) : defaultValue,
      );
    };
    const unsubscribe = subscribe(storageKey, onNotify);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setValue(readPersisted(storageKey, defaultValue, allowedValues));
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", onStorage);
    }
    // Resync in case another subscriber wrote between mount and effect.
    setValue(readPersisted(storageKey, defaultValue, allowedValues));
    return () => {
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
    };
    // `allowedValues` is expected to be a module-level constant; spreading it
    // into the dep list would churn on inline arrays, so consumers must pass a
    // stable reference (all current consumers do).
  }, [storageKey, defaultValue, allowedValues]);

  const setter = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // localStorage unavailable
      }
      notify(storageKey, next);
    },
    [storageKey],
  );

  return [value, setter];
}
