import { describe, it, expect, afterEach } from "vitest";
import { createRef } from "react";
import { render, cleanup } from "@testing-library/react";
import { Control, controlClass } from "./control";

afterEach(cleanup);

// The identity oracle: these literals are the pre-migration constant
// compositions the builder must emit CHARACTER-IDENTICALLY (the zero-visual-
// change bar). They deliberately duplicate the constant definitions — a test
// that imports the constants it verifies would ratify its own drift.
const ICON_BASE =
  "w-[28px] h-[28px] coarse:w-[40px] coarse:h-[40px] rounded border transition-colors flex items-center justify-center shrink-0";
const ICON_REST = "border-border text-text-secondary hover:border-text-secondary";
const ICON_CLASS = `rk-glint ${ICON_BASE} ${ICON_REST}`;
const BAR_AXIS_H = "h-[28px] coarse:h-[40px]";
const SEGMENT_AXIS_H = "h-[26px] coarse:h-[38px]";
const ARM =
  "bg-accent-green/15 border-accent-green text-accent-green hover:bg-accent-green/25";
const ARM_RINGED =
  "bg-accent-green/15 ring-1 ring-inset ring-accent-green text-accent-green hover:bg-accent-green/25";
const CHIP_BASE =
  "rk-glint min-h-[33px] min-w-[35px] coarse:min-h-[40px] coarse:min-w-[40px] flex items-center justify-center px-1 py-0 text-xs border border-border rounded transition-colors active:bg-bg-card";
const CHIP_REST = "hover:border-text-secondary";
const CELL_BASE =
  "px-2 py-1 min-h-[40px] min-w-[40px] flex items-center justify-center text-xs rounded";
const CELL_REST = "text-text-secondary hover:text-text-primary hover:bg-bg-card";
const ROW_BASE =
  "w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs min-h-[28px] coarse:min-h-[40px] transition-colors";
const ROW_REST = "text-text-secondary hover:text-text-primary hover:bg-bg-card";
const ROW_CHECKED = "text-text-primary hover:bg-bg-card";
const ROW_DISABLED =
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary";
const ROW_CLASS = `${ROW_BASE} ${ROW_REST} ${ROW_DISABLED}`;
const WIDE_FLOORS = "min-h-[28px] coarse:min-h-[40px]";
const WIDE_CLASS = `py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary ${WIDE_FLOORS}`;
const CONFIRM_SAFE = `py-1.5 border border-border rounded hover:border-text-secondary ${WIDE_FLOORS} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border`;
const CONFIRM_KILL = `py-1.5 bg-signal-red/20 border border-signal-red rounded hover:bg-signal-red/35 ${WIDE_FLOORS} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-signal-red/20`;
const OFF_BORDERED =
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border";
const OFF_INK =
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-secondary";
const SEGMENT_OFF = "border-border text-text-secondary hover:text-text-primary";

describe("controlClass — icon variant", () => {
  it("rest emits ICON_CLASS verbatim", () => {
    expect(controlClass({ variant: "icon" })).toBe(ICON_CLASS);
  });
  it("pressed and open swap REST for the latched arm (REST-swap)", () => {
    const expected = `rk-glint ${ICON_BASE} ${ARM}`;
    expect(controlClass({ variant: "icon", pressed: true })).toBe(expected);
    expect(controlClass({ variant: "icon", open: true })).toBe(expected);
  });
  it("pressed output carries no rest hover utilities (no arm stacking)", () => {
    const out = controlClass({ variant: "icon", pressed: true });
    expect(out).toContain(ARM);
    expect(out).not.toContain("hover:border-text-secondary");
    expect(out).not.toContain(ICON_REST);
  });
  it("disabled composes the unified bordered recipe when the prop is provided", () => {
    expect(controlClass({ variant: "icon", disabled: false })).toBe(
      `${ICON_CLASS} ${OFF_BORDERED}`,
    );
    expect(controlClass({ variant: "icon" })).not.toContain("disabled:");
  });
  it("glint:false drops rk-glint (the menu-stepper composition)", () => {
    expect(controlClass({ variant: "icon", glint: false, disabled: true })).toBe(
      `${ICON_BASE} ${ICON_REST} ${OFF_BORDERED}`,
    );
  });
  it("box:height emits only the shared height axis, with optional rest override", () => {
    expect(controlClass({ variant: "icon", box: "height", glint: false })).toBe(BAR_AXIS_H);
    expect(
      controlClass({
        variant: "icon",
        box: "height",
        rest: "border border-accent-green text-accent-green hover:border-accent-green",
      }),
    ).toBe(`rk-glint ${BAR_AXIS_H} border border-accent-green text-accent-green hover:border-accent-green`);
  });
  it("box:height pressed swaps the rest override for the latched arm (no stacking)", () => {
    expect(
      controlClass({
        variant: "icon",
        box: "height",
        glint: false,
        pressed: true,
        rest: "border border-accent-green hover:border-accent-green",
      }),
    ).toBe(`${BAR_AXIS_H} ${ARM}`);
  });
  it("box:height composes the disabled recipe when the prop is provided", () => {
    expect(controlClass({ variant: "icon", box: "height", glint: false, disabled: true })).toBe(
      `${BAR_AXIS_H} ${OFF_BORDERED}`,
    );
  });
  it("rest override replaces the default rest arm", () => {
    expect(
      controlClass({ variant: "icon", rest: "border-border hover:border-text-secondary text-text-primary" }),
    ).toBe(`rk-glint ${ICON_BASE} border-border hover:border-text-secondary text-text-primary`);
  });
});

