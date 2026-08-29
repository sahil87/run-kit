// Package layoutspec is the Go port of the frontend's surface-layout grammar
// (app/frontend/src/lib/surface-layout.ts parseLayout/serializeLayout): the
// "@rk_win_layout" value is "<shape>:<surface>[,<surface>…]" and both the
// /options validator and the CLI share this one table so they cannot drift
// from the frontend's parser. The package is pure — no tmux, no I/O.
package layoutspec

import (
	"errors"
	"fmt"
	"strings"
)

// Layout is a parsed layout value: which preset arrangement (Shape) and which
// surfaces occupy its slots (Order — Order[0] is slot A, the main slot in
// main-* shapes). A layout carries exactly its shape's arity of surfaces;
// kinds never repeat within one layout EXCEPT tty (duplicate tty tiles of the
// same window are legal — the muxed relay supports N clients per pane).
type Layout struct {
	Shape string
	Order []string
}

// shapeArity is the fixed slot count per shape (spec: shape arity is fixed).
var shapeArity = map[string]int{
	"single":     1,
	"split-h":    2,
	"split-v":    2,
	"row":        3,
	"col":        3,
	"main-left":  3,
	"main-right": 3,
	"main-top":   3,
}

// surfaceKinds is the closed surface registry — the frontend's ViewName set;
// spec'd-but-unshipped surfaces (desktop, agents) are rejected until the
// frontend ships them, and extending the registry is appending one entry.
var surfaceKinds = map[string]bool{
	"tty":  true,
	"web":  true,
	"chat": true,
	"code": true,
}

// Parse validates "<shape>:<a>,<b>[,<c>]" and returns the Layout. Untrusted
// strings (tmux option values, API bodies) are validated HERE so callers may
// pass raw values. Anything malformed — unknown shape, unknown surface, wrong
// arity for the shape, a repeated non-tty surface — is an error.
func Parse(raw string) (Layout, error) {
	shape, rest, found := strings.Cut(raw, ":")
	if !found {
		return Layout{}, fmt.Errorf("layout %q: must be <shape>:<surface,…>", raw)
	}
	arity, ok := shapeArity[shape]
	if !ok {
		return Layout{}, fmt.Errorf("layout %q: unknown shape %q", raw, shape)
	}
	order := strings.Split(rest, ",")
	if len(order) != arity {
		return Layout{}, fmt.Errorf("layout %q: shape %q takes %d surfaces, got %d", raw, shape, arity, len(order))
	}
	seen := map[string]bool{}
	for _, surface := range order {
		if !surfaceKinds[surface] {
			return Layout{}, fmt.Errorf("layout %q: unknown surface %q", raw, surface)
		}
		if surface == "tty" {
			continue // duplicate tty tiles are legal (muxed relay)
		}
		if seen[surface] {
			return Layout{}, fmt.Errorf("layout %q: surface %q repeats", raw, surface)
		}
		seen[surface] = true
	}
	return Layout{Shape: shape, Order: order}, nil
}

// String serializes the layout back to its exact option-value form
// (round-trips byte-identically with Parse).
func (l Layout) String() string {
	return l.Shape + ":" + strings.Join(l.Order, ",")
}

// Has reports whether the layout's order contains the surface.
func (l Layout) Has(surface string) bool {
	for _, s := range l.Order {
		if s == surface {
			return true
		}
	}
	return false
}

// IsSurface reports whether kind is in the surface registry.
func IsSurface(kind string) bool {
	return surfaceKinds[kind]
}

// Sentinels for the disallowed mutations below — where the frontend verbs
// return null. The CLI maps these to exit codes; the /options validator never
// calls the verbs.
var (
	// ErrLayoutFull: Add on a 3-tile layout (the arity cap).
	ErrLayoutFull = errors.New("layout already holds 3 tiles")
	// ErrLayoutLastTile: Close on a single-tile layout.
	ErrLayoutLastTile = errors.New("the last tile never closes")
	// ErrSurfaceAbsent: Close/Promote on a surface the layout does not hold.
	ErrSurfaceAbsent = errors.New("surface is not in the layout")
	// ErrSurfaceRepeat: Add a non-tty surface the layout already holds.
	ErrSurfaceRepeat = errors.New("surface is already in the layout")
	// ErrUnknownSurface: a kind outside the surface registry (user input).
	ErrUnknownSurface = errors.New("unknown surface")
	// ErrArityMismatch: SetShape to a shape of a different arity.
	ErrArityMismatch = errors.New("shape has a different arity")
)

// growthShape is the shape a layout grows to when a tile is appended
// (GROWTH_SHAPE): 1→2 split-h, 2→3 main-left (slot A stays dominant).
var growthShape = map[int]string{2: "split-h", 3: "main-left"}

// collapseShape is the shape a layout collapses to when a tile leaves
// (COLLAPSE_SHAPE): 3→2 split-h, 2→1 single.
var collapseShape = map[int]string{1: "single", 2: "split-h"}

