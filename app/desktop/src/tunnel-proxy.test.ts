/**
 * node:test suite for the tunnel-proxy pure helpers (run via `pnpm run test`
 * after compile — the `web-views.test.ts` convention). The local proxy's
 * CONNECT/absolute-form behavior through a live tunnel WebSocket is covered
 * by the e2e fixture — Node has no built-in WebSocket server and a
 * hand-rolled frame codec duplicates that proof.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import {
  createLocalProxy,
  deriveForwardRequest,
  formatAuthority,
  parseConnectAuthority,
  stripProxyHeaders,
  TUNNEL_WS_CHUNK_BYTES,
  tunnelWsUrl,
} from "./tunnel-proxy";

// ── tunnelWsUrl ─────────────────────────────────────────────────────────────

test("tunnelWsUrl maps http→ws and carries the target URL-encoded", () => {
  assert.equal(
    tunnelWsUrl("http://100.101.2.3:3000", "example.internal:8080"),
    "ws://100.101.2.3:3000/ws/tunnel?target=example.internal%3A8080",
  );
});

test("tunnelWsUrl maps https→wss (a TLS front end passes the upgrade)", () => {
  assert.equal(
    tunnelWsUrl("https://dev.example.ts.net", "127.0.0.1:3000"),
    "wss://dev.example.ts.net/ws/tunnel?target=127.0.0.1%3A3000",
  );
});

test("tunnelWsUrl an SSH host's viewer-side tunnel origin stays loopback ws", () => {
  assert.equal(
    tunnelWsUrl("http://127.0.0.1:3100", "127.0.0.1:3000"),
    "ws://127.0.0.1:3100/ws/tunnel?target=127.0.0.1%3A3000",
  );
});

test("tunnelWsUrl a bracketed IPv6 target survives the encoding round-trip", () => {
  const url = tunnelWsUrl("http://127.0.0.1:3000", formatAuthority("::1", 8080));
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/ws/tunnel");
  assert.equal(parsed.searchParams.get("target"), "[::1]:8080");
});

test("tunnelWsUrl drops any origin path and rejects non-http(s) origins", () => {
  assert.equal(
    tunnelWsUrl("http://127.0.0.1:3000/some/base", "a:1"),
    "ws://127.0.0.1:3000/ws/tunnel?target=a%3A1",
  );
  assert.throws(() => tunnelWsUrl("ftp://host:21", "a:1"));
  assert.throws(() => tunnelWsUrl("not a url", "a:1"));
});

// ── parseConnectAuthority / formatAuthority ─────────────────────────────────

test("parseConnectAuthority accepts host:port, dotted quads, bracketed IPv6", () => {
  assert.deepEqual(parseConnectAuthority("example.com:443"), { host: "example.com", port: 443 });
  assert.deepEqual(parseConnectAuthority("127.0.0.1:8080"), { host: "127.0.0.1", port: 8080 });
  assert.deepEqual(parseConnectAuthority("[::1]:8080"), { host: "::1", port: 8080 });
  assert.deepEqual(parseConnectAuthority("[2001:db8::1]:443"), {
    host: "2001:db8::1",
    port: 443,
  });
  assert.deepEqual(parseConnectAuthority("example.com:1"), { host: "example.com", port: 1 });
  assert.deepEqual(parseConnectAuthority("example.com:65535"), {
    host: "example.com",
    port: 65535,
  });
});

test("parseConnectAuthority rejects malformed authorities", () => {
  for (const bad of [
    "example.com", // no port
    "example.com:", // empty port
    "example.com:abc", // non-numeric port
    "example.com:-1",
    "example.com:0", // port bounds
    "example.com:65536",
    ":8080", // empty host
    "[]:8080",
    "[::1]", // bracket without port
    "[::1x:80", // unterminated bracket
    "[::1]x:80", // garbage after bracket
    "::1:8080", // unbracketed IPv6 is not authority-form
    "example.com:80:90", // a second colon makes the host invalid
    "example.com: 80", // whitespace is not numeric
    "",
  ]) {
    assert.equal(parseConnectAuthority(bad), null, bad);
  }
});

test("formatAuthority brackets IPv6 and round-trips through the parser", () => {
  assert.equal(formatAuthority("example.com", 443), "example.com:443");
  assert.equal(formatAuthority("::1", 8080), "[::1]:8080");
  const target = parseConnectAuthority("[2001:db8::5]:9000");
  assert.ok(target !== null);
  assert.deepEqual(parseConnectAuthority(formatAuthority(target.host, target.port)), target);
});

// ── stripProxyHeaders ───────────────────────────────────────────────────────

test("stripProxyHeaders removes hop-by-hop and proxy-only headers", () => {
  const out = stripProxyHeaders({
    "proxy-connection": "keep-alive",
    "proxy-authorization": "Basic abc",
    connection: "keep-alive",
    "keep-alive": "timeout=5",
    te: "trailers",
    trailer: "Expires",
    upgrade: "websocket",
    "content-type": "text/html",
    authorization: "Bearer token", // NOT proxy-authorization — end-to-end
    cookie: "session=1",
  });
  assert.deepEqual(out, {
    "content-type": "text/html",
    authorization: "Bearer token",
    cookie: "session=1",
  });
});

test("stripProxyHeaders removes every header the Connection token lists", () => {
  const out = stripProxyHeaders({
    connection: "X-Foo, keep-alive , X-Bar",
    "x-foo": "1",
    "x-bar": "2",
    "x-keep": "3",
  });
  assert.deepEqual(out, { "x-keep": "3" });
});

test("stripProxyHeaders preserves multi-value headers and matches case-insensitively", () => {
  const out = stripProxyHeaders({
    "set-cookie": ["a=1", "b=2"],
    Connection: "X-Gone",
    "X-Gone": "yes",
  });
  assert.deepEqual(out, { "set-cookie": ["a=1", "b=2"] });
});

// ── deriveForwardRequest ────────────────────────────────────────────────────

test("deriveForwardRequest rewrites absolute-form to the origin-form forward shape", () => {
  const out = deriveForwardRequest("http://example.com:8080/path?q=1", {
    host: "example.com:8080",
    "proxy-connection": "keep-alive",
    accept: "*/*",
  });
  assert.deepEqual(out, {
    host: "example.com",
    port: 8080,
    path: "/path?q=1",
    headers: { accept: "*/*", host: "example.com:8080" },
  });
});

