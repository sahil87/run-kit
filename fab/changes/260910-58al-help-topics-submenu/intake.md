# Intake: Help Topics Submenu

**Change**: 260910-58al-help-topics-submenu
**Created**: 2026-09-10

## Origin

Conversational. The user, after publishing the cron schedule-kinds explainer to shll.ai, asked:

> How tough is it to have a feature where I can go to the Help menu and open a submenu over there and click on a few preselected help topics? If I do that what should open is a web surface in whatever terminal I am in, pointing to a URL. One of those examples is this documentation on cron.

Follow-ups named further pages (`https://shll.ai/fab-kit/merge-topologies/`, `https://shll.ai/run-kit/status-dot/`) and, from a candidate list, the user selected the final set: "Lets add boards, notifications, fkf". Decisions reached in the discussion:

- **Frontend-only.** Every topic is a public shll.ai page. shll.ai is served by GitHub Pages and sends no `X-Frame-Options` and no `Content-Security-Policy` (verified with `curl -sI` on 2026-09-10), so the pages render inside the web tile's iframe. The earlier idea of embedding `docs/wiki/*.html` into the rk binary and serving it same-origin was dropped once the explainer moved to `docs/site` and got published.
- **Reuse the `rk present` path.** Opening a topic is "add a web tab to the current window, make sure the layout shows a web surface, select the tab" — exactly what `rk present <url>` does server-side via `webAddShow`. The frontend already has each piece: `addWebTab` (`src/api/client.ts`), `addSurface` + `applyLayout` (`src/app.tsx`), `selectWebTab` (`src/api/client.ts`).
- **Keep the two existing rows.** `Help — run-kit docs` (opens `HELP_URL` = `https://shll.ai/run-kit` in a new browser tab) and `Keyboard shortcuts` stay as they are.
- **Palette twins are mandatory** (Constitution V: every menu action registered in the command palette).

## Why

The top-bar chevron menu's Help row today is a single external link to the run-kit docs root. Someone who wants the status-dot legend, the boards guide, or the cron explainer has to leave the dashboard, find the page, and lose their place. The docs also live on a different tool's site in two cases (fab-kit), which nobody discovers from a run-kit link.

The dashboard already has a web tile that renders any framable URL beside the terminal, and a CLI (`rk present`) that agents use to show pages there. Humans have no equivalent one-click path from the UI. Giving the Help row a short, curated list of topics that open in the current window's web tile makes the docs a surface of the dashboard instead of a detour, and does it with zero backend work because the pages are already published.

If we do nothing, the help affordance stays a single "go read the website" link and each newly published explainer (the cron page shipped today) is reachable only by URL.

## What Changes

### 1. A topics registry (`app/frontend/src/lib/help-topics.ts`, new)

Pure data plus a colocated `help-topics.test.ts`, following the `lib/palette/*.ts` dependency-free helper convention. One exported list, in display order:

```ts
export type HelpTopic = {
  /** Stable id — palette action id is `help-topic-${id}`; menu row key. */
  id: string;
  /** Row label. The palette label is `Help: ${label}`. */
  label: string;
  /** Absolute https URL. Stored verbatim as the web-tab target. */
  url: string;
  /** Which toolkit tool the page belongs to; rendered as a trailing muted tag when not run-kit. */
  tool: "run-kit" | "fab-kit";
};

export const HELP_TOPICS: readonly HelpTopic[] = [
  { id: "status-dot",          label: "Status dot legend",   url: "https://shll.ai/run-kit/status-dot/",          tool: "run-kit" },
  { id: "cron-schedule-kinds", label: "Cron schedule kinds", url: "https://shll.ai/run-kit/cron-schedule-kinds/", tool: "run-kit" },
  { id: "boards",              label: "Boards",              url: "https://shll.ai/run-kit/boards/",              tool: "run-kit" },
  { id: "notifications",       label: "Notifications",       url: "https://shll.ai/run-kit/notifications/",       tool: "run-kit" },
  { id: "merge-topologies",    label: "Merge topologies",    url: "https://shll.ai/fab-kit/merge-topologies/",    tool: "fab-kit" },
  { id: "fkf",                 label: "FKF",                 url: "https://shll.ai/fab-kit/fkf/",                 tool: "fab-kit" },
];
```

Tests assert: ids unique, every url absolute `https://shll.ai/`, labels non-empty, the palette-label derivation (`Help: Status dot legend`), and the action-id derivation (`help-topic-status-dot`).

### 2. The open action (`app/frontend/src/app.tsx`, or a hook beside `switchToTile`)

