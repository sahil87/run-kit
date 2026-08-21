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
 *  `expected` (marker = @rk_marker, color = @color, flair = @rk_flair). */
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

  test("the label zone opens the banded picker; picking a marker persists via @rk_marker (no cycling)", async ({ page }) => {
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
    // header ∅ carrying the clear for that axis. The marker axis starts unset
    // — its header ∅ is ringed (aria-selected).
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

    // The header ∅ clears the marker axis (aria-name "Marker none") — the
    // picker is still open.
    await picker.getByRole("option", { name: "Marker none" }).click();
    await expectMarker(page, winName, "");

    // The ✕ cell is the explicit dismiss (selection never closes).
    await picker.getByLabel("Close picker").click();
    await expect(picker).not.toBeVisible();
  });

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

  test("rain + scan are FLAIRS: they persist via @rk_flair and compose with any marker", async ({ page }) => {
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

    // The header ∅ clears the flair axis only — the marker survives.
    await picker.getByRole("option", { name: "Flair none" }).click();
    await expectFlair(page, winName, "");
    await expectMarker(page, winName, "dashed");

    await picker.getByLabel("Close picker").click();
  });

  test("picking a color persists via @color — normal shade through the legacy seam, dark shade verbatim", async ({ page }) => {
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
    // stored in — so @color persists as "1+3", not the family name. `exact`
    // because the paired shade band also contains "Color orange-dark", which
    // Playwright's substring name matching would otherwise collide with.
    const picker = await openLabelPicker(row, page);
    await picker.getByRole("option", { name: "Color orange", exact: true }).click();
    await expectColor(page, winName, "1+3");

    // A DARK-shade pick has no legacy form: it persists as the verbatim
    // "{family}-dark" value, which the backend validators accept. The picker
    // stayed open after the first pick (the dismissal contract), so this is
    // the same open session.
    await picker.getByRole("option", { name: "Color orange-dark", exact: true }).click();
    await expectColor(page, winName, "orange-dark");
    await picker.getByLabel("Close picker").click();
    await expect(picker).not.toBeVisible();
  });

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
      { data: { options: { "@color": "1+3" } } },
    );
    expect(setRes.ok(), "setting @color=1+3 via the options API").toBeTruthy();

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
