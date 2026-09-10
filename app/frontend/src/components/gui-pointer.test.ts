import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  attachGuiPointer,
  TAP_MAX_PX,
  type GuiPointerOptions,
} from "./gui-pointer";

// jsdom has no TouchEvent constructor: the layer reads only the
// touches/changedTouches point lists, so tests dispatch plain Events with
// those props assigned. Rects are stubbed — jsdom has no layout.
interface Pt {
  id: number;
  x: number;
  y: number;
}

function touch(type: string, changed: Pt[], all: Pt[] = changed) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const mk = (p: Pt) => ({ identifier: p.id, clientX: p.x, clientY: p.y });
  Object.assign(e, { touches: all.map(mk), changedTouches: changed.map(mk) });
  return e;
}

function stubRect(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  const full = {
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  };
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(full as DOMRect);
}

interface CapturedEvent {
  type: string;
  buttons: number;
  clientX: number;
  clientY: number;
  deltaX: number;
  deltaY: number;
}

const FB = { width: 800, height: 600 };
/** The cursor seeds at the tile centre of the stubbed geometry. */
const CURSOR_START = { x: 400, y: 300 };

function setup(opts: Partial<GuiPointerOptions> = {}) {
  const wrapper = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.width = FB.width;
  canvas.height = FB.height;
  wrapper.appendChild(canvas);
  document.body.appendChild(wrapper);
  stubRect(canvas, { left: 0, top: 0, width: FB.width, height: FB.height });
  stubRect(wrapper, { left: 0, top: 0, width: FB.width, height: FB.height });
  Object.defineProperties(wrapper, {
    clientWidth: { get: () => FB.width, configurable: true },
    clientHeight: { get: () => FB.height, configurable: true },
  });

  const events: CapturedEvent[] = [];
  for (const type of ["mousemove", "mousedown", "mouseup", "wheel"]) {
    canvas.addEventListener(type, (e) => {
      const me = e as MouseEvent & WheelEvent;
      events.push({
        type,
        buttons: me.buttons ?? 0,
        clientX: me.clientX ?? 0,
        clientY: me.clientY ?? 0,
        deltaX: me.deltaX ?? 0,
        deltaY: me.deltaY ?? 0,
      });
    });
  }

  const rfb = { focus: vi.fn() };
  const onZoomStep = vi.fn();
  const ensureCursorVisible = vi.fn();
  const detach = attachGuiPointer(wrapper, {
    rfb,
    onZoomStep,
    ensureCursorVisible,
    ...opts,
  });
  return { wrapper, canvas, events, rfb, onZoomStep, ensureCursorVisible, detach };
}

