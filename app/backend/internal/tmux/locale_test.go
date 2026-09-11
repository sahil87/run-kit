package tmux

import (
	"os"
	"reflect"
	"testing"
)

func mapLookup(env map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := env[k]
		return v, ok
	}
}

// TestUTF8LocaleFix pins tmux's client rule row by row: the first NON-EMPTY
// of LC_ALL, LC_CTYPE, LANG decides (an empty value is skipped like an unset
// one — measured on tmux 3.7c); LC_ALL/LC_CTYPE are overridden in place, a
// non-UTF-8 LANG gets LC_CTYPE beside it, and any UTF-8/UTF8 spelling (any
// case) leaves the environment alone.
func TestUTF8LocaleFix(t *testing.T) {
	cases := []struct {
		name      string
		env       map[string]string
		wantName  string
		wantValue string
		wantOK    bool
	}{
		{"none set", map[string]string{}, "LC_CTYPE", "C.UTF-8", true},
		{"LANG=C", map[string]string{"LANG": "C"}, "LC_CTYPE", "C.UTF-8", true},
		{"LANG=POSIX", map[string]string{"LANG": "POSIX"}, "LC_CTYPE", "C.UTF-8", true},
		{"LANG empty alone is none set", map[string]string{"LANG": ""}, "LC_CTYPE", "C.UTF-8", true},
		{"LC_CTYPE=C", map[string]string{"LC_CTYPE": "C", "LANG": "en_US.UTF-8"}, "LC_CTYPE", "C.UTF-8", true},
		{"LC_ALL=C", map[string]string{"LC_ALL": "C"}, "LC_ALL", "C.UTF-8", true},
		{"LC_ALL=C beats UTF-8 LANG", map[string]string{"LC_ALL": "C", "LANG": "en_US.UTF-8"}, "LC_ALL", "C.UTF-8", true},
		{"LC_ALL=C beats UTF-8 LC_CTYPE", map[string]string{"LC_ALL": "C", "LC_CTYPE": "C.UTF-8"}, "LC_ALL", "C.UTF-8", true},
		{"LC_ALL empty alone is none set", map[string]string{"LC_ALL": ""}, "LC_CTYPE", "C.UTF-8", true},
		{"LC_ALL empty skipped, LC_CTYPE=C decides", map[string]string{"LC_ALL": "", "LC_CTYPE": "C", "LANG": "en_US.UTF-8"}, "LC_CTYPE", "C.UTF-8", true},
		{"LANG=en_US.UTF-8", map[string]string{"LANG": "en_US.UTF-8"}, "", "", false},
		{"LC_ALL=en_IN.UTF-8", map[string]string{"LC_ALL": "en_IN.UTF-8"}, "", "", false},
		{"LC_ALL empty beside UTF-8 LANG is healthy", map[string]string{"LC_ALL": "", "LANG": "en_US.UTF-8"}, "", "", false},
		{"LC_CTYPE empty beside UTF-8 LANG is healthy", map[string]string{"LC_CTYPE": "", "LANG": "en_US.UTF-8"}, "", "", false},
		{"LC_CTYPE=C.UTF-8 beside LANG=C", map[string]string{"LC_CTYPE": "C.UTF-8", "LANG": "C"}, "", "", false},
		{"LANG=en_US.utf8 (lower, no hyphen)", map[string]string{"LANG": "en_US.utf8"}, "", "", false},
		{"LANG=C.utf-8 (lower)", map[string]string{"LANG": "C.utf-8"}, "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			name, value, ok := utf8LocaleFix(mapLookup(tc.env))
			if name != tc.wantName || value != tc.wantValue || ok != tc.wantOK {
				t.Errorf("utf8LocaleFix(%v) = (%q, %q, %v), want (%q, %q, %v)",
					tc.env, name, value, ok, tc.wantName, tc.wantValue, tc.wantOK)
			}
		})
	}
}

// TestLocaleStatus pins the first-set precedence and the "" name when
// nothing is set, the shape doctor renders.
func TestLocaleStatus(t *testing.T) {
	name, value, utf8 := LocaleStatus(mapLookup(map[string]string{"LC_CTYPE": "C", "LANG": "en_US.UTF-8"}))
	if name != "LC_CTYPE" || value != "C" || utf8 {
		t.Errorf("LocaleStatus = (%q, %q, %v), want (LC_CTYPE, C, false)", name, value, utf8)
	}
	name, value, utf8 = LocaleStatus(mapLookup(map[string]string{"LANG": "en_IN.UTF-8"}))
	if name != "LANG" || value != "en_IN.UTF-8" || !utf8 {
		t.Errorf("LocaleStatus = (%q, %q, %v), want (LANG, en_IN.UTF-8, true)", name, value, utf8)
	}
	if name, _, utf8 := LocaleStatus(mapLookup(nil)); name != "" || utf8 {
		t.Errorf("LocaleStatus(empty) = (%q, _, %v), want (\"\", false)", name, utf8)
	}
	// An empty value is skipped like an unset variable — tmux consults the
	// first NON-EMPTY of the three.
	name, value, utf8 = LocaleStatus(mapLookup(map[string]string{"LC_ALL": "", "LANG": "en_IN.UTF-8"}))
	if name != "LANG" || value != "en_IN.UTF-8" || !utf8 {
		t.Errorf("LocaleStatus(LC_ALL empty) = (%q, %q, %v), want (LANG, en_IN.UTF-8, true)", name, value, utf8)
	}
}

