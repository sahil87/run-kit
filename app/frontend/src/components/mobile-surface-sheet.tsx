import { useRef } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import {
  SURFACE_GLYPH,
  SURFACE_LABEL,
  type SurfaceKind,
} from "@/lib/surface-layout";

/**
 * MobileSurfaceSheet (260812-ab5v-surface-layout-core T014; spec
 * docs/specs/surface-layout.md § Mobile — "slot A + the remaining surfaces as
 * sheet tabs", right-panel P5 carried forward). Below `isMobileViewport()` the
 * layout manager renders only ONE tile; this sheet is how the OTHER resolved
 * surfaces stay reachable: a bottom-bar chip opens this full-height sheet
 * listing the open surfaces as TABS, and selecting a tab swaps which surface
 * renders in slot A **on mobile only** — the selection is transient
 * app-level state, NEVER a layout mutation (the layout stays desktop's
 * arrangement; no URL/localStorage write, matching zoom's transient
 * discipline).
 *
 * Every open surface is listed — the shown one included, marked pressed — so
 * the sheet is also the way BACK to slot A after a tab switch (a
 * remaining-surfaces-only list would be a one-way door).
 *
 * Pattern: the Shell mobile drawer's sibling — a backdrop + panel with
 * `role="dialog" aria-modal="true"`, focus-trapped (`useFocusTrap`, the
 * drawer/Dialog contract), Escape and backdrop-tap close. `fixed inset-0`
 * (the app.tsx Dialog precedent) so it covers the whole viewport regardless
 * of the bottom bar's grid cell.
 *
 * Presentational: surfaces/active/selection arrive as props; the sheet owns
 * nothing.
 */
export function MobileSurfaceSheet({
  surfaces,
  active,
  onSelect,
  onClose,
}: {
  /** The open surfaces (the resolved layout's order, deduped), tty first. */
  surfaces: SurfaceKind[];
  /** The surface currently rendering in the mobile slot. */
  active: SurfaceKind;
  /** Tab selection — swaps the mobile slot-A surface (transient, mobile-only). */
  onSelect: (surface: SurfaceKind) => void;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // aria-modal contract: trap Tab within the sheet, Escape closes (the Shell
  // drawer pattern).
  useFocusTrap(sheetRef, true, onClose);

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop — tap dismisses (the drawer/backdrop convention). */}
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Surfaces"
        data-testid="mobile-surface-sheet"
        // Full-height sheet (the bottom sliver of headroom lets the backdrop
        // read as a dismiss affordance, mirroring the drawer's 88% width).
        className="absolute inset-x-0 bottom-0 top-[8%] bg-bg-primary border-t border-border rounded-t-lg shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center px-3 h-10 shrink-0 border-b border-border text-xs text-text-secondary select-none">
          Surfaces
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {surfaces.map((kind) => {
            const isActive = kind === active;
            const label = SURFACE_LABEL[kind];
            return (
              <button
                key={kind}
                type="button"
                data-testid={`mobile-surface-tab-${kind}`}
                aria-pressed={isActive}
                aria-label={`${label} tab`}
                onClick={() => {
                  onSelect(kind);
                  onClose();
                }}
                className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-accent-green/10 text-accent-green"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-card"
                }`}
              >
                <span aria-hidden="true" className="font-mono w-6 text-center">
                  {SURFACE_GLYPH[kind]}
                </span>
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
