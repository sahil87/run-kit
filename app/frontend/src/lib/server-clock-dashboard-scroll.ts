// The `Server: Clock dashboard` palette entry's scroll seam (document-event
// idiom, mirroring `rk:operator-console`): the palette dispatches the event
// after navigating to `/$server`; the dashboard listens for it and scrolls
// its CRONS heading into view. The module-level pending flag covers the
// mount-after-dispatch race — a dashboard that mounts after the event fired
// still scrolls on its mount effect. The URL never carries a hash.

export const CRONS_SCROLL_EVENT = "rk:server-clock-dashboard-scroll";

let pending = false;

/** Arm the pending flag and dispatch the scroll event. */
export function requestCronsScroll(): void {
  pending = true;
  document.dispatchEvent(new CustomEvent(CRONS_SCROLL_EVENT));
}

/** Read-and-clear the pending flag — the dashboard's mount-time check. */
export function consumePendingCronsScroll(): boolean {
  const was = pending;
  pending = false;
  return was;
}
