import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { apiBase, pinWindow } from "./_boards";
import { TMUX_SERVER, createSession, killSession, listWindows } from "./_tmux";

// Behavioural contract for the board-list-reorder backend surface: the
// `board_order` key on POST /api/settings (persists the full ordered
// board-name list to ~/.config/run-kit/config.yaml via partial merge), the
// API-layer rank-aware sort on GET /api/boards (stored order first by index,
// then unranked boards alphabetically), and the server-global `board-order`
// broadcast that fans out to every state-socket connection — including a
// metrics-only subscription with no attached tmux server. Native HTML5 drag is
// unreliable to simulate in Playwright, so the drag affordances,
// derive-over-store override, render-time reconcile, MIME discrimination,
// self-target snap-back, debounce/flush, and palette Move actions are covered
// by Vitest unit tests (use-board-list-reorder.test.ts, palette/move.test.ts,
// boards.test.ts, boards-section.test.tsx, host-overview-page.test.tsx); this
// spec exercises the deterministic backend surface end-to-end.
//
// scripts/test-e2e.sh isolates the tmux server/port but NOT $HOME, so this
// suite's POST /api/settings writes hit the developer's REAL
// ~/.config/run-kit/config.yaml. beforeAll snapshots its raw bytes (recording
// whether the file existed at all); afterAll restores those exact bytes — or
// deletes the file when none existed — so any curated board order round-trips
// byte-identically and no test residue persists (best-effort, so a teardown
// error never masks a test failure). beforeAll also creates one tmux session
// (`e2e-board-reorder-<ts>` with windows win-a/win-b) on E2E_TMUX_SERVER
// (default `rk-test-e2e`); afterAll kills it. apiBase() resolves the backend
// origin; windowIds() reads win-a/win-b's stable tmux window ids so pins are
// created deterministically via the API (not the hover popover).
const SETTINGS_PATH = join(homedir(), ".config", "run-kit", "config.yaml");
// `undefined` = the file did not exist before the suite (restore = delete it);
// a Buffer = its exact original bytes (restore = write them back verbatim).
let settingsSnapshot: Buffer | undefined;
let settingsExisted = false;

const TEST_SESSION = `e2e-board-reorder-${Date.now()}`;
// Board names are constrained to alphanumeric/-/_. Fresh, sortable-distinct
// names per run: `zzz…` sorts AFTER `aaa…` alphabetically, so a stored order of
// [zzz, aaa] proves the reorder overrides the default alphabetical sort.
const BOARD_A = `aaa${Date.now().toString().slice(-6)}`;
const BOARD_Z = `zzz${Date.now().toString().slice(-6)}`;

