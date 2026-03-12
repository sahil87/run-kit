import { useState, useCallback, useEffect } from "react";

type UseKeyboardNavOptions = {
  itemCount: number;
  onSelect: (index: number) => void;
  shortcuts?: Record<string, () => void>;
};

export function useKeyboardNav({
  itemCount,
  onSelect,
  shortcuts = {},
}: UseKeyboardNavOptions) {
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Clamp focused index when item count changes
  useEffect(() => {
    if (itemCount > 0 && focusedIndex >= itemCount) {
      setFocusedIndex(Math.max(0, itemCount - 1));
    }
  }, [itemCount, focusedIndex]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "j":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, itemCount - 1));
          break;
        case "k":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          onSelect(focusedIndex);
          break;
        default:
          if (shortcuts[e.key]) {
            e.preventDefault();
            shortcuts[e.key]();
          }
      }
    },
    [itemCount, focusedIndex, onSelect, shortcuts],
  );

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return { focusedIndex, setFocusedIndex };
}
