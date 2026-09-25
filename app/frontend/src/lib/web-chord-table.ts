/**
 * The native engine's chord table — the reclaim predicate, enumerated.
 *
 * A guest `WebContentsView`'s keydowns never reach the SPA document, so
 * `hasReclaimableMatch` cannot run at event time there. Instead the SPA
 * enumerates its kind-`"web"` answer over the effective binding registry into
 * a concrete table, uploads it (`web:chords`), and main matches
 * `before-input-event` against it with exact modifier equality — the registry
 * stays the single authority (a rebind re-derives the table and moves both
 * engines) and main stays dumb and testable.
 *
 * The per-tier expansion mirrors `matchesCombo`'s acceptance exactly:
 * `cmd` accepts Ctrl OR Meta without Shift; `shifted` accepts Shift+Ctrl OR
 * Shift+Meta; `ctrl` accepts Ctrl alone; Alt is rejected in every tier. A
 * plain `{code: "Escape"}` spec is appended last in the released table —
 * Escape is the focus-return chord and is not a registry binding. Under the
 * web tile's keyboard-capture latch (`captured`) the table narrows to the
 * `captureSurface` toggle binding's specs ALONE and Escape is dropped, so the
 * guest page's own chords — including its palette's Esc close — pass through
 * (the iframe engine's in-document narrowing, mirrored shell-side).
 */
import type { EffectiveBinding } from "@/lib/keybindings";

/** One reclaimable chord for the shell-side matcher: a key code plus its
 *  exact modifier set. `alt` is always `false` (the registry has no Alt
 *  tier); the field exists so the main-side match is exact equality. */
export interface WebChordSpec {
  code: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: false;
}

/** The combos `matchesCombo` accepts for a binding's `{code, tier}`. */
function combosFor(code: string, tier: EffectiveBinding["tier"]): WebChordSpec[] {
  switch (tier) {
    case "cmd":
      return [
        { code, ctrl: true, meta: false, shift: false, alt: false },
        { code, ctrl: false, meta: true, shift: false, alt: false },
      ];
    case "shifted":
      return [
        { code, ctrl: true, meta: false, shift: true, alt: false },
        { code, ctrl: false, meta: true, shift: true, alt: false },
      ];
    case "ctrl":
      return [{ code, ctrl: true, meta: false, shift: false, alt: false }];
  }
}

/**
 * The per-guest chord table over the effective registry: every enabled
 * binding that `hasReclaimableMatch` would reclaim under kind `"web"` —
 * ungated, `webOnly`, and `captureSurface` bindings; never `ttyOnly` or
 * `guiOnly` — expanded per tier, deduped by the five-tuple, in registry
 * order, Escape last. With `captured` set (the web tile's capture latch) the
 * table is ONLY the `captureSurface` binding's effective specs — a disabled
 * or unbound toggle yields an empty table, leaving the URL-bar button and the
 * palette row as the exits — and no Escape spec is appended.
 */
export function buildWebChordTable(
  bindings: readonly EffectiveBinding[],
  opts?: { captured?: boolean },
): WebChordSpec[] {
  const seen = new Set<string>();
  const specs: WebChordSpec[] = [];
  const push = (spec: WebChordSpec): void => {
    const key = `${spec.code}${spec.ctrl}${spec.meta}${spec.shift}${spec.alt}`;
    if (seen.has(key)) return;
    seen.add(key);
    specs.push(spec);
  };
  for (const binding of bindings) {
    if (!binding.enabled || binding.code === "") continue;
    if (opts?.captured) {
      if (!binding.captureSurface) continue;
    } else if (binding.ttyOnly || binding.guiOnly) {
      continue;
    }
    for (const spec of combosFor(binding.code, binding.tier)) push(spec);
  }
  if (!opts?.captured) {
    push({ code: "Escape", ctrl: false, meta: false, shift: false, alt: false });
  }
  return specs;
}