One shared function `openHelpTopic(topic)` used by both the menu rows and the palette actions. Behavior by context:

**Terminal mode with a current window** (`windowParam` set):

1. `const { index, existed } = await addWebTab(server, windowId, topic.url)`. The add route resolves targets like `rk present` and dedupes an identical stored address (`existed: true`), so re-clicking a topic never grows the tab family.
2. Ensure a web surface is visible:
   - Desktop (not `isMobileViewport()`): if `!layout.order.includes("web")`, `const next = addSurface(layout, "web")`; if `next` is non-null, `applyLayout(next)`. If `next` is `null` (the layout already holds 3 tiles and cannot grow), fall through to the fallback below instead of silently no-oping.
   - Mobile (narrow-width or coarse pointer): call the existing `switchToTile("web")`, which grows the shared layout the same way and writes the per-viewer zoom key so the phone shows the tile.
3. `await selectWebTab(server, windowId, index)` so the topic is the active tab even when it already existed.
4. Errors from any call surface through the existing `useToast()` `addToast(err.message)` path (the family-cap 409 message must reach the UI verbatim, as the client contract states).

**Fallback** — board, server, and host modes (no current window), and the full-layout case above: `window.open(topic.url, "_blank", "noopener,noreferrer")`, the same call the existing `Help: Documentation` palette entry makes. No toast; opening a browser tab is the expected behavior there.

### 3. Chevron-menu rows (`app/frontend/src/components/top-bar-overflow-menu.tsx`, `top-bar.tsx`)

The App section of the chevron menu today renders, in order: Settings row, `Help — run-kit docs` (external `↗`), `Keyboard shortcuts`, Theme, the operator-console row, and the fixed version row at the tail. Add **one disclosure row directly under `Help — run-kit docs`**:

- Label `Help topics`, trailing `▸` (collapsed) / `▾` (expanded); `role="menuitem"` with `aria-expanded`, `aria-controls` pointing at the group.
- Activating it (click, Enter, Space, or `→`) expands the group **inline within the same `role="menu"` list**, revealing one row per `HELP_TOPICS` entry, visually indented one step, each `role="menuitem"` styled with the existing `controlClass({ variant: "menu-row" })`. `←` or activating the disclosure again collapses it. Escape keeps its current meaning (closes the whole menu).
- The disclosure state is component-local and resets to collapsed whenever the menu closes (no persistence).
- A topic row shows a trailing muted `fab-kit` tag when `tool !== "run-kit"`. In terminal mode the row has **no** `↗` (it opens in-tile); in board/server/host modes the rows render the `↗` glyph the existing Help row uses, because there they open a browser tab.
- Clicking a topic row runs `openHelpTopic(topic)` and dismisses the menu (the existing menu-row click dismissal).
- The registry-driven menu contract (`menuOnly: true`, `menuGroup: "app"`, `barRender: () => null`) is unchanged; the disclosure is one `menuRender` entry registered next to the `help` entry so section partition and ordering logic stay untouched.

Why inline disclosure rather than a nested flyout: the menu is a single-level `role="menu"` list with section labels and no submenu primitive; a second popover layer would need new positioning, outside-click and focus-trap code and behaves poorly on coarse pointers. Six rows expanded in place keep the menu compact when collapsed and need no new primitive.

### 4. Palette twins (`app/frontend/src/hooks/use-global-palette-actions.ts`)

Fold `HELP_TOPICS.map(...)` into the action list next to `helpEntry` and `shortcutsEntry`:

```ts
const helpTopicActions: PaletteAction[] = useMemo(
  () => HELP_TOPICS.map((t) => ({
    id: `help-topic-${t.id}`,
    label: `Help: ${t.label}`,
    onSelect: () => openHelpTopic(t),
  })),
  [openHelpTopic],
);
```

Labels follow the existing `Category: Action` convention (`Help: Documentation`, `Help: Keyboard Shortcuts`). No keyboard chords are bound; the palette is the keyboard path. `withShortcutHints` decorates them like every other entry (no hint renders since no binding exists).

### 5. Tests

- Unit (Vitest): `lib/help-topics.test.ts` (registry invariants); a `top-bar-overflow-menu` test for the disclosure row (collapsed by default, expands to six rows, `aria-expanded` toggles, `←`/`→` keys, `fab-kit` tag on the two fab-kit rows, `↗` only outside terminal mode); a palette test asserting six `Help: …` entries exist with the derived ids.
- E2E (Playwright, via `just test-e2e` only): one spec, with the constitution's **Proves / Steps** JSDoc, that opens the chevron menu in terminal mode, expands Help topics, clicks `Cron schedule kinds`, and asserts the window's web-tab strip shows a tab whose address is `https://shll.ai/run-kit/cron-schedule-kinds/` and the layout now includes a web surface. The iframe's remote content is not asserted (no network dependency); the tab entry and layout are.

