import { useState, useCallback, useEffect, useMemo } from "react";

const STORAGE_KEY = "runkit-lanes-pins";

export type LanePin = {
  server: string;
  session: string;
  windowIndex: number;
};

type UsePinnedLanesReturn = {
  pins: ReadonlyArray<LanePin>;
  pinWindow: (pin: LanePin) => void;
  unpinWindow: (pin: LanePin) => void;
  isPinned: (pin: LanePin) => boolean;
  clearPins: () => void;
  movePinToIndex: (fromIndex: number, toIndex: number) => void;
};

function pinKey(pin: LanePin): string {
  return `${pin.server}:${pin.session}:${pin.windowIndex}`;
}

function readPins(): LanePin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LanePin =>
        typeof item === "object" &&
        item !== null &&
        typeof item.server === "string" &&
        typeof item.session === "string" &&
        typeof item.windowIndex === "number",
    );
  } catch {
    return [];
  }
}

function writePins(pins: LanePin[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // localStorage unavailable
  }
}

export function usePinnedLanes(): UsePinnedLanesReturn {
  const [pins, setPins] = useState<LanePin[]>(readPins);

  // Cross-tab sync via storage event
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setPins(readPins());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const pinWindow = useCallback((pin: LanePin) => {
    setPins((prev) => {
      const key = pinKey(pin);
      if (prev.some((p) => pinKey(p) === key)) return prev;
      const next = [...prev, pin];
      writePins(next);
      return next;
    });
  }, []);

  const unpinWindow = useCallback((pin: LanePin) => {
    setPins((prev) => {
      const key = pinKey(pin);
      const next = prev.filter((p) => pinKey(p) !== key);
      writePins(next);
      return next;
    });
  }, []);

  const isPinned = useCallback(
    (pin: LanePin): boolean => {
      const key = pinKey(pin);
      return pins.some((p) => pinKey(p) === key);
    },
    [pins],
  );

  const clearPins = useCallback(() => {
    writePins([]);
    setPins([]);
  }, []);

  const movePinToIndex = useCallback((fromIndex: number, toIndex: number) => {
    setPins((prev) => {
      if (fromIndex === toIndex) return prev;
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      writePins(next);
      return next;
    });
  }, []);

  return useMemo(
    () => ({ pins, pinWindow, unpinWindow, isPinned, clearPins, movePinToIndex }),
    [pins, pinWindow, unpinWindow, isPinned, clearPins, movePinToIndex],
  );
}