const ofType = (events: CapturedEvent[], type: string) => events.filter((e) => e.type === type);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("attachGuiPointer — interception and focus", () => {
  it("owns touches in the capture phase and focuses the RFB on the first touch", () => {
    const { wrapper, canvas, rfb } = setup();
    const bubbleSpy = vi.fn();
    canvas.addEventListener("touchstart", bubbleSpy); // stands in for noVNC's GestureHandler
    fireTouch(canvas, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    expect(bubbleSpy).not.toHaveBeenCalled();
    expect(rfb.focus).toHaveBeenCalledOnce();
  });
});

function fireTouch(el: HTMLElement, type: string, changed: Pt[], all?: Pt[]) {
  el.dispatchEvent(touch(type, changed, all));
}

describe("attachGuiPointer — one-finger drag", () => {
  it("moves the cursor at gain 1.25 of the finger delta with no button", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    fireTouch(wrapper, "touchmove", [{ id: 1, x: 140, y: 100 }]);

    const moves = ofType(events, "mousemove");
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(moves[moves.length - 1].clientX - CURSOR_START.x).toBe(50);
    expect(moves[moves.length - 1].clientY - CURSOR_START.y).toBe(0);
    expect(ofType(events, "mousedown")).toHaveLength(0);
  });

  it("clamps the cursor to the framebuffer", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    fireTouch(wrapper, "touchmove", [{ id: 1, x: 99_999, y: 99_999 }]);
    const moves = ofType(events, "mousemove");
    expect(moves[moves.length - 1].clientX).toBe(FB.width);
    expect(moves[moves.length - 1].clientY).toBe(FB.height);
  });

  it("calls ensureCursorVisible (framebuffer coords) when a move leaves the visible window", () => {
    const { wrapper, canvas, ensureCursorVisible } = setup();
    // The tile sees an 800px window of a 2880px-wide zoomed canvas.
    stubRect(canvas, { left: 0, top: 0, width: 2880, height: 1620 });
    canvas.width = 2880;
    canvas.height = 1620;
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    fireTouch(wrapper, "touchmove", [{ id: 1, x: 800, y: 0 }]);
    expect(ensureCursorVisible).toHaveBeenLastCalledWith(1400, CURSOR_START.y);
  });

  it("positions the caller-owned cursor indicator in content coordinates", () => {
    const cursorEl = document.createElement("div");
    const { wrapper } = setup({ cursorEl });
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    fireTouch(wrapper, "touchmove", [{ id: 1, x: 140, y: 100 }]);
    expect(cursorEl.style.left).toBe(`${CURSOR_START.x + 50}px`);
    expect(cursorEl.style.top).toBe(`${CURSOR_START.y}px`);
  });
});

describe("attachGuiPointer — tap", () => {
  it("a lift within both thresholds left-clicks at the cursor", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    fireTouch(wrapper, "touchmove", [{ id: 1, x: 104, y: 100 }]);
    vi.advanceTimersByTime(120);
    fireTouch(wrapper, "touchend", [{ id: 1, x: 104, y: 100 }], []);

    const downs = ofType(events, "mousedown");
    const ups = ofType(events, "mouseup");
    expect(downs).toHaveLength(1);
    expect(ups).toHaveLength(1);
    expect(downs[0].buttons).toBe(1);
    // At the cursor (nudged 4px × 1.25 by the sub-threshold move), not the finger.
    expect(downs[0].clientX).toBe(CURSOR_START.x + 5);
  });

  it("a lift past the time threshold does not click", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    vi.advanceTimersByTime(250);
    fireTouch(wrapper, "touchend", [{ id: 1, x: 100, y: 100 }], []);
    expect(ofType(events, "mousedown")).toHaveLength(0);
  });

  it("a lift past the movement threshold does not click (reclassified drag)", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    fireTouch(wrapper, "touchmove", [{ id: 1, x: 114, y: 100 }]);
    vi.advanceTimersByTime(50);
    fireTouch(wrapper, "touchend", [{ id: 1, x: 114, y: 100 }], []);
    expect(ofType(events, "mousedown")).toHaveLength(0);
    expect(ofType(events, "mouseup")).toHaveLength(0);
  });
});

describe("attachGuiPointer — two-finger tap", () => {
  it("both fingers lifting within the tap window right-clicks", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    vi.advanceTimersByTime(50);
    fireTouch(wrapper, "touchstart", [{ id: 2, x: 200, y: 100 }], [
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 200, y: 100 },
    ]);
    vi.advanceTimersByTime(70);
    fireTouch(wrapper, "touchend", [{ id: 1, x: 100, y: 100 }], [{ id: 2, x: 200, y: 100 }]);
    vi.advanceTimersByTime(20);
    fireTouch(wrapper, "touchend", [{ id: 2, x: 200, y: 100 }], []);

    const downs = ofType(events, "mousedown");
    expect(downs).toHaveLength(1);
    expect(downs[0].buttons).toBe(2);
    expect(ofType(events, "mouseup")).toHaveLength(1);
  });

  it("a two-finger gesture that left the dead zone never right-clicks", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    fireTouch(wrapper, "touchstart", [{ id: 2, x: 200, y: 100 }], [
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 200, y: 100 },
    ]);
    // A scroll-classified gesture, then both lift inside the time window.
    fireTouch(wrapper, "touchmove", [{ id: 1, x: 100, y: 160 }, { id: 2, x: 200, y: 160 }]);
    fireTouch(wrapper, "touchend", [{ id: 1, x: 100, y: 160 }], [{ id: 2, x: 200, y: 160 }]);
    fireTouch(wrapper, "touchend", [{ id: 2, x: 200, y: 160 }], []);
    expect(ofType(events, "mousedown")).toHaveLength(0);
  });
});

