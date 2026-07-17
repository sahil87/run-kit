package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// syntheticTree builds a small command tree exercising every filtering and
// recursion case deterministically: a completion-named child, a help-named
// child, a hidden child carrying its own subtree, and a visible nested parent
// with nested (grandchild) children.
func syntheticTree() *cobra.Command {
	root := &cobra.Command{Use: "fake", Short: "fake root"}

	// Cobra's auto-generated completion/help are NOT hidden, so they must be
	// excluded by name. Model them as plain children here.
	root.AddCommand(&cobra.Command{Use: "completion", Short: "gen completions"})
	root.AddCommand(&cobra.Command{Use: "help", Short: "help about commands"})

	// A hidden parent with a child — the whole subtree must be dropped.
	hidden := &cobra.Command{Use: "secret", Short: "hidden cmd", Hidden: true}
	hidden.AddCommand(&cobra.Command{Use: "inner", Short: "hidden child"})
	root.AddCommand(hidden)

	// A visible parent with a visible nested child AND a hidden nested child.
	parent := &cobra.Command{Use: "group", Short: "visible group"}
	parent.AddCommand(&cobra.Command{Use: "leaf", Short: "visible leaf"})
	parent.AddCommand(&cobra.Command{Use: "buried", Short: "hidden grandchild", Hidden: true})
	root.AddCommand(parent)

	return root
}

func childByName(n node, name string) (node, bool) {
	for _, c := range n.Commands {
		if c.Name == name {
			return c, true
		}
	}
	return node{}, false
}

func TestBuildDumpTopLevelShape(t *testing.T) {
	doc := buildDump(rootCmd, displayVersion())

	if doc.Tool != "run-kit" {
		t.Errorf("tool = %q, want %q", doc.Tool, "run-kit")
	}
	if doc.SchemaVersion != 1 {
		t.Errorf("schema_version = %d, want 1", doc.SchemaVersion)
	}
	if doc.Version == "" {
		t.Error("version is empty, want non-empty")
	}
	if doc.Root.Name != "run-kit" {
		t.Errorf("root.name = %q, want %q", doc.Root.Name, "run-kit")
	}
	if doc.Root.Path != "run-kit" {
		t.Errorf("root.path = %q, want %q", doc.Root.Path, "run-kit")
	}
	if len(doc.Root.Commands) == 0 {
		t.Error("root.commands is empty, want visible subcommands captured")
	}
}

func TestBuildDumpVersionFromBinary(t *testing.T) {
	// Version must flow from the binary's version var (via displayVersion),
	// not be a hardcoded literal — so an ldflags override propagates.
	want := displayVersion()
	doc := buildDump(rootCmd, want)
	if doc.Version != want {
		t.Errorf("version = %q, want displayVersion() = %q", doc.Version, want)
	}
}

// TestBuildDumpOmitsCapturedAt pins the help-dump standard's "do not emit
// captured_at" rule: the capture timestamp is owned by the shll.ai puller, so
// the tool's envelope MUST be exactly {tool, version, schema_version, root}.
func TestBuildDumpOmitsCapturedAt(t *testing.T) {
	doc := buildDump(rootCmd, "dev")
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal dump: %v", err)
	}

	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	if _, ok := envelope["captured_at"]; ok {
		t.Error("envelope contains captured_at — the standard reserves it for the shll.ai puller")
	}
	wantKeys := map[string]bool{"tool": true, "version": true, "schema_version": true, "root": true}
	for k := range envelope {
		if !wantKeys[k] {
			t.Errorf("unexpected envelope key %q — shape must be exactly {tool, version, schema_version, root}", k)
		}
	}
	for k := range wantKeys {
		if _, ok := envelope[k]; !ok {
			t.Errorf("missing required envelope key %q", k)
		}
	}
}

func TestCaptureNodeFilteringSynthetic(t *testing.T) {
	n := captureNode(syntheticTree())

	if _, ok := childByName(n, "completion"); ok {
		t.Error("completion subcommand should be filtered out")
	}
	if _, ok := childByName(n, "help"); ok {
		t.Error("help subcommand should be filtered out")
	}
	if _, ok := childByName(n, "secret"); ok {
		t.Error("hidden parent should be filtered out (whole subtree dropped)")
	}

	group, ok := childByName(n, "group")
	if !ok {
		t.Fatal("visible parent 'group' should be present")
	}
	// Full-depth recursion: the visible grandchild is captured.
	if _, ok := childByName(group, "leaf"); !ok {
		t.Error("visible nested child 'leaf' should be captured to full depth")
	}
	// A hidden child of a visible parent is dropped individually.
	if _, ok := childByName(group, "buried"); ok {
		t.Error("hidden nested child 'buried' should be filtered out individually")
	}
}

func TestCaptureNodeLeafCommandsIsEmptyArrayNotNull(t *testing.T) {
	n := captureNode(syntheticTree())
	group, ok := childByName(n, "group")
	if !ok {
		t.Fatal("'group' should be present")
	}
	leaf, ok := childByName(group, "leaf")
	if !ok {
		t.Fatal("'leaf' should be present")
	}
	if leaf.Commands == nil {
		t.Error("leaf.Commands is nil, want non-nil empty slice")
	}

	// The marshaled JSON for a leaf must contain "commands":[] not
	// "commands":null.
	data, err := json.Marshal(leaf)
	if err != nil {
		t.Fatalf("marshal leaf: %v", err)
	}
	js := string(data)
	if !strings.Contains(js, `"commands":[]`) {
		t.Errorf("leaf JSON should contain \"commands\":[], got: %s", js)
	}
	if strings.Contains(js, `"commands":null`) {
		t.Errorf("leaf JSON should NOT contain \"commands\":null, got: %s", js)
	}
}

func TestCaptureNodeRealTreeSelfExcludesAndDepth(t *testing.T) {
	n := captureNode(rootCmd)

	// help-dump is Hidden, so it self-excludes from its own dump.
	if _, ok := childByName(n, "help-dump"); ok {
		t.Error("help-dump should self-exclude (Hidden) from the dump")
	}
	// Cobra's generated completion/help excluded from the real tree too.
	if _, ok := childByName(n, "completion"); ok {
		t.Error("completion should be excluded from the real tree")
	}
	if _, ok := childByName(n, "help"); ok {
		t.Error("help should be excluded from the real tree")
	}

	// A genuine nested command (daemon) is captured to full depth with
	// children (start/stop/restart/status).
	daemon, ok := childByName(n, "daemon")
	if !ok {
		t.Fatal("daemon should be present in the real tree")
	}
	if len(daemon.Commands) == 0 {
		t.Error("daemon.commands should be captured to full depth (non-empty)")
	}
	if _, ok := childByName(daemon, "status"); !ok {
		t.Error("daemon should have its 'status' subcommand captured")
	}
}

func TestNodeFieldsCapturedFromCobra(t *testing.T) {
	n := captureNode(rootCmd)
	if n.Path != rootCmd.CommandPath() {
		t.Errorf("path = %q, want %q", n.Path, rootCmd.CommandPath())
	}
	if n.Short != rootCmd.Short {
		t.Errorf("short = %q, want %q", n.Short, rootCmd.Short)
	}
	if n.Usage != rootCmd.UseLine() {
		t.Errorf("usage = %q, want %q", n.Usage, rootCmd.UseLine())
	}
	// text is the raw UsageString, byte-for-byte.
	if n.Text != rootCmd.UsageString() {
		t.Error("text should be the raw UsageString, byte-for-byte")
	}
}
