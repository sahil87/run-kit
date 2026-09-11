package mcp

import (
	"strings"
	"testing"
	"time"
)

// TestTableShape pins the seeded allowlist: exactly the eleven tools (the ten
// W1 seeds plus board), every timeout within the cap, and no row exposing a
// forbidden flag form.
func TestTableShape(t *testing.T) {
	want := []string{"sessions", "panes", "capture", "process", "status", "cron_list", "gui_status", "tab_show", "tab_web_ls", "send", "board"}
	if len(Table) != len(want) {
		t.Fatalf("Table has %d rows, want %d", len(Table), len(want))
	}
	for i, name := range want {
		if Table[i].Tool != name {
			t.Errorf("Table[%d].Tool = %q, want %q", i, Table[i].Tool, name)
		}
	}
	if ToolTimeoutCap != 45*time.Second {
		t.Errorf("ToolTimeoutCap = %s, want 45s", ToolTimeoutCap)
	}
	for _, row := range Table {
		if row.Timeout > ToolTimeoutCap {
			t.Errorf("row %q timeout %s exceeds cap", row.Tool, row.Timeout)
		}
		for _, arg := range row.Args {
			for _, banned := range []string{"--force", "--answer", "--key", "--await"} {
				if arg.Flag == banned || arg.Literal == banned {
					t.Errorf("row %q exposes %s", row.Tool, banned)
				}
			}
		}
	}
}

// findRow locates a table row by tool name — positional assertions
// (Table[len-1]) are brittle once the table grows past its seed ordering.
func findRow(t *testing.T, tool string) Row {
	t.Helper()
	for _, row := range Table {
		if row.Tool == tool {
			return row
		}
	}
	t.Fatalf("no row named %q", tool)
	return Row{}
}

// TestTableSendRow pins the stdin-driven mutating row: body on stdin, text
// receipt, non-read-only annotations, and the interim-receipt description
// override.
func TestTableSendRow(t *testing.T) {
	row := findRow(t, "send")
	if row.Stdin != "message" {
		t.Errorf("send.Stdin = %q, want message", row.Stdin)
	}
	if row.Result != ResultText {
		t.Errorf("send.Result = %v, want ResultText", row.Result)
	}
	if row.Annotations.ReadOnly || row.Annotations.Destructive || row.Annotations.Idempotent || row.Annotations.OpenWorld {
		t.Errorf("send annotations = %+v, want all false", row.Annotations)
	}
	if !strings.Contains(row.Description, "does NOT mean the agent has acted") {
		t.Errorf("send description missing the interim-receipt caveat: %q", row.Description)
	}
}

// TestTableBoardRow pins the action-enum row: parent path, arg order and
// shapes (enum, patterns), all-false annotations (mixed read/write), JSON
// result, and the description override.
func TestTableBoardRow(t *testing.T) {
	row := findRow(t, "board")
	if row.Path != "board" {
		t.Errorf("board.Path = %q, want board (the parent — flags resolve there)", row.Path)
	}
	if row.Result != ResultJSON {
		t.Errorf("board.Result = %v, want ResultJSON", row.Result)
	}
	if row.Annotations != (Annotations{}) {
		t.Errorf("board annotations = %+v, want all false", row.Annotations)
	}
	if row.Description != boardDescription || row.Description == "" {
		t.Errorf("board description = %q, want the boardDescription override", row.Description)
	}

	wantShapes := []struct {
		name     string
		flag     string
		pos      int
		required bool
		enum     []string
		pattern  string
	}{
		{name: "server", flag: "-L"},
		{name: "action", pos: 1, required: true, enum: []string{"show", "pin", "unpin", "reorder"}},
		{name: "name", pos: 2, pattern: `^[A-Za-z0-9_-]{1,32}$`},
		{name: "window", pos: 3, pattern: `^@\d+$`},
		{name: "before", flag: "--before", pattern: `^@\d+$`},
		{name: "after", flag: "--after", pattern: `^@\d+$`},
	}
	if len(row.Args) != len(wantShapes)+1 { // + jsonLiteral
		t.Fatalf("board args = %d, want %d", len(row.Args), len(wantShapes)+1)
	}
	for i, want := range wantShapes {
		arg := row.Args[i]
		if arg.Name != want.name || arg.Flag != want.flag || arg.Positional != want.pos ||
			arg.Required != want.required || arg.Pattern != want.pattern {
			t.Errorf("board.Args[%d] = %+v, want name=%q flag=%q pos=%d required=%v pattern=%q",
				i, arg, want.name, want.flag, want.pos, want.required, want.pattern)
		}
		if want.enum != nil && strings.Join(arg.Enum, ",") != strings.Join(want.enum, ",") {
			t.Errorf("board.Args[%d].Enum = %v, want %v", i, arg.Enum, want.enum)
		}
	}
	if last := row.Args[len(row.Args)-1]; last.Literal != "--json" {
		t.Errorf("board's last arg = %+v, want the --json literal", last)
	}
}

// TestTableNeverTools asserts no row's path names a never-tool.
func TestTableNeverTools(t *testing.T) {
	for _, row := range Table {
		for _, nt := range neverTools {
			if row.Path == nt || strings.HasPrefix(row.Path, nt+" ") {
				t.Errorf("row %q path %q is a never-tool", row.Tool, row.Path)
			}
		}
	}
}

// TestReadOnlyAnnotations pins the annotation semantics of every See row —
// the two mutating rows (send, board) carry all-false annotations instead.
func TestReadOnlyAnnotations(t *testing.T) {
	for _, row := range Table {
		if row.Tool == "send" || row.Tool == "board" {
			continue
		}
		if row.Annotations != readOnlyAnn {
			t.Errorf("row %q annotations = %+v, want readOnlyAnn", row.Tool, row.Annotations)
		}
		if row.Result != ResultJSON {
			t.Errorf("row %q result = %v, want ResultJSON", row.Tool, row.Result)
		}
	}
}
