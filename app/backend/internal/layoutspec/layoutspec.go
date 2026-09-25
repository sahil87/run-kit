// Package layoutspec is the Go port of the frontend's surface-layout tree
// model (app/frontend/src/lib/layout-tree.ts, plus the verbs of
// surface-layout.ts): the "@rk_win_layout" value is a CANONICAL SPLIT TREE —
// "h(tty,v(code,web))" — and the legacy "<shape>:<surface,…>" preset strings
// parse permanently into their trees. The /options validator and the CLI
// share this one package so they cannot drift from the frontend's parser, and
// a shared JSON fixture table (app/frontend/src/lib/layout-tree.fixtures.json,
// read by layoutspec_test.go) pins identical inputs → outputs on both sides.
// The package is pure — no tmux, no I/O. Unlike the frontend, Go trees carry
// no sizes: divider positions are per-viewer frontend state.
package layoutspec

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

// Node is one node of the canonical split tree: a leaf (Kind set — a surface
// kind) or a split (Dir "h" = children left→right, "v" = top→bottom, with ≥2
// Children, and a child split never of its parent's direction, so each
// arrangement has exactly one encoding). A tree holds 1–3 leaves; non-tty
// kinds never repeat (duplicate tty tiles are legal — the muxed relay
// supports N clients per pane).
type Node struct {
	Kind     string
	Dir      string
	Children []Node
}

// MaxTiles is the tile-count cap (the size floor that replaces it is a later
// change).
const MaxTiles = 3

// splitGapPX mirrors the frontend's SPLIT_GAP_PX gutter: the nominal geometry
// Add resolves the split direction from is computed with it, so the Go and TS
// verbs pick the same axis.
const splitGapPX = 6

// nominalBox mirrors the frontend's NOMINAL_BOX: the fallback geometry for
// callers with no measured rects (mobile, the CLI).
var nominalBox = rect{w: 1600, h: 1000}

// surfaceKindList is the closed surface registry — the frontend's ViewName
// set; spec'd-but-unshipped surfaces (desktop, agents) are rejected until the
// frontend ships them, and extending the registry is appending one entry.
var surfaceKindList = []string{"tty", "web", "code", "gui"}

// IsSurface reports whether kind is in the surface registry.
func IsSurface(kind string) bool {
	for _, k := range surfaceKindList {
		if k == kind {
			return true
		}
	}
	return false
}

// IsLeaf reports whether the node is a leaf (a surface kind, not a split).
func (n Node) IsLeaf() bool {
	return n.Kind != ""
}

func leaf(kind string) Node {
	return Node{Kind: kind}
}

// splitNode builds a split; a single-child split lifts to the child
// (canonical form).
func splitNode(dir string, children ...Node) Node {
	if len(children) == 1 {
		return children[0]
	}
	return Node{Dir: dir, Children: children}
}

// Leaves returns the leaf kinds in reading order (depth-first, left-to-right).
func (n Node) Leaves() []string {
	if n.IsLeaf() {
		return []string{n.Kind}
	}
	var out []string
	for _, c := range n.Children {
		out = append(out, c.Leaves()...)
	}
	return out
}

// LeafIDs returns the stable per-leaf ids in reading order: the kind itself
// for a unique kind; duplicate kinds (only tty can repeat) are "tty",
// "tty#2", … by occurrence.
func (n Node) LeafIDs() []string {
	kinds := n.Leaves()
	totals := map[string]int{}
	for _, k := range kinds {
		totals[k]++
	}
	seen := map[string]int{}
	out := make([]string, len(kinds))
	for i, k := range kinds {
		if totals[k] == 1 {
			out[i] = k
			continue
		}
		seen[k]++
		if seen[k] == 1 {
			out[i] = k
		} else {
			out[i] = k + "#" + strconv.Itoa(seen[k])
		}
	}
	return out
}

// Has reports whether the layout's leaves contain the surface.
func (n Node) Has(surface string) bool {
	for _, k := range n.Leaves() {
		if k == surface {
			return true
		}
	}
	return false
}

