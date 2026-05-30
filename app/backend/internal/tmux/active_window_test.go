package tmux

import (
	"reflect"
	"strings"
	"testing"
)

// sessionGroupLine builds a list-sessions line for parseSessionGroups:
// session_id<TAB>session_name<TAB>session_group_list.
//
// NOTE: the third field is `#{session_group_list}` (comma-separated MEMBER
// NAMES), NOT `#{session_group}`. tmux 3.6a reports `#{session_group}` as an
// opaque numeric id (e.g. "0"), so the group key is derived from the member
// names via baseGroupName instead.
func sessionGroupLine(sid, name, groupList string) string {
	return strings.Join([]string{sid, name, groupList}, listDelim)
}

func TestBaseGroupName(t *testing.T) {
	tests := []struct {
		name      string
		sessName  string
		groupList string
		want      string
	}{
		{"ungrouped → own name", "solo", "", "solo"},
		{"base member from list (queried as base)", "runKit", "runKit,rk-relay-abc", "runKit"},
		{"base member from list (queried as ephemeral)", "rk-relay-abc", "runKit,rk-relay-abc", "runKit"},
		{"anchor skipped, base chosen", "_rk-ctl", "_rk-ctl,runKit", "runKit"},
		{"ephemeral-only list → own name fallback", "rk-relay-x", "rk-relay-x", "rk-relay-x"},
		{"order independent — base is first non-special", "rk-relay-x", "rk-relay-x,runKit", "runKit"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := baseGroupName(tt.sessName, tt.groupList); got != tt.want {
				t.Errorf("baseGroupName(%q, %q) = %q, want %q", tt.sessName, tt.groupList, got, tt.want)
			}
		})
	}
}

func TestParseSessionGroups(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  map[string]string
	}{
		{
			// Regression for the v2.1.4 bug: tmux reports group_list with member
			// NAMES; both base and ephemeral $sid must resolve to the base name
			// "runKit" so an event fired against the ephemeral updates the right
			// group. (Previously keyed on numeric #{session_group}="0" → mismatch
			// with the derivation lookup by session name → permanent Tier-2 fallback.)
			name: "grouped base + ephemeral resolve to base name",
			lines: []string{
				sessionGroupLine("$0", "runKit", "runKit,rk-relay-4c7ca880"),
				sessionGroupLine("$124", "rk-relay-4c7ca880", "runKit,rk-relay-4c7ca880"),
			},
			want: map[string]string{"$0": "runKit", "$124": "runKit"},
		},
		{
			name: "ungrouped session falls back to name as group",
			lines: []string{
				sessionGroupLine("$2", "solo", ""),
			},
			want: map[string]string{"$2": "solo"},
		},
		{
			name: "mixed grouped and ungrouped",
			lines: []string{
				sessionGroupLine("$0", "runKit", "runKit,rk-relay-x"),
				sessionGroupLine("$34", "rk-relay-x", "runKit,rk-relay-x"),
				sessionGroupLine("$2", "solo", ""),
			},
			want: map[string]string{"$0": "runKit", "$34": "runKit", "$2": "solo"},
		},
		{
			name: "anchor in group resolves members to base name",
			lines: []string{
				sessionGroupLine("$0", "runKit", "_rk-ctl,runKit"),
				sessionGroupLine("$9", "_rk-ctl", "_rk-ctl,runKit"),
			},
			want: map[string]string{"$0": "runKit", "$9": "runKit"},
		},
		{
			name:  "empty input",
			lines: nil,
			want:  nil,
		},
		{
			name: "short line skipped, missing sid skipped",
			lines: []string{
				"$0\trunKit", // only 2 fields
				sessionGroupLine("", "x", "x"),
				sessionGroupLine("$5", "ok", ""),
			},
			want: map[string]string{"$5": "ok"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseSessionGroups(tt.lines)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseSessionGroups() = %v, want %v", got, tt.want)
			}
		})
	}
}

// activeWindowLine builds a list-windows -a line for parseActiveWindowsByGroup:
// session_group_list<TAB>session_name<TAB>window_id<TAB>window_active.
//
// The first field is `#{session_group_list}` (member names), NOT
// `#{session_group}` — see sessionGroupLine.
func activeWindowLine(groupList, name, wid string, active int) string {
	a := "0"
	if active == 1 {
		a = "1"
	}
	return strings.Join([]string{groupList, name, wid, a}, listDelim)
}

func TestParseActiveWindowsByGroup(t *testing.T) {
	const gl = "runKit,rk-relay-x" // shared group-list for grouped cases
	tests := []struct {
		name  string
		lines []string
		want  map[string]string
	}{
		{
			// Regression: the seed must reflect the BASE session's pointer
			// (the Tier-2 truth), keyed by the base NAME "runKit" — not by a
			// numeric group, and not the ephemeral's independent pointer.
			name: "base pointer authoritative over ephemeral, keyed by base name",
			lines: []string{
				activeWindowLine(gl, "runKit", "@0", 0),
				activeWindowLine(gl, "runKit", "@3", 1),
				activeWindowLine(gl, "rk-relay-x", "@0", 1),
				activeWindowLine(gl, "rk-relay-x", "@3", 0),
			},
			want: map[string]string{"runKit": "@3"},
		},
		{
			// Mirrors the exact live v2.1.4 state: base and ephemeral agree on
			// @27. Keyed by base name "runKit" so the derivation lookup hits.
			name: "live grouped shape keyed by base name",
			lines: []string{
				activeWindowLine("runKit,rk-relay-4c7ca880", "rk-relay-4c7ca880", "@27", 1),
				activeWindowLine("runKit,rk-relay-4c7ca880", "runKit", "@27", 1),
			},
			want: map[string]string{"runKit": "@27"},
		},
		{
			name: "ungrouped session keyed by name",
			lines: []string{
				activeWindowLine("", "solo", "@2", 1),
				activeWindowLine("", "solo", "@5", 0),
			},
			want: map[string]string{"solo": "@2"},
		},
		{
			name: "no base-member row uses first active member as representative",
			// Only an ephemeral row present (base session momentarily absent
			// from the listing); fall back to first active member row, still
			// keyed by the base name derived from the group-list.
			lines: []string{
				activeWindowLine(gl, "rk-relay-x", "@7", 1),
			},
			want: map[string]string{"runKit": "@7"},
		},
		{
			name: "base row overrides earlier ephemeral fallback",
			lines: []string{
				activeWindowLine(gl, "rk-relay-x", "@7", 1), // ephemeral first
				activeWindowLine(gl, "runKit", "@3", 1),     // base later
			},
			want: map[string]string{"runKit": "@3"},
		},
		{
			name: "inactive rows ignored",
			lines: []string{
				activeWindowLine(gl, "runKit", "@0", 0),
				activeWindowLine(gl, "runKit", "@1", 0),
			},
			want: nil,
		},
		{
			name:  "empty input",
			lines: nil,
			want:  nil,
		},
		{
			name: "short line skipped",
			lines: []string{
				"runKit\trunKit\t@3", // only 3 fields
				activeWindowLine("", "g", "@9", 1),
			},
			want: map[string]string{"g": "@9"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseActiveWindowsByGroup(tt.lines)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseActiveWindowsByGroup() = %v, want %v", got, tt.want)
			}
		})
	}
}
