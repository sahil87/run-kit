import type { ISearchOptions, SearchAddon } from "@xterm/addon-search";
import { blendHex, type ThemePalette } from "@/themes";

/** The document CustomEvent that opens the tty find bar: dispatched by the
 *  terminal-find chord handler and the palette action; the mounted
 *  SurfaceLayout is its single receiver (the `web-find:open` precedent). */
export const TERMINAL_FIND_OPEN_EVENT = "terminal-find:open";

/** The tty find bar's muted hint-area note, shown once a search has run:
 *  addon-search sees only the xterm client buffer (what streamed since
 *  attach), never tmux history — there is no server-side search. */
export const TERMINAL_FIND_SCOPE_NOTE = "client buffer only (since attach)";

/** The terminal-native FindBar toggles, mapped onto ISearchOptions. */
export interface TerminalFindToggles {
  caseSensitive: boolean;
  regex: boolean;
}

// Fill ratios blending the match color into the terminal background: the
// addon's decoration colors are opaque #RRGGBB (no alpha channel), so a
// full-strength fill would drown the matched glyphs; the overview-ruler
// ticks stay full-strength — they sit outside the text grid.
const MATCH_FILL_RATIO = 0.35;
const ACTIVE_FILL_RATIO = 0.5;

/** Map the bar's toggles + active theme onto the addon's search options.
 *  Decoration vocabulary: amber matches, accent-green active match (the
 *  label-color vocabulary). Theme palettes ship #RRGGBB, the only form the
 *  addon accepts. */
export function buildSearchOptions(
  toggles: TerminalFindToggles,
  palette: ThemePalette,
): ISearchOptions {
  const match = palette.ansi[3];
  const active = palette.ansi[2];
  return {
    caseSensitive: toggles.caseSensitive,
    regex: toggles.regex,
    decorations: {
      matchBackground: blendHex(match, palette.background, MATCH_FILL_RATIO),
      matchOverviewRuler: match,
      activeMatchBackground: blendHex(active, palette.background, ACTIVE_FILL_RATIO),
      activeMatchColorOverviewRuler: active,
    },
  };
}

/** Run a find step, never throwing: the addon throws on an invalid pattern
 *  while the regex toggle is on, and a malformed query must behave exactly
 *  like a no-match (`false`). An absent addon or empty query is a no-op. */
export function runFind(
  addon: SearchAddon | null | undefined,
  query: string,
  direction: 1 | -1,
  options: ISearchOptions,
): boolean {
  if (!addon || query === "") return false;
  try {
    return direction === 1
      ? addon.findNext(query, options)
      : addon.findPrevious(query, options);
  } catch {
    return false;
  }
}
