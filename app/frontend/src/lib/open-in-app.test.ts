import { describe, it, expect, beforeEach } from "vitest";
import type { WindowInfo } from "@/types";
import {
  DEEPLINK_APPS,
  isLocalHostname,
  buildOpenTargets,
  activePaneCwd,
  readLastUsedOpenTarget,
  writeLastUsedOpenTarget,
  resolveLastUsedTarget,
  LAST_USED_OPEN_TARGET_KEY,
  type OpenTarget,
} from "./open-in-app";

describe("DEEPLINK_APPS", () => {
  it("carries exactly vscode, cursor, windsurf", () => {
    expect(DEEPLINK_APPS.map((a) => a.id)).toEqual(["vscode", "cursor", "windsurf"]);
  });

  it("composes the ssh-remote URI grammar", () => {
    const vscode = DEEPLINK_APPS[0];
    expect(vscode.url("devbox", "/Users/x/code/proj")).toBe(
      "vscode://vscode-remote/ssh-remote+devbox/Users/x/code/proj",
    );
    const windsurf = DEEPLINK_APPS[2];
    expect(windsurf.url("h", "/p")).toBe("windsurf://vscode-remote/ssh-remote+h/p");
  });
});

describe("isLocalHostname", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", "::1"])("%s is local", (h) => {
    expect(isLocalHostname(h)).toBe(true);
  });

  it.each(["myhost.tail1234.ts.net", "192.168.1.10", "devbox", "example.com"])(
    "%s is remote",
    (h) => {
      expect(isLocalHostname(h)).toBe(false);
    },
  );
});

describe("buildOpenTargets", () => {
  const hostApps = [
    { id: "vscode", label: "VS Code", kind: "editor" },
    { id: "iterm", label: "iTerm", kind: "terminal" },
  ];

  it("local: host section only, even with sshHost set", () => {
    const targets = buildOpenTargets({
      local: true,
      sshHost: "devbox",
      hostApps,
      path: "/p",
    });
    expect(targets.map((t) => t.id)).toEqual(["host:vscode", "host:iterm"]);
    expect(targets.every((t) => t.kind === "host")).toBe(true);
  });

  it("remote with sshHost: deeplinks first, then host escape hatch", () => {
    const targets = buildOpenTargets({
      local: false,
      sshHost: "devbox",
      hostApps,
      path: "/Users/x/proj",
    });
    expect(targets.map((t) => t.id)).toEqual([
      "deeplink:vscode",
      "deeplink:cursor",
      "deeplink:windsurf",
      "host:vscode",
      "host:iterm",
    ]);
    const first = targets[0];
    if (first.kind !== "deeplink") throw new Error("expected deeplink target");
    expect(first.url).toBe("vscode://vscode-remote/ssh-remote+devbox/Users/x/proj");
  });

  it("remote without sshHost: deeplink section hidden", () => {
    const targets = buildOpenTargets({
      local: false,
      sshHost: "",
      hostApps,
      path: "/p",
    });
    expect(targets.map((t) => t.kind)).toEqual(["host", "host"]);
  });

  it("empty registry hides the host section", () => {
    const targets = buildOpenTargets({
      local: false,
      sshHost: "devbox",
      hostApps: [],
      path: "/p",
    });
    expect(targets.map((t) => t.kind)).toEqual(["deeplink", "deeplink", "deeplink"]);
  });

  it("zero targets when local + empty registry", () => {
    expect(
      buildOpenTargets({ local: true, sshHost: "devbox", hostApps: [], path: "/p" }),
    ).toEqual([]);
  });

  it("zero targets when the path is empty (nothing to open)", () => {
    expect(
      buildOpenTargets({ local: false, sshHost: "devbox", hostApps, path: "" }),
    ).toEqual([]);
  });

  it("host targets carry the raw wt app id for POST /api/open", () => {
    const targets = buildOpenTargets({ local: true, sshHost: "", hostApps, path: "/p" });
    const host = targets[0];
    if (host.kind !== "host") throw new Error("expected host target");
    expect(host.appId).toBe("vscode");
  });
});

describe("activePaneCwd", () => {
  const base: WindowInfo = {
    windowId: "@1",
    index: 0,
    name: "main",
    worktreePath: "/wt",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
  };
  const pane = (cwd: string, isActive: boolean) => ({
    paneId: "%1",
    paneIndex: 0,
    cwd,
    command: "zsh",
    isActive,
  });

  it("prefers the active pane's cwd", () => {
    const win = { ...base, panes: [pane("/first", false), pane("/active", true)] };
    expect(activePaneCwd(win)).toBe("/active");
  });

  it("falls back to the first pane's cwd when no active pane has one", () => {
    const win = { ...base, panes: [pane("/first", false), pane("", true)] };
    expect(activePaneCwd(win)).toBe("/first");
  });

  it("falls back to worktreePath when panes are absent", () => {
    expect(activePaneCwd(base)).toBe("/wt");
  });

  it("returns empty for a null window", () => {
    expect(activePaneCwd(null)).toBe("");
  });
});

describe("last-used preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips through localStorage under the runkit-* key", () => {
    writeLastUsedOpenTarget("deeplink:vscode");
    expect(localStorage.getItem(LAST_USED_OPEN_TARGET_KEY)).toBe("deeplink:vscode");
    expect(readLastUsedOpenTarget()).toBe("deeplink:vscode");
  });

  it("reads null when nothing is stored", () => {
    expect(readLastUsedOpenTarget()).toBeNull();
  });

  it("resolveLastUsedTarget finds a live target", () => {
    const targets: OpenTarget[] = [
      { kind: "host", id: "host:vscode", label: "VS Code", appId: "vscode" },
    ];
    expect(resolveLastUsedTarget(targets, "host:vscode")).toBe(targets[0]);
  });

  it("resolveLastUsedTarget returns null for a stale or absent id", () => {
    const targets: OpenTarget[] = [
      { kind: "host", id: "host:vscode", label: "VS Code", appId: "vscode" },
    ];
    expect(resolveLastUsedTarget(targets, "deeplink:vscode")).toBeNull();
    expect(resolveLastUsedTarget(targets, null)).toBeNull();
  });
});
