# Intake: Make the All settings tab the last settings tab

**Change**: 260824-xf6p-all-settings-tab-last
**Created**: 2026-08-24

## Origin

One-shot `/fab-new` invocation, natural-language input, no prior conversation:

> The settings page right now has four tabs. Make the All Settings tab the last tab

## Why

The settings dialog's tab rail currently orders its four tabs **General, Appearance, All settings, Shortcuts**. "All settings" is the registry-driven everything-table — the advanced/escape-hatch surface (the VSCode settings.json analogue), while General, Appearance, and Shortcuts are the curated topic tabs. Sitting third, the advanced table interrupts the curated sequence: a user scanning the rail top-to-bottom hits the exhaustive table before the last curated tab.

Moving **All settings** to the end groups the three curated tabs together and places the power-user table last, matching the two-level model already documented in memory (curated tabs = palatable presentation, All settings = the exhaustive pane). If left as is, nothing breaks — this is purely an ordering/IA refinement of the tab rail.

## What Changes

### Tab rail order (`app/frontend/src/components/settings-dialog.tsx`)

The `SETTINGS_TABS` array (currently at `settings-dialog.tsx:356`) is the single source of the rail order — the tablist renders it in array order and the roving arrow-key navigation walks/wraps it in array order. Reorder the entries so `all` is last:

```ts
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "all", label: "All settings" },
];
```

Nothing else in the component changes: tab ids, labels, panel components, the `SettingsTab` union, deep-link semantics (`openSettings("all")`, palette action id `settings-all`), the default-open tab (General), and the single-tablist/roving-tabindex markup are all untouched. New display order: **General, Appearance, Shortcuts, All settings**.

### Order-dependent test update (`app/frontend/src/components/settings-dialog.test.tsx`)

The roving-tabindex test "arrow keys rove the tablist and activate on focus" (around line 446) asserts wrap behavior: `ArrowUp` from **General** wraps to the LAST tab and currently expects **Shortcuts**. After the reorder the last tab is **All settings**, so that assertion updates to expect the "All settings" tab. The four-tab presence test at line ~311 iterates labels with per-label `getByRole` queries (presence-only, order-insensitive) and needs no change; deep-link and `selectTab`-based tests target tabs by name and are order-independent.

### Other order pins

`use-global-palette-actions.test.tsx` and `settings-dialog-context.test.tsx` exercise deep-linking by tab **id** (`settings-all`, `openSettings('all')`), not rail position — unaffected. **Correction (review cycle 1)**: the e2e spec `app/frontend/tests/e2e/shortcut-registry.spec.ts` ("tabs switch by pointer and by roving arrow keys", lines ~332-340) DOES pin the rail order via ArrowDown walks (Appearance → All settings → Shortcuts) plus an order comment; it and its companion `shortcut-registry.spec.md` must be updated to the new order in the same commit.

## Affected Memory

- `run-kit/ui/dialogs-and-state`: (modify) § Settings Dialog — the "Four tabs" tab table rows reorder to General, Appearance, Shortcuts, All settings, and any prose implying All settings precedes Shortcuts is adjusted.

## Impact

- `app/frontend/src/components/settings-dialog.tsx` — one array reorder (`SETTINGS_TABS`).
- `app/frontend/src/components/settings-dialog.test.tsx` — one wrap-assertion update in the arrow-key roving test.
- `docs/memory/run-kit/ui/dialogs-and-state.md` — tab-table row order (hydrate).
- No backend, API, routing, palette-registry, or e2e surface changes. No behavior change beyond display/arrow-walk order.

## Open Questions

None — the request is unambiguous and the codebase fully determines the mechanics.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New order is General, Appearance, Shortcuts, All settings — only "All settings" moves; the other three keep their relative order | The request names exactly one tab to move and one destination (last); minimal-move is the only natural reading | S:90 R:95 A:90 D:90 |
| 2 | Certain | Tab ids, labels, deep links (`openSettings("all")`, palette `settings-all`), and the General default-open tab are untouched — display order only | Request is about position; ids/deep links are position-independent by design (memory § SettingsDialogContext) | S:80 R:95 A:95 D:95 |
| 3 | Certain | The arrow-key wrap assertion (ArrowUp from General → last tab) updates from Shortcuts to All settings | Constitution Test Integrity: tests conform to the spec'd behavior; the wrap target is derived from array order | S:80 R:90 A:95 D:90 |
| 4 | Confident | No new e2e spec — the existing colocated unit tests (updated) cover the rail order and roving nav; a pure reorder adds no new interaction surface | code-quality says UI changes SHOULD get e2e where possible, but the tab rail is already unit-covered and no e2e spec exists for this dialog's rail order | S:65 R:90 A:75 D:70 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
