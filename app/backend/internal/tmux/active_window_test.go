package tmux

import (
	"reflect"
	"strings"
	"testing"
)

// sessionGroupLine builds a list-sessions line for parseSessionGroups:
// session_id<TAB>session_name<TAB>session_group.
func sessionGroupLine(sid, name, group string) string {
	return strings.Join([]string{sid, name, group}, listDelim)
}

func TestParseSessionGroups(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  map[string]string
	}{
		{
			name: "grouped base + ephemeral share group",
			lines: []string{
				sessionGroupLine("$0", "runKit", "runKit"),
				sessionGroupLine("$34", "rk-relay-abc", "runKit"),
			},
			want: map[string]string{"$0": "runKit", "$34": "runKit"},
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
				sessionGroupLine("$0", "runKit", "runKit"),
				sessionGroupLine("$34", "rk-relay-x", "runKit"),
				sessionGroupLine("$2", "solo", ""),
			},
			want: map[string]string{"$0": "runKit", "$34": "runKit", "$2": "solo"},
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
				sessionGroupLine("$5", "ok", "ok"),
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
// session_group<TAB>session_name<TAB>window_id<TAB>window_active.
func activeWindowLine(group, name, wid string, active int) string {
	a := "0"
	if active == 1 {
		a = "1"
	}
	return strings.Join([]string{group, name, wid, a}, listDelim)
}

func TestParseActiveWindowsByGroup(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  map[string]string
	}{
		{
			name: "leader pointer authoritative over ephemeral",
			// Group runKit: leader (name==group) active @3; ephemeral active @0.
			// The seed must reflect the LEADER (@3), mirroring Tier-2 base pointer.
			lines: []string{
				activeWindowLine("runKit", "runKit", "@0", 0),
				activeWindowLine("runKit", "runKit", "@3", 1),
				activeWindowLine("runKit", "rk-relay-x", "@0", 1),
				activeWindowLine("runKit", "rk-relay-x", "@3", 0),
			},
			want: map[string]string{"runKit": "@3"},
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
			name: "leaderless group uses first active member as representative",
			// No row where name==group (leader renamed); fall back to first
			// active member row.
			lines: []string{
				activeWindowLine("runKit", "rk-relay-x", "@7", 1),
			},
			want: map[string]string{"runKit": "@7"},
		},
		{
			name: "leader row overrides earlier ephemeral fallback",
			lines: []string{
				activeWindowLine("runKit", "rk-relay-x", "@7", 1), // ephemeral first
				activeWindowLine("runKit", "runKit", "@3", 1),     // leader later
			},
			want: map[string]string{"runKit": "@3"},
		},
		{
			name: "inactive rows ignored",
			lines: []string{
				activeWindowLine("runKit", "runKit", "@0", 0),
				activeWindowLine("runKit", "runKit", "@1", 0),
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
				activeWindowLine("g", "g", "@9", 1),
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
