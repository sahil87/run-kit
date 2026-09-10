package mcp

import (
	"strings"
	"testing"
	"time"
)

// TestTableShape pins the seeded allowlist: exactly the ten W1 tools, every
// timeout within the cap, and no row exposing a forbidden flag form.
func TestTableShape(t *testing.T) {
	want := []string{"sessions", "panes", "capture", "process", "status", "cron_list", "gui_status", "tab_show", "tab_web_ls", "send"}
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

// TestTableSendRow pins the one mutating row: body on stdin, text receipt,
// non-read-only annotations, and the interim-receipt description override.
func TestTableSendRow(t *testing.T) {
	row := Table[len(Table)-1]
	if row.Tool != "send" {
		t.Fatalf("last row = %q, want send", row.Tool)
	}
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

// TestReadOnlyAnnotations pins the annotation semantics of every See row.
func TestReadOnlyAnnotations(t *testing.T) {
	for _, row := range Table[:len(Table)-1] {
		if row.Annotations != readOnlyAnn {
			t.Errorf("row %q annotations = %+v, want readOnlyAnn", row.Tool, row.Annotations)
		}
		if row.Result != ResultJSON {
			t.Errorf("row %q result = %v, want ResultJSON", row.Tool, row.Result)
		}
	}
}
