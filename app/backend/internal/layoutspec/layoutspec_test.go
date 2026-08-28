package layoutspec

import (
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
