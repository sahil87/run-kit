import { describe, it, expect, vi } from "vitest";
import {
  CRONS_SCROLL_EVENT,
  consumePendingCronsScroll,
  requestCronsScroll,
} from "./server-clock-dashboard-scroll";

describe("server-clock-dashboard-scroll", () => {
  it("dispatches the document event and arms the pending flag", () => {
    const listener = vi.fn();
    document.addEventListener(CRONS_SCROLL_EVENT, listener);

    requestCronsScroll();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumePendingCronsScroll()).toBe(true);
    document.removeEventListener(CRONS_SCROLL_EVENT, listener);
  });

  it("consume clears the flag — a second consume reads false", () => {
    requestCronsScroll();
    expect(consumePendingCronsScroll()).toBe(true);
    expect(consumePendingCronsScroll()).toBe(false);
  });

  it("reads false when nothing was requested", () => {
    expect(consumePendingCronsScroll()).toBe(false);
  });
});
