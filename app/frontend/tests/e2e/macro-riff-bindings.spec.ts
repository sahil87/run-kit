import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Fully mocked (no tmux/wt/gh) — inject the state-socket `sessions` payload,
// the server list, and the riff endpoints via page.route, then drive the
// keyboard. See macro-riff-bindings.spec.md for intent + steps.
//
// Macro shortcut bindings over riff presets (260730-hbyh): the overlay's
// CUSTOM section (add-macro flow, command preview, missing-preset badge),
// macro chords dispatching `POST /api/riff` with the PRESET NAME only,
// success toast + navigation to the spawned window, the kind-tagged
// `Macro:` palette entry with its effective-combo hint, and the 400-toast
// path for a preset gone from fabconfig (no silent fallback).
//
// Route globs carry a trailing `*` — the client appends `?server=` (and the
// presets GET a `?session=`), so a bare glob would silently miss.

const SERVER = "default";

const DISCUSS_MACRO = {
  actionId: "macro:riff-discuss",
  kind: "macro",
  label: "riff: discuss",
  target: { type: "riff", preset: "discuss" },
};

function sessionsPayload() {
  const win = (id: number, name: string, active: boolean) => ({
    windowId: `@${id}`,
    index: id - 1,
    name,
    worktreePath: `/tmp/${name}`,
    activity: active ? "active" : "idle",
    isActiveWindow: active,
    activityTimestamp: 0,
    agentState: "idle",
  });
  return JSON.stringify([
    {
      name: "dev",
      // `@9` is the window the mocked spawn "creates" — present in the state
      // payload from the start so post-spawn navigation confirms (the mock
      // socket replays a static snapshot; a truly-new window would trip the
      // switch-confirm watchdog).
      windows: [
        win(1, "win-one", true),
        win(2, "win-two", false),
        win(9, "riff-swift-fox", false),
      ],
    },
  ]);
}

type SpawnBehavior = { status: number; body: Record<string, unknown> };

const SPAWN_OK: SpawnBehavior = {
  status: 200,
  body: { server: SERVER, session: "dev", window: "riff-swift-fox", windowId: "@9" },
};

async function mockBackend(page: Page, spawn: SpawnBehavior = SPAWN_OK) {
  const spawnBodies: Record<string, unknown>[] = [];
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
  await page.route("**/api/windows/*/select*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: SERVER, sessionCount: 1 }]),
    }),
  );
  // The spawn dialog / overlay preflight: one preset, fab built-in tier.
  await page.route("**/api/riff/presets*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        presets: [{ name: "discuss", layout: "deck-h", paneCount: 2 }],
        tiers: ["default"],
      }),
    }),
  );
  // The spawn seam. `**/api/riff?*` matches only the POST URL (the `?server=`
  // query) — `/api/riff/presets` needs a `/` that the glob `?`/`*` never match.
  await page.route("**/api/riff?*", (route) => {
    spawnBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: spawn.status,
      contentType: "application/json",
      body: JSON.stringify(spawn.body),
    });
  });
  await mockStateSocket(page, { sessions: sessionsPayload() });
  return spawnBodies;
}

async function gotoWindowOne(page: Page) {
  await page.goto(`/${SERVER}/1`);
  await expect(page.getByText("win-one").first()).toBeVisible();
}

function seedMacro(page: Page, macro: Record<string, unknown>, code: string) {
  return page.addInitScript(
    ([m, c]) => {
      localStorage.setItem("runkit-macros", JSON.stringify([m]));
      localStorage.setItem(
        "runkit-keybindings",
        JSON.stringify({ [(m as { actionId: string }).actionId]: { code: c, tier: "shifted" } }),
      );
    },
    [macro, code] as const,
  );
}

