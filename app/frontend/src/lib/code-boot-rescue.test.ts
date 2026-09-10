import { describe, it, expect } from "vitest";
import {
  CODE_BOOT_RESCUE_WAIT_MS,
  isWorkspaceSrc,
  bridgeConfirmed,
  decideRescue,
} from "./code-boot-rescue";

const BASELINE = "2026-09-10T02:45:39.941Z";
const NEWER = "2026-09-10T02:45:41.100Z";
const WS_SRC = "/code/?workspace=%2Fstate%2F%407-3fa1c9.code-workspace";
const FOLDER_SRC = "/code/?folder=%2Frepo";

describe("isWorkspaceSrc", () => {
  it("is true for the ?workspace= form and false for the ?folder= degrade form", () => {
    expect(isWorkspaceSrc(WS_SRC)).toBe(true);
    expect(isWorkspaceSrc(FOLDER_SRC)).toBe(false);
  });

  it("is false for a src with no query string", () => {
    expect(isWorkspaceSrc("/code/")).toBe(false);
  });
});

describe("bridgeConfirmed", () => {
  it("confirms a strictly newer stamp", () => {
    expect(bridgeConfirmed(BASELINE, NEWER)).toBe(true);
  });

  it("does not confirm an equal or older stamp (the previous boot's record)", () => {
    expect(bridgeConfirmed(BASELINE, BASELINE)).toBe(false);
    expect(bridgeConfirmed(NEWER, BASELINE)).toBe(false);
  });

  it("confirms any parseable stamp against a null or empty baseline", () => {
    expect(bridgeConfirmed(null, BASELINE)).toBe(true);
    expect(bridgeConfirmed("", BASELINE)).toBe(true);
  });

  it("never confirms an empty or unparseable current", () => {
    expect(bridgeConfirmed(BASELINE, "")).toBe(false);
    expect(bridgeConfirmed(BASELINE, null)).toBe(false);
    expect(bridgeConfirmed(BASELINE, "not-a-time")).toBe(false);
    expect(bridgeConfirmed(null, "not-a-time")).toBe(false);
  });

  it("never confirms against an unparseable baseline", () => {
    expect(bridgeConfirmed("not-a-time", BASELINE)).toBe(false);
  });
});

describe("decideRescue", () => {
  it("a confirmed bridge (newer stamp) rescues nothing", () => {
    expect(
      decideRescue({
        baseline: BASELINE,
        current: NEWER,
        installed: true,
        isWorkspaceMount: true,
      }),
    ).toBe("none");
  });

  it("an equal (stale) stamp with the extension installed reloads", () => {
    expect(
      decideRescue({
        baseline: BASELINE,
        current: BASELINE,
        installed: true,
        isWorkspaceMount: true,
      }),
    ).toBe("reload");
  });

  it("an empty current with the extension installed reloads", () => {
    expect(
      decideRescue({ baseline: BASELINE, current: "", installed: true, isWorkspaceMount: true }),
    ).toBe("reload");
  });

  it("installed false or null (status GET unavailable) fails closed — no reload", () => {
    for (const installed of [false, null]) {
      expect(
        decideRescue({ baseline: null, current: null, installed, isWorkspaceMount: true }),
      ).toBe("skip-not-installed");
    }
  });

  it("installed null outranks an otherwise-confirmed bridge", () => {
    expect(
      decideRescue({ baseline: null, current: NEWER, installed: null, isWorkspaceMount: true }),
    ).toBe("skip-not-installed");
  });

  it("a ?folder= mount is never rescued, whatever the other inputs", () => {
    expect(
      decideRescue({ baseline: null, current: null, installed: true, isWorkspaceMount: false }),
    ).toBe("none");
    expect(
      decideRescue({ baseline: BASELINE, current: NEWER, installed: false, isWorkspaceMount: false }),
    ).toBe("none");
  });
});

describe("CODE_BOOT_RESCUE_WAIT_MS", () => {
  it("is the named 10 s wait window", () => {
    expect(CODE_BOOT_RESCUE_WAIT_MS).toBe(10_000);
  });
});
