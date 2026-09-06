package cron

import (
	"context"
	"fmt"

	"rk/internal/tmux"
)

// facts.go — per-live-server fact gathering (R16). Every tmux touch routes
// through the TmuxSeam (the real implementation delegates to internal/tmux —
// R13: no exec calls in this package) and is only ever invoked for servers in
// the tick's live set (R12). A target that fails resolution is a skip
// diagnostic, never an error.

// TmuxSeam is the narrow tmux surface fact gathering needs. Tests substitute
// fakes; the dead-server "zero tmux commands" property is pinned against it.
type TmuxSeam interface {
	ListSessions(ctx context.Context, server string) ([]tmux.SessionInfo, error)
	ListWindows(ctx context.Context, session, server string) ([]tmux.WindowInfo, error)
	ResolveAgentPane(ctx context.Context, windowTarget, server string) (string, error)
	PaneFacts(ctx context.Context, paneID, server string) (tmux.PaneFacts, error)
	PaneExists(ctx context.Context, paneID, server string) (bool, error)
}

// realTmux is the production seam — pure delegation to internal/tmux.
type realTmux struct{}

func (realTmux) ListSessions(ctx context.Context, server string) ([]tmux.SessionInfo, error) {
	return tmux.ListSessions(ctx, server)
}

func (realTmux) ListWindows(ctx context.Context, session, server string) ([]tmux.WindowInfo, error) {
	return tmux.ListWindows(ctx, session, server)
}

func (realTmux) ResolveAgentPane(ctx context.Context, windowTarget, server string) (string, error) {
	return tmux.ResolveAgentPane(ctx, windowTarget, server)
}

func (realTmux) PaneFacts(ctx context.Context, paneID, server string) (tmux.PaneFacts, error) {
	return tmux.PaneFactsCtx(ctx, paneID, server)
}

func (realTmux) PaneExists(ctx context.Context, paneID, server string) (bool, error) {
	return tmux.PaneExists(ctx, paneID, server)
}

// ServerFacts is one live server's derived state: the agent-state fingerprint
// (wake_on input), per-entry resolved target facts, and skip diagnostics.
type ServerFacts struct {
	Fingerprint string
	Targets     map[string]TargetFacts
	Diags       []Diagnostic
}

// GatherFacts resolves every entry's target on one live server and reads each
// resolved pane's agent-state epoch, plus the server-scoped fingerprint.
// Enumeration failures degrade (diagnostics), never abort.
func GatherFacts(ctx context.Context, server string, entries []Entry, seam TmuxSeam) ServerFacts {
	out := ServerFacts{Targets: map[string]TargetFacts{}}
	diag := func(entryID, reason, detail string) {
		out.Diags = append(out.Diags, Diagnostic{Server: server, EntryID: entryID, Reason: reason, Detail: detail})
	}

	// One enumeration pass per server: sessions → windows (+panes).
	type winFacts struct {
		window tmux.WindowInfo
	}
	var windows []winFacts
	sessions, err := seam.ListSessions(ctx, server)
	if err != nil {
		diag("", "enumeration-failed", fmt.Sprintf("list-sessions: %v", err))
	} else {
		for _, s := range sessions {
			wins, err := seam.ListWindows(ctx, s.Name, server)
			if err != nil {
				diag("", "enumeration-failed", fmt.Sprintf("list-windows %s: %v", s.Name, err))
				continue
			}
			for _, w := range wins {
				windows = append(windows, winFacts{window: w})
			}
		}
	}

	// Server-scoped agent-state fingerprint from the enumerated panes.
	states := map[string]string{}
	for _, wf := range windows {
		for _, p := range wf.window.Panes {
			if p.AgentState != "" {
				states[p.PaneID] = p.AgentState
			}
		}
	}
	out.Fingerprint = Fingerprint(states)

	// paneFacts fills the resolved pane's agent-state read.
	paneFacts := func(entryID, paneID string) TargetFacts {
		pf, err := seam.PaneFacts(ctx, paneID, server)
		if err != nil {
			diag(entryID, "target-unresolved", fmt.Sprintf("pane %s facts: %v", paneID, err))
			return TargetFacts{Unresolved: err.Error()}
		}
		return TargetFacts{PaneID: paneID, AgentState: pf.AgentState, StateEpoch: pf.AgentStateEpoch}
	}

	for _, e := range entries {
		switch e.Target.Kind {
		case TargetRole:
			if e.Target.Role != RoleOperator {
				out.Targets[e.ID] = TargetFacts{Unresolved: "unknown role " + e.Target.Role}
				diag(e.ID, "target-unresolved", "unknown role "+e.Target.Role)
				continue
			}
			// The @rk_win_role radio semantics: find the window carrying
			// Role == "operator", then resolve its agent pane — never a bare
			// -t _rk-operator.
			var carrier *tmux.WindowInfo
			for i := range windows {
				if windows[i].window.Role == RoleOperator {
					c := windows[i].window
					carrier = &c
					break
				}
			}
			if carrier == nil {
				out.Targets[e.ID] = TargetFacts{Unresolved: "no window carries role operator"}
				diag(e.ID, "target-unresolved", "no window carries role operator")
				continue
			}
			pane, err := seam.ResolveAgentPane(ctx, carrier.WindowID, server)
			if err != nil {
				out.Targets[e.ID] = TargetFacts{Unresolved: err.Error()}
				diag(e.ID, "target-unresolved", fmt.Sprintf("operator window %s: %v", carrier.WindowID, err))
				continue
			}
			out.Targets[e.ID] = paneFacts(e.ID, pane)
		case TargetSession:
			// The live pane carrying the @rk_pane_agent_session id.
			var paneID string
			for _, wf := range windows {
				for _, p := range wf.window.Panes {
					if p.AgentSessionRef == e.Target.Session {
						paneID = p.PaneID
						break
					}
				}
				if paneID != "" {
					break
				}
			}
			if paneID == "" {
				out.Targets[e.ID] = TargetFacts{Unresolved: "no live pane carries session " + e.Target.Session}
				diag(e.ID, "target-unresolved", "no live pane carries session "+e.Target.Session)
				continue
			}
			out.Targets[e.ID] = paneFacts(e.ID, paneID)
		case TargetPane:
			if !tmux.ValidPaneID(e.Target.Pane) {
				out.Targets[e.ID] = TargetFacts{Unresolved: "invalid pane id " + e.Target.Pane}
				diag(e.ID, "target-unresolved", "invalid pane id "+e.Target.Pane)
				continue
			}
			alive, err := seam.PaneExists(ctx, e.Target.Pane, server)
			if err != nil {
				out.Targets[e.ID] = TargetFacts{Unresolved: err.Error()}
				diag(e.ID, "target-unresolved", fmt.Sprintf("pane %s liveness: %v", e.Target.Pane, err))
				continue
			}
			if !alive {
				out.Targets[e.ID] = TargetFacts{Unresolved: "pane " + e.Target.Pane + " is dead"}
				diag(e.ID, "target-unresolved", "pane "+e.Target.Pane+" is dead")
				continue
			}
			out.Targets[e.ID] = paneFacts(e.ID, e.Target.Pane)
		default:
			out.Targets[e.ID] = TargetFacts{Unresolved: "unknown target kind " + e.Target.Kind}
			diag(e.ID, "target-unresolved", "unknown target kind "+e.Target.Kind)
		}
	}
	return out
}