test.describe("overlay add-macro flow", () => {
  test("add a riff-preset macro, capture a key, and the chord spawns + navigates", async ({ page }) => {
    const spawnBodies = await mockBackend(page);
    await gotoWindowOne(page);

    // Open the cheatsheet and start the add flow.
    await page.keyboard.press("Shift+Control+Slash");
    const overlay = page.getByTestId("shortcuts-overlay");
    await expect(overlay).toBeVisible();
    await overlay.getByText("+ bind a key to a palette action or riff preset…").click();

    // Target list = riff presets (from the mocked preflight) + palette actions.
    await page.getByLabel("Search macro targets").fill("discuss");
    await page.getByRole("button", { name: "riff: discuss" }).click();
    await expect(page.getByLabel("Macro name")).toHaveValue("riff: discuss");
    await page.getByRole("button", { name: "add + capture key" }).click();

    // Capture armed on the fresh row — land the chord.
    await expect(overlay.getByText("press keys…")).toBeVisible();
    await page.keyboard.press("Shift+Control+KeyD");

    // Definition + combo persisted to their two stores.
    const storedMacros = await page.evaluate(() => localStorage.getItem("runkit-macros"));
    expect(JSON.parse(storedMacros ?? "[]")).toEqual([DISCUSS_MACRO]);
    const storedBindings = await page.evaluate(() => localStorage.getItem("runkit-keybindings"));
    expect(JSON.parse(storedBindings ?? "{}")).toEqual({
      "macro:riff-discuss": { code: "KeyD", tier: "shifted" },
    });
    // The row renders the resolved-command preview.
    await expect(overlay.getByText("rk riff --preset discuss")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);

    // The chord POSTs the preset name only and navigates to the spawned window.
    await page.keyboard.press("Shift+Control+KeyD");
    await expect(page.getByText("Spawned riff-swift-fox")).toBeVisible();
    expect(spawnBodies).toEqual([{ session: "dev", preset: "discuss" }]);
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/9(?:$|[/?#])`));
  });
});

test.describe("palette exposure", () => {
  test("a seeded macro appears as a kind-tagged Macro: entry with its hint and executes", async ({ page }) => {
    await seedMacro(page, DISCUSS_MACRO, "KeyD");
    const spawnBodies = await mockBackend(page);
    await gotoWindowOne(page);

    await page.keyboard.press("Meta+k");
    const paletteInput = page.getByPlaceholder("Type a command");
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill("Macro");
    await expect(page.getByText("Macro: riff: discuss")).toBeVisible();
    // The effective combo decorates the entry (non-mac host → Shift+Ctrl+D).
    await expect(page.getByText("Shift+Ctrl+D")).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.getByText("Spawned riff-swift-fox")).toBeVisible();
    expect(spawnBodies).toEqual([{ session: "dev", preset: "discuss" }]);
  });
});

test.describe("missing preset — no silent fallback", () => {
  test("the overlay flags the row and the chord surfaces the backend 400 as a toast", async ({ page }) => {
    const GONE_MACRO = {
      ...DISCUSS_MACRO,
      actionId: "macro:gone",
      label: "riff: gone",
      target: { type: "riff", preset: "gone" },
    };
    await seedMacro(page, GONE_MACRO, "KeyG");
    const spawnBodies = await mockBackend(page, {
      status: 400,
      body: { error: 'unknown preset "gone" (defined: discuss)' },
    });
    await gotoWindowOne(page);

    // The CUSTOM row carries the error badge once the preset list is known.
    await page.keyboard.press("Shift+Control+Slash");
    const overlay = page.getByTestId("shortcuts-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay.getByText("missing preset")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);

    // The chord still POSTs (the backend is authoritative) and the 400
    // surfaces as an error toast; nothing navigates.
    await page.keyboard.press("Shift+Control+KeyG");
    await expect(page.getByText(/unknown preset "gone"/)).toBeVisible();
    expect(spawnBodies).toEqual([{ session: "dev", preset: "gone" }]);
    await expect(page).toHaveURL(new RegExp(`/${SERVER}/1(?:$|[/?#])`));
  });
});