// clearLocaleEnv unsets the three locale variables for the test's duration
// and resets the forced-locale record, restoring both afterwards. t.Setenv
// cannot express "unset", so the restore is manual.
func clearLocaleEnv(t *testing.T) {
	t.Helper()
	for _, n := range localeVars {
		if v, ok := os.LookupEnv(n); ok {
			t.Setenv(n, v) // registers the restore
			os.Unsetenv(n)
		} else {
			// EnsureUTF8Locale writes through os.Setenv with no cleanup of its
			// own; a variable absent before the test must be absent after it.
			t.Cleanup(func() { os.Unsetenv(n) })
		}
	}
	forcedMu.Lock()
	origName, origValue, origOK := forcedName, forcedValue, forcedOK
	forcedName, forcedValue, forcedOK = "", "", false
	forcedMu.Unlock()
	t.Cleanup(func() {
		forcedMu.Lock()
		forcedName, forcedValue, forcedOK = origName, origValue, origOK
		forcedMu.Unlock()
	})
}

// TestEnsureUTF8LocaleForcesAndRecords proves a locale-less process gains
// LC_CTYPE=C.UTF-8, the record names that assignment, and a second call is a
// no-op that keeps the record (idempotency is what lets doctor report the
// repair after the fact).
func TestEnsureUTF8LocaleForcesAndRecords(t *testing.T) {
	clearLocaleEnv(t)
	t.Setenv("LANG", "C")

	EnsureUTF8Locale()
	if got := os.Getenv("LC_CTYPE"); got != "C.UTF-8" {
		t.Fatalf("LC_CTYPE = %q after EnsureUTF8Locale, want C.UTF-8", got)
	}
	if got := os.Getenv("LANG"); got != "C" {
		t.Fatalf("LANG = %q, want untouched C", got)
	}
	name, value, ok := ForcedLocale()
	if !ok || name != "LC_CTYPE" || value != "C.UTF-8" {
		t.Fatalf("ForcedLocale = (%q, %q, %v), want (LC_CTYPE, C.UTF-8, true)", name, value, ok)
	}

	EnsureUTF8Locale()
	if got := os.Getenv("LC_CTYPE"); got != "C.UTF-8" {
		t.Fatalf("second call changed LC_CTYPE to %q", got)
	}
	if name, value, ok := ForcedLocale(); !ok || name != "LC_CTYPE" || value != "C.UTF-8" {
		t.Fatalf("second call lost the record: (%q, %q, %v)", name, value, ok)
	}
}

// TestEnsureUTF8LocaleLeavesUTF8Alone proves an already-UTF-8 environment is
// never modified and nothing is recorded.
func TestEnsureUTF8LocaleLeavesUTF8Alone(t *testing.T) {
	clearLocaleEnv(t)
	t.Setenv("LANG", "en_IN.UTF-8")

	EnsureUTF8Locale()
	if _, set := os.LookupEnv("LC_CTYPE"); set {
		t.Fatalf("LC_CTYPE was set in a UTF-8 environment")
	}
	if _, set := os.LookupEnv("LC_ALL"); set {
		t.Fatalf("LC_ALL was set in a UTF-8 environment")
	}
	if _, _, ok := ForcedLocale(); ok {
		t.Fatalf("ForcedLocale reports a repair in a UTF-8 environment")
	}
}

// TestParseShowEnvironment pins the `show-environment -g` line grammar:
// NAME=value rows are kept (values may contain '='), `-NAME` unset markers
// and malformed rows are dropped.
func TestParseShowEnvironment(t *testing.T) {
	got := parseShowEnvironment([]string{
		"LANG=en_IN.UTF-8",
		"PATH=/opt/homebrew/bin:/usr/bin",
		"-LC_ALL",
		"DIRENV_DIFF=eJx=abc==",
		"malformed",
		"=novalue",
	})
	want := map[string]string{
		"LANG":        "en_IN.UTF-8",
		"PATH":        "/opt/homebrew/bin:/usr/bin",
		"DIRENV_DIFF": "eJx=abc==",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parseShowEnvironment = %v, want %v", got, want)
	}
}
