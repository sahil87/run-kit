import { useEffect } from "react";
import { acquire, type OverlayKind } from "@/lib/overlay-presence";

/**
 * Holds an overlay-presence registration of `kind` while `open` is true;
 * releases when `open` turns false and on unmount. Call it above any early
 * `return null` — it is a hook. A component that only mounts while open
 * passes `true`.
 */
export function useOccludes(kind: OverlayKind, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    return acquire(kind);
  }, [kind, open]);
}