describe("controlClass — chip variant", () => {
  it("rest emits the chip composition verbatim", () => {
    expect(controlClass({ variant: "chip" })).toBe(`${CHIP_BASE} ${CHIP_REST}`);
  });
  it("pressed swaps CHIP_REST for the latched arm", () => {
    expect(controlClass({ variant: "chip", pressed: true })).toBe(`${CHIP_BASE} ${ARM}`);
  });
  it("disabled composes the bordered recipe", () => {
    expect(controlClass({ variant: "chip", disabled: true })).toBe(
      `${CHIP_BASE} ${CHIP_REST} ${OFF_BORDERED}`,
    );
  });
  it("ringed selects the borderless menu key-cell recipe", () => {
    expect(controlClass({ variant: "chip", ringed: true })).toBe(`${CELL_BASE} ${CELL_REST}`);
    expect(controlClass({ variant: "chip", ringed: true, pressed: true })).toBe(
      `${CELL_BASE} ${ARM_RINGED}`,
    );
    expect(controlClass({ variant: "chip", ringed: true, disabled: true })).toBe(
      `${CELL_BASE} ${CELL_REST} ${ROW_DISABLED}`,
    );
  });
});

describe("controlClass — toggle variant", () => {
  const BASE = "px-2 py-1 border rounded text-xs transition-colors";
  it("composes call-site base + rest, defaulting rest to the bordered neutral arm", () => {
    expect(controlClass({ variant: "toggle", base: BASE })).toBe(`${BASE} ${ICON_REST}`);
  });
  it("pressed swaps in the bordered arm; ringed selects the ring-inset arm", () => {
    expect(controlClass({ variant: "toggle", base: BASE, pressed: true })).toBe(
      `${BASE} ${ARM}`,
    );
    expect(
      controlClass({ variant: "toggle", base: "b", rest: "r", ringed: true, pressed: true }),
    ).toBe(`b ${ARM_RINGED}`);
  });
  it("rest override is swapped out wholesale when pressed (no arm stacking)", () => {
    const out = controlClass({
      variant: "toggle",
      base: "b",
      rest: "text-text-secondary hover:text-text-primary",
      ringed: true,
      pressed: true,
    });
    expect(out).not.toContain("hover:text-text-primary");
  });
  it("onBorder prepends the border width utility to the on-state", () => {
    expect(controlClass({ variant: "toggle", base: "b", onBorder: true, pressed: true })).toBe(
      `b border ${ARM}`,
    );
  });
  it("disabled composes the recipe matching the rest-arm shape", () => {
    expect(controlClass({ variant: "toggle", base: "b", disabled: false })).toBe(
      `b ${ICON_REST} ${OFF_BORDERED}`,
    );
    expect(
      controlClass({ variant: "toggle", base: "b", rest: "r", ringed: true, disabled: true }),
    ).toBe(`b r ${OFF_INK}`);
  });
});

