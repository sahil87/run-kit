import { createContext, useContext } from "react";

/** True while a SurfaceLayout sash or intersection drag is in progress. A
 *  React context rather than an engine prop: the flag is a layout fact the
 *  chrome has no business threading, and only the native engine consumes it
 *  (live-resize its guest every frame). Default false — an engine mounted
 *  outside SurfaceLayout never drags. */
export const TileDragContext = createContext(false);

export function useTileDragging(): boolean {
  return useContext(TileDragContext);
}