describe("attachGuiPointer — two-finger drag scroll", () => {
  it("emits wheels 1:1 with the centroid delta and stops at the lift", () => {
    const { wrapper, events } = setup();
    const two = (y1: number, y2: number): Pt[] => [
      { id: 1, x: 100, y: y1 },
      { id: 2, x: 200, y: y2 },
    ];
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    fireTouch(wrapper, "touchstart", [{ id: 2, x: 200, y: 200 }], two(100, 200));
    fireTouch(wrapper, "touchmove", two(130, 230));
    fireTouch(wrapper, "touchmove", two(160, 260));

    const wheels = ofType(events, "wheel");
    expect(wheels.reduce((sum, w) => sum + w.deltaY, 0)).toBe(60);
    expect(wheels.every((w) => w.deltaY > 0)).toBe(true); // down is positive
    expect(wheels.reduce((sum, w) => sum + w.deltaX, 0)).toBe(0);
    // A scroll never moves the cursor or presses a button.
    expect(ofType(events, "mousemove")).toHaveLength(0);
    expect(ofType(events, "mousedown")).toHaveLength(0);

    fireTouch(wrapper, "touchend", [{ id: 1, x: 100, y: 160 }], [{ id: 2, x: 200, y: 260 }]);
    fireTouch(wrapper, "touchend", [{ id: 2, x: 200, y: 260 }], []);
    expect(ofType(events, "wheel")).toHaveLength(wheels.length); // no momentum
  });
});

describe("attachGuiPointer — long-press", () => {
  it("holds mousedown after 500ms and releases on the lift; moves in between drag", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    expect(ofType(events, "mousedown")).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(ofType(events, "mousedown")).toHaveLength(1);
    expect(ofType(events, "mousedown")[0].buttons).toBe(1);

    // Drag-and-drop: the move is a relative drag with the button held.
    fireTouch(wrapper, "touchmove", [{ id: 1, x: 140, y: 100 }]);
    const moves = ofType(events, "mousemove");
    expect(moves[moves.length - 1].buttons).toBe(1);
    expect(ofType(events, "mouseup")).toHaveLength(0);

    fireTouch(wrapper, "touchend", [{ id: 1, x: 140, y: 100 }], []);
    expect(ofType(events, "mouseup")).toHaveLength(1);
    // The lift only releases — never a second press from the tap path.
    expect(ofType(events, "mousedown")).toHaveLength(1);
  });

  it("leaving the dead zone before 500ms cancels the hold", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    fireTouch(wrapper, "touchmove", [{ id: 1, x: 100 + TAP_MAX_PX, y: 100 }]);
    vi.advanceTimersByTime(600);
    expect(ofType(events, "mousedown")).toHaveLength(0);
  });
});

