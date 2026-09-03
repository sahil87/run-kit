/**
 * Shared port-derivation e2e helpers.
 *
 * Specs never hardcode a port another process could occupy: a fixed "dead"
 * URL port flips the web tile's live/dead posture when anything listens
 * there (a sibling worktree's rig, a stray dev server), and a fixed stub
 * bind collides across concurrent bare Playwright runs. The dead URL
 * derives from a reserve-then-release ephemeral bind; the code stub binds
 * the harness-seeded env port or its own port-0 assignment. No run-kit
 * component binds ephemeral-range listeners the specs would hit, so a
 * just-released port is dead for the assertion window by construction.
 */
import http from "node:http";
import net from "node:net";

/** A reserved-then-released ephemeral port and its `http://localhost:<port>/`
 *  URL — dead by construction, for specs that stamp a web-tab URL that must
 *  not depend on what happens to listen on a fixed port. */
export interface DeadPort {
  port: number;
  url: string;
}

/** Reserve an ephemeral port on `127.0.0.1:0`, release it, and return it with
 *  its dead URL. Resolve ONCE per file (in `beforeAll`) and feed the same
 *  value to both the stamped URL and `stubProxyPorts` — two resolutions could
 *  yield two ports and desync the stub from the stamp. */
export function reserveDeadPort(): Promise<DeadPort> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close();
        reject(new Error("ephemeral bind returned no port"));
        return;
      }
      const port = addr.port;
      srv.close((err) =>
        err ? reject(err) : resolve({ port, url: `http://localhost:${port}/` }),
      );
    });
  });
}

/** A started stub "code-server" and the port it actually bound. */
export interface CodeStub {
  server: http.Server;
  port: number;
}

/** The code-server port the e2e backend is configured with, or `undefined`
 *  for an ephemeral bind. Under the harness `RK_CODE_SERVER_PORT` carries the
 *  derived `E2E_PORT+2` and the backend forwards the stable `/code/` route to
 *  it, so the stub MUST bind exactly that port. Bare runs (env unset) get a
 *  port-0 bind instead of a fixed fallback, so two runs never collide on the
 *  stub bind.
 *
 *  An out-of-range value is rejected here rather than at `srv.listen()`: the
 *  backend's validPort silently leaves the preset unset (convention
 *  fallback), so a bad value would surface as unrelated missing-content
 *  failures. */
function resolveCodePort(): number | undefined {
  const raw = process.env.RK_CODE_SERVER_PORT;
  if (raw === undefined || raw === "") return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `RK_CODE_SERVER_PORT="${raw}" is not a valid port (1-65535). The backend ` +
        `ignores it and disables the code lens, so this spec cannot pass. Run ` +
        `via \`just test-e2e <spec>\`, which seeds a valid port.`,
    );
  }
  return port;
}

/** Start the stub "code-server" serving `html` on every request. Binds the
 *  harness-configured `RK_CODE_SERVER_PORT` when set (see `resolveCodePort`),
 *  else an ephemeral port; read the bound port from the returned `port`, not
 *  from a constant. `workers: 1` means the code specs never hold the harness
 *  port at the same time. */
export function startCodeStub(html: string): Promise<CodeStub> {
  const configured = resolveCodePort();
  const srv = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(configured ?? 0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close();
        reject(new Error("code stub bind returned no port"));
        return;
      }
      resolve({ server: srv, port: addr.port });
    });
  });
}

/** Minimal stub body: a same-origin page with a focusable button (keyboard
 *  tests click into it). */
export function plainCodeStubHtml(): string {
  return '<!doctype html><html><body><button id="inner">stub editor</button></body></html>';
}

/** Stub "workbench" body: a focusable button that grabs focus `grabDelayMs`
 *  after load, then titles its document "grabbed" so the spec can await the
 *  grab deterministically (same-origin, so the parent can read the title).
 *  The grab is ONE-SHOT per load (matching the real editor-restore grab): the
 *  `didFocus` flag stops focus churn from retriggering the timer's target.
 *  Focusing an element inside the frame chains focus up — the iframe ELEMENT
 *  becomes the parent document's activeElement, exactly like the real steal. */
export function focusGrabCodeStubHtml(grabDelayMs: number): string {
  return (
    `<!doctype html><html><body><button id="inner">stub editor</button><script>` +
    `var didFocus=false;setTimeout(function(){if(didFocus)return;didFocus=true;` +
    `document.getElementById("inner").focus();document.title="grabbed";},${grabDelayMs});` +
    `</script></body></html>`
  );
}
