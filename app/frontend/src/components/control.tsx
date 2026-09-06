/**
 * The Control primitive — one class-builder (`controlClass`) plus a thin
 * button wrapper (`<Control>`) expressing the shipped control vocabulary as a
 * variant × state matrix over the constant compositions defined below (the
 * single definition of every button-shaped control recipe — a recipe is never
 * re-typed at a call site):
 *
 *  - `icon` — the top-bar fixed squares: `TOP_BAR_BUTTON*` (28/40 bar axis,
 *    glint). `box: "height"` emits only the shared height axis
 *    (`TOP_BAR_BUTTON_H`) for content-width chips and bordered wrappers that
 *    carry their own border; `glint: false` drops the glint for the menu
 *    steppers that never carried it.
 *  - `chip` — the bottom-bar kbd chips (`KBD_*`, 33×35 fine / 40 coarse).
 *    `ringed` selects the borderless F▴-menu key-cell recipe (`FN_ITEM_*`,
 *    40 flat — the bar renders coarse-only) whose state arm is the ring-inset
 *    `LATCHED_ARM_RINGED`.
 *  - `toggle` — a latching button with call-site geometry: `base` (required)
 *    plus the green arm on-state — `LATCHED_ARM`, or `LATCHED_ARM_RINGED` with
 *    `ringed` (borderless controls paint the border axis as an inset ring so
 *    latching never shifts layout). `onBorder` prepends the `border` width
 *    utility to the on-state for bases that carry no border at rest (the
 *    compose-strip history chip) — the arm's border color needs it.
 *  - `segment` — a segment inside a bordered chip wrapper
 *    (`TOP_BAR_SEGMENT_H` — 26/38, the 2px-wrapper-border inset), with the
 *    split/open-chevron rest arm by default.
 *  - `menu-row` — the one menu-row scale (`MENU_ROW_*`, 28/40 floors);
 *    `pressed`/`open` compose the checked arm (`MENU_ROW_CHECKED`); the ✓
 *    mark stays call-site content (`MENU_ROW_CHECK_MARK`). The disabled
 *    recipe is part of the family's default composition, so it is always
 *    present. `bare` emits `MENU_ROW_BASE` alone for rows with bespoke
 *    color/state arms (the version/update rows).
 *  - `wide` — the canonical dialog button around the `WIDE_BTN_BASE` floors;
 *    call sites add only layout. `bare` emits the floors alone (option-row
 *    composers with their own selected/hover arms).
 *  - `confirm` — the destructive-confirm pair: `CONFIRM_NEUTRAL`, or
 *    `CONFIRM_DANGER` with `danger` (the pair bakes the disabled recipe in).
 *
 * REST-swap is structural: the builder emits `BASE + (state arm | REST)` — a
 * `pressed`/`open`/`danger` arm REPLACES the hover-carrying rest classes, so
 * no call site can stack a state arm on top of rest hovers.
 *
 * Disabled recipe rule: the unified recipe (opacity-40 + cursor-not-allowed +
 * hover neutralized back to the rest arm — bordered controls neutralize the
 * border hover, borderless ones the ink/fill hovers) is composed iff the
 * `disabled` prop is provided, EXCEPT for `menu-row`/`confirm`, whose
 * constant compositions already bake it in. All of its tokens are
 * `disabled:` variants — inert without the attribute — so the recipe's
 * presence never changes a rendered pixel on its own.
 *
 * `size` names the variant's height-axis contract (`bar` 28/40, `chip`
 * 33×35/40, `row` menu floors) and defaults per variant; the geometry itself
 * lives in the constants (Tailwind's scanner reads literals only).
 *
 * `<Control>` is the plain-button wrapper: it composes `controlClass`, binds
 * `disabled`, and reflects `pressed` to `aria-pressed`. `open` deliberately
 * sets nothing — `aria-expanded` stays at the call site. Call sites with
 * custom elements, refs, or floating-ui prop composition consume
 * `controlClass` directly — same emitted classes either way.
 *
 * The vocabulary's className constants are private to this module
 * (Tailwind's scanner reads literal classes only, so sizes stay literal and
 * mirror the `--ctl-*` custom properties on `:root` in globals.css; each
 * lockstep comment names the property its literal mirrors, and the pair MUST
 * change together). What stays exported from `controls.ts` is the
 * out-of-matrix vocabulary: `INPUT_FOCUS`/`INPUT_COARSE`, `SWITCH_*`,
 * `MENU_ROW_KBD_CLASS`, `MENU_ROW_CHECK_MARK` (the ✓ is call-site content),
 * `POPOVER_SHELL`, `POPOVER_SECTION_LABEL`.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * The one menu-row scale, decomposed so the builder composes exactly the
 * variant a row needs:
 *
 *  - `MENU_ROW_BASE` — layout only (full-width left-aligned flex row, padding,
 *    text size) plus the height floor: 28px fine (the rendered xs/py-1.5
 *    box), 40px coarse (the touch floor). No color/state tokens.
 *  - `MENU_ROW_REST` — the resting/hover treatment (secondary text → primary
 *    on hover, card hover bg).
 *  - `MENU_ROW_DISABLED` — the disabled-state tokens (dimmed, no hover).
 *  - `MENU_ROW_CHECKED` — the ONE checked/selected treatment (scheme C: green
 *    = state): primary ink + hover fill only, worn INSTEAD of `MENU_ROW_REST`
 *    (REST-swap — never stacked, so no hover utility competes).
 */
