import { test, expect, type Page } from "@playwright/test";
import { mockStateSocket } from "./_state-socket-mock";

// Operator digest & stuck triage (260822-rfz2 R6/R7). Fully mocked
// (no tmux): the sessions payload rides the state-socket mock with an operator
// window present, and both operator-request endpoints are stubbed via
// page.route. Both route mocks carry a trailing `*` — the client appends
// `?server=` (withServer), so a bare glob would silently miss. See
// operator-digest.spec.md for intent + steps.

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

  test("neither entry is listed when the server has no operator window", async ({ page }) => {
    await mockBackend(page, false);
    await gotoWindow(page);

    await openPaletteWith(page, "Operator:");
    await expect(page.getByRole("option", { name: /^Operator:/ })).toHaveCount(0);
  });
});