describe("controlClass — segment variant", () => {
  it("rest composes the segment height with the chevron rest arm", () => {
    expect(controlClass({ variant: "segment" })).toBe(`${SEGMENT_AXIS_H} ${SEGMENT_OFF}`);
  });
  it("open swaps in the latched arm", () => {
    expect(controlClass({ variant: "segment", open: true })).toBe(
      `${SEGMENT_AXIS_H} ${ARM}`,
    );
  });
  it("rest override covers the plain-segment and toggle-cell arms", () => {
    expect(
      controlClass({ variant: "segment", rest: "text-text-secondary hover:text-text-primary" }),
    ).toBe(`${SEGMENT_AXIS_H} text-text-secondary hover:text-text-primary`);
    expect(
      controlClass({
        variant: "segment",
        rest: "border-transparent text-text-secondary hover:text-text-primary",
        pressed: true,
      }),
    ).toBe(`${SEGMENT_AXIS_H} ${ARM}`);
  });
  it("disabled composes the ink-neutralizing recipe", () => {
    expect(controlClass({ variant: "segment", disabled: true })).toBe(
      `${SEGMENT_AXIS_H} ${SEGMENT_OFF} ${OFF_INK}`,
    );
  });
});

describe("controlClass — menu-row variant", () => {
  it("rest emits ROW_CLASS verbatim (the recipe is baked into the family)", () => {
    expect(controlClass({ variant: "menu-row" })).toBe(ROW_CLASS);
  });
  it("pressed composes the checked arm REST-swapped for the rest arm", () => {
    expect(controlClass({ variant: "menu-row", pressed: true })).toBe(
      `${ROW_BASE} ${ROW_CHECKED} ${ROW_DISABLED}`,
    );
  });
  it("bare emits ROW_BASE alone (bespoke color/state rows)", () => {
    expect(controlClass({ variant: "menu-row", bare: true })).toBe(ROW_BASE);
  });
});

describe("controlClass — wide variant", () => {
  it("rest emits the canonical dialog button", () => {
    expect(controlClass({ variant: "wide" })).toBe(WIDE_CLASS);
  });
  it("disabled composes the unified recipe when the prop is provided", () => {
    expect(controlClass({ variant: "wide", disabled: true })).toBe(
      `${WIDE_CLASS} ${OFF_BORDERED}`,
    );
  });
  it("bare emits the wide floors alone (option-row composers)", () => {
    expect(controlClass({ variant: "wide", bare: true })).toBe(WIDE_FLOORS);
  });
});

describe("controlClass — confirm variant", () => {
  it("composes the neutral arm by default and the danger arm with danger", () => {
    expect(controlClass({ variant: "confirm" })).toBe(CONFIRM_SAFE);
    expect(controlClass({ variant: "confirm", danger: true })).toBe(CONFIRM_KILL);
  });
});

describe("controlClass — shared behavior", () => {
  it("appends className last", () => {
    expect(controlClass({ variant: "chip", className: "text-text-secondary" })).toBe(
      `${CHIP_BASE} ${CHIP_REST} text-text-secondary`,
    );
  });
  it("rejects a cross-axis size", () => {
    expect(() => controlClass({ variant: "icon", size: "row" })).toThrow();
    expect(controlClass({ variant: "icon", size: "bar" })).toBe(ICON_CLASS);
    expect(controlClass({ variant: "menu-row", size: "row" })).toBe(ROW_CLASS);
  });
});

describe("<Control>", () => {
  it("renders a button with the composed class, reflecting pressed to aria-pressed", () => {
    const { getByRole } = render(
      <Control variant="chip" pressed>
        ^
      </Control>,
    );
    const btn = getByRole("button");
    expect(btn.className).toBe(`${CHIP_BASE} ${ARM}`);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
  it("omits aria-pressed when pressed is not provided, binds disabled, defaults type=button", () => {
    const { getByRole } = render(
      <Control variant="confirm" danger disabled>
        Kill
      </Control>,
    );
    const btn = getByRole("button");
    expect(btn.className).toBe(CONFIRM_KILL);
    expect(btn.hasAttribute("aria-pressed")).toBe(false);
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("type")).toBe("button");
  });
  it("passes DOM props through and never leaks builder options onto the element", () => {
    const { getByRole } = render(
      <Control
        variant="toggle"
        base="b"
        ringed
        onBorder
        aria-label="t"
        data-testid="tgl"
        pressed={false}
      >
        x
      </Control>,
    );
    const btn = getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("t");
    expect(btn.getAttribute("data-testid")).toBe("tgl");
    for (const attr of ["base", "ringed", "onborder", "variant", "glint", "box", "bare", "danger", "size"]) {
      expect(btn.hasAttribute(attr)).toBe(false);
    }
    expect(btn.className).toBe(`b ${ICON_REST}`);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });
  it("forwards refs", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Control ref={ref} variant="icon">
        ↻
      </Control>,
    );
    expect(ref.current?.className).toBe(ICON_CLASS);
  });
});
