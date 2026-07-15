import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// scripts/test-e2e.sh isolates the tmux server/port but NOT $HOME, so this spec
// POSTs /api/boards/order against the developer's REAL ~/.rk/settings.yaml.
// Snapshot its raw bytes before the suite and restore them after so a curated
// board order is never clobbered by test residue (byte-identical round-trip).
const SETTINGS_PATH = join(homedir(), ".rk", "settings.yaml");
// `undefined` = the file did not exist before the suite (restore = delete it);
// a Buffer = its exact original bytes (restore = write them back verbatim).
let settingsSnapshot: Buffer | undefined;
let settingsExisted = false;

const TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-test-e2e";
const TEST_SESSION = `e2e-board-reorder-${Date.now()}`;
// Board names are constrained to alphanumeric/-/_. Fresh, sortable-distinct
// names per run: `zzz…` sorts AFTER `aaa…` alphabetically, so a stored order of
// [zzz, aaa] proves the reorder overrides the default alphabetical sort.
const BOARD_A = `aaa${Date.now().toString().slice(-6)}`;
const BOARD_Z = `zzz${Date.now().toString().slice(-6)}`;

function apiBase(baseURL: string | undefined): string {
  return baseURL ?? `http://localhost:${process.env.RK_PORT ?? 3020}`;
}

test.describe("Board list reorder — order endpoint + rank-aware sort + server-global SSE", () => {
  test.beforeAll(() => {
    // Snapshot the developer's REAL ~/.rk/settings.yaml (raw bytes) before this
    // suite mutates it via /api/boards/order. Restored verbatim in afterAll so
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
    try {
      execSync(
        `tmux -L ${TMUX_SERVER} new-session -d -s ${TEST_SESSION} -x 80 -y 24 -n win-a`,
        { stdio: "ignore" },
      );
      execSync(`tmux -L ${TMUX_SERVER} new-window -t ${TEST_SESSION} -n win-b`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
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

    try {
      execSync(`tmux -L ${TMUX_SERVER} kill-session -t ${TEST_SESSION}`, {
        stdio: "ignore",
      });
    } catch {
      // Best-effort
    }
  });

  function windowIds(): { winA: string; winB: string } {
    const lines = execSync(
      `tmux -L ${TMUX_SERVER} list-windows -t ${TEST_SESSION} -F "#{window_id}:#{window_name}"`,
    )
      .toString()
      .trim()
      .split("\n");
    const winA = lines.find((l) => l.endsWith(":win-a"))?.split(":")[0] ?? "";
    const winB = lines.find((l) => l.endsWith(":win-b"))?.split(":")[0] ?? "";
    return { winA, winB };
  }

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
      const pin = await request.post(`${base}/api/boards/${board}/pin`, {
        headers: { "Content-Type": "application/json" },
        data: { server: TMUX_SERVER, windowId: winId },
      });
      expect(pin.ok(), `pin ${board} → ${pin.status()}`).toBeTruthy();
    }

    // Baseline: alphabetical (aaa… before zzz…).
    const baseline = (await (await request.get(`${base}/api/boards`)).json()) as Array<{
      name: string;
    }>;
    const baseNames = baseline.map((b) => b.name).filter((n) => n === BOARD_A || n === BOARD_Z);
    expect(baseNames).toEqual([BOARD_A, BOARD_Z]);

    // POST a reorder putting zzz… FIRST — overriding the alphabetical default.
    const post = await request.post(`${base}/api/boards/order`, {
      headers: { "Content-Type": "application/json" },
      data: { order: [BOARD_Z, BOARD_A] },
    });
    expect(post.ok(), `POST /api/boards/order → ${post.status()}`).toBeTruthy();
    expect(await post.json()).toEqual({ ok: true });

    // GET now returns the stored order first (zzz…, aaa…), proving the API-layer
    // rank-aware sort applies.
    const after = (await (await request.get(`${base}/api/boards`)).json()) as Array<{
      name: string;
    }>;
    const afterNames = after.map((b) => b.name).filter((n) => n === BOARD_A || n === BOARD_Z);
    expect(afterNames).toEqual([BOARD_Z, BOARD_A]);
  });

  test("an invalid board name in the order is rejected with 400", async ({ request, baseURL }) => {
    const base = apiBase(baseURL);
    const resp = await request.post(`${base}/api/boards/order`, {
      headers: { "Content-Type": "application/json" },
      data: { order: ["bad name!"] },
    });
    expect(resp.status()).toBe(400);
  });

  test("a successful order POST broadcasts a server-global event: board-order", async ({
    page,
  }) => {
    // The Host home (`/`) attaches ZERO tmux servers, so its `?metrics=1`
    // stream is the server-neutral one — a board-order frame reaching it proves
    // the broadcast is server-global (the BOARDS zone re-sorts with no attached
    // server). Wait for the HOST HEALTH zone as the readiness signal.
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Host health" })).toBeVisible({
      timeout: 15_000,
    });

    // Open a client on the server-neutral (?metrics=1) stream — no attached tmux
    // server — and prove the board-order broadcast reaches it (server-global).
    const orderPromise = page.evaluate(
      ({ z, a }) => {
        return new Promise<string>((resolve, reject) => {
          const es = new EventSource("/api/sessions/stream?metrics=1");
          const timer = setTimeout(() => {
            es.close();
            reject(new Error("no board-order frame within timeout"));
          }, 15_000);
          es.addEventListener("board-order", (e: MessageEvent) => {
            clearTimeout(timer);
            es.close();
            resolve(e.data as string);
          });
          es.onopen = () => {
            void fetch("/api/boards/order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order: [z, a] }),
            });
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