test("deriveForwardRequest defaults the port and keeps the root path", () => {
  const out = deriveForwardRequest("http://example.com", {});
  assert.deepEqual(out, { host: "example.com", port: 80, path: "/", headers: { host: "example.com" } });
});

test("deriveForwardRequest brackets IPv6 in Host but forwards the bare literal", () => {
  const out = deriveForwardRequest("http://[::1]:8080/x", {});
  assert.deepEqual(out, {
    host: "::1",
    port: 8080,
    path: "/x",
    headers: { host: "[::1]:8080" },
  });
});

test("deriveForwardRequest sets Host from the absolute URL, not the request header", () => {
  const out = deriveForwardRequest("http://real.example:9000/", { host: "forged.example" });
  assert.ok(out !== null);
  assert.equal(out.headers["host"], "real.example:9000");
});

test("deriveForwardRequest rejects non-absolute-form, https, and garbage", () => {
  assert.equal(deriveForwardRequest("/x", {}), null); // origin-form → 400
  assert.equal(deriveForwardRequest("https://example.com/x", {}), null); // https rides CONNECT
  assert.equal(deriveForwardRequest("not a url", {}), null);
  assert.equal(deriveForwardRequest("", {}), null);
});

// ── createLocalProxy (no tunnel needed: origin validation + 400 arms) ──────

test("createLocalProxy rejects a non-http(s) host origin", async () => {
  await assert.rejects(() => createLocalProxy("ftp://host:21"));
});

test("createLocalProxy binds 127.0.0.1:0 and 400s origin-form requests", async () => {
  // The origin is only used to build tunnel URLs — nothing dials it here.
  const proxy = await createLocalProxy("http://127.0.0.1:1");
  try {
    assert.ok(proxy.port > 0);
    const code = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: proxy.port,
          method: "GET",
          path: "/origin-form",
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? -1);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(code, 400);
  } finally {
    await proxy.close();
  }
});

test("createLocalProxy 400s a malformed CONNECT authority", async () => {
  const proxy = await createLocalProxy("http://127.0.0.1:1");
  try {
    // Raw socket: Node's http client fires `connect` for ANY CONNECT
    // response, so it cannot observe the refusal status.
    const head = await new Promise<string>((resolve, reject) => {
      const socket = netConnect(proxy.port, "127.0.0.1", () => {
        socket.write("CONNECT no-port-here HTTP/1.1\r\nHost: no-port-here\r\n\r\n");
      });
      let data = "";
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString("utf8");
      });
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });
    assert.ok(head.startsWith("HTTP/1.1 400"), head);
  } finally {
    await proxy.close();
  }
});

test("the write chunk size stays below the server's 1 MiB read limit", () => {
  assert.ok(TUNNEL_WS_CHUNK_BYTES <= 64 * 1024);
});