## Affected Memory

- `run-kit/ui/top-bar`: (modify) App section gains the `Help topics` disclosure row; row anatomy, keyboard handling, terminal-vs-other-mode `↗` rule, collapse-on-close.
- `run-kit/ui/keyboard-and-palette`: (modify) six `Help: <topic>` palette actions with ids `help-topic-<id>`, registry-fed, no chords.
- `run-kit/ui/lenses-and-layout`: (modify) the frontend open-a-URL-in-tile sequence (`addWebTab` → ensure web surface → `selectWebTab`) as the client-side counterpart of `rk present`, and the full-layout fallback to a browser tab.

## Impact

- Frontend only: `app/frontend/src/lib/help-topics.ts` (new), `components/top-bar-overflow-menu.tsx`, `components/top-bar.tsx` (registry entry), `hooks/use-global-palette-actions.ts`, `app.tsx` (or a small hook) for `openHelpTopic`, plus tests under `src/` and `tests/e2e/`.
- No Go changes, no API changes, no new routes (Constitution IV untouched), no tmux options. Uses existing `POST /api/windows/{id}/web` and `/web/{n}/select`.
- Constitution V satisfied by the palette twins. Constitution IV: this is a menu group, not a page.
- Control-gallery screenshot baselines are unaffected unless the Control primitive's classes change (they should not; the rows reuse `menu-row`).

## Open Questions

- None blocking. The topic list is the user's explicit selection; extending it later is a one-line registry edit.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Frontend-only; no embed route, no backend | Discussed — shll.ai pages verified framable (no XFO/CSP); the explainer is now published under docs/site | S:90 R:85 A:95 D:95 |
| 2 | Certain | Six topics with the URLs listed in § 1, in that order | User selected them explicitly across three messages | S:95 R:95 A:90 D:100 |
| 3 | Certain | Keep `Help — run-kit docs` and `Keyboard shortcuts` rows unchanged | User: "Keep the existing Help: Documentation … and Help: Keyboard Shortcuts rows" | S:90 R:95 A:90 D:95 |
| 4 | Confident | Inline disclosure row `Help topics ▸` in the App section, not a nested flyout | User said "submenu"; the menu has no flyout primitive; inline disclosure needs no new positioning/focus code and works on coarse pointers | S:55 R:85 A:65 D:55 |
| 5 | Confident | Open sequence: `addWebTab` → ensure web surface (`addSurface`+`applyLayout` desktop, `switchToTile("web")` mobile) → `selectWebTab` | Mirrors `webAddShow` behind `rk present`; all three client pieces exist | S:70 R:80 A:80 D:75 |
| 6 | Confident | Fallback `window.open(url, "_blank", "noopener,noreferrer")` in board/server/host modes and when the layout cannot grow | Same call the existing Help palette entry makes; user asked for in-tile only "in whatever terminal I am in" | S:75 R:90 A:80 D:70 |
| 7 | Certain | One palette action per topic, label `Help: <label>`, id `help-topic-<id>` | Constitution V; existing `Category: Action` convention | S:85 R:90 A:95 D:90 |
| 8 | Certain | Registry as pure data in `lib/help-topics.ts` with colocated tests | `lib/palette/*.ts` pure-helper convention in memory | S:70 R:95 A:85 D:80 |
| 9 | Confident | Topic rows show `↗` only outside terminal mode; `fab-kit` rows carry a muted tool tag | Existing Help row uses `↗` for external opens; the tag explains why two topics leave run-kit | S:40 R:90 A:60 D:45 |
| 10 | Confident | Re-clicking a topic selects the existing tab (`existed: true`) rather than adding another | `addWebTab` contract returns `existed`; matches `rk present` dedupe | S:65 R:90 A:85 D:80 |
| 11 | Confident | Tests: registry + menu + palette unit tests, one e2e spec asserting tab address and layout, not remote content | code-quality.md requires tests; e2e must not depend on network | S:60 R:85 A:75 D:70 |
| 12 | Confident | No tool grouping in the menu at six entries; registry order is display order | Six rows do not warrant headers; grouping noted as the split if the list grows | S:50 R:95 A:70 D:60 |

12 assumptions (5 certain, 7 confident, 0 tentative, 0 unresolved).