// String serializes the tree to its grammar form — the only form writers
// emit (a legacy preset string Parse accepts rewrites to this on write).
func (n Node) String() string {
	if n.IsLeaf() {
		return n.Kind
	}
	parts := make([]string, len(n.Children))
	for i, c := range n.Children {
		parts[i] = c.String()
	}
	return n.Dir + "(" + strings.Join(parts, ",") + ")"
}

// ── parsing (tree grammar + permanent legacy preset grammar) ───────────────

// Parse validates a stored @rk_win_layout value: the tree grammar, or the
// legacy "<shape>:<a>,<b>[,<c>]" preset grammar (accepted permanently,
// converted losslessly per the spec table). Untrusted strings (tmux option
// values, API bodies) are validated HERE so callers may pass raw values.
// Anything malformed — unknown kind, whitespace, a non-canonical tree, more
// than MaxTiles leaves, a repeated non-tty surface, a legacy arity mismatch —
// is an error. The input is NEVER normalised into validity.
func Parse(raw string) (Node, error) {
	if raw == "" || strings.IndexFunc(raw, unicode.IsSpace) >= 0 {
		return Node{}, fmt.Errorf("layout %q: empty or contains whitespace", raw)
	}
	var (
		n   Node
		err error
	)
	if strings.Contains(raw, ":") {
		n, err = parseLegacy(raw)
	} else {
		n, err = parseTreeGrammar(raw)
	}
	if err != nil {
		return Node{}, err
	}
	if !isCanonicalTree(n) {
		return Node{}, fmt.Errorf("layout %q: not a canonical tree (1–%d leaves, ≥2 children per split, alternating directions, no repeated non-tty surface)", raw, MaxTiles)
	}
	return n, nil
}

// isCanonicalTree applies the canonical-form validation: ≥2 children per
// split, no child split with its parent's direction, 1..MaxTiles leaves, and
// no repeated non-tty kind.
func isCanonicalTree(n Node) bool {
	kinds := n.Leaves()
	if len(kinds) < 1 || len(kinds) > MaxTiles {
		return false
	}
	seen := map[string]bool{}
	for _, k := range kinds {
		if k == "tty" {
			continue // duplicate tty tiles are legal (muxed relay)
		}
		if seen[k] {
			return false
		}
		seen[k] = true
	}
	var walk func(n Node, parentDir string) bool
	walk = func(n Node, parentDir string) bool {
		if n.IsLeaf() {
			return true
		}
		if len(n.Children) < 2 {
			return false
		}
		if parentDir != "" && n.Dir == parentDir {
			return false
		}
		for _, c := range n.Children {
			if !walk(c, n.Dir) {
				return false
			}
		}
		return true
	}
	return walk(n, "")
}

// treeParser is the recursive-descent cursor for the tree grammar.
type treeParser struct {
	raw string
	i   int
}

func parseTreeGrammar(raw string) (Node, error) {
	p := &treeParser{raw: raw}
	n, err := p.parseNode()
	if err != nil {
		return Node{}, fmt.Errorf("layout %q: %v", raw, err)
	}
	if p.i != len(raw) {
		return Node{}, fmt.Errorf("layout %q: trailing input at byte %d", raw, p.i)
	}
	return n, nil
}

func (p *treeParser) parseNode() (Node, error) {
	if p.i >= len(p.raw) {
		return Node{}, errors.New("unexpected end of input")
	}
	if ch := p.raw[p.i]; ch == 'h' || ch == 'v' {
		dir := string(ch)
		p.i++
		if p.i >= len(p.raw) || p.raw[p.i] != '(' {
			return Node{}, fmt.Errorf("split %q not followed by (", dir)
		}
		p.i++
		var children []Node
		for {
			c, err := p.parseNode()
			if err != nil {
				return Node{}, err
			}
			children = append(children, c)
			if p.i < len(p.raw) && p.raw[p.i] == ',' {
				p.i++
				continue
			}
			break
		}
		if p.i >= len(p.raw) || p.raw[p.i] != ')' {
			return Node{}, errors.New("split not closed by )")
		}
		p.i++
		return Node{Dir: dir, Children: children}, nil
	}
	// No surface kind is a prefix of another, and a leaf must be followed by a
	// delimiter or the end of input.
	for _, kind := range surfaceKindList {
		if !strings.HasPrefix(p.raw[p.i:], kind) {
			continue
		}
		if next := p.i + len(kind); next < len(p.raw) && p.raw[next] != ',' && p.raw[next] != ')' {
			return Node{}, fmt.Errorf("surface %q not followed by a delimiter", kind)
		}
		p.i += len(kind)
		return leaf(kind), nil
	}
	return Node{}, fmt.Errorf("unknown surface at byte %d", p.i)
}

