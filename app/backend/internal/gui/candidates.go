package gui

// WMCandidate is one installed window manager or desktop session on PATH — a
// row of the desktop picker's status-document list. Entries are emitted only
// for resolved binaries, so Installed is always true.
type WMCandidate struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	Kind      string `json:"kind"`
	Installed bool   `json:"installed"`
}

// sessionStarterOrder is the fixed iteration order of the session-starter
// binaries; the sessionStarters membership map in backend.go is derived from
// it so the name set is written once.
var sessionStarterOrder = []string{
	"startlxqt", "lxqt-session", "startxfce4", "xfce4-session", "startplasma-x11", "x-session-manager",
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

// WMCandidates lists the installed picker candidates: the ladder first, then
// the session starters, deduplicated by name (x-session-manager rides both).
// A lookPath miss omits the name entirely; a nil lookPath yields an empty,
// non-nil list (StatusDeps' nil-seam promise) so the document serializes [].
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
	return candidates
}

// WMCandidatesHint is the picker footer's install line: the LXQt line unless
// an LXQt candidate is already listed. Empty when LXQt is present — and off
// Linux, where DEInstallHint is empty.
func WMCandidatesHint(candidates []WMCandidate, lookPath func(string) (string, error)) string {
	for _, c := range candidates {
		if c.Name == "startlxqt" || c.Name == "lxqt-session" {
			return ""
		}
	}
	return DEInstallHint("startlxqt", lookPath)
}
