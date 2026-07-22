import { describe, it, expect, vi } from "vitest";
import { buildOpenActions, openActionLabel } from "./palette-open";
import type { OpenTarget } from "./open-in-app";

const deeplink: OpenTarget = {
  kind: "deeplink",
  id: "deeplink:vscode",
  label: "VS Code",
  url: "vscode://vscode-remote/ssh-remote+devbox/p",
};
const hostVscode: OpenTarget = {
  kind: "host",
  id: "host:vscode",
  label: "VS Code",
  appId: "vscode",
};
const hostIterm: OpenTarget = {
  kind: "host",
  id: "host:iterm",
  label: "iTerm",
  appId: "iterm",
};

describe("buildOpenActions", () => {
  it("returns one action per target with kind-qualified ids", () => {
    const actions = buildOpenActions([deeplink, hostIterm], vi.fn());
    expect(actions.map((a) => a.id)).toEqual(["open-deeplink:vscode", "open-host:iterm"]);
  });

  it("suffixes host targets (on host) only when both kinds are present", () => {
    const remote = buildOpenActions([deeplink, hostVscode, hostIterm], vi.fn());
    expect(remote.map((a) => a.label)).toEqual([
      "Open: VS Code",
      "Open: VS Code (on host)",
      "Open: iTerm (on host)",
    ]);

    const local = buildOpenActions([hostVscode, hostIterm], vi.fn());
    expect(local.map((a) => a.label)).toEqual(["Open: VS Code", "Open: iTerm"]);
  });

  it("yields no actions for an empty target list (palette mirrors the hidden button)", () => {
    expect(buildOpenActions([], vi.fn())).toEqual([]);
  });

  it("onSelect runs the matching target", () => {
    const onRun = vi.fn();
    const actions = buildOpenActions([deeplink, hostIterm], onRun);
    actions[1].onSelect();
    expect(onRun).toHaveBeenCalledWith(hostIterm);
  });
});

describe("openActionLabel", () => {
  it("never suffixes deeplink targets", () => {
    expect(openActionLabel(deeplink, true)).toBe("Open: VS Code");
  });
});
