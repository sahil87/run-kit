package gui

import (
	"reflect"
	"testing"
)

func TestSessionStartersFixedOrder(t *testing.T) {
	want := []string{"startlxqt", "lxqt-session", "startxfce4", "xfce4-session", "startplasma-x11", "x-session-manager"}
	if got := SessionStarters(); !reflect.DeepEqual(got, want) {
		t.Errorf("SessionStarters() = %v, want %v", got, want)
	}
	// The accessor returns a copy: mutating it must not poison the order.
	SessionStarters()[0] = "mutated"
	if got := SessionStarters(); !reflect.DeepEqual(got, want) {
		t.Errorf("SessionStarters() after mutation = %v, want %v", got, want)
	}
	for _, name := range want {
		if !IsSessionStarter(name) {
			t.Errorf("IsSessionStarter(%q) = false — the membership map must be derived from SessionStarters()", name)
		}
	}
}

func TestWMCandidateLabel(t *testing.T) {
	for name, want := range map[string]string{
		"icewm-session":     "IceWM",
		"startlxqt":         "LXQt",
		"lxqt-session":      "LXQt",
		"startxfce4":        "XFCE",
		"xfce4-session":     "XFCE",
		"openbox":           "openbox",
		"startplasma-x11":   "startplasma-x11",
		"x-session-manager": "x-session-manager",
	} {
		if got := WMCandidateLabel(name); got != want {
			t.Errorf("WMCandidateLabel(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestWMCandidates(t *testing.T) {
	cases := []struct {
		name    string
		present []string
		want    []WMCandidate
	}{
		{
			"ladder order then starter order, deduped by name",
			[]string{"openbox", "icewm-session", "x-session-manager", "startlxqt"},
			[]WMCandidate{
				{Name: "icewm-session", Label: "IceWM", Kind: "wm", Installed: true},
				{Name: "openbox", Label: "openbox", Kind: "wm", Installed: true},
				{Name: "x-session-manager", Label: "x-session-manager", Kind: "session", Installed: true},
				{Name: "startlxqt", Label: "LXQt", Kind: "session", Installed: true},
			},
		},
		{
			"aliases collapse into their primaries",
			[]string{"startlxqt", "lxqt-session", "startxfce4", "xfce4-session"},
			[]WMCandidate{
				{Name: "startlxqt", Label: "LXQt", Kind: "session", Installed: true},
				{Name: "startxfce4", Label: "XFCE", Kind: "session", Installed: true},
			},
		},
		{
			"an alias alone keeps its row and the DE label",
			[]string{"lxqt-session"},
			[]WMCandidate{
				{Name: "lxqt-session", Label: "LXQt", Kind: "session", Installed: true},
			},
		},
		{
			"xfce alias alone keeps its row and the DE label",
			[]string{"xfce4-session"},
			[]WMCandidate{
				{Name: "xfce4-session", Label: "XFCE", Kind: "session", Installed: true},
			},
		},
		{
			"lookPath misses are omitted, never installed:false",
			[]string{"openbox"},
			[]WMCandidate{
				{Name: "openbox", Label: "openbox", Kind: "wm", Installed: true},
			},
		},
		{
			"nothing resolves",
			nil,
			[]WMCandidate{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := WMCandidates(stubLookPath(tc.present...))
			if got == nil {
				t.Fatalf("WMCandidates(%v) = nil, want a non-nil slice (JSON [] never null)", tc.present)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("WMCandidates(%v) = %+v, want %+v", tc.present, got, tc.want)
			}
		})
	}
}

func TestWMCandidatesNilLookPathIsEmpty(t *testing.T) {
	got := WMCandidates(nil)
	if got == nil || len(got) != 0 {
		t.Errorf("WMCandidates(nil) = %v, want an empty non-nil slice (nil seams are safe)", got)
	}
}

func TestWMCandidatesHint(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	apt := stubLookPath("apt-get")
	lxqtApt := "sudo apt install --no-install-recommends lxqt-core"

	if got := WMCandidatesHint(WMCandidates(stubLookPath("openbox")), apt); got != lxqtApt {
		t.Errorf("hint with no LXQt candidate = %q, want %q", got, lxqtApt)
	}
	if got := WMCandidatesHint(WMCandidates(stubLookPath()), apt); got != lxqtApt {
		t.Errorf("hint with an empty list = %q, want %q", got, lxqtApt)
	}
	for _, present := range [][]string{{"startlxqt"}, {"lxqt-session"}, {"startlxqt", "lxqt-session"}} {
		if got := WMCandidatesHint(WMCandidates(stubLookPath(present...)), apt); got != "" {
			t.Errorf("hint with %v installed = %q, want empty", present, got)
		}
	}
}