// legacyArity is the fixed slot count per legacy preset shape.
var legacyArity = map[string]int{
	"single":     1,
	"split-h":    2,
	"split-v":    2,
	"row":        3,
	"col":        3,
	"main-left":  3,
	"main-right": 3,
	"main-top":   3,
}

// parseLegacy converts the legacy "<shape>:<a>,<b>[,<c>]" preset grammar to
// its tree (the permanent table in the spec).
func parseLegacy(raw string) (Node, error) {
	shape, rest, _ := strings.Cut(raw, ":")
	arity, ok := legacyArity[shape]
	if !ok {
		return Node{}, fmt.Errorf("layout %q: unknown shape %q", raw, shape)
	}
	parts := strings.Split(rest, ",")
	if len(parts) != arity {
		return Node{}, fmt.Errorf("layout %q: shape %q takes %d surfaces, got %d", raw, shape, arity, len(parts))
	}
	kinds := make([]Node, len(parts))
	for i, s := range parts {
		if !IsSurface(s) {
			return Node{}, fmt.Errorf("layout %q: unknown surface %q", raw, s)
		}
		kinds[i] = leaf(s)
	}
	switch shape {
	case "single":
		return kinds[0], nil
	case "split-h":
		return splitNode("h", kinds...), nil
	case "split-v":
		return splitNode("v", kinds...), nil
	case "row":
		return splitNode("h", kinds...), nil
	case "col":
		return splitNode("v", kinds...), nil
	case "main-left":
		return splitNode("h", kinds[0], splitNode("v", kinds[1], kinds[2])), nil
	case "main-right":
		return splitNode("h", splitNode("v", kinds[1], kinds[2]), kinds[0]), nil
	case "main-top":
		return splitNode("v", kinds[0], splitNode("h", kinds[1], kinds[2])), nil
	}
	panic("unreachable: legacyArity and the builder switch cover the same shapes")
}

// ── pure tree operations ────────────────────────────────────────────────────

// Sentinels for the disallowed mutations below — where the frontend verbs
// return null. The CLI maps these to exit codes; the /options validator never
// calls the verbs.
var (
	// ErrLayoutFull: Add on a 3-tile layout (the tile cap).
	ErrLayoutFull = errors.New("layout already holds 3 tiles")
	// ErrLayoutLastTile: Close on a single-tile layout.
	ErrLayoutLastTile = errors.New("the last tile never closes")
	// ErrSurfaceAbsent: Close/Promote on a surface the layout does not hold.
	ErrSurfaceAbsent = errors.New("surface is not in the layout")
	// ErrSurfaceRepeat: Add a non-tty surface the layout already holds.
	ErrSurfaceRepeat = errors.New("surface is already in the layout")
	// ErrUnknownSurface: a kind outside the surface registry (user input).
	ErrUnknownSurface = errors.New("unknown surface")
	// ErrUnknownTemplate: SetTemplate to a template that does not apply to the
	// layout's tile count.
	ErrUnknownTemplate = errors.New("template does not apply to the tile count")
)

// Default is the layout an unset @rk_win_layout renders (the frontend's
// effectiveLayout fallback): the bare tty leaf. Every verb treats a leaf-less
// Node as Default.
func Default() Node {
	return leaf("tty")
}

// normalize maps a leaf-less Node (the zero value) to Default so callers may
// pass an empty struct for "unset".
func normalize(n Node) Node {
	if len(n.Leaves()) == 0 {
		return Default()
	}
	return n
}

// normalise canonicalises: merge same-direction nesting and lift
// single-child splits. Canonical input is a fixpoint.
func normalise(n Node) Node {
	if n.IsLeaf() {
		return n
	}
	var children []Node
	for _, c := range n.Children {
		c = normalise(c)
		if !c.IsLeaf() && c.Dir == n.Dir {
			children = append(children, c.Children...)
		} else {
			children = append(children, c)
		}
	}
	return splitNode(n.Dir, children...)
}