describe("attachGuiPointer — pinch", () => {
  const spread = (gap: number): Pt[] => [
    { id: 1, x: 400 - gap / 2, y: 300 },
    { id: 2, x: 400 + gap / 2, y: 300 },
  ];

  it("steps once per 40px of distance change beyond the dead zone (160px spread → 3 steps)", () => {
    const { wrapper, onZoomStep } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 350, y: 300 }]);
    fireTouch(wrapper, "touchstart", [{ id: 2, x: 450, y: 300 }], spread(100));
    for (const gap of [140, 180, 220, 260]) {
      fireTouch(wrapper, "touchmove", spread(gap));
    }
    expect(onZoomStep.mock.calls).toEqual([[1], [1], [1]]);
  });

  it("a squeeze steps down", () => {
    const { wrapper, onZoomStep } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 350, y: 300 }]);
    fireTouch(wrapper, "touchstart", [{ id: 2, x: 450, y: 300 }], spread(100));
    fireTouch(wrapper, "touchmove", spread(30)); // 70px closer
    expect(onZoomStep.mock.calls).toEqual([[-1]]);
  });

  it("classifies pinch vs scroll on whichever dominates, locked for the gesture", () => {
    const { wrapper, events, onZoomStep } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 350, y: 300 }]);
    fireTouch(wrapper, "touchstart", [{ id: 2, x: 450, y: 300 }], spread(100));
    fireTouch(wrapper, "touchmove", spread(160)); // distance dominates → pinch
    // A later centroid-heavy move stays pinch — no wheels leak through.
    fireTouch(wrapper, "touchmove", [
      { id: 1, x: 320 - 30, y: 300 },
      { id: 2, x: 480 - 30, y: 300 },
    ]);
    expect(onZoomStep).toHaveBeenCalled();
    expect(ofType(events, "wheel")).toHaveLength(0);
  });
});

describe("attachGuiPointer — detach", () => {
  it("stops intercepting and releases a held button", () => {
    const { wrapper, canvas, events, rfb, detach } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    vi.advanceTimersByTime(500); // long-press held
    expect(ofType(events, "mousedown")).toHaveLength(1);

    detach();
    expect(ofType(events, "mouseup")).toHaveLength(1);

    const bubbleSpy = vi.fn();
    canvas.addEventListener("touchstart", bubbleSpy);
    fireTouch(canvas, "touchstart", [{ id: 2, x: 10, y: 10 }]);
    expect(bubbleSpy).toHaveBeenCalledOnce(); // noVNC would see touches again
    expect(rfb.focus).toHaveBeenCalledOnce(); // the detached layer is inert
  });

  it("touchcancel releases a held button and never clicks", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    vi.advanceTimersByTime(500);
    fireTouch(wrapper, "touchcancel", [{ id: 1, x: 100, y: 100 }], []);
    expect(ofType(events, "mousedown")).toHaveLength(1);
    expect(ofType(events, "mouseup")).toHaveLength(1);

    // A quick cancel of a would-be tap clicks nothing either.
    fireTouch(wrapper, "touchstart", [{ id: 2, x: 100, y: 100 }]);
    fireTouch(wrapper, "touchcancel", [{ id: 2, x: 100, y: 100 }], []);
    expect(ofType(events, "mousedown")).toHaveLength(1);
  });
});

