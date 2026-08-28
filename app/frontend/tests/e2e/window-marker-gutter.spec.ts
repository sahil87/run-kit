/**
 * Window left-edge label zone + banded Label picker e2e: the whole 26px to
 * the left of the status dot is ONE target that opens the banded Label picker
 * (color · marker · flair bands under a composite preview row) — it does NOT
 * cycle. Picking a marker state (8-state closed set) persists via the
 * `@rk_win_marker` window option; picking a NORMAL-shade color persists via
 * `@rk_win_color` in the legacy vocabulary (`familyToLegacy` write seam) while
 * a DARK/LIGHT-shade color persists as the verbatim `{family}-{shade}` value;
 * picking a flair (12-state closed set) persists via `@rk_win_flair`. The
 * picker STAYS OPEN across picks (the dismissal contract — selection never
 * closes; the ✕ cell, an outside click, or Escape dismisses), each band's
 * header − clears ONLY its own axis, hatch rows carry the static hazard wedge
 * while thick/double/dashed rows are texture-free (rain and scan moved to the
 * flair axis), the zone click does not select the row (`stopPropagation`),
 * and selecting a colored window renders a real family tint with NO left
 * border.
 *
 * Shared setup: `beforeAll` creates `e2e-marker-<timestamp>` so the file has
 * its own isolated session; `afterAll` kills it. Tests run sequentially
 * (`fullyParallel: false`). `resolveWindow(page, name)` polls
 * `GET /api/sessions` until a window with the given name appears, returning
 * its stable tmux window id (`@N`), index, and current `marker`/`color`/
 * `flair`. Rows are selected by `data-window-id="@N"` (unique for the
 * window's lifetime; names collide and indices are reused). `expectMarker` /
 * `expectColor` / `expectFlair` poll the same snapshot until the named
 * window's field equals `expected` — they persist as tmux options and surface
 * on the SSE window payload, so a UI change is observable server-side within
 * a couple of poll cycles. `openLabelPicker(row, page)` clicks the row's
 * `Set tab label` zone and returns the visible `Label picker` listbox. The
 * banded picker is a `role="listbox"`: color swatches are `role="option"`
 * `Color <family>` / `Color <family>-dark`; marker cells are `Marker
 * <state>`; flair cells are `Flair <state>`; each band header's clear cell is
 * an option named `Clear color` / `Marker none` / `Flair none`. Color
 * locators use `exact: true` — Playwright's accessible-name matching is
 * substring-based, so `Color orange` would otherwise also match `Color
 * orange-dark`. Row-overlay assertions are scoped as DIRECT children of the
 * row root (`row.locator(":scope > …")`) because the open picker mounts
 * inside the row's DOM and its preview/band cells render the same overlay
 * classes.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { gotoServerReady, resolveWindow as resolveWindowRaw } from "./_ready";
import { TMUX_SERVER, createSession, killSession, newWindow } from "./_tmux";

// Own session per file to avoid cross-test interference (fullyParallel: false).
const TEST_SESSION = `e2e-marker-${Date.now()}`;

/** Shared snapshot resolver (hoisted to `_ready.ts`) bound to this file's
 *  server + session — the full window carries marker/color/flair too. */
const resolveWindow = (page: Page, windowName: string) =>
  resolveWindowRaw(page, TMUX_SERVER, TEST_SESSION, windowName);

/** Poll the snapshot until the named window's window-option field equals
 *  `expected` (marker = @rk_win_marker, color = @rk_win_color, flair = @rk_win_flair). */
async function expectWindowField(
  page: Page,
  windowName: string,
  field: "marker" | "color" | "flair",
  expected: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
        );
        if (!res.ok()) return "<fetch-failed>";
        const sessions = (await res.json()) as Array<{
          name: string;
          windows: Array<{ name: string; marker?: string; color?: string; flair?: string }>;
        }>;
        const win = sessions
          .find((s) => s.name === TEST_SESSION)
          ?.windows.find((w) => w.name === windowName);
        return win?.[field] ?? "";
      },
      { timeout: 6_000 },
    )
    .toBe(expected);
}