const MENU_ROW_BASE =
  "w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs min-h-[28px] coarse:min-h-[40px] transition-colors";
const MENU_ROW_REST =
  "text-text-secondary hover:text-text-primary hover:bg-bg-card";
const MENU_ROW_DISABLED =
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary";
const MENU_ROW_CHECKED = "text-text-primary hover:bg-bg-card";

/**
 * Shared top-bar icon-button sizing. The size is a FIXED square — 28×28 on
 * fine pointers, 40×40 on coarse (the 40px coarse touch floor). Decomposed so
 * state-driven compositions (pressed/latched toggles) compose exactly what
 * they need around the shared geometry:
 *
 *  - `TOP_BAR_BUTTON_BASE` — geometry only (fixed square, rounded border box,
 *    centering, `shrink-0`). No color tokens.
 *  - `TOP_BAR_BUTTON_REST` — the resting/hover color treatment.
 *  - `TOP_BAR_BUTTON_H` — the shared HEIGHT axis alone, for content-width
 *    chips that carry their OWN border (UpdateChip) and must align with the
 *    square buttons without a fixed width.
 *  - `TOP_BAR_SEGMENT_H` — the height for segments INSIDE a bordered chip
 *    wrapper (the split/Open segment groups): the wrapper's border adds 2px,
 *    so segments are 2px shorter to keep the chip's TOTAL box identical to
 *    the squares (26+2 = 28 fine, 38+2 = 40 coarse).
 */
const TOP_BAR_BUTTON_BASE =
  "w-[28px] h-[28px] coarse:w-[40px] coarse:h-[40px] rounded border transition-colors flex items-center justify-center shrink-0"; // lockstep: --ctl-h-bar (fine) / --ctl-h-bar-coarse
const TOP_BAR_BUTTON_REST =
  "border-border text-text-secondary hover:border-text-secondary";
const TOP_BAR_BUTTON_H = "h-[28px] coarse:h-[40px]"; // lockstep: --ctl-h-bar / --ctl-h-bar-coarse
const TOP_BAR_SEGMENT_H = "h-[26px] coarse:h-[38px]"; // lockstep: --ctl-h-bar / --ctl-h-bar-coarse minus the 2px wrapper border

/**
 * The one latched/on state arm (scheme C: green = state). Composed with a
 * BASE that carries NO hover color utilities (REST swapped out) so nothing
 * competes with the latch border — class stacking ties on specificity and
 * loses on compiled source order. Lockstep: the latch color algebra is
 * documented in docs/memory/run-kit/ui/visual-design.md.
 */
const LATCHED_ARM =
  "bg-accent-green/15 border-accent-green text-accent-green hover:bg-accent-green/25";
/** Border-axis equivalent for borderless controls (rail toggles, find-bar and
 *  tile-verb glyph buttons) — ring-inset paints inside, so latching never
 *  shifts layout. */
const LATCHED_ARM_RINGED =
  "bg-accent-green/15 ring-1 ring-inset ring-accent-green text-accent-green hover:bg-accent-green/25";

/**
 * Dialog wide-button geometry — the floor every dialog button carries: 28px
 * fine (the rendered py-1.5 box), 40px coarse (the touch floor). Geometry
 * only; color/state arms compose around it.
 */
