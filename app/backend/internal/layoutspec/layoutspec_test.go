package layoutspec

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// mustParse parses a fixture input that the table expects to succeed.
func mustParse(t *testing.T, raw string) Node {
	t.Helper()
	n, err := Parse(raw)
	if err != nil {
		t.Fatalf("Parse(%q): %v", raw, err)
	}
	return n
}

// ── shared fixture table (pins TS/Go parity) ────────────────────────────────

// fixtureFile mirrors app/frontend/src/lib/layout-tree.fixtures.json: the
// parse table (input → expected serialized tree, null = Parse must error) and
// the verb table (expect null = the verb must return an error; promote and
// cycle never error). The TS suite reads the same file, so the two ports
// cannot drift.
type fixtureFile struct {
	Parse []struct {
		Input  string  `json:"input"`
		Expect *string `json:"expect"`
	} `json:"parse"`
	Verbs []struct {
		Verb   string  `json:"verb"`
		Start  string  `json:"start"`
		Kind   string  `json:"kind"`
		ID     string  `json:"id"`
		Name   string  `json:"name"`
		Expect *string `json:"expect"`
	} `json:"verbs"`
}

func readFixtures(t *testing.T) fixtureFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "src", "lib", "layout-tree.fixtures.json"))
	if err != nil {
		t.Fatalf("read shared fixture table: %v", err)
	}
	var f fixtureFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("decode shared fixture table: %v", err)
	}
	return f
}

func TestFixtureParseTable(t *testing.T) {
	for _, tc := range readFixtures(t).Parse {
		n, err := Parse(tc.Input)
		if tc.Expect == nil {
			if err == nil {
				t.Errorf("Parse(%q) = %q, want rejection", tc.Input, n)
			}
			continue
		}
		if err != nil {
			t.Errorf("Parse(%q): %v, want %q", tc.Input, err, *tc.Expect)
			continue
		}
		if got := n.String(); got != *tc.Expect {
			t.Errorf("Parse(%q).String() = %q, want %q", tc.Input, got, *tc.Expect)
		}
	}
}

