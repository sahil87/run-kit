/**
 * node:test suite for the web-proxy pure logic (run via `pnpm run test`
 * after compile — the `web-views.test.ts` convention).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  guestPartitionName,
  proxyRulesFor,
  setProxyConfigFor,
  webProxyModeFor,
} from "./web-proxy";

// ── guestPartitionName ──────────────────────────────────────────────────────

test("guestPartitionName keys the partition on the host id", () => {
  assert.equal(guestPartitionName("b3f1-uuid"), "persist:rk-web:b3f1-uuid");
  assert.notEqual(guestPartitionName("a"), guestPartitionName("b"));
});

// ── webProxyModeFor ─────────────────────────────────────────────────────────

test("a remote-field host with a LOOPBACK origin is never direct (SSH tunnel)", () => {
  const ssh = { url: "http://127.0.0.1:3100", remote: "buildbox" };
  // The origin matches the local daemon origin exactly — remote still wins.
  assert.equal(webProxyModeFor(ssh, "http://127.0.0.1:3100", true), "proxy");
  assert.equal(webProxyModeFor(ssh, "http://127.0.0.1:3000", true), "proxy");
  assert.equal(webProxyModeFor(ssh, null, true), "proxy");
  assert.equal(webProxyModeFor(ssh, null, false), "legacy");
});

test("an exact local-daemon origin match is direct", () => {
  const host = { url: "http://localhost:3000" };
  assert.equal(webProxyModeFor(host, "http://localhost:3000", false), "direct");
  assert.equal(webProxyModeFor(host, "http://localhost:3000", true), "direct");
});

test("a loopback origin with NO local-daemon answer is direct", () => {
  assert.equal(webProxyModeFor({ url: "http://localhost:3000" }, null, false, "linux"), "direct");
  assert.equal(webProxyModeFor({ url: "http://127.0.0.1:3000" }, null, false, "darwin"), "direct");
  assert.equal(webProxyModeFor({ url: "http://[::1]:3000" }, null, false, "linux"), "direct");
});

test("on Windows a loopback origin is never assumed local (mirrors interstitialKindFor)", () => {
  assert.equal(webProxyModeFor({ url: "http://127.0.0.1:3000" }, null, true, "win32"), "proxy");
  assert.equal(webProxyModeFor({ url: "http://127.0.0.1:3000" }, null, false, "win32"), "legacy");
});

test("a loopback origin that is NOT the local daemon is probe-gated", () => {
  // rk answered with a different origin (e.g. 127.0.0.1 form vs localhost):
  // the loopback fallback applies only when there is NO local origin.
  const host = { url: "http://localhost:3400" };
  assert.equal(webProxyModeFor(host, "http://127.0.0.1:3400", true), "proxy");
  assert.equal(webProxyModeFor(host, "http://127.0.0.1:3400", false), "legacy");
});

test("a non-loopback host is probe-gated", () => {
  const host = { url: "http://100.101.2.3:3000" };
  assert.equal(webProxyModeFor(host, "http://127.0.0.1:3000", true), "proxy");
  assert.equal(webProxyModeFor(host, "http://127.0.0.1:3000", false), "legacy");
  assert.equal(webProxyModeFor(host, null, false), "legacy");
});

// ── proxyRulesFor ───────────────────────────────────────────────────────────

test("proxyRulesFor an http origin targets the origin itself", () => {
  assert.equal(proxyRulesFor("http://127.0.0.1:3100", 3000), "http://127.0.0.1:3100");
  assert.equal(proxyRulesFor("http://100.101.2.3:3000", null), "http://100.101.2.3:3000");
});

test("proxyRulesFor an https origin targets the advertised raw port", () => {
  assert.equal(
    proxyRulesFor("https://dev.example.ts.net", 3001),
    "http://dev.example.ts.net:3001",
  );
});

test("proxyRulesFor an https origin with no advertised port has no target", () => {
  assert.equal(proxyRulesFor("https://dev.example.ts.net", null), null);
});

test("proxyRulesFor rejects unparseable and non-http(s) urls", () => {
  assert.equal(proxyRulesFor("not a url", 3001), null);
  assert.equal(proxyRulesFor("ftp://host:21", 3001), null);
});

// ── setProxyConfigFor ───────────────────────────────────────────────────────

test("proxy mode with rules is fixed_servers with the loopback bypass removed", () => {
  assert.deepEqual(setProxyConfigFor("proxy", "http://127.0.0.1:3100"), {
    mode: "fixed_servers",
    proxyRules: "http://127.0.0.1:3100",
    proxyBypassRules: "<-loopback>",
  });
});

test("proxy mode without rules degrades to direct", () => {
  assert.deepEqual(setProxyConfigFor("proxy", null), { mode: "direct" });
});

test("direct and legacy modes are plain direct sessions", () => {
  assert.deepEqual(setProxyConfigFor("direct", null), { mode: "direct" });
  assert.deepEqual(setProxyConfigFor("legacy", null), { mode: "direct" });
  assert.deepEqual(setProxyConfigFor("legacy", "http://127.0.0.1:3100"), { mode: "direct" });
});