const expectMarker = (page: Page, windowName: string, expected: string) =>
  expectWindowField(page, windowName, "marker", expected);
const expectColor = (page: Page, windowName: string, expected: string) =>
  expectWindowField(page, windowName, "color", expected);
const expectFlair = (page: Page, windowName: string, expected: string) =>
  expectWindowField(page, windowName, "flair", expected);

/** Open the row's banded Label picker from the left-edge label zone. */
async function openLabelPicker(row: Locator, page: Page): Promise<Locator> {
  await row.getByLabel("Set tab label").click();
  const picker = page.getByRole("listbox", { name: "Label picker" });
  await expect(picker).toBeVisible({ timeout: 5_000 });
  return picker;
}

test.describe("Window left-edge label zone + banded picker", () => {
  test.beforeAll(() => {
    createSession(TEST_SESSION);
  });

  test.afterAll(() => {
    killSession(TEST_SESSION);
  });

  /**
   * Proves: the left-edge zone opens the banded picker (not a cycle); the
   * band chrome names all three axes (`[ color ]` / `[ marker ]` / `[ flair
   * ]` headers) and rings the marker header − while the axis is unset;
   * picking a marker state directly persists it as `@rk_win_marker`, ANY
   * state is reachable in one pick (no stepping), the categorical additions
   * (`pipe`, `hatch`, `block`) round-trip through the widened backend closed
   * set exactly like the original five, the header − clears the axis, and the
   * picker stays open across every pick (one open session), closing only via
   * the ✕ cell.
   *
   * Steps:
   * 1. Create `marker-win-<ts>` via the shared `_tmux` helper.
   * 2. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
   * 3. `resolveWindow` the window; assert its row is visible and its marker
   *    is empty.
   * 4. Click the row's `Set tab label` zone; assert the `Label picker`
   *    listbox is visible. (The picker is opened ONCE — all following picks
   *    happen inside this one open session.)
   * 5. Assert the three band headers render (`color` / `marker` / `flair`
   *    text) and the `Marker none` header − is `aria-selected` (axis unset
   *    ring).
   * 6. Click the `Marker solid` option; `expectMarker` → `solid`.
   * 7. Click `Marker double`; `expectMarker` → `double` (reached directly,
   *    not by cycling through intermediate states).
   * 8. Click `Marker pipe`, `Marker hatch`, `Marker block` in turn;
   *    `expectMarker` follows each (the widened closed set persists the new
   *    categorical states).
   * 9. Click the `Marker none` header −; `expectMarker` → `` (cleared) — the
   *    picker is still open.
   * 10. Click the `Close picker` (✕) cell; assert the listbox is no longer
   *     visible.
   */
  test("the label zone opens the banded picker; picking a marker persists via @rk_win_marker (no cycling)", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-win-${ts}`;
    newWindow(TEST_SESSION, winName);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });

    // Fresh window has no marker.
    expect(target.marker ?? "").toBe("");

    const picker = await openLabelPicker(row, page);

    // The banded chrome: each axis named by its `[ axis ]` header, with the
    // header − carrying the clear for that axis. The marker axis starts unset
    // — its header − is ringed (aria-selected).
    for (const axis of ["[ color ]", "[ marker ]", "[ flair ]"]) {
      await expect(picker.getByText(axis, { exact: true })).toBeVisible();
    }
    await expect(picker.getByRole("option", { name: "Marker none" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // The picker STAYS OPEN across picks (the dismissal contract): every state
    // below is reached inside ONE open session, live-toggling against the row.
    // Pick "solid" DIRECTLY (any state is one click — no cycling). Persists.
    await picker.getByRole("option", { name: "Marker solid" }).click();
    await expectMarker(page, winName, "solid");

    // "double" directly (still no cycling — reaches any state).
    await picker.getByRole("option", { name: "Marker double" }).click();
    await expectMarker(page, winName, "double");

    // The three CATEGORICAL additions (9hh6) persist through the same widened
    // closed set: pipe (1px hairline), hatch (45° diagonals — the in-progress
    // marker), block (heavy block dashes).
    await picker.getByRole("option", { name: "Marker pipe" }).click();
    await expectMarker(page, winName, "pipe");
    await picker.getByRole("option", { name: "Marker hatch" }).click();
    await expectMarker(page, winName, "hatch");
    await picker.getByRole("option", { name: "Marker block" }).click();
    await expectMarker(page, winName, "block");

    // The header − clears the marker axis (aria-name "Marker none") — the
    // picker is still open.
    await picker.getByRole("option", { name: "Marker none" }).click();
    await expectMarker(page, winName, "");

    // The ✕ cell is the explicit dismiss (selection never closes).
    await picker.getByLabel("Close picker").click();
    await expect(picker).not.toBeVisible();
  });

  /**
   * Proves: the hazard-wedge texture pairing sits on hatch: a hatch row
   * mounts `.rk-hazard`, a thick row mounts nothing, and no marker mounts the
   * retired rain/scanline motion (`.rk-dash-rain` / `.rk-scanlines*` are gone
   * from the marker axis entirely).
   *
   * Steps:
   * 1. Create `marker-texture-<ts>`; navigate + wait for `Connected`;
   *    `resolveWindow` it.
   * 2. Open the picker; click `Marker hatch`; `expectMarker` → `hatch`;
   *    assert the row mounts `.rk-hazard`.
   * 3. Click `Marker thick`; `expectMarker` → `thick`; assert the row has NO
   *    `.rk-hazard`, no `.rk-dash-rain`, no `[class*='rk-scanlines']`.
   * 4. Click `Marker dashed`; `expectMarker` → `dashed`; assert no
   *    `.rk-dash-rain` (the rain is a flair now).
   * 5. Close via the ✕ cell.
   */
  test("hatch rows carry the hazard wedge; thick/double rows are texture-free (the motion split)", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-texture-${ts}`;
    newWindow(TEST_SESSION, winName);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });

    const picker = await openLabelPicker(row, page);

    // NOTE on scoping: the picker mounts INSIDE the row's DOM (top-full
    // popover), and its preview/cells render the same overlay classes — so the
    // row's own overlays are matched as DIRECT children of the row root
    // (:scope >), never the picker's spans.

    // hatch ↔ hazard is the marker axis's ONE texture pairing.
    await picker.getByRole("option", { name: "Marker hatch" }).click();
    await expectMarker(page, winName, "hatch");
    await expect(row.locator(":scope > div.rk-hazard")).toBeAttached({ timeout: 5_000 });

    // thick (completed) went QUIET — no hazard, and no rain/scanline motion
    // survives on any marker (both moved to the flair axis).
    await picker.getByRole("option", { name: "Marker thick" }).click();
    await expectMarker(page, winName, "thick");
    await expect(row.locator(":scope > div.rk-hazard")).toHaveCount(0, { timeout: 5_000 });
    await expect(row.locator(".rk-dash-rain")).toHaveCount(0);
    await expect(row.locator("[class*='rk-scanlines']")).toHaveCount(0);

    // dashed goes still too — its data rain is the `rain` FLAIR now.
    await picker.getByRole("option", { name: "Marker dashed" }).click();
    await expectMarker(page, winName, "dashed");
    await expect(row.locator(".rk-dash-rain")).toHaveCount(0);

    await picker.getByLabel("Close picker").click();
  });

  /**
   * Proves: the two migrated motion treatments live on the flair axis:
   * picking `Flair rain` / `Flair scan` persists `@rk_win_flair` and mounts
   * the always-on overlay on the row alongside ANY marker (rain composes with
   * its old owner, dashed), and the flair header − clears only the flair
   * axis.
   *
   * Steps:
   * 1. Create `marker-flair-<ts>`; navigate + wait for `Connected`;
   *    `resolveWindow` it.
   * 2. Open the picker; click `Flair rain`; `expectFlair` → `rain`.
   * 3. Click `Marker dashed`; `expectMarker` → `dashed`; assert the row
   *    mounts `.rk-flair-rain` (composed with the marker).
   * 4. Click `Flair scan`; `expectFlair` → `scan`; assert the row mounts
   *    `.rk-flair-scan`.
   * 5. Click the `Flair none` header −; `expectFlair` → `` while
   *    `expectMarker` stays `dashed` (axes are independent).
   * 6. Close via the ✕ cell.
   */
  test("rain + scan are FLAIRS: they persist via @rk_win_flair and compose with any marker", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-flair-${ts}`;
    newWindow(TEST_SESSION, winName);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });

    const picker = await openLabelPicker(row, page);

    // The flair band leads with the two migrated motion treatments, then the
    // 10 shipped states.
    await picker.getByRole("option", { name: "Flair rain" }).click();
    await expectFlair(page, winName, "rain");
    // The overlay mounts on the row — composable with ANY marker (dashed
    // here, the rain's old owner). `:scope >` selects the ROW's own overlay —
    // the picker (mounted inside the row's DOM) renders the same classes on
    // its band cells.
    await picker.getByRole("option", { name: "Marker dashed" }).click();
    await expectMarker(page, winName, "dashed");
    await expect(row.locator(":scope > .rk-flair-rain")).toBeAttached({ timeout: 5_000 });

    await picker.getByRole("option", { name: "Flair scan" }).click();
    await expectFlair(page, winName, "scan");
    await expect(row.locator(":scope > .rk-flair-scan")).toBeAttached({ timeout: 5_000 });

    // The header − clears the flair axis only — the marker survives.
    await picker.getByRole("option", { name: "Flair none" }).click();
    await expectFlair(page, winName, "");
    await expectMarker(page, winName, "dashed");

    await picker.getByLabel("Close picker").click();
  });

  /**
   * Proves: the banded picker's color band writes through the
   * `familyToLegacy` seam — picking the `orange` family (normal shade)
   * persists `@rk_win_color` as the legacy descriptor `1+3` (the vocabulary
   * pre-existing colors are stored in), not the family name — while picking
   * `orange-dark` or `orange-light` persists the verbatim `{family}-{shade}`
   * value: non-normal shades have no legacy form and the backend's
   * `ValidateColorValue`/`NormalizeColorValue` accept the family-name
   * vocabulary.
   *
   * Steps:
   * 1. Create `marker-color-<ts>` via the shared `_tmux` helper; navigate +
   *    wait for `Connected`.
   * 2. `resolveWindow` it; assert its color is empty.
   * 3. Click the `Set tab label` zone; assert the `Label picker` listbox is
   *    visible.
   * 4. Click the `Color orange` option (`exact: true` — `Color orange-dark`
   *    and `Color orange-light` sit in the same family column);
   *    `expectColor` → `1+3`.
   * 5. In the SAME open session (the picker stays open after a pick), click
   *    `Color orange-dark` (`exact: true`); `expectColor` → `orange-dark`.
   * 6. Click `Color orange-light` (`exact: true`); `expectColor` →
   *    `orange-light`.
   * 7. Click the `Close picker` (✕) cell; assert the listbox is no longer
   *    visible.
   */
  test("picking a color persists via @rk_win_color — normal shade through the legacy seam, dark/light shades verbatim", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-color-${ts}`;
    newWindow(TEST_SESSION, winName);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });
    expect(target.color ?? "").toBe("");

    // Open the picker from the left-edge zone and pick the "orange" family
    // (NORMAL shade). The picker maps it to the LEGACY descriptor "1+3" at the
    // write seam (familyToLegacy) — the vocabulary pre-existing colors are
    // stored in — so @rk_win_color persists as "1+3", not the family name. `exact`
    // because the shade band also contains "Color orange-dark" and
    // "Color orange-light", which Playwright's substring name matching would
    // otherwise collide with.
    const picker = await openLabelPicker(row, page);
    await picker.getByRole("option", { name: "Color orange", exact: true }).click();
    await expectColor(page, winName, "1+3");

    // A DARK-shade pick has no legacy form: it persists as the verbatim
    // "{family}-dark" value, which the backend validators accept. The picker
    // stayed open after the first pick (the dismissal contract), so this is
    // the same open session.
    await picker.getByRole("option", { name: "Color orange-dark", exact: true }).click();
    await expectColor(page, winName, "orange-dark");

    // A LIGHT-shade pick mirrors the dark rung: no legacy form, verbatim
    // "{family}-light" storage accepted by the same closed-set validators.
    await picker.getByRole("option", { name: "Color orange-light", exact: true }).click();
    await expectColor(page, winName, "orange-light");
    await picker.getByLabel("Close picker").click();
    await expect(picker).not.toBeVisible();
  });

  /**
   * Proves: the banded picker's composite preview row shows the target row's
   * real name, and the combo caption under it names the live combo —
   * `∅ · ∅ · ∅` on a fresh window, `teal · hatch · scan` after one pick per
   * axis — repainting immediately inside the single open session.
   *
   * Steps:
   * 1. Create `marker-preview-<ts>`; navigate + wait for `Connected`;
   *    `resolveWindow` it.
   * 2. Open the picker; assert the preview shows the window's name and the
   *    caption reads `∅ · ∅ · ∅`.
   * 3. Click `Color teal` (exact), `Marker hatch`, `Flair scan`; assert the
   *    caption reads `teal · hatch · scan`.
   * 4. Close via the ✕ cell.
   */
  test("the composite preview mirrors the live combo (tint + name + caption)", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-preview-${ts}`;
    newWindow(TEST_SESSION, winName);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });

    const picker = await openLabelPicker(row, page);

    // The preview carries the row's real name; the caption under it starts
    // all-∅ (every axis unset on a fresh window).
    await expect(picker.getByText(winName)).toBeVisible();
    await expect(picker.getByText("∅ · ∅ · ∅")).toBeVisible();

    // Picks repaint the caption immediately — family name, marker, flair.
    await picker.getByRole("option", { name: "Color teal", exact: true }).click();
    await picker.getByRole("option", { name: "Marker hatch" }).click();
    await picker.getByRole("option", { name: "Flair scan" }).click();
    await expect(picker.getByText("teal · hatch · scan")).toBeVisible();

    await picker.getByLabel("Close picker").click();
  });

  /**
   * Proves: clicking the zone opens the picker WITHOUT selecting the row —
   * the label target is independent of selection, and the click's
   * `stopPropagation` prevents the row-select handler and the URL writeback
   * from firing.
   *
   * Steps:
   * 1. Create `marker-noselect-<ts>` via the shared `_tmux` helper.
   * 2. Navigate to `/${TMUX_SERVER}` (dashboard) and wait for `Connected`.
   * 3. `resolveWindow` the window; assert the row button is not
   *    `aria-current`.
   * 4. Click the row's `Set tab label` zone; assert the `Label picker`
   *    listbox is visible.
   * 5. Assert the row button is still not `aria-current="page"` and the URL
   *    still has no window segment (`windowId.slice(1)`).
   */
  test("clicking the label zone does not select the row (stopPropagation)", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-noselect-${ts}`;
    newWindow(TEST_SESSION, winName);

    await gotoServerReady(page, TMUX_SERVER);

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    const rowButton = row.getByRole("button").filter({ hasText: winName });

    // On the dashboard the row is not selected; clicking its label zone must
    // open the picker but NOT select it (the URL must not gain the window
    // segment).
    await expect(rowButton).not.toHaveAttribute("aria-current", "page");
    await row.getByLabel("Set tab label").click();
    await expect(page.getByRole("listbox", { name: "Label picker" })).toBeVisible({ timeout: 5_000 });
    // Row still not selected, URL still on the dashboard.
    await expect(rowButton).not.toHaveAttribute("aria-current", "page");
    expect(page.url()).not.toContain(`/${target.windowId.slice(1)}`);
  });

  /**
   * Proves: selection is carried by tint depth + typography alone — a
   * selected colored row paints a REAL family tint background (not
   * transparent) and bold text, with NO left border. The color is stored in
   * the legacy vocabulary the backend accepts, so the tint half is actually
   * exercised.
   *
   * Steps:
   * 1. Create `marker-sel-<ts>` via the shared `_tmux` helper; navigate +
   *    wait for `Connected`.
   * 2. `resolveWindow` it, then set `@rk_win_color` = `"1+3"` (the LEGACY
   *    descriptor for the `orange` family) via the
   *    `POST /api/windows/{id}/options` endpoint the UI uses; assert the
   *    response is OK.
   * 3. Click the row button; assert it becomes `aria-current="page"`.
   * 4. Poll the button's computed `background-color` until it is a real color
   *    (not `rgba(0, 0, 0, 0)`), then assert it is not `transparent` — the
   *    orange family tint is actually painted.
   * 5. Read the button's computed `border-left-width` — assert it is `0px`
   *    (no selection border).
   * 6. Read the computed `font-weight` — assert it is ≥ 500 (`font-medium`,
   *    the typographic half of the selection cue).
   */
  test("selecting a colored window applies the deep family tint with no left border", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-sel-${ts}`;
    newWindow(TEST_SESSION, winName);

    await gotoServerReady(page, TMUX_SERVER);
    const target0 = await resolveWindow(page, winName);

    // Store a color through the SAME API the UI uses, in the STORED (legacy)
    // vocabulary the backend validates: "1+3" is the legacy descriptor for the
    // "orange" family (the picker maps orange → "1+3" at the write seam). Setting
    // the raw family name via the tmux CLI would be dropped by the backend's
    // NormalizeColorValue on read, leaving the row uncolored. Driving it through
    // the API with the legacy value renders the real family tint.
    const setRes = await page.request.post(
      `/api/windows/${encodeURIComponent(target0.windowId)}/options?server=${encodeURIComponent(TMUX_SERVER)}`,
      { data: { options: { "@rk_win_color": "1+3" } } },
    );
    expect(setRes.ok(), "setting @rk_win_color=1+3 via the options API").toBeTruthy();

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const row = sidebar.locator(`[data-window-id="${target0.windowId}"]`);
    const rowButton = row.getByRole("button").filter({ hasText: winName });
    await expect(rowButton).toBeVisible({ timeout: 5_000 });

    await rowButton.click();
    await expect(rowButton).toHaveAttribute("aria-current", "page", { timeout: 5_000 });

    // Selection is tint depth + typography only. The stored legacy value "1+3"
    // resolves to the orange family, so the button MUST paint an actual tinted
    // background (not transparent). Poll because the color arrives on the next
    // SSE payload after the API write.
    await expect
      .poll(
        async () =>
          rowButton.evaluate((el) => getComputedStyle(el).backgroundColor),
        { timeout: 6_000 },
      )
      .not.toBe("rgba(0, 0, 0, 0)");
    const bg = await rowButton.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("transparent");

    // NO left border (removed in the axis split).
    const borderLeftWidth = await rowButton.evaluate(
      (el) => getComputedStyle(el).borderLeftWidth,
    );
    expect(borderLeftWidth).toBe("0px");
    // Bold text — the typographic half of the selection cue (font-medium → 500).
    const fontWeight = await rowButton.evaluate(
      (el) => getComputedStyle(el).fontWeight,
    );
    expect(Number(fontWeight)).toBeGreaterThanOrEqual(500);
  });
});
