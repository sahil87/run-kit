package mcp

import (
	"slices"
	"strings"
	"testing"
	"time"
)

// TestTableShape pins the seeded allowlist: exactly the twelve tools (the ten
// W1 seeds plus board and operator_request), every timeout within the cap, and no row exposing a
// forbidden flag form.
func TestTableShape(t *testing.T) {
	want := []string{"sessions", "panes", "capture", "process", "status", "cron_list", "gui_status", "tab_show", "tab_web_ls", "send", "board", "operator_request"}
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

// TestTableOperatorRequestRow pins the operator_request Talk row: the path,
// the closed template enum on the positional, the conditional window flag,
// the acceptor flags, the --json literal, and the description override naming
// the window-scoped templates and the queued posture.
func TestTableOperatorRequestRow(t *testing.T) {
	row := findRow(t, "operator_request")
	if row.Path != "operator request" {
		t.Errorf("path = %q, want %q", row.Path, "operator request")
	}
	if row.Result != ResultJSON {
		t.Errorf("result = %v, want ResultJSON", row.Result)
	}
	if row.Annotations.ReadOnly || row.Annotations.Destructive || row.Annotations.Idempotent || row.Annotations.OpenWorld {
		t.Errorf("annotations = %+v, want all false (a Talk row)", row.Annotations)
	}

	argsByName := make(map[string]Arg, len(row.Args))
	var positional *Arg
	var literals []string
	for i, arg := range row.Args {
		if arg.Literal != "" {
			literals = append(literals, arg.Literal)
			continue
		}
		if arg.Positional != 0 {
			if positional != nil {
				t.Errorf("second positional arg %q; want exactly one", arg.Name)
			}
			a := row.Args[i]
			positional = &a
			continue
		}
		argsByName[arg.Name] = arg
	}

	if positional == nil || positional.Name != "template" || positional.Positional != 1 {
		t.Fatalf("positional = %+v, want template at slot 1", positional)
	}
	if !positional.Required || positional.Type != ArgString {
		t.Errorf("template = %+v, want a required string", positional)
	}
	if !slices.Equal(positional.Enum, operatorTemplateIDs) {
		t.Errorf("template enum = %v, want the mirrored registry ids %v", positional.Enum, operatorTemplateIDs)
	}
	if !slices.IsSorted(operatorTemplateIDs) {
		t.Errorf("operatorTemplateIDs = %v, want sorted (mirrors the api list order)", operatorTemplateIDs)
	}
	if len(operatorTemplateIDs) != 9 {
		t.Errorf("operatorTemplateIDs has %d ids, want the 9-entry registry", len(operatorTemplateIDs))
	}

	window, ok := argsByName["window"]
	if !ok || window.Flag != "--window" || window.Required {
		t.Errorf("window arg = %+v (present %v), want an optional --window flag", window, ok)
	}
	if window.Pattern != `^@\d+$` {
		t.Errorf("window pattern = %q, want ^@\\d+$", window.Pattern)
	}
	for _, name := range []string{"text", "session"} {
		arg, ok := argsByName[name]
		if !ok || arg.Flag != "--"+name || arg.Type != ArgString || arg.Required {
			t.Errorf("%s arg = %+v (present %v), want an optional string flag", name, arg, ok)
		}
	}
	server, ok := argsByName["server"]
	if !ok || server.Flag != "-L" || server.Required {
		t.Errorf("server arg = %+v (present %v), want the optional -L mapping", server, ok)
	}
	if !slices.Equal(literals, []string{"--json"}) {
		t.Errorf("literals = %v, want [--json]", literals)
	}

	for _, want := range []string{"fix-tab-name", "annotate-tab", "user-message", "queued", "--list"} {
		if !strings.Contains(row.Description, want) {
			t.Errorf("description missing %q: %q", want, row.Description)
		}
		}
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
// the three mutating rows (send, board, operator_request) carry all-false annotations instead.
func TestReadOnlyAnnotations(t *testing.T) {
	seen := 0
	for _, row := range Table {
		if !row.Annotations.ReadOnly {
			continue
		}
		seen++
		if row.Annotations != readOnlyAnn {
			t.Errorf("row %q annotations = %+v, want readOnlyAnn", row.Tool, row.Annotations)
		}
		if row.Result != ResultJSON {
			t.Errorf("row %q result = %v, want ResultJSON", row.Tool, row.Result)
		}
	}
	if seen != 9 {
		t.Errorf("%d read-only rows, want the nine See rows", seen)
	}
}
