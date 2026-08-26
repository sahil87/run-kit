package codebridge

import (
	"testing"

	"rk/build"
)

func TestOlderThan(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"3.18.1", "3.19.0", true},
		{"3.19.0", "3.18.1", false},
		{"3.19.0", "3.19.0", false},  // equal is not older
		{"3.9.0", "3.19.0", true},    // numeric, not lexicographic
		{"0.0.0-dev", "0.0.1", true}, // non-numeric tail degrades to digits
		{"3.19.0-dev", "3.19.0", false},
		{"0.0.0-dev", "0.0.0-dev", false},
		{"3.19", "3.19.0", false}, // missing component counts as 0
		{"3.19", "3.19.1", true},
		{"v3.18.0", "3.19.0", true}, // leading v ignored
		{"4.0.0", "3.19.0", false},
	}
	for _, c := range cases {
		if got := OlderThan(c.a, c.b); got != c.want {
			t.Errorf("OlderThan(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

// TestEmbeddedMatchesEmbedDir: Embedded() reports ok=false exactly when the
// embedded codebridge dir holds no VSIX (dev build), and a consistent
// payload/version when it does (release build) — absence is a state, never an
// error.
func TestEmbeddedMatchesEmbedDir(t *testing.T) {
	entries, err := build.CodeBridge.ReadDir("codebridge")
	if err != nil {
		t.Fatalf("read embedded codebridge dir: %v", err)
	}
	hasVsix := false
	for _, e := range entries {
		if e.Name() == "rk-code-bridge.vsix" {
			hasVsix = true
		}
	}
	vsix, version, ok := Embedded()
	if ok != hasVsix {
		t.Errorf("Embedded() ok = %v, want %v (embed dir has VSIX: %v)", ok, hasVsix, hasVsix)
	}
	if ok && (len(vsix) == 0 || version == "") {
		t.Errorf("Embedded() ok with empty payload/version (%d bytes, %q)", len(vsix), version)
	}
}
