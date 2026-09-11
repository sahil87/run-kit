package gui

// WMCandidate is one row of the desktop picker's status-document list: an
// installed window manager or desktop session (Installed true, Hint empty),
// or — on Linux only — a known desktop that is not installed, carrying its
// install line in Hint (wording only; rk never executes a package manager).
type WMCandidate struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	Kind      string `json:"kind"`
	Installed bool   `json:"installed"`
	Hint      string `json:"hint,omitempty"`
}

// sessionStarterOrder is the fixed iteration order of the session-starter
// binaries; the sessionStarters membership map in backend.go is derived from
// it so the name set is written once.
var sessionStarterOrder = []string{
	"startlxqt", "lxqt-session", "startxfce4", "xfce4-session", "startplasma-x11",
	"startlxde", "mate-session", "cinnamon-session", "x-session-manager",
}

// SessionStarters returns the session-starter binaries in their fixed order —
// the candidate list's order after the ladder.
func SessionStarters() []string {
	return append([]string(nil), sessionStarterOrder...)
}

// WMCandidateLabel is the picker row's display name: the desktop label for a
// known DE/WM starter, the raw binary name otherwise.
func WMCandidateLabel(name string) string {
	switch name {
	case "icewm-session":
		return "IceWM"
	case "startlxqt", "lxqt-session":
		return "LXQt"
	case "startxfce4", "xfce4-session":
		return "XFCE"
	case "startplasma-x11":
		return "Plasma"
	case "startlxde":
		return "LXDE"
	case "mate-session":
		return "MATE"
	case "cinnamon-session":
		return "Cinnamon"
	}
	return name
}

// deAliasPrimary maps a DE's alias starter to its primary starter. Both
// binaries ship in one package set (sessionStarterDEs), so when both resolve
// the alias row collapses into the primary — one desktop, one row. An alias
// resolving alone keeps its row (and the DE label).
var deAliasPrimary = map[string]string{
	"lxqt-session":  "startlxqt",
	"xfce4-session": "startxfce4",
}

// dePrimaryAlias inverts deAliasPrimary for the missing-row installed check:
// a DE counts as installed when either its primary or its alias starter
// resolved.
var dePrimaryAlias = func() map[string]string {
	m := make(map[string]string, len(deAliasPrimary))
	for alias, primary := range deAliasPrimary {
		m[primary] = alias
	}
	return m
}()

// deCandidatePrimaries is the known-desktop table's primary starter names in
// table order — the missing-row emission order after the IceWM ladder head.
// x-session-manager never gets a missing row (no install line for it).
var deCandidatePrimaries = []string{
	"startlxqt", "startxfce4", "startplasma-x11", "startlxde", "mate-session", "cinnamon-session",
}

// WMCandidates lists the picker candidates: installed rows first (the ladder,
// then the session starters, deduplicated by name — x-session-manager rides
// both), then — Linux only — the known desktops that did not resolve, each
// with its install hint: the IceWM ladder head, then the DE primaries in
// table order (a DE with either starter resolved counts as installed). A nil
// lookPath yields an empty, non-nil list (StatusDeps' nil-seam promise) so
// the document serializes [].
func WMCandidates(lookPath func(string) (string, error)) []WMCandidate {
	candidates := []WMCandidate{}
	if lookPath == nil {
		return candidates
	}
	seen := map[string]bool{}
	resolved := map[string]bool{}
	for _, name := range append(WMLadder(), SessionStarters()...) {
		if seen[name] {
			continue
		}
		seen[name] = true
		if _, err := lookPath(name); err != nil {
			continue
		}
		resolved[name] = true
		// The primary always precedes its alias in the fixed iteration order,
		// so a resolved primary is already listed when the alias comes up.
		if primary, isAlias := deAliasPrimary[name]; isAlias && resolved[primary] {
			continue
		}
		kind := "wm"
		if IsSessionStarter(name) {
			kind = "session"
		}
		candidates = append(candidates, WMCandidate{
			Name:      name,
			Label:     WMCandidateLabel(name),
			Kind:      kind,
			Installed: true,
		})
	}
	if goos != "linux" {
		return candidates
	}
	if !resolved["icewm-session"] {
		candidates = append(candidates, WMCandidate{
			Name:  "icewm-session",
			Label: WMCandidateLabel("icewm-session"),
			Kind:  "wm",
			Hint:  WMInstallHint(lookPath),
		})
	}
	for _, primary := range deCandidatePrimaries {
		if resolved[primary] || resolved[dePrimaryAlias[primary]] {
			continue
		}
		candidates = append(candidates, WMCandidate{
			Name:  primary,
			Label: WMCandidateLabel(primary),
			Kind:  "session",
			Hint:  DEInstallHint(primary, lookPath),
		})
	}
	return candidates
}
