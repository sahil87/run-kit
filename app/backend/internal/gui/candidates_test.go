package gui

import (
	"reflect"
	"testing"
)

func TestSessionStartersFixedOrder(t *testing.T) {
	want := []string{
		"startlxqt", "lxqt-session", "startxfce4", "xfce4-session", "startplasma-x11",
		"startlxde", "mate-session", "cinnamon-session", "x-session-manager",
	}
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
		"startplasma-x11":   "Plasma",
		"startlxde":         "LXDE",
		"mate-session":      "MATE",
		"cinnamon-session":  "Cinnamon",
		"openbox":           "openbox",
		"x-session-manager": "x-session-manager",
	} {
		if got := WMCandidateLabel(name); got != want {
			t.Errorf("WMCandidateLabel(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestWMCandidates(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	icewm := WMCandidate{Name: "icewm-session", Label: "IceWM", Kind: "wm", Installed: true}
	lxqt := WMCandidate{Name: "startlxqt", Label: "LXQt", Kind: "session", Installed: true}
	xfce := WMCandidate{Name: "startxfce4", Label: "XFCE", Kind: "session", Installed: true}
	missing := func(name, label, hint string) WMCandidate {
		return WMCandidate{Name: name, Label: label, Kind: "session", Hint: hint}
	}
	cases := []struct {
		name    string
		present []string
		want    []WMCandidate
	}{
		{
			"ladder order then starter order, deduped by name; missing DEs follow",
			[]string{"openbox", "icewm-session", "x-session-manager", "startlxqt"},
			[]WMCandidate{
				icewm,
				{Name: "openbox", Label: "openbox", Kind: "wm", Installed: true},
				{Name: "x-session-manager", Label: "x-session-manager", Kind: "session", Installed: true},
				lxqt,
				missing("startxfce4", "XFCE", "install xfce4 with your package manager"),
				missing("startplasma-x11", "Plasma", "install plasma with your package manager"),
				missing("startlxde", "LXDE", "install lxde with your package manager"),
				missing("mate-session", "MATE", "install mate with your package manager"),
				missing("cinnamon-session", "Cinnamon", "install cinnamon with your package manager"),
			},
		},
		{
			"aliases collapse into their primaries; the IceWM ladder head leads the missing rows",
			[]string{"startlxqt", "lxqt-session", "startxfce4", "xfce4-session"},
			[]WMCandidate{
				lxqt,
				xfce,
				{Name: "icewm-session", Label: "IceWM", Kind: "wm", Hint: "install icewm with your package manager"},
				missing("startplasma-x11", "Plasma", "install plasma with your package manager"),
				missing("startlxde", "LXDE", "install lxde with your package manager"),
				missing("mate-session", "MATE", "install mate with your package manager"),
				missing("cinnamon-session", "Cinnamon", "install cinnamon with your package manager"),
			},
		},
		{
			"an alias alone keeps its installed row and suppresses the missing row",
			[]string{"lxqt-session"},
			[]WMCandidate{
				{Name: "lxqt-session", Label: "LXQt", Kind: "session", Installed: true},
				{Name: "icewm-session", Label: "IceWM", Kind: "wm", Hint: "install icewm with your package manager"},
				missing("startxfce4", "XFCE", "install xfce4 with your package manager"),
				missing("startplasma-x11", "Plasma", "install plasma with your package manager"),
				missing("startlxde", "LXDE", "install lxde with your package manager"),
				missing("mate-session", "MATE", "install mate with your package manager"),
				missing("cinnamon-session", "Cinnamon", "install cinnamon with your package manager"),
			},
		},
		{
			"nothing resolves — IceWM first, then the DEs in table order",
			nil,
			[]WMCandidate{
				{Name: "icewm-session", Label: "IceWM", Kind: "wm", Hint: "install icewm with your package manager"},
				missing("startlxqt", "LXQt", "install lxqt with your package manager"),
				missing("startxfce4", "XFCE", "install xfce4 with your package manager"),
				missing("startplasma-x11", "Plasma", "install plasma with your package manager"),
				missing("startlxde", "LXDE", "install lxde with your package manager"),
				missing("mate-session", "MATE", "install mate with your package manager"),
				missing("cinnamon-session", "Cinnamon", "install cinnamon with your package manager"),
			},
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

// Missing rows carry the detected package manager's wording.
func TestWMCandidatesMissingRowHintsFollowThePackageManager(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	got := WMCandidates(stubLookPath("apt-get", "icewm-session", "lxqt-session"))
	want := []WMCandidate{
		{Name: "icewm-session", Label: "IceWM", Kind: "wm", Installed: true},
		{Name: "lxqt-session", Label: "LXQt", Kind: "session", Installed: true},
		{Name: "startxfce4", Label: "XFCE", Kind: "session", Hint: "sudo apt install --no-install-recommends xfce4"},
		{Name: "startplasma-x11", Label: "Plasma", Kind: "session", Hint: "sudo apt install --no-install-recommends plasma-desktop"},
		{Name: "startlxde", Label: "LXDE", Kind: "session", Hint: "sudo apt install --no-install-recommends lxde-core"},
		{Name: "mate-session", Label: "MATE", Kind: "session", Hint: "sudo apt install --no-install-recommends mate-desktop-environment-core"},
		{Name: "cinnamon-session", Label: "Cinnamon", Kind: "session", Hint: "sudo apt install --no-install-recommends cinnamon-core"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("WMCandidates = %+v, want %+v (alias-installed LXQt: one installed row, no missing row)", got, want)
	}
}

func TestWMCandidatesNilLookPathIsEmpty(t *testing.T) {
	got := WMCandidates(nil)
	if got == nil || len(got) != 0 {
		t.Errorf("WMCandidates(nil) = %v, want an empty non-nil slice (nil seams are safe)", got)
	}
}

// Missing desktops are emitted only where they can be installed — off Linux
// the list stays installed-only.
func TestWMCandidatesOffLinuxHasNoMissingRows(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	for _, os := range []string{"darwin", "plan9"} {
		goos = os
		got := WMCandidates(stubLookPath())
		if len(got) != 0 {
			t.Errorf("%s WMCandidates(nothing) = %+v, want empty (no missing rows off Linux)", os, got)
		}
	}
}
