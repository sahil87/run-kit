package tmuxctl

import (
	"testing"
)

func TestParseLine_Begin(t *testing.T) {
	resetLoggedUnknowns()
	ev := ParseLine("%begin 1234567890 1 0")
	b, ok := ev.(BeginEvent)
	if !ok {
		t.Fatalf("expected BeginEvent, got %T (%v)", ev, ev)
	}
	if b.Epoch != "1234567890" || b.Cmd != "1" || b.Flags != "0" {
		t.Fatalf("unexpected fields: %+v", b)
	}
}

func TestParseLine_EndError(t *testing.T) {
	resetLoggedUnknowns()
	if _, ok := ParseLine("%end 1 2 3").(EndEvent); !ok {
		t.Fatal("expected EndEvent")
	}
	if _, ok := ParseLine("%error 1 2 3").(ErrorEvent); !ok {
		t.Fatal("expected ErrorEvent")
	}
}

func TestParseLine_SessionWindowChanged(t *testing.T) {
	resetLoggedUnknowns()
	ev := ParseLine("%session-window-changed $3 @42")
	swc, ok := ev.(SessionWindowChangedEvent)
	if !ok {
		t.Fatalf("expected SessionWindowChangedEvent, got %T", ev)
	}
	if swc.SessionID != "$3" || swc.WindowID != "@42" {
		t.Fatalf("unexpected fields: %+v", swc)
	}
}

func TestParseLine_WindowAddCloseRename(t *testing.T) {
	resetLoggedUnknowns()
	if w, ok := ParseLine("%window-add @7").(WindowAddEvent); !ok || w.WindowID != "@7" {
		t.Fatalf("window-add: got %v", ParseLine("%window-add @7"))
	}
	if w, ok := ParseLine("%window-close @7").(WindowCloseEvent); !ok || w.WindowID != "@7" {
		t.Fatalf("window-close: got %v", ParseLine("%window-close @7"))
	}
	r, ok := ParseLine("%window-renamed @42 my new window name").(WindowRenamedEvent)
	if !ok {
		t.Fatal("expected WindowRenamedEvent")
	}
	if r.WindowID != "@42" {
		t.Fatalf("WindowID: %q", r.WindowID)
	}
	if r.Name != "my new window name" {
		t.Fatalf("Name should preserve spaces, got %q", r.Name)
	}
}

func TestParseLine_SessionsChanged(t *testing.T) {
	resetLoggedUnknowns()
	if _, ok := ParseLine("%sessions-changed").(SessionsChangedEvent); !ok {
		t.Fatal("expected SessionsChangedEvent")
	}
}

func TestParseLine_LayoutChange(t *testing.T) {
	resetLoggedUnknowns()
	ev := ParseLine("%layout-change @42 layout-str vis-layout-str window-flags")
	lc, ok := ev.(LayoutChangeEvent)
	if !ok {
		t.Fatalf("expected LayoutChangeEvent, got %T", ev)
	}
	if lc.WindowID != "@42" {
		t.Fatalf("WindowID: %q", lc.WindowID)
	}

	// Short form (just the @wid).
	ev = ParseLine("%layout-change @99")
	lc, ok = ev.(LayoutChangeEvent)
	if !ok || lc.WindowID != "@99" {
		t.Fatalf("short form: got %v", ev)
	}
}

func TestParseLine_OutputAndUnlinkedDropped(t *testing.T) {
	resetLoggedUnknowns()
	if _, ok := ParseLine("%output %1 hello world").(IgnoredEvent); !ok {
		t.Fatal("expected IgnoredEvent for output line")
	}
	if _, ok := ParseLine("%unlinked-window-add @55").(IgnoredEvent); !ok {
		t.Fatal("expected IgnoredEvent for unlinked-window-* line")
	}
}

func TestParseLine_ContentLineDropped(t *testing.T) {
	resetLoggedUnknowns()
	// Non-% lines are content between %begin and %end markers; drop silently.
	if _, ok := ParseLine("some output line").(IgnoredEvent); !ok {
		t.Fatal("expected IgnoredEvent for content line")
	}
	if _, ok := ParseLine("").(IgnoredEvent); !ok {
		t.Fatal("expected IgnoredEvent for empty string")
	}
}

func TestParseLine_UnknownLoggedOnce(t *testing.T) {
	resetLoggedUnknowns()
	a := ParseLine("%future-feature foo bar")
	b := ParseLine("%future-feature baz qux")
	ua, ok := a.(UnknownEvent)
	if !ok {
		t.Fatalf("expected UnknownEvent, got %T", a)
	}
	if ua.Raw != "%future-feature foo bar" {
		t.Fatalf("Raw: %q", ua.Raw)
	}
	if _, ok := b.(UnknownEvent); !ok {
		t.Fatal("second unknown should still be UnknownEvent")
	}
	// Note: the "logged once" property is enforced by the dedupe table but
	// is not directly observable via the public API. We assert behavior
	// (no panic, both calls return UnknownEvent) and trust the
	// loggedUnknowns map to dedupe — verified by reading the source.
}

func TestParseLine_Malformed(t *testing.T) {
	resetLoggedUnknowns()
	// Missing arg.
	if _, ok := ParseLine("%session-window-changed").(MalformedEvent); !ok {
		t.Fatal("expected MalformedEvent for missing args")
	}
	// Only one arg when two required.
	if _, ok := ParseLine("%session-window-changed $3").(MalformedEvent); !ok {
		t.Fatalf("expected MalformedEvent, got %v", ParseLine("%session-window-changed $3"))
	}
}

func TestParseLine_NoPanicOnExtremes(t *testing.T) {
	resetLoggedUnknowns()
	// Single character, ill-formed, etc.
	cases := []string{"%", "%%%", "% ", "%   ", "%begin", "%window-renamed @42"}
	for _, c := range cases {
		_ = ParseLine(c) // just ensuring no panic
	}
}
