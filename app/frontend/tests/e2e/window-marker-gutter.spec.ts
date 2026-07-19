import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
// Own session per file to avoid cross-test interference (fullyParallel: false).
const TEST_SESSION = `e2e-marker-${Date.now()}`;

/**
 * Resolve a window's stable identifiers (tmux `@N` id + index) AND its current
 * marker from the backend snapshot by its display name. Polls because the
 * window is created via the tmux CLI and surfaces asynchronously.
 */
async function resolveWindow(
  page: Page,
  windowName: string,
): Promise<{ windowId: string; index: number; marker?: string }> {
  const deadline = Date.now() + 5_000;
  let last: { windowId: string; index: number; marker?: string } | null = null;
  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/sessions?server=${encodeURIComponent(TMUX_SERVER)}`,
    );
    if (res.ok()) {
      const sessions = (await res.json()) as Array<{
        name: string;
        windows: Array<{ windowId: string; index: number; name: string; marker?: string }>;
      }>;
      const win = sessions
        .find((s) => s.name === TEST_SESSION)
        ?.windows.find((w) => w.name === windowName);
      if (win) {
        last = { windowId: win.windowId, index: win.index, marker: win.marker };
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

test.describe("Window marker gutter + borderless selection", () => {
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

  test("clicking the gutter cycles the marker and persists via @rk_marker", async ({ page }) => {
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

    // Pointer-only affordance — no ARIA button role (palette is the keyboard
    // path, intake #12); selected by its aria-label.
    const gutter = row.getByLabel("Cycle window marker");
    // First click: empty → dotted.
    await gutter.click();
    await expectMarker(page, winName, "dotted");

    // Second click: dotted → solid.
    await gutter.click();
    await expectMarker(page, winName, "solid");

    // Third click: solid → double.
    await gutter.click();
    await expectMarker(page, winName, "double");

    // Fourth click wraps double → empty (cleared).
    await gutter.click();
    await expectMarker(page, winName, "");
  });

  test("gutter click does not select the row (stopPropagation)", async ({ page }) => {
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

    // On the dashboard the row is not selected; clicking its gutter must NOT
    // select it (the URL must not gain the window segment).
    await expect(rowButton).not.toHaveAttribute("aria-current", "page");
    await row.getByLabel("Cycle window marker").click();
    await expectMarker(page, winName, "dotted");
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
    // NormalizeColorValue on read, leaving the row uncolored — the bug the
    // vocabulary fix (must-fix 2) closed. Driving it through the API with the
    // legacy value renders the real family tint.
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
    // background (not transparent) — this is the half the old CLI-driven test
    // silently skipped (it exercised an uncolored row). Poll because the color
    // arrives on the next SSE payload after the API write.
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