test.describe("Board list reorder — order endpoint + rank-aware sort + server-global SSE", () => {
  test.beforeAll(() => {
    // Snapshot the developer's REAL ~/.config/run-kit/config.yaml (raw bytes)
    // before this
    // suite mutates it via POST /api/settings (board_order key). Restored verbatim in afterAll so
    // any curated board order survives byte-identically — $HOME is NOT isolated
    // by scripts/test-e2e.sh, so test residue would otherwise persist.
    try {
      settingsSnapshot = readFileSync(SETTINGS_PATH);
      settingsExisted = true;
    } catch (err) {
      // Only ENOENT means "no file to restore" (afterAll then deletes any
      // residue). Any other read error (EACCES/EIO) means the file EXISTS but
      // couldn't be snapshotted — rethrow so afterAll never rmSync-deletes the
      // developer's real settings on a failed snapshot.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      settingsSnapshot = undefined;
      settingsExisted = false;
    }

    // Two windows so we can pin one to each of two boards (a board exists only
    // while ≥1 pin carries its name).
    createSession(TEST_SESSION, { windows: ["win-a", "win-b"] });
  });

  test.afterAll(() => {
    // Restore the settings snapshot even if tests failed (afterAll always runs).
    // Write the ORIGINAL bytes back — or delete the file if none existed — so the
    // board order is byte-identical to before the suite ran.
    try {
      if (settingsExisted && settingsSnapshot !== undefined) {
        writeFileSync(SETTINGS_PATH, settingsSnapshot);
      } else {
        rmSync(SETTINGS_PATH, { force: true });
      }
    } catch {
      // Best-effort — never mask a test failure with a teardown error.
    }

    killSession(TEST_SESSION);
  });

  function windowIds(): { winA: string; winB: string } {
    const wins = listWindows(TEST_SESSION);
    const winA = wins.find((w) => w.name === "win-a")?.windowId ?? "";
    const winB = wins.find((w) => w.name === "win-b")?.windowId ?? "";
    return { winA, winB };
  }

  /**
   * Proves: after pinning win-a → BOARD_A and win-b → BOARD_Z, the board list
   * defaults to alphabetical ([BOARD_A, BOARD_Z]); a POST /api/settings patch
   * of {board_order: [BOARD_Z, BOARD_A]} returns {status: "ok"} and
   * GET /api/boards then returns [BOARD_Z, BOARD_A] — the API-layer
   * rank-aware sort applies the stored order.
   *
   * Steps:
   * 1. Read win-a/win-b window ids.
   * 2. POST /api/boards/<BOARD_A>/pin (win-a) and
   *    POST /api/boards/<BOARD_Z>/pin (win-b); assert each is ok.
   * 3. GET /api/boards; filter to the two test boards; assert the alphabetical
   *    baseline [BOARD_A, BOARD_Z].
   * 4. POST /api/settings with {board_order: [BOARD_Z, BOARD_A]}; assert ok +
   *    {status: "ok"}.
   * 5. GET /api/boards; filter to the two test boards; assert
   *    [BOARD_Z, BOARD_A] (stored order overrides alphabetical).
   */
  test("reorder POST persists and GET /api/boards reflects the stored order first, then alphabetical", async ({
    request,
    baseURL,
  }) => {
    const base = apiBase(baseURL);
    const { winA, winB } = windowIds();
    expect(winA, "win-a id").toBeTruthy();
    expect(winB, "win-b id").toBeTruthy();

    // Pin win-a → BOARD_A (aaa…) and win-b → BOARD_Z (zzz…). Default board list
    // sort is alphabetical, so without a stored order aaa… precedes zzz….
    for (const [board, winId] of [
      [BOARD_A, winA],
      [BOARD_Z, winB],
    ] as const) {
      await pinWindow(request, board, TMUX_SERVER, winId);
    }

    // Baseline: alphabetical (aaa… before zzz…).
    const baseline = (await (await request.get(`${base}/api/boards`)).json()) as Array<{
      name: string;
    }>;
    const baseNames = baseline.map((b) => b.name).filter((n) => n === BOARD_A || n === BOARD_Z);
    expect(baseNames).toEqual([BOARD_A, BOARD_Z]);

    // POST a reorder putting zzz… FIRST — overriding the alphabetical default.
    // The order rides POST /api/settings as the board_order key (partial merge
    // per Constitution IX).
    const post = await request.post(`${base}/api/settings`, {
      headers: { "Content-Type": "application/json" },
      data: { board_order: [BOARD_Z, BOARD_A] },
    });
    expect(post.ok(), `POST /api/settings → ${post.status()}`).toBeTruthy();
    expect(await post.json()).toEqual({ status: "ok" });

    // GET now returns the stored order first (zzz…, aaa…), proving the API-layer
    // rank-aware sort applies.
    const after = (await (await request.get(`${base}/api/boards`)).json()) as Array<{
      name: string;
    }>;
    const afterNames = after.map((b) => b.name).filter((n) => n === BOARD_A || n === BOARD_Z);
    expect(afterNames).toEqual([BOARD_Z, BOARD_A]);
  });

  /**
   * Proves: order names are validated before any write — an order containing
   * "bad name!" (fails board-name validation) returns HTTP 400.
   *
   * Steps:
   * 1. POST /api/settings with {board_order: ["bad name!"]}.
   * 2. Assert the status is 400.
   */
  test("an invalid board name in the order is rejected with 400", async ({ request, baseURL }) => {
    const base = apiBase(baseURL);
    const resp = await request.post(`${base}/api/settings`, {
      headers: { "Content-Type": "application/json" },
      data: { board_order: ["bad name!"] },
    });
    expect(resp.status()).toBe(400);
  });

  /**
   * Proves: a successful order POST fans out an `event: board-order` global
   * event to a state-socket connection subscribed to metrics only (no attached
   * tmux server), proving the broadcast is server-global — the Host BOARDS
   * zone with zero attached servers still re-sorts live.
   *
   * Steps:
   * 1. Navigate to / (the Host home — zero attached tmux servers, so its
   *    metrics-only subscription is the server-neutral one) and wait for the
   *    HOST HEALTH region as the readiness signal.
   * 2. In the page context, open a WebSocket to /ws/state, send `hello` +
   *    `subscribe {kind:"metrics"}`, and resolve on the first
   *    {op:"event",kind:"global",type:"board-order"} frame's data.
   * 3. On the socket's onopen (deterministic — no fixed delay),
   *    POST /api/settings {board_order: [BOARD_Z, BOARD_A]} from the page
   *    origin.
   * 4. Await the resolved frame; parse it and assert `order` equals
   *    [BOARD_Z, BOARD_A] (rejects if no frame arrives within the timeout).
   */
  test("a successful order POST broadcasts a server-global event: board-order", async ({
    page,
  }) => {
    // The Host home (`/`) attaches ZERO tmux servers, so its metrics-only state
    // socket subscription is the server-neutral one — a board-order envelope
    // reaching it proves the broadcast is server-global (the BOARDS zone re-sorts
    // with no attached server). Wait for the HOST HEALTH zone as the readiness
    // signal.
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Host health" })).toBeVisible({
      timeout: 15_000,
    });

    // Open an in-page state-socket client subscribed to metrics (no server
    // subscription) and prove the board-order broadcast reaches it (server-global).
    const orderPromise = page.evaluate(
      ({ z, a }) => {
        return new Promise<string>((resolve, reject) => {
          const proto = location.protocol === "https:" ? "wss:" : "ws:";
          const ws = new WebSocket(`${proto}//${location.host}/ws/state`);
          const timer = setTimeout(() => {
            ws.close();
            reject(new Error("no board-order frame within timeout"));
          }, 15_000);
          ws.onopen = () => {
            ws.send(JSON.stringify({ op: "hello", conn: "e2e-board-list-reorder" }));
            ws.send(JSON.stringify({ op: "subscribe", kind: "metrics", req: 1 }));
            void fetch("/api/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ board_order: [z, a] }),
            });
          };
          ws.onmessage = (e: MessageEvent) => {
            try {
              const m = JSON.parse(e.data as string);
              if (m.op === "event" && m.kind === "global" && m.type === "board-order") {
                clearTimeout(timer);
                ws.close();
                resolve(JSON.stringify(m.data));
              }
            } catch {
              /* ignore malformed frame */
            }
          };
        });
      },
      { z: BOARD_Z, a: BOARD_A },
    );

    const data = await orderPromise;
    const parsed = JSON.parse(data) as { order: string[] };
    expect(parsed.order).toEqual([BOARD_Z, BOARD_A]);
  });
});