// lastPath is the child-index path of the last leaf in reading order —
// reached by descending into the last child at every level.
func lastPath(n Node) []int {
	var path []int
	for !n.IsLeaf() {
		last := len(n.Children) - 1
		path = append(path, last)
		n = n.Children[last]
	}
	return path
}

// pathOf returns the child-index path of a leaf id.
func pathOf(n Node, leafID string) ([]int, bool) {
	ids := n.LeafIDs()
	li := 0
	var walk func(n Node, path []int) []int
	walk = func(n Node, path []int) []int {
		if n.IsLeaf() {
			found := path
			if ids[li] != leafID {
				found = nil
			}
			li++
			return found
		}
		for i, c := range n.Children {
			if found := walk(c, append(path, i)); found != nil {
				return found
			}
		}
		return nil
	}
	found := walk(n, nil)
	return found, found != nil
}

// replaceAt rebuilds the tree with the node at path substituted.
func replaceAt(n Node, path []int, value Node) Node {
	if len(path) == 0 {
		return value
	}
	children := make([]Node, len(n.Children))
	copy(children, n.Children)
	children[path[0]] = replaceAt(children[path[0]], path[1:], value)
	return Node{Dir: n.Dir, Children: children}
}

// removeAt drops the subtree at path; ok=false marks the removed node itself.
func removeAt(n Node, path []int) (out Node, ok bool) {
	if len(path) == 0 {
		return Node{}, false
	}
	children := make([]Node, 0, len(n.Children))
	for i, c := range n.Children {
		if i != path[0] {
			children = append(children, c)
			continue
		}
		if r, rok := removeAt(c, path[1:]); rok {
			children = append(children, r)
		}
	}
	if len(children) == 0 {
		return Node{}, false
	}
	return Node{Dir: n.Dir, Children: children}, true
}

func indexOf(ss []string, s string) int {
	for i, v := range ss {
		if v == s {
			return i
		}
	}
	return -1
}

func contains(ss []string, s string) bool {
	return indexOf(ss, s) >= 0
}

// swapLeaves exchanges two leaves by id. An involution, and a no-op when
// either id is absent.
func swapLeaves(n Node, a, b string) Node {
	if a == b {
		return n
	}
	ids := n.LeafIDs()
	kinds := n.Leaves()
	ka, kb := "", ""
	for i, id := range ids {
		switch id {
		case a:
			ka = kinds[i]
		case b:
			kb = kinds[i]
		}
	}
	if ka == "" || kb == "" {
		return n
	}
	li := 0
	var walk func(n Node) Node
	walk = func(n Node) Node {
		if n.IsLeaf() {
			id := ids[li]
			li++
			switch id {
			case a:
				return leaf(kb)
			case b:
				return leaf(ka)
			}
			return n
		}
		children := make([]Node, len(n.Children))
		for i, c := range n.Children {
			children[i] = walk(c)
		}
		return Node{Dir: n.Dir, Children: children}
	}
	return walk(n)
}

// ── templates (generators, not the model) ───────────────────────────────────

// templateNames is the registry order — it drives TemplateOf matching,
// TemplatesFor, and the Cycle walk.
var templateNames = []string{"row", "col", "main-left", "main-right", "main-top", "main-bottom", "grid"}

// indexKinds are distinct stand-in kinds for structure comparisons and slot
// mapping (there are exactly four kinds, and template matching runs at N ≤ 4).
var indexKinds = []string{"tty", "web", "code", "gui"}

