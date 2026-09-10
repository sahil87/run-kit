import { spawn } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { READY_TIMEOUT, gotoWindow, openPalette, resolveWindow } from "./_ready";
import { TMUX_SERVER, createSession, killSession } from "./_tmux";
import { emitGui, mockStateSocket } from "./_state-socket-mock";
import {
  fetchGuiStatusRaw,
  hasXtigervnc,
  pollGuiStatus,
  postSettingsRaw,
  restoreSettings,
  snapshotSettings,
  stableGuiGeometry,
} from "./_gui";

// GUI surface tile e2e (spec docs/specs/gui.md — the gui lens as a 4th surface
// kind). Two halves:
//
// (a) UNGATED, fully mocked (no tmux, no Xvnc): the state-socket mock carries
// a `gui` global slot (delivered on hello, flipped mid-test via `emitGui`).
// The sessions payload's `dev` session has two windows — `@1` (a code-capable
// work window, default layout) and `@2` (code-capable, `layout:
// "split-h:tty,gui"` — proving the off-degrades/on-restores rule without a
// settings write). `/ws/terminals` is accepted and held open; the window
// `/options` POST and `GET /api/gui/host` are route-stubbed (the status
// document is a parameter — the bare-WM strip tests pass one carrying
// `wm: ""` + `wm_hint`); `/ws/gui/` is route-tracked so a test can assert NO
// relay socket is opened while the host is unreachable. The bare-WM strip
// tests drive the gui slot between a bare fixture (`wm: ""`) and a WM-stamped
// one (`wm: "icewm-session"`); the palette launch-row tests stub
// `POST /api/gui/host/launch` with the `ok:false` ladder-miss document and
// capture the request body. Every reachable gui fixture carries the host's
// `geometry` setting (a fixed WxH or `auto`); the geometry tests exercise
// the palette's disabled Lock row / hidden Auto row gating across a
// fixed→`auto` flip and stub `POST /api/gui/host/resize` to capture the
// preset row's request body. Both desktop (1280px) and mobile (375px,
// hasTouch) forks run. The zoom/pointer/keybar tests live here too: the
// desktop fork drives the zoom chords and Ctrl+wheel against the badge, the
// mobile fork drives the key bar's latch rendering and a CDP two-finger
// pinch. The mocked /ws/gui/ socket is held open without an RFB handshake,
// so the tile's RFB NEVER reaches `connected` in this half — the chords,
// badge, and latch rendering are the observable surface, and the `sendKey`
// call-order assertions live in the vitest suites (gui-keybar/gui-pointer
// unit tests).
//
// (b) XVNC-GATED, real rig: skips cleanly when Xtigervnc is not on PATH (CI
// lacks it). Turns the gui switch on with a real POST /api/settings against
// the worktree's derived rig (spawns a real rk-gui session + Xtigervnc +
// openbox on the test daemon socket), opens the tile, zen-zooms it, attaches
// a coarse 375px viewer (proving a phone never drives SetDesktopSize — the
// payload width/height stay), and walks the off-confirm → degrade → restore
// cycle. A resize case POSTs /api/gui/host/resize through page.request,
// asserts the display's width/height follow within seconds and the fit-mode
// canvas letterboxes to the desktop's aspect, then resizes back. The settings
// file is snapshotted in beforeAll and restored in afterAll
// (`_gui.ts` snapshotSettings/restoreSettings — the restore also POSTs
// {"gui.enabled": null} so the rk-gui session is killed and the key unset even
// when the snapshot held no gui key; the afterAll additionally POSTs
// {"gui.geometry": null} first so the run's geometry writes never outlive it).
// The rig helpers (capability gate, status
// fetch/poll, geometry settle) are shared with gui-perf.spec.ts via `_gui.ts`.

const GUI_OFF = [
  { id: "host", enabled: false, backend: "", reachable: false, display: "", width: 0, height: 0, viewers: 0, wm: "", locked: false },
];
const GUI_ON_UNREACHABLE = [
  { id: "host", enabled: true, backend: "Xtigervnc", reachable: false, display: ":10", width: 0, height: 0, viewers: 0, wm: "", locked: false },
];
const GUI_REASON = "no VNC backend: sudo apt install --no-install-recommends tigervnc-standalone-server icewm";
const GUI_ON_BARE = [
  { id: "host", enabled: true, backend: "Xtigervnc", reachable: true, display: ":10", width: 1280, height: 800, viewers: 0, wm: "", locked: false, geometry: "1920x1080" },
];
const GUI_ON_ICEWM = [{ ...GUI_ON_BARE[0], wm: "icewm-session" }];
// Geometry variants of the reachable icewm entry: a fixed desktop size vs the
// follow-the-tile `auto` value (the palette's Lock/Auto rows key off it).
const GUI_ON_FIXED = [{ ...GUI_ON_ICEWM[0], geometry: "1600x900" }];
const GUI_ON_AUTO = [{ ...GUI_ON_ICEWM[0], geometry: "auto" }];
const GUI_WM_HINT = "sudo apt install --no-install-recommends icewm";
const GUI_STATUS_BARE = {
  id: "host",
  enabled: true,
  backend: "Xtigervnc",
  reachable: true,
  display: ":10",
  width: 1280,
  height: 800,
  viewers: 0,
  wm: "",
  wm_hint: GUI_WM_HINT,
  socket: "",
  session: "",
  reason: "",
  apps: [],
  uptime_seconds: 0,
};

