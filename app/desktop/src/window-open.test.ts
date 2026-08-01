/**
 * node:test suite for the window-open policy (run via `pnpm run test` after
 * compile — the `hosts.test.ts` convention). Compiled output is excluded
 * from packaging via the electron-builder `files` pattern.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isEditorDeeplink, isHttpUrl, windowOpenAction } from "./window-open";

test("https URLs open externally", () => {
  assert.equal(windowOpenAction("https://github.com/sahil87/run-kit/pull/1"), "open-external");
});

test("http URLs open externally", () => {
  assert.equal(windowOpenAction("http://localhost:8080/docs"), "open-external");
});

test("about:blank is denied (the addon-default URL that used to swallow links)", () => {
  assert.equal(windowOpenAction("about:blank"), "deny");
});

test("file: URLs are denied", () => {
  assert.equal(windowOpenAction("file:///etc/passwd"), "deny");
});

test("smb: URLs are denied — arbitrary schemes never reach openExternal", () => {
  assert.equal(windowOpenAction("smb://fileserver/share"), "deny");
});

test("a registered-origin http URL opens externally — no in-window branch exists", () => {
  // The policy takes no origin set at all: a URL on a registered rk server's
  // origin is routed exactly like any other http(s) URL (system browser).
  assert.equal(windowOpenAction("http://100.101.2.3:3000/utils2/rk-dev?x=1"), "open-external");
});

test("isHttpUrl accepts only http/https", () => {
  assert.equal(isHttpUrl("http://host"), true);
  assert.equal(isHttpUrl("https://host"), true);
  assert.equal(isHttpUrl("ftp://host"), false);
  assert.equal(isHttpUrl(""), false);
});

// Editor deeplinks (260801-sm6g): the fixed allowlist mirroring the SPA's
// DEEPLINK_APPS — vscode/cursor/windsurf open externally; everything else
// (including near-miss editor schemes) stays denied.

test("allowlisted editor deeplinks open externally (windowOpenAction)", () => {
  assert.equal(
    windowOpenAction("vscode://vscode-remote/ssh-remote+devbox/home/u/repo"),
    "open-external",
  );
  assert.equal(
    windowOpenAction("cursor://vscode-remote/ssh-remote+devbox/home/u/repo"),
    "open-external",
  );
  assert.equal(
    windowOpenAction("windsurf://vscode-remote/ssh-remote+devbox/home/u/repo"),
    "open-external",
  );
});

test("isEditorDeeplink matches exactly the allowlisted schemes (guardNavigation's gate)", () => {
  assert.equal(isEditorDeeplink("vscode://vscode-remote/ssh-remote+h/p"), true);
  assert.equal(isEditorDeeplink("cursor://vscode-remote/ssh-remote+h/p"), true);
  assert.equal(isEditorDeeplink("windsurf://vscode-remote/ssh-remote+h/p"), true);
  // Near-miss / arbitrary schemes never qualify — allowlist, not pass-through.
  assert.equal(isEditorDeeplink("vscode-insiders://vscode-remote/ssh-remote+h/p"), false);
  assert.equal(isEditorDeeplink("jetbrains-gateway://connect"), false);
  assert.equal(isEditorDeeplink("file:///etc/passwd"), false);
  assert.equal(isEditorDeeplink("https://host"), false);
  assert.equal(isEditorDeeplink(""), false);
});

test("non-allowlisted schemes stay denied — openExternal is never a pass-through", () => {
  assert.equal(windowOpenAction("vscode-insiders://vscode-remote/ssh-remote+h/p"), "deny");
  assert.equal(windowOpenAction("smb://fileserver/share"), "deny");
  assert.equal(windowOpenAction("file:///etc/passwd"), "deny");
});
