import { describe, it, expect, vi } from "vitest";
import {
  buildOpenActions,
  buildOpenLastUsedAction,
  buildOpenPrAction,
  openActionLabel,
} from "./palette-open";
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

describe("buildOpenLastUsedAction (260801-sm6g)", () => {
  it("yields no action without a resolved last-used target (boundary-hidden)", () => {
    expect(buildOpenLastUsedAction(null, vi.fn())).toEqual([]);
  });

  it("names the resolved target in the dynamic suffix, id doubles as the registry actionId", () => {
    const actions = buildOpenLastUsedAction(deeplink, vi.fn());
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("open-last-used");
    expect(actions[0].label).toBe("Open: Last used (VS Code)");
  });

  it("onSelect runs the resolved target", () => {
    const onRun = vi.fn();
    buildOpenLastUsedAction(hostIterm, onRun)[0].onSelect();
    expect(onRun).toHaveBeenCalledWith(hostIterm);
  });
});

describe("buildOpenPrAction", () => {
  const prUrl = "https://github.com/acme/run-kit/pull/123123";

  it("yields no action without a prUrl (no PR, no palette entry)", () => {
    expect(buildOpenPrAction(undefined, 123123, vi.fn())).toEqual([]);
  });

  it("bakes the PR number into the label", () => {
    const actions = buildOpenPrAction(prUrl, 123123, vi.fn());
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("open-pr");
    expect(actions[0].label).toBe("Open: PR #123123");
  });

  it("falls back to a numberless label when prNumber is absent", () => {
    expect(buildOpenPrAction(prUrl, undefined, vi.fn())[0].label).toBe("Open: PR");
  });

  it("onSelect delegates the PR url to onOpen", () => {
    const onOpen = vi.fn();
    buildOpenPrAction(prUrl, 123123, onOpen)[0].onSelect();
    expect(onOpen).toHaveBeenCalledWith(prUrl);
  });
});