const WORK_WINDOW = {
  windowId: "@1",
  index: 0,
  name: "work",
  worktreePath: "/tmp/wt",
  activity: "idle",
  isActiveWindow: true,
  activityTimestamp: 0,
  gitRoot: "/repo",
  panes: [{ paneId: "%1", paneIndex: 0, cwd: "/repo", command: "zsh", isActive: true }],
};
const GUI_LAYOUT_WINDOW = {
  ...WORK_WINDOW,
  windowId: "@2",
  index: 1,
  name: "gui-tab",
  layout: "split-h:tty,gui",
};

function sessionsPayload() {
  return JSON.stringify([{ name: "dev", windows: [WORK_WINDOW, GUI_LAYOUT_WINDOW] }]);
}

/** The mocked backend for the ungated half; returns the /ws/gui/ dial count.
 *  `statusDoc` overrides the `GET /api/gui/host` document (the bare-WM strip
 *  tests pass one carrying `wm: ""` and the `wm_hint` install line). */
async function mockGuiBackend(page: Page, gui: unknown, statusDoc?: unknown) {
  let guiDials = 0;
  await page.routeWebSocket(/\/ws\/terminals/, () => {});
  await page.routeWebSocket(/\/ws\/gui\//, () => {
    guiDials += 1;
  });
  await page.route("**/api/servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ name: "default", sessionCount: 1 }]),
    }),
  );
  await page.route("**/api/windows/*/options*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );
  await page.route("**/api/gui/host", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        statusDoc ?? {
          id: "host",
          enabled: true,
          backend: "Xtigervnc",
          reachable: false,
          display: ":10",
          width: 0,
          height: 0,
          viewers: 0,
          wm: "",
          socket: "",
          session: "",
          reason: GUI_REASON,
          apps: [],
          uptime_seconds: 0,
        },
      ),
    }),
  );
  await mockStateSocket(page, { sessions: sessionsPayload(), gui });
  // noVNC's Websock.attach() probes the raw channel's properties via
  // Object.keys + prototype names and throws on a miss; Playwright's
  // routeWebSocket mock instance forwards gets through a proxy but exposes
  // nothing to that enumeration, so constructing an RFB against a mocked
  // /ws/gui/ URL would crash the page. Wrap the constructor so /ws/gui/
  // sockets get a prototype carrying the probed names; every other socket
  // keeps the plain mock. Registered AFTER the routeWebSocket calls: init
  // scripts run in registration order, and Playwright's mock injection must
  // install first for this wrapper to ride on top of it.
  await page.addInitScript(() => {
    const probed = ["send", "close", "binaryType", "onerror", "onmessage", "onopen", "protocol", "readyState"];
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(target, args) {
        const inner = Reflect.construct(target, args);
        if (!String(args[0]).includes("/ws/gui/")) return inner;
        const patched = Object.create(Object.getPrototypeOf(inner));
        for (const name of probed) {
          Object.defineProperty(patched, name, {
            configurable: true,
            enumerable: true,
            get: () => Reflect.get(inner, name),
            set: (v) => Reflect.set(inner, name, v),
          });
        }
        // Methods bind to the inner socket: the mock extends EventTarget,
        // whose native methods (addEventListener, …) brand-check the receiver
        // and would throw "Illegal invocation" on the proxy.
        return new Proxy(inner, {
          getPrototypeOf: () => patched,
          get: (t, p) => {
            const v = Reflect.get(t, p);
            return typeof v === "function" ? v.bind(t) : v;
          },
        });
      },
    });
  });
  return { guiDials: () => guiDials };
}

/** The surface-toggle buttons by accessible name, scoped to the banner (the
 *  off-screen measurement probe duplicates every testid — getByRole excludes
 *  it). */
const toggleButton = (page: Page, name: string) =>
  page.getByRole("banner").getByRole("button", { name });