const WIDE_BTN_BASE =
  "min-h-[28px] coarse:min-h-[40px]"; // lockstep: --ctl-h-bar (fine) / --ctl-h-bar-coarse

/**
 * The one confirm-button pair — every destructive-confirm dialog (sidebar
 * kill, board kill trio, server kill) composes these arms so the pair exists
 * exactly once. Call sites add ONLY layout (`flex-1`/`w-full`); color,
 * padding, floors, and the disabled recipe come from here:
 *
 *  - `CONFIRM_NEUTRAL` — the safe/cancel arm (bordered neutral, hover
 *    brightens the border).
 *  - `CONFIRM_DANGER` — the destructive arm on the `signal-red` token (signal
 *    hues = status — the same token the flyout danger rows use, so the
 *    destructive hue themes correctly); the /20 rest → /35 hover alpha steps
 *    match the retired raw-red weight in both themes.
 *
 * Both carry the wide-button floors and the unified disabled recipe
 * (opacity-40 + not-allowed + hover neutralized back to the rest arm).
 */
const CONFIRM_NEUTRAL = `py-1.5 border border-border rounded hover:border-text-secondary ${WIDE_BTN_BASE} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border`;
const CONFIRM_DANGER = `py-1.5 bg-signal-red/20 border border-signal-red rounded hover:bg-signal-red/35 ${WIDE_BTN_BASE} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-signal-red/20`;

// Bottom-bar chip classes. Chip size splits by pointer: 33×35 on fine
// pointers (lighter bar, more air between chips) while coarse pointers get
// the 40×40 touch floor. Lockstep: --ctl-chip-h/--ctl-chip-w (fine) and
// --ctl-chip-coarse in globals.css (:root) — the pairs MUST change together.
//
// Decomposed so latched chips compose BASE + their state arm with NO
// competing hover utility (a same-specificity `hover:border-*` tie would be
// decided by compiled source order — a latched chip must keep its latch
// border under hover):
//
//  - `KBD_BASE` — geometry, border box, radius, transition, pressed fill.
//    No hover color utilities. (The select guard and the focus ring are the
//    global unlayered rules in globals.css, which cover every control.)
//  - `KBD_REST` — the neutral-hover arm.
const KBD_BASE =
  "rk-glint min-h-[33px] min-w-[35px] coarse:min-h-[40px] coarse:min-w-[40px] flex items-center justify-center px-1 py-0 text-xs border border-border rounded transition-colors active:bg-bg-card";
const KBD_REST = "hover:border-text-secondary";

/** F▴ menu key buttons (F-keys, Esc, nav, arrows, the ⌥ latch cell). Flat
 *  40px both pointer classes — the bar (and so this menu) renders only on
 *  coarse pointers, so a fine/coarse split would be dead code. Lockstep:
 *  --ctl-chip-coarse in globals.css (:root) — the pair MUST change together.
 *  BASE/REST split so the ⌥ latch composes BASE + LATCHED_ARM_RINGED with no
 *  competing hover utility. */
const FN_ITEM_BASE =
  "px-2 py-1 min-h-[40px] min-w-[40px] flex items-center justify-center text-xs rounded";

export type ControlVariant =
  | "icon"
  | "chip"
  | "toggle"
  | "segment"
  | "menu-row"
  | "wide"
  | "confirm";
export type ControlSize = "bar" | "chip" | "row";

/** Disabled recipe for controls whose rest arm hovers the border. */
const DISABLED_BORDERED =
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border";
/** Disabled recipe for rest arms whose only hover is ink. */
const DISABLED_INK =
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-secondary";

/** The borderless chip's rest arm (the FN menu cells' half of FN_ITEM_CLASS). */
const FN_ITEM_REST = "text-text-secondary hover:text-text-primary hover:bg-bg-card";
/** The segment rest arm (the split/open-chevron precedent). */
const SEGMENT_REST = "border-border text-text-secondary hover:text-text-primary";
/** The canonical wide dialog button — color/state around the WIDE_BTN_BASE
 *  floors; call sites add only layout (`w-full`/`flex-1`). */
const WIDE_BTN_CLASS = `py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary ${WIDE_BTN_BASE}`;