describe("attachGuiPointer — chrome pass-through", () => {
  function withChrome(wrapper: HTMLElement) {
    const keybar = document.createElement("div");
    keybar.setAttribute("data-testid", "gui-keybar");
    const button = document.createElement("button");
    keybar.appendChild(button);
    wrapper.appendChild(keybar);
    return { keybar, button };
  }

  it("a touch targeted inside the key bar is not intercepted; a canvas touch still is", () => {
    const { wrapper, canvas, rfb } = setup();
    const { button } = withChrome(wrapper);
    const buttonSpy = vi.fn();
    button.addEventListener("touchstart", buttonSpy);

    // dispatchEvent returns false iff preventDefault ran on a cancelable event.
    expect(button.dispatchEvent(touch("touchstart", [{ id: 1, x: 10, y: 10 }]))).toBe(true);
    expect(buttonSpy).toHaveBeenCalledOnce();
    expect(rfb.focus).not.toHaveBeenCalled();

    const canvasSpy = vi.fn();
    canvas.addEventListener("touchstart", canvasSpy);
    expect(canvas.dispatchEvent(touch("touchstart", [{ id: 2, x: 100, y: 100 }]))).toBe(false);
    expect(canvasSpy).not.toHaveBeenCalled();
    expect(rfb.focus).toHaveBeenCalledOnce();
  });

  it("a canvas drag in progress survives a key-bar tap (ownership decided at touchstart)", () => {
    const { wrapper, canvas, events } = setup();
    const { button } = withChrome(wrapper);
    fireTouch(canvas, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    fireTouch(button, "touchstart", [{ id: 2, x: 10, y: 10 }]);
    fireTouch(button, "touchend", [{ id: 2, x: 10, y: 10 }], [{ id: 1, x: 100, y: 100 }]);
    fireTouch(canvas, "touchmove", [{ id: 1, x: 140, y: 100 }]);

    const moves = ofType(events, "mousemove");
    expect(moves[moves.length - 1].clientX - CURSOR_START.x).toBe(50);
    // The bar tap never entered the gesture state: no click at the cursor.
    expect(ofType(events, "mousedown")).toHaveLength(0);
  });

  it("the bare-WM strip gets the same pass-through", () => {
    const { wrapper, rfb } = setup();
    const strip = document.createElement("div");
    strip.setAttribute("data-testid", "gui-wm-strip");
    wrapper.appendChild(strip);
    const stripSpy = vi.fn();
    strip.addEventListener("touchstart", stripSpy);
    expect(strip.dispatchEvent(touch("touchstart", [{ id: 1, x: 5, y: 5 }]))).toBe(true);
    expect(stripSpy).toHaveBeenCalledOnce();
    expect(rfb.focus).not.toHaveBeenCalled();
  });

  it("the credentials overlay gets the same pass-through (defense behind the detach)", () => {
    const { wrapper, rfb } = setup();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-testid", "gui-surface-credentials");
    const input = document.createElement("input");
    overlay.appendChild(input);
    wrapper.appendChild(overlay);
    const inputSpy = vi.fn();
    input.addEventListener("touchstart", inputSpy);
    expect(input.dispatchEvent(touch("touchstart", [{ id: 1, x: 5, y: 5 }]))).toBe(true);
    expect(inputSpy).toHaveBeenCalledOnce();
    expect(rfb.focus).not.toHaveBeenCalled();
  });
});

describe("attachGuiPointer — coalesced and simultaneous two-finger delivery", () => {
  it("two contacts in ONE touchstart classify: a spread steps the zoom", () => {
    const { wrapper, onZoomStep } = setup();
    fireTouch(wrapper, "touchstart", [
      { id: 1, x: 350, y: 300 },
      { id: 2, x: 450, y: 300 },
    ]);
    // 100 → 160: 60px of spread, 50 beyond the dead zone → exactly one step.
    fireTouch(wrapper, "touchmove", [
      { id: 1, x: 320, y: 300 },
      { id: 2, x: 480, y: 300 },
    ]);
    expect(onZoomStep.mock.calls).toEqual([[1]]);
  });

  it("a coalesced two-finger tap right-clicks", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 200, y: 100 },
    ]);
    vi.advanceTimersByTime(100);
    fireTouch(wrapper, "touchend", [{ id: 1, x: 100, y: 100 }], [{ id: 2, x: 200, y: 100 }]);
    fireTouch(wrapper, "touchend", [{ id: 2, x: 200, y: 100 }], []);
    const downs = ofType(events, "mousedown");
    expect(downs).toHaveLength(1);
    expect(downs[0].buttons).toBe(2);
  });

  it("both fingers lifting in ONE touchend still right-clicks", () => {
    const { wrapper, events } = setup();
    fireTouch(wrapper, "touchstart", [{ id: 1, x: 100, y: 100 }]);
    fireTouch(wrapper, "touchstart", [{ id: 2, x: 200, y: 100 }], [
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 200, y: 100 },
    ]);
    vi.advanceTimersByTime(100);
    fireTouch(
      wrapper,
      "touchend",
      [
        { id: 1, x: 100, y: 100 },
        { id: 2, x: 200, y: 100 },
      ],
      [],
    );
    const downs = ofType(events, "mousedown");
    expect(downs).toHaveLength(1);
    expect(downs[0].buttons).toBe(2);
    expect(ofType(events, "mouseup")).toHaveLength(1);
  });
});
