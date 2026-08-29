package layoutspec

import (
	"errors"
	"reflect"
	"testing"
)

func TestParseRoundTripsEveryShape(t *testing.T) {
	samples := []string{
		"single:tty",
		"split-h:tty,code",
		"split-v:tty,web",
		"row:tty,code,web",
		"col:tty,web,chat",
		"main-left:tty,code,web",
		"main-right:web,tty,code",
		"main-top:chat,tty,tty",
	}
	for _, s := range samples {
		parsed, err := Parse(s)
		if err != nil {
			t.Errorf("Parse(%q): %v", s, err)
			continue
		}
		if got := parsed.String(); got != s {
			t.Errorf("Parse(%q).String() = %q, want byte-identical round-trip", s, got)
		}
	}
}

func TestParseShapeAndOrder(t *testing.T) {
	got, err := Parse("main-left:tty,code,web")
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	want := Layout{Shape: "main-left", Order: []string{"tty", "code", "web"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Parse = %+v, want %+v", got, want)
	}
}

func TestParseRejectsUnknownShapesAndSurfaces(t *testing.T) {
	for _, raw := range []string{
		"grid:tty,code",
		"single:terminal",
		"single:",
		"tty",
		"",
		"single:desktop", // spec'd but unshipped surface
	} {
		if _, err := Parse(raw); err == nil {
			t.Errorf("Parse(%q): err = nil, want rejection", raw)
		}
	}
}

func TestParseRejectsArityMismatches(t *testing.T) {
	for _, raw := range []string{
		"main-left:tty,code",
		"single:tty,code",
		"split-h:tty,code,web",
	} {
		if _, err := Parse(raw); err == nil {
			t.Errorf("Parse(%q): err = nil, want arity rejection", raw)
		}
	}
}

func TestParseRepeatedNonTtyRejectedDuplicateTtyLegal(t *testing.T) {
	for _, raw := range []string{"row:tty,web,web", "split-h:code,code"} {
		if _, err := Parse(raw); err == nil {
			t.Errorf("Parse(%q): err = nil, want repeated-surface rejection", raw)
		}
	}
	got, err := Parse("split-h:tty,tty")
	if err != nil {
		t.Fatalf("Parse(split-h:tty,tty): %v", err)
	}
	if want := (Layout{Shape: "split-h", Order: []string{"tty", "tty"}}); !reflect.DeepEqual(got, want) {
		t.Errorf("Parse(split-h:tty,tty) = %+v, want %+v", got, want)
	}
	if _, err := Parse("row:tty,code,tty"); err != nil {
		t.Errorf("Parse(row:tty,code,tty): %v, want accepted", err)
	}
}

func TestHas(t *testing.T) {
	l, err := Parse("main-left:tty,code,web")
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if !l.Has("web") || !l.Has("tty") || !l.Has("code") {
		t.Errorf("Has missed an ordered surface: %+v", l)
	}
	if l.Has("chat") {
		t.Error("Has(chat) = true on a chat-less layout")
	}
}

// The verb tests below mirror app/frontend/src/lib/surface-layout.test.ts
// describe("mutations") case-for-case (same inputs, same outputs — where the
// TS returns null the Go returns its named sentinel). Test names cite the TS
// `it` case so drift is greppable. The TS fixtures:
var (
	tsThree = Layout{Shape: "main-left", Order: []string{"tty", "code", "web"}}
	tsTwo   = Layout{Shape: "split-h", Order: []string{"tty", "code"}}
	tsOne   = Layout{Shape: "single", Order: []string{"tty"}}
)

func TestDefault(t *testing.T) {
	if got := Default(); !reflect.DeepEqual(got, tsOne) {
		t.Errorf("Default() = %+v, want single:tty", got)
	}
}

// TS: "promote moves a surface to slot A, shape unchanged"
func TestPromote_TS_promoteMovesASurfaceToSlotAShapeUnchanged(t *testing.T) {
	if got := Promote(tsThree, "code"); !reflect.DeepEqual(got, Layout{Shape: "main-left", Order: []string{"code", "tty", "web"}}) {
		t.Errorf("Promote(three, code) = %+v", got)
	}
	if got := Promote(tsThree, "tty"); !reflect.DeepEqual(got, tsThree) {
		t.Errorf("Promote(three, tty) = %+v, want unchanged (already slot A)", got)
	}
	if got := Promote(tsThree, "chat"); !reflect.DeepEqual(got, tsThree) {
		t.Errorf("Promote(three, chat) = %+v, want unchanged (absent)", got)
	}
}

// TS: "swapWithNext exchanges with the next neighbor, wrapping at the end"
func TestSwapWithNext_TS_exchangesWithTheNextNeighborWrappingAtTheEnd(t *testing.T) {
	if got := SwapWithNext(tsThree, "tty"); !reflect.DeepEqual(got, Layout{Shape: "main-left", Order: []string{"code", "tty", "web"}}) {
		t.Errorf("SwapWithNext(three, tty) = %+v", got)
	}
	if got := SwapWithNext(tsThree, "web"); !reflect.DeepEqual(got, Layout{Shape: "main-left", Order: []string{"web", "code", "tty"}}) {
		t.Errorf("SwapWithNext(three, web) = %+v, want wrap to slot A", got)
	}
	if got := SwapWithNext(tsOne, "tty"); !reflect.DeepEqual(got, tsOne) {
		t.Errorf("SwapWithNext(one, tty) = %+v, want unchanged (single never swaps)", got)
	}
}

// TS: "closeSurface collapses arity preserving remaining order; single refuses"
func TestClose_TS_collapsesArityPreservingRemainingOrderSingleRefuses(t *testing.T) {
	got, err := Close(tsThree, "code")
	if err != nil || !reflect.DeepEqual(got, Layout{Shape: "split-h", Order: []string{"tty", "web"}}) {
		t.Errorf("Close(three, code) = %+v, %v", got, err)
	}
	got, err = Close(tsTwo, "tty")
	if err != nil || !reflect.DeepEqual(got, Layout{Shape: "single", Order: []string{"code"}}) {
		t.Errorf("Close(two, tty) = %+v, %v", got, err)
	}
	if _, err := Close(tsOne, "tty"); !errors.Is(err, ErrLayoutLastTile) {
		t.Errorf("Close(one, tty): err = %v, want ErrLayoutLastTile", err)
	}
	if _, err := Close(tsTwo, "web"); !errors.Is(err, ErrSurfaceAbsent) {
		t.Errorf("Close(two, web): err = %v, want ErrSurfaceAbsent", err)
	}
}

// TS: "addSurface grows 1→2 as split-h and 2→3 as main-left"
func TestAdd_TS_growsOneToTwoAsSplitHAndTwoToThreeAsMainLeft(t *testing.T) {
	got, err := Add(tsOne, "code")
	if err != nil || !reflect.DeepEqual(got, Layout{Shape: "split-h", Order: []string{"tty", "code"}}) {
		t.Errorf("Add(one, code) = %+v, %v", got, err)
	}
	got, err = Add(tsTwo, "web")
	if err != nil || !reflect.DeepEqual(got, Layout{Shape: "main-left", Order: []string{"tty", "code", "web"}}) {
		t.Errorf("Add(two, web) = %+v, %v", got, err)
	}
}

// TS: "addSurface refuses at 3 tiles and on repeated non-tty kinds"
func TestAdd_TS_refusesAtThreeTilesAndOnRepeatedNonTtyKinds(t *testing.T) {
	if _, err := Add(tsThree, "chat"); !errors.Is(err, ErrLayoutFull) {
		t.Errorf("Add(three, chat): err = %v, want ErrLayoutFull", err)
	}
	if _, err := Add(tsTwo, "code"); !errors.Is(err, ErrSurfaceRepeat) {
		t.Errorf("Add(two, code): err = %v, want ErrSurfaceRepeat", err)
	}
	// duplicate tty is legal (muxed relay supports N clients)
	got, err := Add(tsTwo, "tty")
	if err != nil || !reflect.DeepEqual(got, Layout{Shape: "main-left", Order: []string{"tty", "code", "tty"}}) {
		t.Errorf("Add(two, tty) = %+v, %v", got, err)
	}
	if _, err := Add(tsTwo, "bogus"); !errors.Is(err, ErrUnknownSurface) {
		t.Errorf("Add(two, bogus): err = %v, want ErrUnknownSurface", err)
	}
}

// TS: "cycleShape walks the same-arity ring keeping order"
func TestCycle_TS_walksTheSameArityRingKeepingOrder(t *testing.T) {
	if got := Cycle(tsThree); !reflect.DeepEqual(got, Layout{Shape: "main-right", Order: tsThree.Order}) {
		t.Errorf("Cycle(main-left) = %+v", got)
	}
	if got := Cycle(Layout{Shape: "main-right", Order: tsThree.Order}); !reflect.DeepEqual(got, Layout{Shape: "main-top", Order: tsThree.Order}) {
		t.Errorf("Cycle(main-right) = %+v", got)
	}
	if got := Cycle(Layout{Shape: "main-top", Order: tsThree.Order}); !reflect.DeepEqual(got, Layout{Shape: "row", Order: tsThree.Order}) {
		t.Errorf("Cycle(main-top) = %+v, want wrap to row", got)
	}
	if got := Cycle(tsTwo); !reflect.DeepEqual(got, Layout{Shape: "split-v", Order: tsTwo.Order}) {
		t.Errorf("Cycle(split-h) = %+v", got)
	}
	if got := Cycle(tsOne); !reflect.DeepEqual(got, tsOne) {
		t.Errorf("Cycle(one) = %+v, want arity 1 cycles to itself", got)
	}
}

// TS: "setShape jumps within the arity only"
func TestSetShape_TS_jumpsWithinTheArityOnly(t *testing.T) {
	got, err := SetShape(tsThree, "col")
	if err != nil || !reflect.DeepEqual(got, Layout{Shape: "col", Order: tsThree.Order}) {
		t.Errorf("SetShape(three, col) = %+v, %v", got, err)
	}
	if _, err := SetShape(tsThree, "split-h"); !errors.Is(err, ErrArityMismatch) {
		t.Errorf("SetShape(three, split-h): err = %v, want ErrArityMismatch", err)
	}
	if _, err := SetShape(tsTwo, "single"); !errors.Is(err, ErrArityMismatch) {
		t.Errorf("SetShape(two, single): err = %v, want ErrArityMismatch", err)
	}
}

// TS: "shapesForArity matches the arity table" — the Go table is shapeRing.
func TestShapeRing_TS_shapesForArityMatchesTheArityTable(t *testing.T) {
	if !reflect.DeepEqual(shapeRing[1], []string{"single"}) {
		t.Errorf("shapeRing[1] = %v", shapeRing[1])
	}
	if !reflect.DeepEqual(shapeRing[2], []string{"split-h", "split-v"}) {
		t.Errorf("shapeRing[2] = %v", shapeRing[2])
	}
	if len(shapeRing[3]) != 5 {
		t.Errorf("shapeRing[3] = %v, want 5 entries", shapeRing[3])
	}
	for shape, arity := range shapeArity {
		found := false
		for _, s := range shapeRing[arity] {
			if s == shape {
				found = true
			}
		}
		if !found {
			t.Errorf("shape %q missing from shapeRing[%d]", shape, arity)
		}
	}
}

// The zero Layout reads as Default on every verb (the "" → single:tty rule the
// CLI applies to an unset @rk_win_layout).
func TestZeroLayoutReadsAsDefault(t *testing.T) {
	var zero Layout
	if got := Promote(zero, "tty"); !reflect.DeepEqual(got, tsOne) {
		t.Errorf("Promote(zero) = %+v", got)
	}
	got, err := Add(zero, "web")
	if err != nil || !reflect.DeepEqual(got, Layout{Shape: "split-h", Order: []string{"tty", "web"}}) {
		t.Errorf("Add(zero, web) = %+v, %v", got, err)
	}
	if got := Cycle(zero); !reflect.DeepEqual(got, tsOne) {
		t.Errorf("Cycle(zero) = %+v", got)
	}
	if _, err := Close(zero, "tty"); !errors.Is(err, ErrLayoutLastTile) {
		t.Errorf("Close(zero): err = %v, want ErrLayoutLastTile", err)
	}
}

func TestIsSurface(t *testing.T) {
	for _, kind := range []string{"tty", "web", "chat", "code"} {
		if !IsSurface(kind) {
			t.Errorf("IsSurface(%q) = false", kind)
		}
	}
	for _, kind := range []string{"", "desktop", "agents", "terminal"} {
		if IsSurface(kind) {
			t.Errorf("IsSurface(%q) = true", kind)
		}
	}
}
