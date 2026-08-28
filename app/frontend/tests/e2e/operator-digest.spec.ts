import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Operator digest & stuck triage — the two direct-fire `Operator:` palette
// entries with their gating and toasts, plus the zero-waiting 409 failure
// toast. Fully mocked (no tmux, no live backend): the sessions payload (a
// chat-carrying work window @1 plus, when the test wants one, an operator
// window @9 with role: "operator" in _rk-operator) rides the state-socket
// mock (_state-socket-mock.ts), and both operator-request endpoints are
// stubbed via page.route — **/api/operator-request* (server-scoped: brief-me,
// whats-stuck) and **/api/windows/*/operator-request* (window-scoped — a
// guard so no stray fire reaches a live backend). Both route mocks carry a
// trailing `*` — the client's withServer appends `?server=`, so a no-star
// mock silently falls through to live tmux. Each spec lands on the @1
// terminal route before driving the palette.

const SERVER = "default";

function sessionsPayload(withOperator: boolean) {
  const work = {
    windowId: "@1",
    index: 0,
    name: "feature-work",
    worktreePath: "/tmp/wt",
    activity: "active",
    isActiveWindow: true,
    activityTimestamp: 0,
    agentState: "idle",
    chatProvider: "claude",
    chatSessionRef: "5d80479e-8f25-46cd-a0d4-e51435508a37",
    panes: [
      { paneId: "%1", paneIndex: 0, cwd: "/tmp/wt", command: "claude", isActive: true },
    ],
  };
  return JSON.stringify([
    { name: "dev", windows: [work] },
    ...(withOperator
      ? [
          {
            name: "_rk-operator",
            windows: [
              {
                windowId: "@9",
                index: 0,
                name: "operator",
                worktreePath: "/tmp/op",
                activity: "idle",
                isActiveWindow: false,
                activityTimestamp: 0,
                role: "operator",
                agentState: "idle",
                panes: [
                  { paneId: "%9", paneIndex: 0, cwd: "/tmp/op", command: "claude", isActive: true },
                ],
              },
            ],
          },
        ]
      : []),
  ]);
}

type OpBehavior = { status: number; body: Record<string, unknown> };

const OP_OK: OpBehavior = { status: 200, body: { ok: true } };

/** Install the fully-mocked backend; returns the recorded request bodies for
 *  each operator-request route. */
async function mockBackend(page: Page, withOperator: boolean, behavior: OpBehavior = OP_OK) {
  const serverBodies: Record<string, unknown>[] = [];
  const windowBodies: Record<string, unknown>[] = [];
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
  // The server-scoped operator-request seam — trailing `*` required
  // (withServer appends `?server=`).
  await page.route("**/api/operator-request*", (route) => {
    serverBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: behavior.status,
      contentType: "application/json",
      body: JSON.stringify(behavior.body),
    });
  });
  // The window-scoped operator-request seam — same trailing-`*` rule; a
  // no-star mock silently falls through to live tmux. Guards against any
  // stray window-scoped fire reaching a live backend; no test expects one.
  await page.route("**/api/windows/*/operator-request*", (route) => {
    windowBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: behavior.status,
      contentType: "application/json",
      body: JSON.stringify(behavior.body),
    });
  });
  await mockStateSocket(page, { sessions: sessionsPayload(withOperator) });
  return { serverBodies, windowBodies };
}

const WINDOW_URL = `/${SERVER}/%401`;

async function gotoWindow(page: Page) {
  await page.goto(WINDOW_URL);
  await expect(page.getByText("feature-work").first()).toBeVisible({ timeout: 10_000 });
}

async function openPaletteWith(page: Page, query: string) {
  await page.keyboard.press("Meta+k");
  const paletteInput = page.getByPlaceholder("Type a command");
  await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  await paletteInput.fill(query);
}

test.describe("Operator digest & triage (260822-rfz2)", () => {
  /**
   * Proves: the Brief me entry needs no dialog — selecting it POSTs
   * {template: "brief-me", text: ""} to the server-scoped endpoint exactly
   * once and toasts "Sent to operator — digest will appear in the operator
   * tab".
   *
   * Steps:
   * 1. Mock the backend with an operator window and 200 stubs.
   * 2. Land on the @1 terminal route; open the palette filtered to `Operator:`.
   * 3. Select `Operator: Brief me`.
   * 4. Assert exactly one POST body {template: "brief-me", text: ""} and the
   *    digest-wording toast visible.
   */
  test("palette 'Operator: Brief me' fires the server-scoped request directly and toasts the digest wording", async ({
    page,
  }) => {
    const { serverBodies } = await mockBackend(page, true);
    await gotoWindow(page);

    await openPaletteWith(page, "Operator:");
    await page.getByRole("option", { name: "Operator: Brief me" }).click();

    await expect.poll(() => serverBodies).toEqual([{ template: "brief-me", text: "" }]);
    await expect(page.getByText("Sent to operator — digest will appear in the operator tab")).toBeVisible();
  });

  /**
   * Proves: the What's stuck entry mirrors Brief me — direct fire of
   * {template: "whats-stuck", text: ""} and the triage-wording toast.
   *
   * Steps:
   * 1. Mock the backend with an operator window and 200 stubs.
   * 2. Open the palette filtered to `Operator:`, select
   *    `Operator: What's stuck`.
   * 3. Assert exactly one POST body {template: "whats-stuck", text: ""} and
   *    the "…triage will appear in the operator tab" toast.
   */
  test("palette 'Operator: What's stuck' fires the server-scoped request directly and toasts the triage wording", async ({
    page,
  }) => {
    const { serverBodies } = await mockBackend(page, true);
    await gotoWindow(page);

    await openPaletteWith(page, "Operator:");
    await page.getByRole("option", { name: "Operator: What's stuck" }).click();

    await expect.poll(() => serverBodies).toEqual([{ template: "whats-stuck", text: "" }]);
    await expect(page.getByText("Sent to operator — triage will appear in the operator tab")).toBeVisible();
  });

  /**
   * Proves: the requiresWaiting rejection's structured `error` message
   * reaches the user as the error toast (the throwOnError seam), not a
   * generic failure.
   *
   * Steps:
   * 1. Mock the backend with an operator window and a 409 stub carrying
   *    "nothing is waiting on this server".
   * 2. Select `Operator: What's stuck` from the palette.
   * 3. Assert the POST fired and the toast carries the server's
   *    nothing-waiting message.
   */
  test("a zero-waiting 'What's stuck' surfaces the structured 409 as the failure toast", async ({ page }) => {
    const { serverBodies } = await mockBackend(page, true, {
      status: 409,
      body: { error: "nothing is waiting on this server" },
    });
    await gotoWindow(page);

    await openPaletteWith(page, "Operator:");
    await page.getByRole("option", { name: "Operator: What's stuck" }).click();

    await expect.poll(() => serverBodies).toHaveLength(1);
    await expect(page.getByText("nothing is waiting on this server")).toBeVisible();
  });

  /**
   * Proves: the degrade-to-absent gate — with no role: "operator" window in
   * the sessions payload, every `Operator:` palette entry is omitted (not
   * disabled).
   *
   * Steps:
   * 1. Mock the backend WITHOUT an operator window.
   * 2. Open the palette filtered to `Operator:`.
   * 3. Assert zero `Operator:` options.
   */
  test("neither entry is listed when the server has no operator window", async ({ page }) => {
    await mockBackend(page, false);
    await gotoWindow(page);

    await openPaletteWith(page, "Operator:");
    await expect(page.getByRole("option", { name: /^Operator:/ })).toHaveCount(0);
  });
});
