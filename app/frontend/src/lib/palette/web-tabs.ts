/**
 * Pure builder for the command-palette web-tab strip actions (`Web: Next tab` /
 * `Web: Previous tab` / `Web: Close tab` / `Web: New tab from address` —
 * 260828-9kip R11). Extracted from app.tsx so the tab-count gating and the
 * wrap math are unit-testable without mounting the shell — mirroring
 * lib/palette/view.ts (`buildViewActions`) and lib/palette/zen.ts
 * (`buildZenActions`).
 *
 * Constitution V palette parity for the IframeWindow tab strip. Enablement is
 * the availability idiom — entries are ABSENT, not disabled: the verb entries
 * need a family of ≥2 tabs (nothing to cycle or safely close at 1), while
 * `Web: New tab from address` is offered at ≥1 (it is the only UI path to a
 * second tab from a 1-tab window — the strip's `+` renders only at ≥2). The
 * caller gates the whole set on the layout including an open `web` tile.
 *
 * The new-tab entry dispatches the `web-address:focus` CustomEvent with
 * `detail.newTab` so the mounted web tile arms its one-shot new-tab mode (the
 * next Enter on the address bar adds instead of replacing) — the same seam the
 * `Web: Focus address bar` action and the ⌘L chord use, one receiver per
 * layout. No chords are registered for any of the four entries.
 */
import { WEB_ADDRESS_FOCUS_EVENT } from "../web-url";

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
};

/**
 * Build the web-tab palette actions for a window's tab family. `active` is the
 * 1-based active slot; a 0/absent pointer reads slot 1 and an out-of-range
 * pointer clamps to the family (the same clamp the mount and `activeWebUrl`
 * apply). An empty family yields no entries.
 */
export function buildWebTabActions(
  tabs: string[],
  active: number | undefined,
  handlers: WebTabVerbHandlers,
): WebTabPaletteAction[] {
  const count = tabs.length;
  if (count === 0) return [];
  const current = active !== undefined && active >= 1 ? Math.min(active, count) : 1;
  const next = current === count ? 1 : current + 1;
  const prev = current === 1 ? count : current - 1;
  return [
    ...(count >= 2
      ? [
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
        ]
      : []),
    {
      id: "web-tab-new",
      label: "Web: New tab from address",
      onSelect: () =>
        document.dispatchEvent(new CustomEvent(WEB_ADDRESS_FOCUS_EVENT, { detail: { newTab: true } })),
    },
  ];
}
