import { useEffect, useRef, useState } from "react";
import { Tip } from "@/components/tip";
import { useKeybindings } from "@/hooks/use-keybindings";
import { formatCombo } from "@/lib/keybindings";
import {
  setShape,
  shapesForArity,
  SHAPE_ARITY,
  SHAPE_LABEL,
  type Layout,
} from "@/lib/surface-layout";
import { LayoutGlyph, LayoutShapeGlyph } from "@/components/top-bar-icons";
import {
  MENU_ROW_BASE,
  MENU_ROW_REST,
  MENU_ROW_ACTIVE,
  POPOVER_ROW_CLASS,
  TOP_BAR_BUTTON,
} from "@/components/top-bar-overflow-menu";

/**
 * ▦ Layout chip (260812-ab5v-surface-layout-core; spec
 * docs/specs/surface-layout.md § Verbs — "▦ Cycle shape … one chip on the
 * layout (top-bar right cluster)"). Terminal-route L1 tier only.
 *
 * - **In-bar (`LayoutChip`)**: a fixed-square token button whose click opens a
 *   popover of the preset-shape glyphs valid for the CURRENT tile count
 *   (`shapesForArity(SHAPE_ARITY[layout.shape])` — a shape never changes the
 *   tile count; adds/closes do that). The current shape is marked (trailing ✓
 *   + `aria-checked`, the macOS menu pattern); clicking a glyph jumps DIRECTLY
 *   via `setShape` → the caller's `onApply` (app.tsx's `applyLayout` — the
 *   single user-mutation path, R3 write discipline). The popover follows the
 *   `SplitControl` direction-menu pattern (outside-mousedown closes, Escape
 *   closes + refocuses the trigger, `role="menu"` + `menuitemradio` rows).
 * - **Overflow (`LayoutMenuRows`)**: the chip's chevron-menu form — one
 *   `Layout: …` `menuitemradio` row per arity-valid shape (the
 *   `ViewSwitcherMenuRows` precedent: `MENU_ROW_*` composition, active row
 *   inverse-video, `tabIndex={-1}` roving focus).
 *
 * The same-arity CYCLE chord is the registry's `layout-cycle` binding (⌘;) —
 * the chip's tip advertises its effective combo (registry-derived, omitted
 * when unbound/disabled; the SplitControl tip pattern), and the palette's
 * `Layout: Cycle Shape` entry is its Constitution V parity.
 *
 * Presentational by contract: the layout arrives resolved from app.tsx; the
 * chip owns only its popover-open state.
 */

type LayoutChipProps = {
  /** The RESOLVED layout (app.tsx ran the ladder + degradation). */
  layout: Layout;
  /** The single mutation path (app.tsx `applyLayout`): persist + URL mirror. */
  onApply: (next: Layout) => void;
};

export function LayoutChip({ layout, onApply }: LayoutChipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Outside-mousedown + Escape close (the SplitControl popover pattern);
  // Escape refocuses the trigger.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey, { capture: true });
    };
  }, [open]);

  // Host-effective cycle chord for the tip's kbd slot (260811-0f3d pattern):
  // registry-derived, reflecting rebinds, omitted when unbound/disabled (a
  // keycap advertising a dead chord would lie).
  const { byAction, host } = useKeybindings();
  const cycleBinding = byAction.get("layout-cycle");
  const cycleChord = cycleBinding?.enabled
    ? formatCombo({ code: cycleBinding.code, tier: cycleBinding.tier }, host.platform)
    : undefined;

  // The popover lists exactly the shapes valid for the CURRENT tile count
  // (R9) — arity is fixed per shape, so a jump can never strand a tile.
  const shapes = shapesForArity(SHAPE_ARITY[layout.shape]);

  const jump = (shape: (typeof shapes)[number]) => {
    setOpen(false);
    const next = setShape(layout, shape);
    if (next) onApply(next);
  };

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      {/* Tip suppressed while the popover is open (trigger convention — the
          tip must not paint over the first rows). */}
      <Tip label={open ? undefined : "Layout"} kbd={open ? undefined : cycleChord}>
        <button
          ref={buttonRef}
          type="button"
          data-testid="layout-chip"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Layout"
          className={TOP_BAR_BUTTON}
        >
          <LayoutGlyph />
        </button>
      </Tip>
      {open && (
        <div
          role="menu"
          aria-label="Layout presets"
          // The SplitControl direction-menu sizing: shrink-wraps to its rows
          // (`w-max`) with the 170px floor guarding the single-shape case.
          className="absolute top-full right-0 mt-1 w-max min-w-[170px] bg-bg-primary border border-border rounded-lg shadow-2xl py-1 z-50"
        >
          {shapes.map((shape) => {
            const current = shape === layout.shape;
            return (
              <button
                key={shape}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                data-testid={`layout-shape-${shape}`}
                onClick={() => jump(shape)}
                className={POPOVER_ROW_CLASS}
              >
                <LayoutShapeGlyph shape={shape} />
                {SHAPE_LABEL[shape]}
                {/* Current-shape marker: trailing ✓ (the macOS menu pattern —
                    the row's glyph is identity, the ✓ is the state marker). */}
                {current && (
                  <span aria-hidden="true" className="ml-auto text-accent-green">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The chip's chevron-menu rows (260715-h1ck overflow representation): one
 * `Layout: …` `menuitemradio` row per arity-valid shape — the
 * `ViewSwitcherMenuRows` precedent (`MENU_ROW_BASE` + rest/active composition,
 * inverse-video active row, `tabIndex={-1}` for the menu's roving focus).
 * Clicking jumps directly (the menu's role-keyed click handler closes the
 * panel on a `menuitemradio` activation).
 */
export function LayoutMenuRows({ layout, onApply }: LayoutChipProps) {
  const shapes = shapesForArity(SHAPE_ARITY[layout.shape]);
  return (
    <>
      {shapes.map((shape) => {
        const current = shape === layout.shape;
        return (
          <button
            key={shape}
            type="button"
            role="menuitemradio"
            tabIndex={-1}
            aria-checked={current}
            data-testid={`layout-shape-${shape}`}
            onClick={() => {
              const next = setShape(layout, shape);
              if (next) onApply(next);
            }}
            className={`${MENU_ROW_BASE} ${current ? MENU_ROW_ACTIVE : MENU_ROW_REST}`}
          >
            <LayoutShapeGlyph shape={shape} />
            {`Layout: ${SHAPE_LABEL[shape]}`}
          </button>
        );
      })}
    </>
  );
}