// buildTemplate builds a template's tree for any N from a slot order; slot 0
// is the template's main tile.
func buildTemplate(name string, slots []string) Node {
	leaves := make([]Node, len(slots))
	for i, k := range slots {
		leaves[i] = leaf(k)
	}
	switch name {
	case "row":
		return splitNode("h", leaves...)
	case "col":
		return splitNode("v", leaves...)
	case "main-left":
		if len(leaves) < 3 {
			return splitNode("h", leaves...)
		}
		return splitNode("h", leaves[0], splitNode("v", leaves[1:]...))
	case "main-right":
		if len(leaves) < 3 {
			return splitNode("h", leaves...)
		}
		return splitNode("h", splitNode("v", leaves[1:]...), leaves[0])
	case "main-top":
		if len(leaves) < 3 {
			return splitNode("v", leaves...)
		}
		return splitNode("v", leaves[0], splitNode("h", leaves[1:]...))
	case "main-bottom":
		if len(leaves) < 3 {
			return splitNode("v", leaves...)
		}
		return splitNode("v", splitNode("h", leaves[1:]...), leaves[0])
	case "grid":
		cols := 1
		for cols*cols < len(leaves) {
			cols++
		}
		var rows []Node
		for i := 0; i < len(leaves); i += cols {
			end := i + cols
			if end > len(leaves) {
				end = len(leaves)
			}
			rows = append(rows, splitNode("h", leaves[i:end]...))
		}
		return splitNode("v", rows...)
	}
	return Node{}
}

// structureSig is the structure signature: the tree's shape with leaves
// replaced by their reading-order indices, e.g. "h(0,v(1,2))".
func structureSig(n Node) string {
	var b strings.Builder
	i := 0
	var walk func(n Node)
	walk = func(n Node) {
		if n.IsLeaf() {
			b.WriteString(strconv.Itoa(i))
			i++
			return
		}
		b.WriteString(n.Dir)
		b.WriteByte('(')
		for j, c := range n.Children {
			if j > 0 {
				b.WriteByte(',')
			}
			walk(c)
		}
		b.WriteByte(')')
	}
	walk(n)
	return b.String()
}

// TemplateOf reports which template a tree is (structure match, kinds
// ignored) and its leaves in that template's slot order: the first template
// in registry order whose structure matches, "single" at one leaf, "custom"
// otherwise. The slots are reading order for "single" and "custom".
func TemplateOf(n Node) (name string, slots []string) {
	real := n.Leaves()
	count := len(real)
	if count == 1 {
		return "single", real
	}
	if count > len(indexKinds) {
		return "custom", real
	}
	sig := structureSig(n)
	indexSlots := indexKinds[:count]
	for _, name := range templateNames {
		built := buildTemplate(name, indexSlots)
		if structureSig(built) != sig {
			continue
		}
		slots := make([]string, count)
		for j, kind := range built.Leaves() {
			slots[indexOf(indexKinds, kind)] = real[j]
		}
		return name, slots
	}
	return "custom", real
}

// SlotOrder returns the tree's leaves in template slot order — slot A is the
// template's main tile; reading order for a custom tree.
func SlotOrder(n Node) []string {
	_, slots := TemplateOf(n)
	return slots
}

// TemplatesFor lists the structurally distinct templates at a tile count, in
// registry order: nil for 1, [row col] for 2, [row col main-left main-right
// main-top main-bottom] for 3.
func TemplatesFor(count int) []string {
	if count < 2 || count > len(indexKinds) {
		return nil
	}
	indexSlots := indexKinds[:count]
	seen := map[string]bool{}
	var out []string
	for _, name := range templateNames {
		sig := structureSig(buildTemplate(name, indexSlots))
		if seen[sig] {
			continue
		}
		seen[sig] = true
		out = append(out, name)
	}
	return out
}

// ── mutations (verbs) ───────────────────────────────────────────────────────

// rect is an absolute pixel box — the nominal add geometry.
type rect struct {
	x, y, w, h float64
}

// lastLeafRect computes the last leaf's rect inside the nominal box with
// equal shares and the split gutter — the frontend's addSurface with no
// measured rects.
func lastLeafRect(n Node) rect {
	last := nominalBox
	var walk func(n Node, b rect)
	walk = func(n Node, b rect) {
		if n.IsLeaf() {
			last = b
			return
		}
		horiz := n.Dir == "h"
		count := float64(len(n.Children))
		avail := b.h
		if horiz {
			avail = b.w
		}
		share := (avail - splitGapPX*(count-1)) / count
		at := b.y
		if horiz {
			at = b.x
		}
		for _, c := range n.Children {
			var cb rect
			if horiz {
				cb = rect{x: at, y: b.y, w: share, h: b.h}
			} else {
				cb = rect{x: b.x, y: at, w: b.w, h: share}
			}
			walk(c, cb)
			at += share + splitGapPX
		}
	}
	walk(n, nominalBox)
	return last
}

