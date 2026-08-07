/**
 * Pin the native HTML5 drag ghost under the exact grab point.
 *
 * Without `setDragImage`, the browser snapshots the draggable element and
 * chooses the ghost's initial anchor itself — and when that anchor disagrees
 * with the grab point (scrolled `overflow` ancestors, macOS's drag-image snap
 * animation, Chromium-version drift), the ghost visibly "falls in" from above
 * the cursor at drag start. Re-declaring the same element as the drag image
 * with the measured cursor-to-element offset renders the ghost under the
 * cursor from the first frame, so there is nothing to animate.
 *
 * Call first in a `dragstart` handler (while `currentTarget` is still bound
 * to the dispatching element). No-op where `setDragImage` is unavailable
 * (jsdom and the synthetic dataTransfer bags unit tests build).
 */
export function pinDragImage(e: React.DragEvent): void {
  if (typeof e.dataTransfer?.setDragImage !== "function") return;
  const rect = e.currentTarget.getBoundingClientRect();
  e.dataTransfer.setDragImage(e.currentTarget, e.clientX - rect.left, e.clientY - rect.top);
}