test.describe("gui surface — mocked signal, desktop (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /**
   * Proves: with the gui switch off, a code-capable window route shows exactly
   * the tty/code/web toggle buttons, the overflow Tiles menu has no GUI row,
   * the ⌘4-class chord (⇧Ctrl+4 on this Linux rig) is inert, and a window
   * whose shared layout names gui renders degraded to single:tty.
   *
   * Steps:
   * 1. Mock the backend with `gui: [{enabled:false,…}]` and open @1.
   * 2. Assert exactly the Terminal/Code/Web tile buttons in the toggle group
   *    and no GUI row in the overflow menu's Tiles section.
   * 3. Press Control+Shift+4; assert no gui tile appears.
   * 4. Open @2 (layout split-h:tty,gui); assert only the tty tile renders.
   */
  test("switch off: no 4th button, no Tiles row, the gui chord is inert, a gui layout degrades", async ({
    page,
  }) => {
    await mockGuiBackend(page, GUI_OFF);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    const group = page.getByRole("banner").getByTestId("surface-toggles");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible();
    await expect(toggleButton(page, "Code tile")).toBeVisible();
    await expect(toggleButton(page, "Web tile")).toBeVisible();
    await expect(toggleButton(page, "GUI tile")).toHaveCount(0);

    await page.getByRole("banner").getByLabel("More controls").click();
    await expect(
      page.getByRole("menu", { name: "More controls" }).getByRole("menuitemcheckbox", { name: "GUI tile" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // ⇧Ctrl+4 with the switch off mounts no handler — nothing happens.
    await page.keyboard.press("Control+Shift+4");
    await expect(page.getByTestId("surface-tile-gui")).toHaveCount(0);
    await expect(page.getByTestId("surface-tile-tty")).toBeVisible();

    // A window whose shared layout names gui degrades to single:tty while off.
    await page.goto("/default/%402");
    await expect(page.getByTestId("surface-tile-tty")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(page.getByTestId("surface-tile-gui")).toHaveCount(0);
  });

  /**
   * Proves: flipping the mocked gui slot to enabled (unreachable) adds the 4th
   * button on the open tab without a reload, and toggling it opens the gui
   * tile into the enabled-but-not-running empty state with the fetched reason
   * — with NO relay WebSocket dialed while the host is unreachable.
   *
   * Steps:
   * 1. Mock the backend off; open @1; assert no GUI button.
   * 2. `emitGui` the enabled/unreachable payload; assert the GUI tile button
   *    appears (no reload).
   * 3. Click it; assert the gui tile mounts into `gui-surface-empty` carrying
   *    the reason line, and that no /ws/gui/ socket was dialed.
   */
  test("flip on: the button appears without reload; toggling opens the empty state (no relay dial)", async ({
    page,
  }) => {
    const { guiDials } = await mockGuiBackend(page, GUI_OFF);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(toggleButton(page, "GUI tile")).toHaveCount(0);

    emitGui(GUI_ON_UNREACHABLE);
    await expect(toggleButton(page, "GUI tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    await expect(page.getByTestId("gui-surface-empty")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(page.getByTestId("gui-surface-empty")).toContainText("GUI is on but not running");
    await expect(page.getByTestId("gui-surface-empty")).toContainText(GUI_REASON);
    expect(guiDials()).toBe(0);
  });

  /**
   * Proves: on a reachable host whose supervisor stamped no window manager,
   * the gui tile shows the bare-WM strip above the canvas with the exact copy
   * and the status document's install line, Copy places exactly that line on
   * the clipboard, and a stream flip to a WM-stamped entry removes the strip.
   *
   * Steps:
   * 1. Grant clipboard permissions; mock the backend with the bare stream
   *    entry (`wm: ""`) and the bare status document (`wm_hint`).
   * 2. Open @1, toggle the gui tile on; assert `gui-wm-strip` renders the
   *    exact line `No window manager on the GUI host — <hint> · then Restart
   *    supervisor` above the canvas.
   * 3. Click Copy; assert the clipboard holds exactly the install line.
   * 4. `emitGui` the icewm-stamped entry; assert the strip is gone.
   */
  test("bare WM: the strip shows the install line, Copy puts it on the clipboard, a WM stamp removes the strip", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockGuiBackend(page, GUI_ON_BARE, GUI_STATUS_BARE);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    const strip = page.getByTestId("gui-wm-strip");
    await expect(strip).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(strip).toContainText(
      `No window manager on the GUI host — ${GUI_WM_HINT} · then Restart supervisor`,
    );

    await page.getByRole("button", { name: "Copy install line" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(GUI_WM_HINT);

    emitGui(GUI_ON_ICEWM);
    await expect(strip).toHaveCount(0);
    await expect(page.getByTestId("gui-surface-canvas")).toBeVisible();
  });

  /**
   * Proves: the strip's × dismissal is per-viewer persistent — it survives a
   * full page reload (localStorage), and a stream flip to a non-empty `wm`
   * clears the dismissal so a LATER bare state shows the strip again.
   *
   * Steps:
   * 1. Mock the backend bare; open @1; toggle the gui tile on; assert the
   *    strip, then click × and assert it is hidden.
   * 2. Reload the page (the state-socket mock replays the bare slot on hello);
   *    toggle the gui tile back on; assert the strip stays hidden.
   * 3. `emitGui` the icewm-stamped entry, then the bare one again; assert the
   *    strip is back (the WM stamp cleared the dismissal).
   */
  test("dismiss persists across reload; a WM-stamped flip re-arms the strip", async ({ page }) => {
    await mockGuiBackend(page, GUI_ON_BARE, GUI_STATUS_BARE);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    const strip = page.getByTestId("gui-wm-strip");
    await expect(strip).toBeVisible({ timeout: READY_TIMEOUT });
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(strip).toHaveCount(0);

    await page.reload();
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });
    await toggleButton(page, "GUI tile").click();
    await expect(page.getByTestId("gui-surface-canvas")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(strip).toHaveCount(0);

    emitGui(GUI_ON_ICEWM);
    await expect(page.getByTestId("gui-surface-canvas")).toBeVisible();
    emitGui(GUI_ON_BARE);
    await expect(strip).toBeVisible({ timeout: READY_TIMEOUT });
  });

  /**
   * Proves: the palette's launch rows are gated on the live signal — absent
   * while the host is unreachable, present once reachable — and selecting
   * `GUI: Open browser` POSTs `{"app":"browser"}` to the launch endpoint and
   * toasts the server's `ok:false` hint verbatim.
   *
   * Steps:
   * 1. Mock the backend enabled-but-unreachable; open @1; open the palette
   *    and assert neither `GUI: Open terminal` nor `GUI: Open browser` is
   *    listed (the supervisor-logs row still is — the family is present).
   * 2. Stub `POST /api/gui/host/launch` with the `ok:false` ladder-miss body
   *    (capturing the request body); `emitGui` the bare-but-reachable entry.
   * 3. Reopen the palette; assert both rows; select `GUI: Open browser`.
   * 4. Assert the POST body was `{"app":"browser"}` and the error toast
   *    carries the hint.
   */
  test("palette launch rows follow reachability; Open browser toasts the ladder-miss hint", async ({
    page,
  }) => {
    await mockGuiBackend(page, GUI_ON_UNREACHABLE);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    let paletteInput = await openPalette(page);
    await paletteInput.fill("GUI: Open");
    await expect(page.getByRole("option", { name: "GUI: Open terminal" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "GUI: Open browser" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "GUI: Open supervisor logs" })).toBeVisible();
    await page.keyboard.press("Escape");

    const hint = "no browser on the GUI host — sudo apt install chromium-browser";
    let launchBody: unknown = null;
    await page.route("**/api/gui/host/launch", async (route) => {
      launchBody = JSON.parse(route.request().postData() ?? "null");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, app: "browser", hint }),
      });
    });
    emitGui(GUI_ON_BARE);
    await expect(toggleButton(page, "GUI tile")).toBeVisible({ timeout: READY_TIMEOUT });

    paletteInput = await openPalette(page);
    await paletteInput.fill("GUI: Open");
    await expect(page.getByRole("option", { name: "GUI: Open terminal" })).toBeVisible();
    await page.getByRole("option", { name: "GUI: Open browser" }).click();

    await expect.poll(() => launchBody).toEqual({ app: "browser" });
    await expect(page.getByText(/no browser on the GUI host/)).toBeVisible();
  });

  /**
   * Proves: under a fixed `gui.geometry` the palette keeps `GUI: Lock
   * resolution` listed but DISABLED with the fixed-size copy (the pins are
   * inert — no viewer can drive SetDesktopSize), and flipping the stream's
   * geometry to `auto` re-enables the row while the destination-only
   * `GUI: Resolution → Auto (follow this tile)` row drops out of the list.
   *
   * Steps:
   * 1. Mock the backend with the fixed-geometry entry (`geometry: "1600x900"`,
   *    reachable, WM-stamped status document); open @1; toggle the gui tile
   *    open (the Lock row needs an open tile).
   * 2. Open the palette; assert the Lock option is aria-disabled and reads
   *    exactly `GUI: Lock resolution — resolution is fixed (1600×900) — pick
   *    Auto to follow the tile`, and that the Auto row is listed; Escape.
   * 3. `emitGui` the `auto` entry; reopen the palette; assert the Lock row is
   *    enabled again and the Auto row is gone.
   */
  test("fixed geometry: the Lock row is disabled with the fixed copy; `auto` re-enables it and drops the Auto row", async ({
    page,
  }) => {
    await mockGuiBackend(page, GUI_ON_FIXED, { ...GUI_STATUS_BARE, wm: "icewm-session", wm_hint: "" });
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });
    await toggleButton(page, "GUI tile").click();
    await expect(page.getByTestId("gui-surface-canvas")).toBeVisible({ timeout: READY_TIMEOUT });

    let paletteInput = await openPalette(page);
    await paletteInput.fill("GUI: Lock resolution");
    const lockOption = page.getByRole("option", { name: "GUI: Lock resolution" });
    await expect(lockOption).toBeVisible();
    await expect(lockOption).toHaveAttribute("aria-disabled", "true");
    await expect(lockOption).toHaveText(
      "GUI: Lock resolution — resolution is fixed (1600×900) — pick Auto to follow the tile",
    );
    await paletteInput.fill("GUI: Resolution → Auto");
    await expect(
      page.getByRole("option", { name: "GUI: Resolution → Auto (follow this tile)" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    emitGui(GUI_ON_AUTO);
    paletteInput = await openPalette(page);
    await paletteInput.fill("GUI: Lock resolution");
    await expect(lockOption).toBeVisible();
    await expect(lockOption).not.toHaveAttribute("aria-disabled", "true");
    await paletteInput.fill("GUI: Resolution → Auto");
    await expect(
      page.getByRole("option", { name: "GUI: Resolution → Auto (follow this tile)" }),
    ).toHaveCount(0);
  });

  /**
   * Proves: selecting the palette's `GUI: Resolution → 1280×720` preset row
   * POSTs the resize endpoint with exactly `{"geometry":"1280x720"}` — the ×
   * glyph is display-only, the wire value is the lowercase-x form.
   *
   * Steps:
   * 1. Stub `POST /api/gui/host/resize` (capturing the request body, answering
   *    the 200 ok document); mock the backend reachable with
   *    `geometry: "1920x1080"`; open @1.
   * 2. Open the palette, filter to the resolution rows, select
   *    `GUI: Resolution → 1280×720`.
   * 3. Assert the captured body is exactly `{ geometry: "1280x720" }`.
   */
  test("Resolution → 1280×720 posts the exact resize body", async ({ page }) => {
    let resizeBody: unknown = null;
    await page.route("**/api/gui/host/resize", async (route) => {
      resizeBody = JSON.parse(route.request().postData() ?? "null");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, geometry: "1280x720", was: "1920x1080" }),
      });
    });
    await mockGuiBackend(page, GUI_ON_ICEWM);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    const paletteInput = await openPalette(page);
    await paletteInput.fill("GUI: Resolution");
    await page.getByRole("option", { name: "GUI: Resolution → 1280×720" }).click();

    await expect.poll(() => resizeBody).toEqual({ geometry: "1280x720" });
  });

  /**
   * Proves: while the gui tile owns tile focus, the Ctrl-tier zoom chords
   * drive the zoom posture and the corner badge reports every change —
   * Ctrl+= pressed twice steps fit→100→125 (the badge reads `125%`) and
   * Ctrl+0 returns to fit (the badge reads `fit`).
   *
   * Steps:
   * 1. Mock the backend with the reachable icewm entry; open @1; toggle the
   *    gui tile on and click the canvas wrapper so the tile owns focus (the
   *    guiOnly chord handlers mount only then).
   * 2. Press Control+Equal twice; assert `gui-zoom-badge` reads `125%`.
   * 3. Press Control+Digit0; assert the badge reads `fit`.
   */
  test("zoom chords: Ctrl+= twice reads 125% on the badge; Ctrl+0 returns to fit", async ({
    page,
  }) => {
    await mockGuiBackend(page, GUI_ON_ICEWM);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    const tile = page.getByTestId("gui-surface-canvas");
    await expect(tile).toBeVisible({ timeout: READY_TIMEOUT });
    await tile.click();

    const badge = page.getByTestId("gui-zoom-badge");
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Control+Equal");
    await expect(badge).toHaveText("125%");

    await page.keyboard.press("Control+Digit0");
    await expect(badge).toHaveText("fit");
  });

  /**
   * Proves: a Ctrl+wheel over the gui tile steps the zoom ladder one notch
   * per threshold of accumulated deltaY (the badge reads `100%` after one
   * up-step from fit) while a wheel WITHOUT Ctrl is left for noVNC and never
   * moves the zoom.
   *
   * Steps:
   * 1. Mock the backend with the reachable icewm entry; open @1; toggle the
   *    gui tile on; hover the canvas wrapper's centre.
   * 2. Send a plain wheel (no Ctrl); after a settle beat assert no badge
   *    appeared.
   * 3. Hold Control and send one wheel notch above the step threshold;
   *    release Control; assert `gui-zoom-badge` reads `100%`.
   */
  test("Ctrl+wheel steps the zoom once; a plain wheel never zooms", async ({ page }) => {
    await mockGuiBackend(page, GUI_ON_ICEWM);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    const tile = page.getByTestId("gui-surface-canvas");
    await expect(tile).toBeVisible({ timeout: READY_TIMEOUT });
    const box = await tile.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const badge = page.getByTestId("gui-zoom-badge");
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(200);
    await expect(badge).toHaveCount(0);

    // -60px of deltaY clears the 50px step threshold exactly once.
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -60);
    await page.keyboard.up("Control");
    await expect(badge).toHaveText("100%");
  });
});