func TestFixtureVerbTable(t *testing.T) {
	for _, tc := range readFixtures(t).Verbs {
		start := mustParse(t, tc.Start)
		var (
			got string
			err error
		)
		switch tc.Verb {
		case "add":
			var next Node
			next, err = Add(start, tc.Kind)
			got = next.String()
		case "close":
			var next Node
			next, err = Close(start, tc.ID)
			got = next.String()
		case "template":
			var next Node
			next, err = SetTemplate(start, tc.Name)
			got = next.String()
		case "promote":
			got = Promote(start, tc.ID).String()
		case "cycle":
			got = Cycle(start).String()
		default:
			t.Fatalf("fixture verb %q unknown to the Go port", tc.Verb)
		}
		label := tc.Verb + " " + tc.Start
		if tc.Expect == nil {
			if err == nil {
				t.Errorf("%s = %q, want an error", label, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: %v, want %q", label, err, *tc.Expect)
			continue
		}
		if got != *tc.Expect {
			t.Errorf("%s = %q, want %q", label, got, *tc.Expect)
		}
	}
}

// ── grammars ────────────────────────────────────────────────────────────────

func TestParseTreeGrammarRoundTrips(t *testing.T) {
	for _, raw := range []string{
		"tty", "gui",
		"h(tty,web)", "v(tty,web)",
		"h(tty,code,web)", "v(tty,code,web)",
		"h(tty,v(code,web))", "h(v(code,web),tty)",
		"v(tty,h(code,web))", "v(h(code,web),tty)",
		"h(tty,tty)", "h(tty,v(tty,tty))",
	} {
		if got := mustParse(t, raw).String(); got != raw {
			t.Errorf("Parse(%q).String() = %q, want byte-identical round-trip", raw, got)
		}
	}
}

// The legacy preset → tree conversion table (spec § The Model), byte-exact.
func TestParseLegacyTable(t *testing.T) {
	table := map[string]string{
		"single:tty":              "tty",
		"single:code":             "code",
		"split-h:tty,web":         "h(tty,web)",
		"split-v:tty,web":         "v(tty,web)",
		"row:tty,code,web":        "h(tty,code,web)",
		"col:tty,code,web":        "v(tty,code,web)",
		"main-left:tty,code,web":  "h(tty,v(code,web))",
		"main-right:tty,code,web": "h(v(code,web),tty)",
		"main-top:tty,code,web":   "v(tty,h(code,web))",
	}
	for raw, want := range table {
		if got := mustParse(t, raw).String(); got != want {
			t.Errorf("Parse(%q).String() = %q, want %q", raw, got, want)
		}
	}
}

func TestParseRejections(t *testing.T) {
	for _, raw := range []string{
		// non-canonical trees
		"h(h(tty,web),code)", // same-direction nesting
		"v(v(tty,web))",      // single-child split, nested
		"h(tty)",             // single-child split
		// the tile cap
		"h(tty,web,code,gui)",
		// repeated non-tty kind
		"h(web,web)", "main-left:tty,code,code", "split-h:code,code",
		// whitespace, truncation, trailing input
		"h( tty,web)", "h(tty,web", "h(tty,web)x", "",
		// legacy arity / unknown shape / unknown surface
		"single:tty,web", "row:tty,web", "grid:tty,code", "single:desktop",
		// not a layout at all
		"foo", "main-bottom:tty,code,web",
	} {
		if n, err := Parse(raw); err == nil {
			t.Errorf("Parse(%q) = %q, want rejection", raw, n)
		}
	}
}

func TestParseDuplicateTtyLegal(t *testing.T) {
	n := mustParse(t, "split-h:tty,tty")
	if got := n.String(); got != "h(tty,tty)" {
		t.Errorf("Parse(split-h:tty,tty).String() = %q", got)
	}
	if got := n.LeafIDs(); !reflect.DeepEqual(got, []string{"tty", "tty#2"}) {
		t.Errorf("LeafIDs(h(tty,tty)) = %v, want [tty tty#2]", got)
	}
}

// ── structure helpers ───────────────────────────────────────────────────────

func TestDefault(t *testing.T) {
	if got := Default(); !reflect.DeepEqual(got, Node{Kind: "tty"}) {
		t.Errorf("Default() = %+v, want the bare tty leaf", got)
	}
	if got := Default().String(); got != "tty" {
		t.Errorf("Default().String() = %q, want tty", got)
	}
}

func TestHas(t *testing.T) {
	n := mustParse(t, "h(tty,v(code,web))")
	for _, s := range []string{"tty", "code", "web"} {
		if !n.Has(s) {
			t.Errorf("Has(%q) = false on %q", s, n)
		}
	}
	if n.Has("gui") {
		t.Errorf("Has(gui) = true on a gui-less layout %q", n)
	}
}

func TestIsSurface(t *testing.T) {
	for _, kind := range []string{"tty", "web", "code", "gui"} {
		if !IsSurface(kind) {
			t.Errorf("IsSurface(%q) = false", kind)
		}
	}
	for _, kind := range []string{"", "desktop", "agents", "terminal", "chat"} {
		if IsSurface(kind) {
			t.Errorf("IsSurface(%q) = true", kind)
		}
	}
}

func TestTemplateOf(t *testing.T) {
	// The R5 case: v(h(code,web),tty) is main-bottom with slot A = tty.
	name, slots := TemplateOf(mustParse(t, "v(h(code,web),tty)"))
	if name != "main-bottom" || !reflect.DeepEqual(slots, []string{"tty", "code", "web"}) {
		t.Errorf("TemplateOf(v(h(code,web),tty)) = %q %v", name, slots)
	}
	// h(v(tty,code),web) is main-right's structure with slot A = web. (Every
	// canonical ≤3-leaf tree matches a template — "custom" needs N ≥ 4.)
	name, slots = TemplateOf(mustParse(t, "h(v(tty,code),web)"))
	if name != "main-right" || !reflect.DeepEqual(slots, []string{"web", "tty", "code"}) {
		t.Errorf("TemplateOf(h(v(tty,code),web)) = %q %v, want main-right [web tty code]", name, slots)
	}
	if name, _ := TemplateOf(mustParse(t, "tty")); name != "single" {
		t.Errorf("TemplateOf(tty) = %q, want single", name)
	}
}

func TestTemplatesFor(t *testing.T) {
	if got := TemplatesFor(1); len(got) != 0 {
		t.Errorf("TemplatesFor(1) = %v, want empty", got)
	}
	if got := TemplatesFor(2); !reflect.DeepEqual(got, []string{"row", "col"}) {
		t.Errorf("TemplatesFor(2) = %v", got)
	}
	want3 := []string{"row", "col", "main-left", "main-right", "main-top", "main-bottom"}
	if got := TemplatesFor(3); !reflect.DeepEqual(got, want3) {
		t.Errorf("TemplatesFor(3) = %v", got)
	}
}

// ── verb sentinels (fixture table covers the happy paths) ──────────────────

func TestAddSentinels(t *testing.T) {
	if _, err := Add(mustParse(t, "h(tty,web,code)"), "tty"); !errors.Is(err, ErrLayoutFull) {
		t.Errorf("Add on a full layout: err = %v, want ErrLayoutFull", err)
	}
	if _, err := Add(mustParse(t, "h(tty,web)"), "web"); !errors.Is(err, ErrSurfaceRepeat) {
		t.Errorf("Add a repeated non-tty: err = %v, want ErrSurfaceRepeat", err)
	}
	if _, err := Add(mustParse(t, "tty"), "bogus"); !errors.Is(err, ErrUnknownSurface) {
		t.Errorf("Add a bogus surface: err = %v, want ErrUnknownSurface", err)
	}
	// A duplicate tty is legal (the muxed relay supports N clients per pane).
	if got, err := Add(mustParse(t, "tty"), "tty"); err != nil || got.String() != "h(tty,tty)" {
		t.Errorf("Add(tty, tty) = %q, %v, want h(tty,tty)", got, err)
	}
}

func TestCloseSentinels(t *testing.T) {
	if _, err := Close(mustParse(t, "tty"), "tty"); !errors.Is(err, ErrLayoutLastTile) {
		t.Errorf("Close the last tile: err = %v, want ErrLayoutLastTile", err)
	}
	if _, err := Close(mustParse(t, "h(tty,web)"), "code"); !errors.Is(err, ErrSurfaceAbsent) {
		t.Errorf("Close an absent leaf: err = %v, want ErrSurfaceAbsent", err)
	}
	// Closing one tile of a column leaves a column (structure kept).
	if got, err := Close(mustParse(t, "v(tty,code,web)"), "code"); err != nil || got.String() != "v(tty,web)" {
		t.Errorf("Close(v(tty,code,web), code) = %q, %v, want v(tty,web)", got, err)
	}
	// Close by duplicate-tty leaf id.
	if got, err := Close(mustParse(t, "h(tty,v(tty,web))"), "tty#2"); err != nil || got.String() != "h(tty,web)" {
		t.Errorf("Close by tty#2 = %q, %v, want h(tty,web)", got, err)
	}
}

func TestSetTemplateSentinel(t *testing.T) {
	if _, err := SetTemplate(mustParse(t, "h(tty,web)"), "main-left"); !errors.Is(err, ErrUnknownTemplate) {
		t.Errorf("SetTemplate outside TemplatesFor(n): err = %v, want ErrUnknownTemplate", err)
	}
	if _, err := SetTemplate(mustParse(t, "tty"), "row"); !errors.Is(err, ErrUnknownTemplate) {
		t.Errorf("SetTemplate on one tile: err = %v, want ErrUnknownTemplate", err)
	}
	if got, err := SetTemplate(mustParse(t, "h(tty,v(code,web))"), "main-bottom"); err != nil || got.String() != "v(h(code,web),tty)" {
		t.Errorf("SetTemplate(main-bottom) = %q, %v, want v(h(code,web),tty)", got, err)
	}
}

func TestPromoteNoOps(t *testing.T) {
	n := mustParse(t, "h(tty,v(code,web))")
	if got := Promote(n, "gui"); got.String() != n.String() {
		t.Errorf("Promote of an absent leaf = %q, want unchanged", got)
	}
	if got := Promote(n, "tty"); got.String() != n.String() {
		t.Errorf("Promote of slot A = %q, want unchanged", got)
	}
}

func TestReplaceLast(t *testing.T) {
	if got := ReplaceLast(mustParse(t, "h(tty,v(code,gui))"), "web"); got.String() != "h(tty,v(code,web))" {
		t.Errorf("ReplaceLast = %q, want h(tty,v(code,web))", got)
	}
	if got := ReplaceLast(mustParse(t, "tty"), "web"); got.String() != "web" {
		t.Errorf("ReplaceLast on a single leaf = %q, want web", got)
	}
}

// The zero Node reads as Default on every verb (the "" → tty rule the CLI
// applies to an unset @rk_win_layout).
func TestZeroNodeReadsAsDefault(t *testing.T) {
	var zero Node
	if got := Promote(zero, "tty"); got.String() != "tty" {
		t.Errorf("Promote(zero) = %q, want tty", got)
	}
	if got, err := Add(zero, "web"); err != nil || got.String() != "h(tty,web)" {
		t.Errorf("Add(zero, web) = %q, %v, want h(tty,web)", got, err)
	}
	if got := Cycle(zero); got.String() != "tty" {
		t.Errorf("Cycle(zero) = %q, want tty", got)
	}
	if _, err := Close(zero, "tty"); !errors.Is(err, ErrLayoutLastTile) {
		t.Errorf("Close(zero): err = %v, want ErrLayoutLastTile", err)
	}
}