// Add splits the LAST leaf in reading order along its longer axis (ties →
// horizontal), the new leaf landing after it (right or bottom), on the
// nominal 1600×1000 box (the CLI has no measured rects). ErrLayoutFull at
// MaxTiles leaves; ErrSurfaceRepeat when a non-tty surface is already open
// (duplicate tty tiles are legal); ErrUnknownSurface outside the registry.
func Add(n Node, kind string) (Node, error) {
	n = normalize(n)
	if !IsSurface(kind) {
		return Node{}, fmt.Errorf("%w: %q", ErrUnknownSurface, kind)
	}
	if len(n.Leaves()) >= MaxTiles {
		return Node{}, ErrLayoutFull
	}
	if kind != "tty" && n.Has(kind) {
		return Node{}, fmt.Errorf("%w: %q", ErrSurfaceRepeat, kind)
	}
	r := lastLeafRect(n)
	dir := "v"
	if r.w >= r.h {
		dir = "h" // wider than tall splits right; a tie splits horizontally
	}
	path := lastPath(n)
	target := n
	for _, i := range path {
		target = target.Children[i]
	}
	return normalise(replaceAt(n, path, splitNode(dir, target, leaf(kind)))), nil
}

// Close removes a leaf (by leaf id — the kind for a unique kind) and
// normalises: the neighbours absorb its share and the remaining STRUCTURE is
// kept (closing one tile of a column leaves a column). ErrLayoutLastTile on a
// single-tile layout; ErrSurfaceAbsent when absent.
func Close(n Node, leafID string) (Node, error) {
	n = normalize(n)
	if len(n.Leaves()) < 2 {
		return Node{}, ErrLayoutLastTile
	}
	path, ok := pathOf(n, leafID)
	if !ok {
		return Node{}, fmt.Errorf("%w: %q", ErrSurfaceAbsent, leafID)
	}
	out, _ := removeAt(n, path)
	return normalise(out), nil
}

// Promote swaps the leaf (by leaf id) with slot A — the template's main tile
// (SlotOrder[0]), or the first leaf in reading order for a custom tree. A
// no-op when the leaf is absent or already slot A.
func Promote(n Node, leafID string) Node {
	n = normalize(n)
	ids := n.LeafIDs()
	if !contains(ids, leafID) {
		return n
	}
	main := SlotOrder(n)[0]
	mainID := ids[indexOf(n.Leaves(), main)]
	if mainID == leafID {
		return n
	}
	return swapLeaves(n, leafID, mainID)
}

// ReplaceLast replaces the last leaf in reading order with kind in place —
// webAddShow's full-layout fallback: the last tile (the least valuable; slot
// A stays dominant) yields rather than failing the show.
func ReplaceLast(n Node, kind string) Node {
	n = normalize(n)
	return replaceAt(n, lastPath(n), leaf(kind))
}

// Cycle returns the next entry of TemplatesFor(tile count) after the current
// template, rebuilt from the current slot order (wrapping). A custom tree
// cycles to the first template; one tile is a no-op.
func Cycle(n Node) Node {
	n = normalize(n)
	ring := TemplatesFor(len(n.Leaves()))
	if len(ring) == 0 {
		return n
	}
	name, slots := TemplateOf(n)
	next := ring[0] // a custom tree cycles to the first template
	if i := indexOf(ring, name); i >= 0 {
		next = ring[(i+1)%len(ring)]
	}
	return buildTemplate(next, slots)
}

// SetTemplate rebuilds TEMPLATES[name] from the current slot order — lossy
// for a custom tree. ErrUnknownTemplate when the name is not a template for
// the current tile count.
func SetTemplate(n Node, name string) (Node, error) {
	n = normalize(n)
	if !contains(TemplatesFor(len(n.Leaves())), name) {
		return Node{}, fmt.Errorf("%w: %q", ErrUnknownTemplate, name)
	}
	return buildTemplate(name, SlotOrder(n)), nil
}
