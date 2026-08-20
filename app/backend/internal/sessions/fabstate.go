package sessions

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"

	"rk/internal/tmux"
)

// fabStatusLinkName is the symlink fab maintains at a worktree root pointing
// at the active change's status file: fab/changes/<name>/.status.yaml. It is
// the L2 fab-register source docs/specs/status-pyramid.md documents for the
// sessions enrichment path (Constitution II: fab state comes from .status.yaml,
// derived at request time — never through a choreography subprocess).
const fabStatusLinkName = ".fab-status.yaml"

// fabState is one pane's fab tier (change/stage/displayState) derived natively
// from the filesystem. The zero value is the degraded state: every failure
// mode (no symlink ancestor, dangling symlink, unreadable or unparsable
// .status.yaml, empty progress map) yields it — per-pane, never an error, so
// one bad worktree cannot blank the whole fetch.
type fabState struct {
	change       string
	stage        string
	displayState string
}

// fabStateMemo is the per-FetchSessions-call derivation memo. Many panes share
// one worktree, so the walk-up result (keyed by cwd) and the derived state
// (keyed by the resolved symlink path) are deduped for the duration of one
// call. It is created fresh per call and holds no state across requests — a
// stage transition written to .status.yaml is visible on the very next fetch.
type fabStateMemo struct {
	links  map[string]string   // pane cwd → located .fab-status.yaml path ("" = none)
	states map[string]fabState // resolved symlink path → derived state
}

func newFabStateMemo() *fabStateMemo {
	return &fabStateMemo{links: map[string]string{}, states: map[string]fabState{}}
}

// windowState applies the window-level rollup over the window's panes (in pane
// order): a change-bound pane's derivation wins; otherwise the first pane with
// any derivation. The per-pane derivation is all-or-nothing (a pane either
// resolves a full triple or degrades to the zero value), so the rule collapses
// to the first pane carrying a change.
func (m *fabStateMemo) windowState(panes []tmux.PaneInfo) fabState {
	for _, p := range panes {
		if st := m.derive(p.Cwd); st.change != "" {
			return st
		}
	}
	return fabState{}
}

// derive returns the fab state for one pane cwd, memoized per call. A pane
// with an empty cwd is skipped outright.
func (m *fabStateMemo) derive(cwd string) fabState {
	if cwd == "" {
		return fabState{}
	}
	link, ok := m.links[cwd]
	if !ok {
		link = locateFabStatusLink(cwd)
		m.links[cwd] = link
	}
	if link == "" {
		return fabState{}
	}
	st, ok := m.states[link]
	if !ok {
		st = parseFabStatusLink(link)
		m.states[link] = st
	}
	return st
}

// locateFabStatusLink walks up from cwd to the nearest ancestor directory
// containing a .fab-status.yaml entry, bounded by the filesystem root. Lstat
// (not Stat) so a dangling symlink — an archived change — still counts as
// found and degrades at read time like any other unreadable target. Returns ""
// when no ancestor carries the link (a plain non-fab directory).
func locateFabStatusLink(cwd string) string {
	dir := filepath.Clean(cwd)
	for {
		link := filepath.Join(dir, fabStatusLinkName)
		if _, err := os.Lstat(link); err == nil {
			return link
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// parseFabStatusLink resolves the .fab-status.yaml symlink and derives the
// full fab state from its target. The change name is the target's parent
// directory basename (fab/changes/<name>/.status.yaml); a relative target is
// resolved against the symlink's own directory. A dangling symlink or an
// unreadable/unparsable target degrades to the zero value.
func parseFabStatusLink(link string) fabState {
	target, err := os.Readlink(link)
	if err != nil {
		return fabState{}
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(filepath.Dir(link), target)
	}
	change := filepath.Base(filepath.Dir(target))
	if change == "" || change == "." || change == string(filepath.Separator) {
		return fabState{}
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return fabState{}
	}
	stage, displayState := fabDisplayStage(parseProgressStates(data))
	if stage == "" {
		return fabState{}
	}
	return fabState{change: change, stage: stage, displayState: displayState}
}

// stageState is one ordered entry of a .status.yaml progress: mapping. Order
// is load-bearing — the display-stage tier rule depends on stage order, so the
// parse goes through yaml.Node (a Go map would lose it).
type stageState struct {
	stage string
	state string
}

// parseProgressStates extracts the ordered stage→state pairs from a
// .status.yaml document's top-level progress: mapping. Anything else (corrupt
// YAML, progress absent or not a mapping, an empty mapping) yields nil.
func parseProgressStates(data []byte) []stageState {
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil
	}
	root := doc.Content[0]
	for i := 0; i+1 < len(root.Content); i += 2 {
		if root.Content[i].Value != "progress" {
			continue
		}
		mapping := root.Content[i+1]
		if mapping.Kind != yaml.MappingNode {
			return nil
		}
		var states []stageState
		for j := 0; j+1 < len(mapping.Content); j += 2 {
			states = append(states, stageState{
				stage: mapping.Content[j].Value,
				state: mapping.Content[j+1].Value,
			})
		}
		return states
	}
	return nil
}

// fabDisplayStage derives (stage, displayState) from the ordered progress
// pairs with fab's five-tier display-stage rule: the first active stage wins;
// else the first failed (a parked failure outranks ready/done); else the first
// ready; else the last done/skipped; else the first stage is pending. An empty
// progress set yields ("", "") — there is no stage to point at.
func fabDisplayStage(states []stageState) (stage, state string) {
	if len(states) == 0 {
		return "", ""
	}
	for _, ss := range states {
		if ss.state == "active" {
			return ss.stage, "active"
		}
	}
	for _, ss := range states {
		if ss.state == "failed" {
			return ss.stage, "failed"
		}
	}
	for _, ss := range states {
		if ss.state == "ready" {
			return ss.stage, "ready"
		}
	}
	lastDone, lastDoneState := "", ""
	for _, ss := range states {
		if ss.state == "done" || ss.state == "skipped" {
			lastDone, lastDoneState = ss.stage, ss.state
		}
	}
	if lastDone != "" {
		return lastDone, lastDoneState
	}
	return states[0].stage, "pending"
}
