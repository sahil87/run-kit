package tmux

import (
	"strings"
	"testing"
)

func TestParsePaneTarget(t *testing.T) {
	tests := []struct {
		name       string
		in         string
		wantPane   string
		wantWindow string
		wantErr    bool
	}{
		{"pane ID", "%5", "%5", "", false},
		{"pane ID large", "%123", "%123", "", false},
		{"window ID", "@3", "", "@3", false},
		{"exact session:window", "=work:editor", "", "=work:editor", false},
		{"exact session:window index", "=work:2", "", "=work:2", false},
		{"bare session:window rejected", "work:editor", "", "", true},
		{"bare name rejected", "editor", "", "", true},
		{"empty rejected", "", "", "", true},
		{"bare pane prefix rejected", "%", "", "", true},
		{"non-numeric pane rejected", "%x", "", "", true},
		{"non-numeric window rejected", "@x", "", "", true},
		{"bare equals rejected", "=", "", "", true},
		{"missing session rejected", "=:editor", "", "", true},
		{"missing window rejected", "=work:", "", "", true},
		{"second colon rejected", "=work:editor:0", "", "", true},
		{"session with colon impossible", "=a:b:c", "", "", true},
		{"session with period rejected", "=my.sess:win", "", "", true},
		{"window with space rejected", "=work:my win", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParsePaneTarget(tt.in)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ParsePaneTarget(%q) = %+v, want error", tt.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParsePaneTarget(%q) err = %v", tt.in, err)
			}
			if got.PaneID != tt.wantPane || got.WindowTarget != tt.wantWindow {
				t.Errorf("ParsePaneTarget(%q) = %+v, want pane=%q window=%q", tt.in, got, tt.wantPane, tt.wantWindow)
			}
		})
	}
}

// TestParsePaneTargetErrorNamesForms: the rejection message must name the three
// accepted forms (an agent reading the error can correct itself).
func TestParsePaneTargetErrorNamesForms(t *testing.T) {
	_, err := ParsePaneTarget("mysession:win")
	if err == nil {
		t.Fatal("want error")
	}
	for _, want := range []string{"%N", "@N", "=session:window"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q missing accepted form %q", err.Error(), want)
		}
	}
}

func TestSelectAgentPane(t *testing.T) {
	tests := []struct {
		name  string
		panes []PaneInfo
		want  string
	}{
		{
			"active pane with state wins",
			[]PaneInfo{{PaneID: "%1", IsActive: true, AgentState: "idle"}, {PaneID: "%2", AgentState: "idle"}},
			"%1",
		},
		{
			"state-carrying pane beats stateless active",
			[]PaneInfo{{PaneID: "%1", IsActive: true}, {PaneID: "%2", AgentState: "waiting"}},
			"%2",
		},
		{
			"no state falls back to active pane",
			[]PaneInfo{{PaneID: "%1"}, {PaneID: "%2", IsActive: true}},
			"%2",
		},
		{
			"no state and no active falls back to first",
			[]PaneInfo{{PaneID: "%1"}, {PaneID: "%2"}},
			"%1",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SelectAgentPane(tt.panes); got != tt.want {
				t.Errorf("SelectAgentPane = %q, want %q", got, tt.want)
			}
		})
	}
}

// TestAgentStateStale pins the shared reconcile rule both the sessions rollup
// (parsePanes) and the mux verbs' PaneAgentState route through (R10):
// pid-carrying values are trusted iff the pid is alive; legacy two-segment
// values (pid 0) fall back to the shell-command heuristic.
func TestAgentStateStale(t *testing.T) {
	orig := agentProcessAlive
	t.Cleanup(func() { agentProcessAlive = orig })

	agentProcessAlive = func(int) bool { return false }
	if !agentStateStale(4242, "vim") {
		t.Error("dead pid must be stale regardless of the pane command")
	}
	agentProcessAlive = func(int) bool { return true }
	if agentStateStale(4242, "bash") {
		t.Error("live pid must be trusted even on a shell-named pane (wrapped launch)")
	}
	for _, shell := range []string{"bash", "zsh", "fish", "sh", "dash"} {
		if !agentStateStale(0, shell) {
			t.Errorf("legacy two-segment value on shell %q must be stale", shell)
		}
	}
	if agentStateStale(0, "vim") {
		t.Error("legacy two-segment value on a non-shell command must be trusted")
	}

	// And the same decision reaches the parsePanes rollup.
	agentProcessAlive = func(int) bool { return false }
	lines := []string{"@1\t%1\t0\t/tmp\tvim\t1\tactive:1700000000:4242\t"}
	got := parsePanes(lines)["@1"]
	if len(got) != 1 || got[0].AgentState != "" {
		t.Errorf("dead-pid pane = %+v, want reconciled to unknown", got)
	}
	legacy := []string{"@1\t%1\t0\t/tmp\tbash\t1\tactive:1700000000\t"}
	got = parsePanes(legacy)["@1"]
	if len(got) != 1 || got[0].AgentState != "" {
		t.Errorf("legacy shell pane = %+v, want reconciled to unknown", got)
	}
}
