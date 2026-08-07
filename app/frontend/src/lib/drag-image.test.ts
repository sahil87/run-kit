import { describe, expect, it, vi } from "vitest";
import { pinDragImage } from "./drag-image";

/** Minimal synthetic dragstart event — mirrors the mock-dataTransfer-bag
 *  pattern of use-server-reorder.test.ts, plus the geometry pinDragImage
 *  reads (currentTarget rect + client coords). */
function makeDragStartEvent(opts: {
  setDragImage?: ReturnType<typeof vi.fn>;
  rect?: { left: number; top: number };
  clientX?: number;
  clientY?: number;
}) {
  const currentTarget = {
    getBoundingClientRect: () => ({
      left: opts.rect?.left ?? 0,
      top: opts.rect?.top ?? 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: opts.rect?.left ?? 0,
      y: opts.rect?.top ?? 0,
      toJSON: () => ({}),
    }),
  };
  return {
    currentTarget,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    dataTransfer: opts.setDragImage ? { setDragImage: opts.setDragImage } : {},
  } as unknown as React.DragEvent;
}

describe("pinDragImage", () => {
  it("declares the dispatching element as the drag image, anchored at the grab offset", () => {
    const setDragImage = vi.fn();
    const e = makeDragStartEvent({
      setDragImage,
      rect: { left: 10, top: 200 },
      clientX: 55,
      clientY: 212,
    });

    pinDragImage(e);

    expect(setDragImage).toHaveBeenCalledExactlyOnceWith(e.currentTarget, 45, 12);
  });

  it("no-ops when setDragImage is unavailable (jsdom / mock dataTransfer bags)", () => {
    expect(() => pinDragImage(makeDragStartEvent({}))).not.toThrow();
  });
});
