package snapshot

import (
	"path"
	"sort"
	"strings"
	"time"
)

// Offer is one restorable server: a lingering live-latest snapshot whose
// server has no live tmux socket (the reboot signature). The JSON shape is a
// shared contract with the frontend recovery section — it carries the full
// stored layout tree inline so a row expansion needs no second request.
type Offer struct {
	Server       string         `json:"server"`
	TakenAt      time.Time      `json:"takenAt"`
	SessionCount int            `json:"sessionCount"`
	WindowCount  int            `json:"windowCount"`
	Sessions     []OfferSession `json:"sessions"`
}

// OfferSession is one stored session inside an Offer.
type OfferSession struct {
	Name    string        `json:"name"`
	Color   string        `json:"color,omitempty"`
	Windows []OfferWindow `json:"windows"`
}

// OfferWindow is one stored window inside an Offer.
type OfferWindow struct {
	Index     int    `json:"index"`
	Name      string `json:"name"`
	PaneCount int    `json:"paneCount"`
	// Commands lists the recorded per-pane former commands in pane-index order
	// (empty commands omitted). Informational only — restore never relaunches.
	Commands []string `json:"commands"`
	// Resumable is true when any pane's former command is a `claude` invocation
	// (the window's agent can be resumed, e.g. `claude -c`).
	Resumable bool `json:"resumable"`
}

// infraServerName mirrors the frontend isInfraServer idiom (exact `rk-daemon`,
// any `rk-test-` prefix) plus the daemon-sibling session names, excluded
// defensively as names: infrastructure servers never produce recovery offers.
// `rk-test-*` sockets never snapshot at all (snapshotter scope), so the prefix
// rule is a second line of defense.
func infraServerName(name string) bool {
	switch name {
	case "rk-daemon", "rk-jobs", "rk-code-server", "rk-remotes":
		return true
	}
	return strings.HasPrefix(name, "rk-test-")
}

// isClaudeCommand reports whether a recorded pane command is a `claude`
// invocation: the basename of the first word must be exactly "claude"
// (`claude`, `claude -c`, `/path/to/claude --flags` match; `claudeify` does
// not).
func isClaudeCommand(command string) bool {
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return false
	}
	return path.Base(fields[0]) == "claude"
}

// RestorableOffers derives the restorable-offer set: every store entry with a
// lingering live-latest (DiedAt == nil) whose server is NOT in liveServers and
// is not infrastructure. Tombstones (audited or not) are never offered. The
// live-server enumeration stays outside this package — the caller passes it in.
func (s *Store) RestorableOffers(liveServers []string) ([]Offer, error) {
	entries, err := s.List("")
	if err != nil {
		return nil, err
	}
	live := make(map[string]bool, len(liveServers))
	for _, name := range liveServers {
		live[name] = true
	}

	offers := []Offer{}
	for _, e := range entries {
		if e.DiedAt != nil || live[e.Server] || infraServerName(e.Server) {
			continue
		}
		snap, err := s.LoadLatest(e.Server)
		if err != nil {
			return nil, err
		}
		if snap == nil {
			// Raced removal between List and Load (a concurrent tombstone) —
			// the server no longer qualifies.
			continue
		}
		offers = append(offers, buildOffer(snap))
	}
	return offers, nil
}

// buildOffer renders a snapshot into the offer payload, including the full
// layout tree. Slices are always non-nil so the wire form is `[]`, never null.
func buildOffer(snap *Snapshot) Offer {
	offer := Offer{
		Server:       snap.Server,
		TakenAt:      snap.TakenAt,
		SessionCount: snap.SessionCount(),
		WindowCount:  snap.WindowCount(),
		Sessions:     []OfferSession{},
	}
	for _, sess := range snap.Sessions {
		offerSess := OfferSession{Name: sess.Name, Color: sess.Color, Windows: []OfferWindow{}}
		windows := append([]Window(nil), sess.Windows...)
		sort.Slice(windows, func(i, j int) bool { return windows[i].Index < windows[j].Index })
		for _, win := range windows {
			ow := OfferWindow{
				Index:     win.Index,
				Name:      win.Name,
				PaneCount: len(win.Panes),
				Commands:  []string{},
			}
			for _, p := range win.Panes {
				if p.Command == "" {
					continue
				}
				ow.Commands = append(ow.Commands, p.Command)
				if isClaudeCommand(p.Command) {
					ow.Resumable = true
				}
			}
			offerSess.Windows = append(offerSess.Windows, ow)
		}
		offer.Sessions = append(offer.Sessions, offerSess)
	}
	return offer
}
