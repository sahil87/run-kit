package mcp

import (
	"context"
	"sort"
	"strings"
	"testing"
	"time"

	"rk/internal/testutil"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// connectInMemory builds a server over the in-memory transport pair and
// returns the connected client session.
func connectInMemory(t *testing.T, s *Server) *mcpsdk.ClientSession {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	serverT, clientT := mcpsdk.NewInMemoryTransports()
	ss, err := s.sdk.Connect(ctx, serverT, nil)
	if err != nil {
		t.Fatalf("server Connect: %v", err)
	}
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "mcp-test"}, nil)
	cs, err := client.Connect(ctx, clientT, nil)
	if err != nil {
		t.Fatalf("client Connect: %v", err)
	}
	t.Cleanup(func() {
		cs.Close()
		ss.Wait()
	})
	return cs
}

// TestServerInMemory: an in-process SDK client sees the table's tools, the
// configured instructions, and can call a tool through the executor stub.
func TestServerInMemory(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteStub(t, dir, "rk-stub", "#!/bin/sh\necho '[{\"name\":\"boot\"}]'\n")
	s, err := New(Config{
		Root:         syntheticTree(),
		Exe:          dir + "/rk-stub",
		Version:      "v0.0.0-test",
		Instructions: "the core bundle",
		Table:        syntheticRows(),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got, want := s.Tools(), []string{"capture", "send"}; !equalStrings(got, want) {
		t.Errorf("Tools() = %v, want %v (sorted)", got, want)
	}

	cs := connectInMemory(t, s)
	if got := cs.InitializeResult().Instructions; got != "the core bundle" {
		t.Errorf("instructions = %q", got)
	}
	tools, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	var names []string
	for _, tool := range tools.Tools {
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	if !equalStrings(names, []string{"capture", "send"}) {
		t.Errorf("ListTools = %v", names)
	}

	// A valid call execs the stub and maps its bare JSON verbatim.
	res, err := cs.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name:      "capture",
		Arguments: map[string]any{"target": "%3", "lines": 100},
	})
	if err != nil {
		t.Fatalf("CallTool: %v", err)
	}
	if res.IsError {
		t.Fatalf("capture call IsError: %v", res.Content)
	}
	tc, ok := res.Content[0].(*mcpsdk.TextContent)
	if !ok || tc.Text != `[{"name":"boot"}]` {
		t.Errorf("capture content = %v", res.Content)
	}

	// An invalid call is rejected before exec — IsError, no protocol error.
	res, err = cs.CallTool(context.Background(), &mcpsdk.CallToolParams{
		Name:      "capture",
		Arguments: map[string]any{"target": "bogus"},
	})
	if err != nil {
		t.Fatalf("CallTool (invalid): %v", err)
	}
	if !res.IsError {
		t.Error("invalid target must be IsError")
	}
	if tc, ok := res.Content[0].(*mcpsdk.TextContent); !ok || !strings.Contains(tc.Text, `"target"`) {
		t.Errorf("invalid call content = %v", res.Content)
	}
}

// TestNewResolveFailure: a table that cannot resolve fails New and names the
// row.
func TestNewResolveFailure(t *testing.T) {
	rows := syntheticRows()
	rows[0].Path = "mux nope"
	_, err := New(Config{Root: syntheticTree(), Exe: "x", Table: rows})
	if err == nil || !strings.Contains(err.Error(), `"capture"`) {
		t.Fatalf("New = %v, want an error naming capture", err)
	}
}

// TestAnnotationsOnTheWire: the resolved annotation mapping carries explicit
// pointer hints (a client drives its confirmation UX off them).
func TestAnnotationsOnTheWire(t *testing.T) {
	ro := toolAnnotations(readOnlyAnn)
	if !ro.ReadOnlyHint || !ro.IdempotentHint {
		t.Errorf("readOnlyAnn = %+v", ro)
	}
	if ro.DestructiveHint == nil || *ro.DestructiveHint || ro.OpenWorldHint == nil || *ro.OpenWorldHint {
		t.Errorf("pointer hints must be explicit false: %+v", ro)
	}
	none := toolAnnotations(Annotations{})
	if none.ReadOnlyHint || none.IdempotentHint || *none.DestructiveHint || *none.OpenWorldHint {
		t.Errorf("zero annotations = %+v", none)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
