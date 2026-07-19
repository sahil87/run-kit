import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Own session per file to avoid cross-test interference (fullyParallel: false).
const TEST_SESSION = `e2e-marker-${Date.now()}`;

/**
 * Resolve a window's stable identifiers (tmux `@N` id + index) AND its current
 * marker/color from the backend snapshot by its display name. Polls because the
 * window is created via the tmux CLI and surfaces asynchronously.
 */
async function resolveWindow(
  page: Page,
  windowName: string,
): Promise<{ windowId: string; index: number; marker?: string; color?: string }> {
  const deadline = Date.now() + 5_000;
  let last: { windowId: string; index: number; marker?: string; color?: string } | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string; index: number; name: string; marker?: string; color?: string }>;
      }>;
      const win = sessions
        .find((s) => s.name === TEST_SESSION)
        ?.windows.find((w) => w.name === windowName);
      if (win) {
        last = { windowId: win.windowId, index: win.index, marker: win.marker, color: win.color };
        break;
      }
    }
    await page.waitForTimeout(200);
  }
  expect(last, `window "${windowName}" not found in snapshot`).not.toBeNull();
  return last!;
}

/** Poll the snapshot until the named window's @rk_marker equals `expected`. */
async function expectMarker(page: Page, windowName: string, expected: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
        );
        if (!res.ok()) return "<fetch-failed>";
        const sessions = (await res.json()) as Array<{
          name: string;
          windows: Array<{ name: string; marker?: string }>;
        }>;
        const win = sessions
          .find((s) => s.name === TEST_SESSION)
          ?.windows.find((w) => w.name === windowName);
        return win?.marker ?? "";
      },
      { timeout: 6_000 },
    )
    .toBe(expected);
}

/** Poll the snapshot until the named window's @color equals `expected`. */
async function expectColor(page: Page, windowName: string, expected: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
        );
        if (!res.ok()) return "<fetch-failed>";
        const sessions = (await res.json()) as Array<{
          name: string;
          windows: Array<{ name: string; color?: string }>;
        }>;
        const win = sessions
          .find((s) => s.name === TEST_SESSION)
          ?.windows.find((w) => w.name === windowName);
        return win?.color ?? "";
      },
      { timeout: 6_000 },
    )
    .toBe(expected);
}

test.describe("Window left-edge label zone + combined picker", () => {
  test.beforeAll(() => {
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24`,
        { stdio: "ignore" },
      );
    } catch {
      // Session may already exist
    }
  });

  test.afterAll(() => {
    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best effort
    }
  });

  test("the label zone opens the combined picker; picking a marker persists via @rk_marker (no cycling)", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-win-${ts}`;
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${winName}"`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });

    // Fresh window has no marker.
    expect(target.marker ?? "").toBe("");

    // The 26px left-edge zone is a single target that OPENS the combined Label
    // picker — it does NOT cycle. Named for selection by its aria-label.
    await row.getByLabel("Set window label").click();
    const picker = page.getByRole("listbox", { name: "Label picker" });
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // Pick "solid" DIRECTLY (any state is one click — no cycling). Persists.
    await picker.getByRole("option", { name: "Marker solid" }).click();
    await expectMarker(page, winName, "solid");

    // Re-open and pick "double" directly (still no cycling — reaches any state).
    await row.getByLabel("Set window label").click();
    await page.getByRole("listbox", { name: "Label picker" }).getByRole("option", { name: "Marker double" }).click();
    await expectMarker(page, winName, "double");

    // Re-open and pick "none" to clear.
    await row.getByLabel("Set window label").click();
    await page.getByRole("listbox", { name: "Label picker" }).getByRole("option", { name: "Marker none" }).click();
    await expectMarker(page, winName, "");
  });

  test("picking a color in the label picker persists via @color (legacy vocabulary seam)", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-color-${ts}`;
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${winName}"`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });
    expect(target.color ?? "").toBe("");

    // Open the picker from the left-edge zone and pick the "orange" family. The
    // picker maps it to the LEGACY descriptor "1+3" at the write seam
    // (familyToLegacy) — the vocabulary the backend validates — so @color
    // persists as "1+3", not the family name.
    await row.getByLabel("Set window label").click();
    const picker = page.getByRole("listbox", { name: "Label picker" });
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await picker.getByRole("option", { name: "Color orange" }).click();
    await expectColor(page, winName, "1+3");
  });

  test("clicking the label zone does not select the row (stopPropagation)", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-noselect-${ts}`;
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${winName}"`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("nav[aria-label='Sessions']");
    const target = await resolveWindow(page, winName);
    const row = sidebar.locator(`[data-window-id="${target.windowId}"]`);
    const rowButton = row.getByRole("button").filter({ hasText: winName });

    // On the dashboard the row is not selected; clicking its label zone must
    // open the picker but NOT select it (the URL must not gain the window
    // segment).
    await expect(rowButton).not.toHaveAttribute("aria-current", "page");
    await row.getByLabel("Set window label").click();
    await expect(page.getByRole("listbox", { name: "Label picker" })).toBeVisible({ timeout: 5_000 });
    // Row still not selected, URL still on the dashboard.
    await expect(rowButton).not.toHaveAttribute("aria-current", "page");
    expect(page.url()).not.toContain(`/${target.windowId.slice(1)}`);
  });

  test("selecting a colored window applies the deep family tint with no left border", async ({ page }) => {
    const ts = Date.now();
    const winName = `marker-sel-${ts}`;
    execSync(
      `tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n "${winName}"`,
      { stdio: "ignore" },
    );

    await page.goto(`/${TMUX_SERVER}`);
    await expect(page.locator("[aria-label='Connected']")).toBeVisible({ timeout: 10_000 });
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