test.describe("gui surface — mocked signal, mobile (375px)", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  /**
   * Proves: on a coarse 375px viewport the pinned switch group shows no GUI
   * button while the switch is off, and flipping the mocked slot on adds the
   * button without a reload; tapping it switches the single visible tile to
   * the gui empty state.
   *
   * Steps:
   * 1. Mock the backend off; open @1 at 375px; assert the switch group shows
   *    Terminal/Code/Web and no GUI button.
   * 2. `emitGui` the enabled/unreachable payload; assert the GUI button
   *    appears.
   * 3. Tap it; assert the gui tile's empty state renders.
   */
  test("mobile switch group follows the mocked gui slot", async ({ page }) => {
    await mockGuiBackend(page, GUI_OFF);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(toggleButton(page, "Code tile")).toBeVisible();
    await expect(toggleButton(page, "Web tile")).toBeVisible();
    await expect(toggleButton(page, "GUI tile")).toHaveCount(0);

    emitGui(GUI_ON_UNREACHABLE);
    await expect(toggleButton(page, "GUI tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    await expect(page.getByTestId("gui-surface-empty")).toBeVisible({ timeout: READY_TIMEOUT });
  });

  /**
   * Proves: on a coarse 375px viewport the bare-WM strip renders (wrapping to
   * two lines is allowed) with both of its buttons visible and fully inside
   * the viewport — the phone's tap-reachable route that does not depend on
   * the desktop's taskbar — and × dismisses it.
   *
   * Steps:
   * 1. Mock the backend with the bare stream entry and the bare status
   *    document; open @1 at 375px; tap the GUI button in the switch group.
   * 2. Assert the strip renders and the Copy and × buttons are visible with
   *    bounding boxes inside the 375px viewport.
   * 3. Tap ×; assert the strip is gone.
   */
  test("mobile bare WM: the strip and its buttons fit the 375px viewport; × dismisses", async ({
    page,
  }) => {
    await mockGuiBackend(page, GUI_ON_BARE, GUI_STATUS_BARE);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    const strip = page.getByTestId("gui-wm-strip");
    await expect(strip).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(strip).toContainText("No window manager on the GUI host");

    for (const name of ["Copy install line", "Dismiss"]) {
      const button = page.getByRole("button", { name });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }

    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(strip).toHaveCount(0);
  });

  /**
   * Proves: on a coarse 375px viewport the key bar docks under the canvas
   * with all ten buttons (Esc Tab Ctrl Alt ⇧ ← ↑ ↓ → ⌨); the bar itself
   * fits the viewport and every button is tap-reachable inside it (the strip
   * scrolls horizontally, so both ends of the row provably land inside 375px).
   *
   * Steps:
   * 1. Mock the backend with the reachable icewm entry; open @1 at 375px;
   *    tap the GUI button in the switch group.
   * 2. Assert `gui-keybar` renders, its own box sits inside the 375px
   *    viewport, and exactly the ten buttons are listed.
   * 3. Assert the first button's box is inside the viewport, then scroll the
   *    strip's last button (⌨) into view and assert its box is too.
   */
  test("key bar: ten buttons dock under the canvas, tap-reachable inside the 375px viewport", async ({
    page,
  }) => {
    await mockGuiBackend(page, GUI_ON_ICEWM);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    await expect(page.getByTestId("gui-surface-canvas")).toBeVisible({ timeout: READY_TIMEOUT });

    const bar = page.getByTestId("gui-keybar");
    await expect(bar).toBeVisible({ timeout: READY_TIMEOUT });
    const barBox = await bar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(barBox!.x).toBeGreaterThanOrEqual(0);
    expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(375);

    for (const name of ["Esc", "Tab", "Ctrl", "Alt", "⇧", "←", "↑", "↓", "→"]) {
      await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
    }
    const keyboard = bar.getByRole("button", { name: "Toggle on-screen keyboard" });
    await expect(keyboard).toBeVisible();
    await expect(bar.getByRole("button")).toHaveCount(10);

    const first = bar.getByRole("button", { name: "Esc", exact: true });
    const firstBox = await first.boundingBox();
    expect(firstBox).not.toBeNull();
    expect(firstBox!.x).toBeGreaterThanOrEqual(0);
    expect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(375);

    await keyboard.scrollIntoViewIfNeeded();
    const lastBox = await keyboard.boundingBox();
    expect(lastBox).not.toBeNull();
    expect(lastBox!.x).toBeGreaterThanOrEqual(0);
    expect(lastBox!.x + lastBox!.width).toBeLessThanOrEqual(375);
  });

  /**
   * Proves: the key bar's modifier latch is visible state — tapping Ctrl
   * arms it (the chip renders pressed, without the locked `●` mark) and
   * tapping a non-modifier key (Esc) consumes the arm, returning Ctrl to
   * off. The ungated RFB never reaches `connected`, so the bar's rendered
   * latch is the observable here; the sendKey call order is unit-tested.
   *
   * Steps:
   * 1. Mock the backend with the reachable icewm entry; open @1 at 375px;
   *    open the gui tile; assert Ctrl starts unpressed.
   * 2. Tap Ctrl; assert it renders pressed with the plain `Ctrl` label.
   * 3. Tap Esc; assert Ctrl is unpressed again (the arm was consumed).
   */
  test("key bar latch: tapping Ctrl arms it; tapping Esc consumes the arm", async ({ page }) => {
    await mockGuiBackend(page, GUI_ON_ICEWM);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    const bar = page.getByTestId("gui-keybar");
    await expect(bar).toBeVisible({ timeout: READY_TIMEOUT });

    const ctrl = bar.getByRole("button", { name: "Ctrl", exact: true });
    await expect(ctrl).toHaveAttribute("aria-pressed", "false");

    await ctrl.tap();
    await expect(ctrl).toHaveAttribute("aria-pressed", "true");
    await expect(ctrl).toHaveText("Ctrl");

    await bar.getByRole("button", { name: "Esc", exact: true }).tap();
    await expect(ctrl).toHaveAttribute("aria-pressed", "false");
  });

  /**
   * Proves: in the coarse-default trackpad pointer mode a two-finger spread
   * on the canvas steps the zoom ladder — a symmetric pinch past the dead
   * zone moves the badge to `100%`, and spreading further moves it to
   * `125%` — while the fingers' centroid never moves (a spread, not a
   * two-finger scroll).
   *
   * Steps:
   * 1. Mock the backend with the reachable icewm entry; open @1 at 375px;
   *    open the gui tile; measure the noVNC host's centre.
   * 2. Via CDP `Input.dispatchTouchEvent`: touch down with finger 1, then
   *    finger 2, 120px apart and symmetric about the centre.
   * 3. Spread to 170px (dead zone plus one step); assert `gui-zoom-badge`
   *    reads `100%`.
   * 4. Spread to 210px (one more step); assert the badge reads `125%`; lift
   *    both fingers.
   */
  test("pinch: a two-finger spread steps the zoom badge to 100% then 125%", async ({ page }) => {
    await mockGuiBackend(page, GUI_ON_ICEWM);
    await page.goto("/default/%401");
    await expect(toggleButton(page, "Terminal tile")).toBeVisible({ timeout: READY_TIMEOUT });

    await toggleButton(page, "GUI tile").click();
    await expect(page.getByTestId("gui-surface-canvas")).toBeVisible({ timeout: READY_TIMEOUT });
    const hostBox = await page.getByTestId("gui-novnc-host").boundingBox();
    expect(hostBox).not.toBeNull();
    const cx = Math.round(hostBox!.x + hostBox!.width / 2);
    const cy = Math.round(hostBox!.y + hostBox!.height / 2);

    const client = await page.context().newCDPSession(page);
    // Two fingers land staggered (one touchStart each), then spread
    // symmetrically about the tile centre so the centroid never moves.
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: cx - 60, y: cy, id: 1 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: cx - 60, y: cy, id: 1 },
        { x: cx + 60, y: cy, id: 2 },
      ],
    });
    const spreadTo = (halfDistance: number) =>
      client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: cx - halfDistance, y: cy, id: 1 },
          { x: cx + halfDistance, y: cy, id: 2 },
        ],
      });

    const badge = page.getByTestId("gui-zoom-badge");
    await spreadTo(85); // 120 → 170px: the dead zone plus one 40px step
    await expect(badge).toHaveText("100%");
    await spreadTo(105); // 170 → 210px: one more step
    await expect(badge).toHaveText("125%");
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
});

