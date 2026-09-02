import { WEB_TAB_DRAFT_EVENT } from "../web-url";

export type WebTabPaletteAction = {
  id: string;
  label: string;
  onSelect: () => void;
};

export type WebTabVerbHandlers = {
  /** Select tab slot `n` (1-based; the builder applies the wrap). */
  onSelectTab: (n: number) => void;
  /** Close tab slot `n` (1-based). */
  onCloseTab: (n: number) => void;
  /** Move tab slot `n` (1-based) to position `to` (1-based). */
  onMoveTab: (n: number, to: number) => void;
};

/**
 * Build the web-tab palette actions for a window's tab family. `active` is the
 * 1-based active slot; a 0/absent pointer reads slot 1 and an out-of-range
 * pointer clamps to the family (the same clamp the mount and `activeWebUrl`
 * apply). An empty family yields only `Web: New tab` — the draft entry point
 * must stay reachable from the empty state; the verb entries need tabs.
 */
export function buildWebTabActions(
  tabs: string[],
  active: number | undefined,
  handlers: WebTabVerbHandlers,
): WebTabPaletteAction[] {
  const count = tabs.length;
  const verbs: WebTabPaletteAction[] = [];
  if (count >= 2) {
    // Wrap math only exists alongside tabs — an empty family never reaches it.
    const current = active !== undefined && active >= 1 ? Math.min(active, count) : 1;
    const next = current === count ? 1 : current + 1;
    const prev = current === 1 ? count : current - 1;
    verbs.push(
      {
        id: "web-tab-next",
        label: "Web: Next tab",
        onSelect: () => handlers.onSelectTab(next),
      },
      {
        id: "web-tab-prev",
        label: "Web: Previous tab",
        onSelect: () => handlers.onSelectTab(prev),
      },
      {
        id: "web-tab-close",
        label: "Web: Close tab",
        onSelect: () => handlers.onCloseTab(current),
      },
    );
    if (current > 1) {
      verbs.push({
        id: "web-tab-move-left",
        label: "Web: Move tab left",
        onSelect: () => handlers.onMoveTab(current, current - 1),
      });
    }
    if (current < count) {
      verbs.push({
        id: "web-tab-move-right",
        label: "Web: Move tab right",
        onSelect: () => handlers.onMoveTab(current, current + 1),
      });
    }
  }
  return [
    ...verbs,
    {
      id: "web-tab-new",
      label: "Web: New tab",
      onSelect: () =>
        document.dispatchEvent(new CustomEvent(WEB_TAB_DRAFT_EVENT)),
    },
  ];
}
