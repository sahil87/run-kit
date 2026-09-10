import { describe, it, expect } from "vitest";
import {
  CODE_BOOT_RESCUE_WAIT_MS,
  CODE_BOOT_RESCUE_RECHECK_MS,
  isWorkspaceSrc,
  newerThanBaseline,
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

describe("newerThanBaseline", () => {
  it("confirms a strictly newer stamp", () => {
    expect(newerThanBaseline(BASELINE, NEWER)).toBe(true);
  });

  it("does not confirm an equal or older stamp", () => {
    expect(newerThanBaseline(BASELINE, BASELINE)).toBe(false);
    expect(newerThanBaseline(NEWER, BASELINE)).toBe(false);
  });

  it("an empty baseline accepts any parseable stamp; a null baseline never confirms", () => {
    expect(newerThanBaseline("", NEWER)).toBe(true);
    expect(newerThanBaseline(null, NEWER)).toBe(false);
  });

  it("never confirms an empty or unparseable current", () => {
    expect(newerThanBaseline(BASELINE, "")).toBe(false);
    expect(newerThanBaseline(BASELINE, null)).toBe(false);
    expect(newerThanBaseline(BASELINE, "not-a-time")).toBe(false);
    expect(newerThanBaseline("", "not-a-time")).toBe(false);
  });

  it("never confirms against an unparseable baseline", () => {
    expect(newerThanBaseline("not-a-time", BASELINE)).toBe(false);
  });
});

describe("decideRescue", () => {
  it("a marker newer than its baseline reloads", () => {
    expect(
      decideRescue({
        baselineEmptyBootAt: BASELINE,
        emptyBootAt: NEWER,
        installed: true,
        isWorkspaceMount: true,
      }),
    ).toBe("reload");
  });

  it("an empty baseline accepts any parseable marker", () => {
    expect(
      decideRescue({
        baselineEmptyBootAt: "",
        emptyBootAt: NEWER,
        installed: true,
        isWorkspaceMount: true,
      }),
    ).toBe("reload");
  });

  it("a null (unavailable) baseline is not confirmable — no reload", () => {
    expect(
      decideRescue({
        baselineEmptyBootAt: null,
        emptyBootAt: NEWER,
        installed: true,
        isWorkspaceMount: true,
      }),
    ).toBe("none");
  });

  it("an equal, older, or absent marker never reloads — even with NO host record", () => {
    for (const emptyBootAt of [BASELINE, "2026-09-10T02:45:38.000Z", "", null]) {
      expect(
        decideRescue({
          baselineEmptyBootAt: BASELINE,
          emptyBootAt,
          installed: true,
          isWorkspaceMount: true,
        }),
      ).toBe("none");
    }
  });

  it("installed false or null (status GET unavailable) fails closed — and outranks a newer marker", () => {
    for (const installed of [false, null]) {
      expect(
        decideRescue({
          baselineEmptyBootAt: "",
          emptyBootAt: NEWER,
          installed,
          isWorkspaceMount: true,
        }),
      ).toBe("skip-not-installed");
    }
  });

  it("a ?folder= mount is never rescued, whatever the other inputs", () => {
    expect(
      decideRescue({
        baselineEmptyBootAt: "",
        emptyBootAt: NEWER,
        installed: true,
        isWorkspaceMount: false,
      }),
    ).toBe("none");
    expect(
      decideRescue({
        baselineEmptyBootAt: BASELINE,
        emptyBootAt: NEWER,
        installed: false,
        isWorkspaceMount: false,
      }),
    ).toBe("none");
  });
});

describe("rescue timing constants", () => {
  it("the wait and the re-check are the named 10 s windows", () => {
    expect(CODE_BOOT_RESCUE_WAIT_MS).toBe(10_000);
    expect(CODE_BOOT_RESCUE_RECHECK_MS).toBe(10_000);
  });
});