interface ControlClassCommon {
  /** Height-axis contract label; defaulted per variant. */
  size?: ControlSize;
  /** Latched on-state → the variant's green arm (`MENU_ROW_CHECKED` for
   *  menu-row). `<Control>` reflects it to `aria-pressed`. */
  pressed?: boolean;
  /** Open-latch — the same arm as `pressed`; `aria-expanded` stays at the
   *  call site. */
  open?: boolean;
  /** Binds the attribute; for variants whose constants do not bake the
   *  disabled recipe in, providing this prop composes it. */
  disabled?: boolean;
  /** Appended last — per-site layout/ink extras around the composition. */
  className?: string;
}

export type ControlClassOptions = ControlClassCommon &
  (
    | {
        variant: "icon";
        /** `false` drops `rk-glint` (the menu steppers never carried it). */
        glint?: boolean;
        /** `height` emits only the shared height axis (content-width chips,
         *  bordered wrappers). */
        box?: "square" | "height";
        /** Rest-arm override (the sidebar toggle's primary-ink arm, the
         *  update chip's always-green arm). */
        rest?: string;
      }
    | {
        variant: "chip";
        /** Borderless F▴-menu key-cell recipe (ring-inset state arm). */
        ringed?: boolean;
      }
    | {
        variant: "toggle";
        /** Call-site geometry (bordered latches carry their border here). */
        base: string;
        /** Rest-arm override; defaults to the bordered neutral arm. */
        rest?: string;
        /** Borderless latch — ring-inset state arm. */
        ringed?: boolean;
        /** Prepend the `border` width utility to the on-state (bases with no
         *  border at rest). */
        onBorder?: boolean;
      }
    | {
        variant: "segment";
        /** Rest-arm override (plain segments, toggle cells). */
        rest?: string;
      }
    | {
        variant: "menu-row";
        /** Emit `MENU_ROW_BASE` alone (bespoke color/state rows). */
        bare?: boolean;
      }
    | {
        variant: "wide";
        /** Emit the `WIDE_BTN_BASE` floors alone (option-row composers). */
        bare?: boolean;
      }
    | {
        variant: "confirm";
        /** The destructive arm on the `signal-red` token. */
        danger?: boolean;
      }
  );

const DEFAULT_SIZE: Record<ControlVariant, ControlSize> = {
  icon: "bar",
  chip: "chip",
  toggle: "bar",
  segment: "bar",
  "menu-row": "row",
  wide: "bar",
  confirm: "bar",
};

/**
 * Compose the class string for one variant × state cell. Pure: same options,
 * same string.
 */
export function controlClass(options: ControlClassOptions): string {
  const { disabled, className } = options;
  // `size` is the height-axis contract: a variant lives on exactly one axis,
  // so a cross-axis size is a caller bug, not a composition input.
  if (options.size !== undefined && options.size !== DEFAULT_SIZE[options.variant]) {
    throw new Error(
      `controlClass: variant "${options.variant}" lives on the "${DEFAULT_SIZE[options.variant]}" axis, not "${options.size}"`,
    );
  }
  let out: string;
  switch (options.variant) {
    case "icon": {
      const glint = options.glint !== false ? "rk-glint " : "";
      if (options.box === "height") {
        out = options.pressed || options.open
          ? `${glint}${TOP_BAR_BUTTON_H} ${LATCHED_ARM}`
          : `${glint}${TOP_BAR_BUTTON_H}${options.rest ? ` ${options.rest}` : ""}`;
        if (disabled !== undefined) out += ` ${DISABLED_BORDERED}`;
        break;
      }
      const arm = options.pressed || options.open;
      out = arm
        ? `${glint}${TOP_BAR_BUTTON_BASE} ${LATCHED_ARM}`
        : `${glint}${TOP_BAR_BUTTON_BASE} ${options.rest ?? TOP_BAR_BUTTON_REST}`;
      if (disabled !== undefined) out += ` ${DISABLED_BORDERED}`;
      break;
    }
    case "chip": {
      const base = options.ringed ? FN_ITEM_BASE : KBD_BASE;
      const rest = options.ringed ? FN_ITEM_REST : KBD_REST;
      const arm = options.ringed ? LATCHED_ARM_RINGED : LATCHED_ARM;
      out = options.pressed || options.open ? `${base} ${arm}` : `${base} ${rest}`;
      if (disabled !== undefined) {
        out += ` ${options.ringed ? MENU_ROW_DISABLED : DISABLED_BORDERED}`;
      }
      break;
    }
    case "toggle": {
      const rest = options.rest ?? TOP_BAR_BUTTON_REST;
      const arm = `${options.onBorder ? "border " : ""}${
        options.ringed ? LATCHED_ARM_RINGED : LATCHED_ARM
      }`;
      out = options.pressed || options.open ? `${options.base} ${arm}` : `${options.base} ${rest}`;
      if (disabled !== undefined) {
        out += ` ${options.ringed ? DISABLED_INK : DISABLED_BORDERED}`;
      }
      break;
    }
    case "segment": {
      const rest = options.rest ?? SEGMENT_REST;
      out = `${TOP_BAR_SEGMENT_H} ${options.pressed || options.open ? LATCHED_ARM : rest}`;
      if (disabled !== undefined) out += ` ${DISABLED_INK}`;
      break;
    }
    case "menu-row": {
      out = options.bare
        ? MENU_ROW_BASE
        : `${MENU_ROW_BASE} ${options.pressed || options.open ? MENU_ROW_CHECKED : MENU_ROW_REST} ${MENU_ROW_DISABLED}`;
      break;
    }
    case "wide": {
      out = options.bare ? WIDE_BTN_BASE : WIDE_BTN_CLASS;
      if (!options.bare && disabled !== undefined) out += ` ${DISABLED_BORDERED}`;
      break;
    }
    case "confirm": {
      out = options.danger ? CONFIRM_DANGER : CONFIRM_NEUTRAL;
      break;
    }
  }
  return className ? `${out} ${className}` : out;
}

