/** node:test coverage for native-notification pure logic. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  notificationTitle,
  notifyClickNavigationTarget,
  notifyNavigationTarget,
} from "./notify";

test("notifyNavigationTarget joins a valid same-origin relative path", () => {
  assert.equal(
    notifyNavigationTarget("http://127.0.0.1:3100", "/noon/57"),
    "http://127.0.0.1:3100/noon/57",
  );
});

test("notifyNavigationTarget preserves a query-carrying relative path", () => {
  assert.equal(
    notifyNavigationTarget("https://buildbox.example", "/noon/57?view=chat"),
    "https://buildbox.example/noon/57?view=chat",
  );
});

test("notifyNavigationTarget rejects empty, absolute, and non-slash paths", () => {
  assert.equal(notifyNavigationTarget("http://host:3000", ""), null);
  assert.equal(notifyNavigationTarget("http://host:3000", "https://evil.example/x"), null);
  assert.equal(notifyNavigationTarget("http://host:3000", "no-leading-slash"), null);
});

test("notifyNavigationTarget rejects protocol-relative paths", () => {
  assert.equal(notifyNavigationTarget("http://127.0.0.1:3100", "//evil.example"), null);
});

test("notifyClickNavigationTarget uses the dev view's current origin", () => {
  assert.equal(
    notifyClickNavigationTarget(
      { kind: "dev", origin: "http://localhost:4173" },
      "/noon/57",
    ),
    "http://localhost:4173/noon/57",
  );
});

test("notifyClickNavigationTarget returns null for a removed store host", () => {
  assert.equal(
    notifyClickNavigationTarget({ kind: "store", url: null }, "/noon/57"),
    null,
  );
});

test("notifyClickNavigationTarget uses a store host's changed URL", () => {
  assert.equal(
    notifyClickNavigationTarget(
      { kind: "store", url: "https://new-buildbox.example" },
      "/noon/57?view=chat",
    ),
    "https://new-buildbox.example/noon/57?view=chat",
  );
});

test("notificationTitle leaves active-host titles unchanged", () => {
  assert.equal(notificationTitle("fab operator", "buildbox", true), "fab operator");
});

test("notificationTitle prefixes background-host titles with the host name", () => {
  assert.equal(notificationTitle("fab operator", "buildbox", false), "[buildbox] fab operator");
});
