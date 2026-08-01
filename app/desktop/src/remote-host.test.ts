/**
 * node:test suite for the SSH-remote-host pure logic (run via `pnpm run
 * test` after compile).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createLineSplitter,
  parseConnectOrigin,
  parseRemoteAddOutput,
} from "./remote-host";

test("parseRemoteAddOutput reads the labeled Name/Local lines", () => {
  const stdout = "Name:   buildbox\nTarget: sahil@buildbox\nLocal:  http://127.0.0.1:3100\n";
  assert.deepEqual(parseRemoteAddOutput(stdout), {
    name: "buildbox",
    origin: "http://127.0.0.1:3100",
  });
});

test("parseRemoteAddOutput tolerates surrounding chatter and CRLF", () => {
  const stdout = "Already registered.\r\nName: vm2\r\nTarget: vm2\r\nLocal: http://127.0.0.1:3101\r\n";
  assert.deepEqual(parseRemoteAddOutput(stdout), {
    name: "vm2",
    origin: "http://127.0.0.1:3101",
  });
});

test("parseRemoteAddOutput returns null when a labeled line is missing or empty", () => {
  assert.equal(parseRemoteAddOutput("Name: buildbox\n"), null);
  assert.equal(parseRemoteAddOutput("Local: http://127.0.0.1:3100\n"), null);
  assert.equal(parseRemoteAddOutput("Name:\nLocal: http://x:1\n"), null);
  assert.equal(parseRemoteAddOutput(""), null);
});

test("parseConnectOrigin takes the final origin-shaped stdout line", () => {
  assert.equal(parseConnectOrigin("http://127.0.0.1:3100\n"), "http://127.0.0.1:3100");
  assert.equal(
    parseConnectOrigin("some note\nhttp://127.0.0.1:3100\n\n"),
    "http://127.0.0.1:3100",
  );
});

test("parseConnectOrigin rejects non-origin output", () => {
  assert.equal(parseConnectOrigin(""), null);
  assert.equal(parseConnectOrigin("connected!\n"), null);
  assert.equal(parseConnectOrigin("http://127.0.0.1:3100\ntrailing note\n"), null);
});

test("createLineSplitter emits completed lines per chunk and drains on flush", () => {
  const splitter = createLineSplitter();
  assert.deepEqual(splitter.push("connecting to build"), []);
  assert.deepEqual(splitter.push("box…\nstarting daemon"), ["connecting to buildbox…"]);
  assert.deepEqual(splitter.push(" on buildbox…\nopening tunnel"), [
    "starting daemon on buildbox…",
  ]);
  assert.deepEqual(splitter.flush(), ["opening tunnel"]);
  // Flush is drained — a second flush emits nothing.
  assert.deepEqual(splitter.flush(), []);
});

test("createLineSplitter drops blank lines and handles CRLF", () => {
  const splitter = createLineSplitter();
  assert.deepEqual(splitter.push("a\r\n\r\n  \r\nb\r\n"), ["a", "b"]);
  assert.deepEqual(splitter.flush(), []);
});