/** The component's own props, flattened (the discriminated-union builder
 *  options can't be destructured without narrowing first — `toOptions` is
 *  that narrowing). */
interface ControlOwnProps {
  variant: ControlVariant;
  size?: ControlSize;
  pressed?: boolean;
  open?: boolean;
  disabled?: boolean;
  glint?: boolean;
  box?: "square" | "height";
  ringed?: boolean;
  base?: string;
  rest?: string;
  onBorder?: boolean;
  bare?: boolean;
  danger?: boolean;
}

export type ControlProps = ControlOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "disabled"> & {
    className?: string;
    disabled?: boolean;
    children?: ReactNode;
  };

/** Narrow the component's flat props into the builder's per-variant options. */
function toOptions(p: ControlOwnProps & { className?: string }): ControlClassOptions {
  const common = {
    size: p.size,
    pressed: p.pressed,
    open: p.open,
    disabled: p.disabled,
    className: p.className,
  };
  switch (p.variant) {
    case "icon":
      return { ...common, variant: "icon", glint: p.glint, box: p.box, rest: p.rest };
    case "chip":
      return { ...common, variant: "chip", ringed: p.ringed };
    case "toggle":
      if (p.base === undefined) {
        throw new Error('Control: variant "toggle" requires `base` (call-site geometry)');
      }
      return {
        ...common,
        variant: "toggle",
        base: p.base,
        rest: p.rest,
        ringed: p.ringed,
        onBorder: p.onBorder,
      };
    case "segment":
      return { ...common, variant: "segment", rest: p.rest };
    case "menu-row":
      return { ...common, variant: "menu-row", bare: p.bare };
    case "wide":
      return { ...common, variant: "wide", bare: p.bare };
    case "confirm":
      return { ...common, variant: "confirm", danger: p.danger };
  }
}

/**
 * The plain-button form of the primitive. The builder options are consumed
 * here (never leaked onto the element); everything else (handlers, aria, data
 * attributes, refs) passes through to the underlying `<button>`.
 */
export const Control = forwardRef<HTMLButtonElement, ControlProps>(
  function Control(props, ref) {
    const {
      variant,
      size,
      pressed,
      open,
      disabled,
      glint,
      box,
      ringed,
      base,
      rest: restArm,
      onBorder,
      bare,
      danger,
      className,
      type,
      children,
      ...domProps
    } = props;
    const classes = controlClass(
      toOptions({ variant, size, pressed, open, disabled, glint, box, ringed, base, rest: restArm, onBorder, bare, danger, className }),
    );
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={disabled}
        aria-pressed={pressed !== undefined ? pressed : undefined}
        className={classes}
        {...domProps}
      >
        {children}
      </button>
    );
  },
);