// ── Xvnc-gated half (real rig) ──────────────────────────────────────────────

test.describe("gui surface — real Xvnc rig", () => {
  test.skip(!hasXtigervnc, "Xtigervnc not on PATH");

  const SESSION = `e2e-gui-${process.pid}`;
  let settingsSnapshot: Buffer | null = null;
  let fakeAppPid: number | null = null;

  test.beforeAll(() => {
    settingsSnapshot = snapshotSettings();
    createSession(SESSION, { windows: ["work"] });
  });

  test.afterAll(async () => {
    if (fakeAppPid !== null) {
      try {
        process.kill(fakeAppPid);
      } catch {
        /* already gone */
      }
    }
    killSession(SESSION);
    // The resize case left gui.geometry written; unset it through the daemon
    // BEFORE the snapshot restore rewrites the file, so the key cannot
    // outlive the run.
    await postSettingsRaw({ "gui.geometry": null });
    await restoreSettings(settingsSnapshot);
  });

  /**
   * Proves: on the real rig the gui switch drives the whole tile lifecycle —
   * POST {"gui.enabled":true} surfaces the 4th toggle within one state event,
   * the toggle opens a live noVNC canvas through the relay, zen zooms the
   * focused tile, a coarse 375px viewer fits WITHOUT changing the payload's
   * width/height (a phone never drives SetDesktopSize), the off-confirm lists
   * the running apps, confirming removes the button and degrades the layout,
   * and `GUI: Turn on` restores the same layout (the option was never
   * rewritten).
   *
   * Steps:
   * 1. Clean slate (a previous attempt may have left the switch on and rk-gui
   *    mid-teardown): unset the key, wait for the session to disappear, then
   *    POST the switch on; open the seeded window's terminal route; assert
   *    the GUI tile button appears.
   * 2. Poll /api/gui/host until reachable (Xvnc boot), then click the toggle;
   *    assert `gui-surface-canvas` mounts with a live noVNC canvas child.
   * 3. Click the canvas (focus), press ⇧Ctrl+Enter; assert the tty tile is
   *    display-hidden (zen zoomed the gui tile); exit zen.
   * 4. Disarm the desktop viewer (focus the tty tile — resizeSession follows
   *    focus), sample the geometry once stable across two reads; attach a
   *    coarse 375px context, switch it to the gui tile; assert the canvas
   *    fits and the payload geometry is unchanged (never toward the phone's
   *    375px tile) after a settle window.
   * 5. Spawn a fake app on the display (a sleep carrying DISPLAY in its
   *    environ); palette `GUI: Turn off`; assert the confirm lists
   *    `sleep ×1`; confirm.
   * 6. Assert the button disappears and the gui tile degrades out of the
   *    render.
   * 7. Palette `GUI: Turn on`; assert the button and the gui tile return
   *    (the layout option survived untouched).
   */
  test("the gui switch drives button → live canvas → zen → phone fit → off-confirm → restore", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    // Retry clean slate: unset first and wait out any half-torn-down session.
    await postSettingsRaw({ "gui.enabled": null });
    expect(await pollGuiStatus((s) => !s.session, 15_000)).toBe(true);
    const res = await page.request.post("/api/settings", {
      data: { "gui.enabled": true },
    });
    expect(res.ok()).toBe(true);

    const win = await resolveWindow(page, TMUX_SERVER, SESSION, "work");
    await gotoWindow(page, TMUX_SERVER, win.windowId);
    await expect(toggleButton(page, "GUI tile")).toBeVisible({ timeout: READY_TIMEOUT });

    // Xvnc boot takes seconds; reachable flips when the probe succeeds.
    expect(await pollGuiStatus((s) => s.reachable)).toBe(true);
    await toggleButton(page, "GUI tile").click();
    const canvasHost = page.getByTestId("gui-surface-canvas");
    await expect(canvasHost).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(canvasHost.locator("canvas")).toBeVisible({ timeout: READY_TIMEOUT });

    // Zen: focus the gui tile, then ⇧Ctrl+Enter zooms it (tty tile hides).
    await canvasHost.click();
    await page.keyboard.press("Control+Shift+Enter");
    await expect(page.getByTestId("surface-tile-tty")).toHaveClass(/hidden/, {
      timeout: READY_TIMEOUT,
    });
    await page.keyboard.press("Control+Shift+Enter");
    await expect(page.getByTestId("surface-tile-tty")).toBeVisible({ timeout: READY_TIMEOUT });

    // Phone fit: a coarse viewer never drives resize — the payload geometry
    // must not move when it attaches. Disarm the DESKTOP viewer first: focus
    // the tty tile (resizeSession follows tile focus, so the desktop viewer
    // stops driving SetDesktopSize), then sample the geometry once it is
    // stable — from here the phone is the only viewer that could resize, and
    // it must not.
    await page.getByTestId("surface-tile-tty").click();
    const before = await stableGuiGeometry();
    const phone = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
    });
    const phonePage = await phone.newPage();
    await phonePage.goto(`/${TMUX_SERVER}/${encodeURIComponent(win.windowId)}`);
    await expect(toggleButton(phonePage, "GUI tile")).toBeVisible({ timeout: READY_TIMEOUT });
    await toggleButton(phonePage, "GUI tile").click();
    await expect(phonePage.getByTestId("gui-surface-canvas")).toBeVisible({
      timeout: READY_TIMEOUT,
    });
    await phonePage.waitForTimeout(2_000);
    const after = await fetchGuiStatusRaw();
    expect(after?.width).toBe(before.width);
    expect(after?.height).toBe(before.height);
    // A phone-driven resize would pull the desktop toward its 375px tile.
    expect(after!.width).toBeGreaterThanOrEqual(500);
    await phone.close();

    // The off-confirm lists the running apps — spawn one on the display (any
    // process whose environ carries DISPLAY=:N counts; the supervisor tree is
    // excluded).
    const status = await fetchGuiStatusRaw();
    expect(status?.display).toBeTruthy();
    const fakeApp = spawn("sleep", ["300"], {
      env: { ...process.env, DISPLAY: status!.display },
      detached: true,
      stdio: "ignore",
    });
    fakeAppPid = fakeApp.pid ?? null;

    const paletteInput = await openPalette(page);
    await paletteInput.fill("GUI: Turn off");
    await page.getByRole("option", { name: "GUI: Turn off" }).click();
    const dialog = page.getByRole("dialog", { name: "Turn the GUI off?" });
    await expect(dialog).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(dialog).toContainText("sleep ×1", { timeout: READY_TIMEOUT });
    await dialog.getByRole("button", { name: "Turn off" }).click();

    // The button is gone on every tab and the gui tile degrades out of the
    // render (hidden — hide-never-unmount; the option is left as written).
    await expect(toggleButton(page, "GUI tile")).toHaveCount(0, { timeout: READY_TIMEOUT });
    await expect(page.getByTestId("surface-tile-gui")).toBeHidden();

    // Turn on restores the same layout — no rewrite happened on either flip.
    const onInput = await openPalette(page);
    await onInput.fill("GUI: Turn on");
    await page.getByRole("option", { name: "GUI: Turn on" }).click();
    await expect(toggleButton(page, "GUI tile")).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(page.getByTestId("surface-tile-gui")).toBeVisible({ timeout: READY_TIMEOUT });
    // The respawned Xvnc takes seconds to answer the probe again.
    await expect(page.getByTestId("gui-surface-canvas")).toBeVisible({ timeout: 30_000 });
  });

  /**
   * Proves: POST /api/gui/host/resize resizes the live display in place — the
   * status document's width/height read the requested size within seconds —
   * and the open tile's fit-mode canvas letterboxes to the desktop's 16:9
   * aspect (narrower or shorter than its host div); a second resize restores
   * 1920x1080.
   *
   * Steps:
   * 1. Clean slate (unset gui.enabled, wait out any half-torn-down session),
   *    POST the switch on, open the seeded window, assert the GUI button.
   * 2. Poll /api/gui/host until reachable; open the gui tile (the window's
   *    persisted layout may already show it from the lifecycle test above, so
   *    the toggle — which TOGGLES — is pressed only when the tile is not
   *    visible); assert the live canvas mounts.
   * 3. POST /api/gui/host/resize {"geometry":"1280x720"} via page.request;
   *    assert the status document reads width 1280 / height 720 within 5 s.
   * 4. Poll the canvas bounding box until it sits at 16:9 (width == height ×
   *    16/9 within 2 px), then assert it is contained in the noVNC host div's
   *    box and strictly narrower or shorter (the fit-mode letterbox).
   * 5. POST the resize back to {"geometry":"1920x1080"}; assert the status
   *    document follows.
   */
  test("the resize endpoint drives the display size; the fit canvas letterboxes to 16:9", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Retry clean slate: unset first and wait out any half-torn-down session.
    await postSettingsRaw({ "gui.enabled": null });
    expect(await pollGuiStatus((s) => !s.session, 15_000)).toBe(true);
    const on = await page.request.post("/api/settings", {
      data: { "gui.enabled": true },
    });
    expect(on.ok()).toBe(true);

    const win = await resolveWindow(page, TMUX_SERVER, SESSION, "work");
    await gotoWindow(page, TMUX_SERVER, win.windowId);
    await expect(toggleButton(page, "GUI tile")).toBeVisible({ timeout: READY_TIMEOUT });

    expect(await pollGuiStatus((s) => s.reachable)).toBe(true);
    const canvasHost = page.getByTestId("gui-surface-canvas");
    // The window's persisted layout may already carry an open gui tile from
    // the lifecycle test above; the toggle TOGGLES, so press it only when the
    // tile is not showing.
    const tileOpen = await canvasHost
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!tileOpen) await toggleButton(page, "GUI tile").click();
    const canvas = canvasHost.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 30_000 });

    const shrink = await page.request.post("/api/gui/host/resize", {
      data: { geometry: "1280x720" },
    });
    expect(shrink.ok()).toBe(true);
    expect(await pollGuiStatus((s) => s.width === 1280 && s.height === 720, 5_000)).toBe(true);

    // Fit mode preserves the desktop's aspect inside the tile: the canvas
    // letterboxes against the noVNC host div at the desktop's 16:9.
    const host = canvasHost.locator(":scope > div.flex-1");
    let canvasBox: { width: number; height: number } | null = null;
    let hostBox: { width: number; height: number } | null = null;
    await expect
      .poll(
        async () => {
          canvasBox = await canvas.boundingBox();
          hostBox = await host.boundingBox();
          if (!canvasBox || !hostBox) return false;
          return Math.abs(canvasBox.width - (canvasBox.height * 16) / 9) <= 2;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    expect(canvasBox!.width).toBeLessThanOrEqual(hostBox!.width);
    expect(canvasBox!.height).toBeLessThanOrEqual(hostBox!.height);
    expect(canvasBox!.width < hostBox!.width || canvasBox!.height < hostBox!.height).toBe(true);

    const back = await page.request.post("/api/gui/host/resize", {
      data: { geometry: "1920x1080" },
    });
    expect(back.ok()).toBe(true);
    expect(await pollGuiStatus((s) => s.width === 1920 && s.height === 1080, 10_000)).toBe(true);
  });
});