// shapeRing is the same-arity cycle ring per arity (SHAPE_RING): arity 1
// cycles to itself, arity 2 alternates the two splits, arity 3 walks the five
// 3-tile presets.
var shapeRing = map[int][]string{
	1: {"single"},
	2: {"split-h", "split-v"},
	3: {"row", "col", "main-left", "main-right", "main-top"},
}

// Default is the layout an unset @rk_win_layout renders (the frontend's
// effectiveLayout fallback). Every verb treats the zero Layout as Default.
func Default() Layout {
	return Layout{Shape: "single", Order: []string{"tty"}}
}

// normalize maps a zero-valued Layout (no order) to Default so callers may
// pass an empty struct for "unset".
func normalize(l Layout) Layout {
	if len(l.Order) == 0 {
		return Default()
	}
	return l
}

func indexOf(l Layout, surface string) int {
	for i, s := range l.Order {
		if s == surface {
			return i
		}
	}
	return -1
}

// Promote moves surface to slot A; the rest of the order permutes unchanged,
// shape untouched. A no-op (same layout returned) when absent or already A.
func Promote(l Layout, surface string) Layout {
	l = normalize(l)
	idx := indexOf(l, surface)
	if idx <= 0 {
		return l
	}
	order := make([]string, 0, len(l.Order))
	order = append(order, surface)
	for _, s := range l.Order {
		if s != surface {
			order = append(order, s)
		}
	}
	return Layout{Shape: l.Shape, Order: order}
}

// SwapWithNext exchanges surface with its next neighbor in order, wrapping at
// the end back to slot A. A no-op on single-tile layouts or an absent surface.
func SwapWithNext(l Layout, surface string) Layout {
	l = normalize(l)
	idx := indexOf(l, surface)
	if idx < 0 || len(l.Order) < 2 {
		return l
	}
	order := append([]string(nil), l.Order...)
	next := (idx + 1) % len(order)
	order[idx], order[next] = order[next], order[idx]
	return Layout{Shape: l.Shape, Order: order}
}

// Close removes surface and collapses the shape to the smaller-arity preset
// (3→2 split-h, 2→1 single), remaining order preserved with slot A kept.
// ErrLayoutLastTile on a single-tile layout; ErrSurfaceAbsent when absent.
func Close(l Layout, surface string) (Layout, error) {
	l = normalize(l)
	if len(l.Order) < 2 {
		return Layout{}, ErrLayoutLastTile
	}
	idx := indexOf(l, surface)
	if idx < 0 {
		return Layout{}, ErrSurfaceAbsent
	}
	kept := make([]string, 0, len(l.Order)-1)
	for i, s := range l.Order {
		if i != idx {
			kept = append(kept, s)
		}
	}
	return Layout{Shape: collapseShape[len(kept)], Order: kept}, nil
}

// Add appends surface to the next slot and grows the shape (1→2 split-h,
// 2→3 main-left). ErrLayoutFull at 3 tiles; ErrSurfaceRepeat when a non-tty
// surface is already open (duplicate tty tiles are legal — the muxed relay
// supports N clients per pane); ErrUnknownSurface outside the registry.
func Add(l Layout, surface string) (Layout, error) {
	l = normalize(l)
	if !IsSurface(surface) {
		return Layout{}, fmt.Errorf("%w: %q", ErrUnknownSurface, surface)
	}
	if len(l.Order) >= 3 {
		return Layout{}, ErrLayoutFull
	}
	if surface != "tty" && l.Has(surface) {
		return Layout{}, fmt.Errorf("%w: %q", ErrSurfaceRepeat, surface)
	}
	order := append(append([]string(nil), l.Order...), surface)
	return Layout{Shape: growthShape[len(order)], Order: order}, nil
}

// Cycle returns the next same-arity preset, order kept (arity 1 cycles to
// itself).
func Cycle(l Layout) Layout {
	l = normalize(l)
	ring := shapeRing[len(l.Order)]
	for i, shape := range ring {
		if shape == l.Shape {
			return Layout{Shape: ring[(i+1)%len(ring)], Order: l.Order}
		}
	}
	// A parsed layout's shape always matches its arity; an ad-hoc Layout that
	// does not lands on the ring head rather than panicking.
	return Layout{Shape: ring[0], Order: l.Order}
}

// SetShape jumps to shape within the current arity (a shape can never change
// the tile count); ErrArityMismatch otherwise.
func SetShape(l Layout, shape string) (Layout, error) {
	l = normalize(l)
	arity, ok := shapeArity[shape]
	if !ok {
		return Layout{}, fmt.Errorf("unknown shape %q", shape)
	}
	if arity != len(l.Order) {
		return Layout{}, fmt.Errorf("%w: %q takes %d surfaces, the layout holds %d", ErrArityMismatch, shape, arity, len(l.Order))
	}
	return Layout{Shape: shape, Order: l.Order}, nil
}
