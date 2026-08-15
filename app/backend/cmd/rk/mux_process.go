package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk mux process <target> — discover the process tree running in a pane (the
// pane's shell PID from #{pane_pid}, then its descendants) and print it with a
// per-process classification: agent / node / git / other. Agent-state-aware:
// when the pane's reconciled @rk_agent_state carries a live pid (a 3-segment
// value), the tree node with that PID is classified agent regardless of comm —
// the instrumentation is authoritative, comm heuristics are the fallback.
// `has_agent` is true iff any node classifies agent by either route. No daemon
// dependency (the rk present pattern). Exit codes follow the toolkit
// convention: 0 success, 1 operational (missing pane, tmux failure, discovery
// failure), 2 usage.
//
// Human output:
//
//	Pane %5 (PID 1234)
//	1234 zsh
//	  1250 claude [agent]
//
//	Agent process detected.

var muxProcessJSONFlag bool

var muxProcessCmd = &cobra.Command{
	Use:   "process <target> [--json]",
	Short: "Show the process tree running in a pane",
	Long: "Discover the process tree running in the target pane: the pane's shell " +
		"PID (#{pane_pid}) and its descendants, classified agent / node / git / " +
		"other. A pane whose @rk_agent_state carries a live agent pid has that " +
		"tree node classified agent regardless of its comm — the instrumentation " +
		"is authoritative, comm heuristics are the fallback. Prints the tree, " +
		"plus a trailing `Agent process detected.` when any node classifies " +
		"agent; --json emits the machine-readable shape.\n\n" +
		"Targets: %N (pane), @N (window — resolves to its agent pane), " +
		"=session:window (exact). Bare session:window names are rejected.",
	Example: `  rk mux process %5
  rk mux process %5 --json`,
	Args: usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runMuxProcess(cmd, args[0])
	},
}

func init() {
	muxProcessCmd.Flags().BoolVar(&muxProcessJSONFlag, "json", false,
		"Output as JSON")
}

// processNode is a single process in the discovered tree.
type processNode struct {
	PID            int           `json:"pid"`
	PPID           int           `json:"ppid"`
	Comm           string        `json:"comm"`
	Cmdline        string        `json:"cmdline"`
	Classification string        `json:"classification"`
	Children       []processNode `json:"children"`
}

// muxProcessJSON is the --json output shape.
type muxProcessJSON struct {
	Pane      string        `json:"pane"`
	PanePID   int           `json:"pane_pid"`
	Processes []processNode `json:"processes"`
	HasAgent  bool          `json:"has_agent"`
}

// muxProcess*Fn are package-level seams so runMuxProcess can be tested without
// a live tmux server (the mux_send.go pattern); the defaults delegate to
// internal/tmux / the platform discovery in mux_process_<os>.go.
var (
	muxProcessPanePIDFn = func(ctx context.Context, paneID, server string) (int, error) {
		return tmux.PanePIDCtx(ctx, paneID, server)
	}
	muxProcessFactsFn = func(ctx context.Context, paneID, server string) (tmux.PaneFacts, error) {
		return tmux.PaneFactsCtx(ctx, paneID, server)
	}
	muxProcessDiscoverFn = func(ctx context.Context, pid int) ([]processNode, error) {
		return discoverProcessTree(ctx, pid)
	}
)

// classifyProcess classifies a process by its comm name (lowercased): agent
// for the known agent CLIs, node, git, else other.
func classifyProcess(comm string) string {
	switch strings.ToLower(comm) {
	case "claude", "claude-code", "codex", "gemini", "copilot":
		return "agent"
	case "node":
		return "node"
	case "git", "gh":
		return "git"
	default:
		return "other"
	}
}

// parsePSCmdlines parses `ps -axo pid=,args=` output into a PID→args map.
// Each line is a (right-aligned) numeric PID followed by the full command
// line; pid is numeric-first and the remainder is args, so the parse is
// robust against spaces inside the command line. Lines whose first field is
// not a PID are skipped. Lives in this un-tagged file (consumed by the
// darwin process discovery) so the parsing is unit-testable on every
// platform.
func parsePSCmdlines(out string) map[int]string {
	m := make(map[int]string)
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.SplitN(line, " ", 2)
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		args := ""
		if len(fields) == 2 {
			args = strings.TrimSpace(fields[1])
		}
		m[pid] = args
	}
	return m
}

// markAgentPID reclassifies the tree node carrying the instrumented agent pid
// as agent, regardless of comm — the @rk_agent_state instrumentation is
// authoritative over the comm heuristic table.
func markAgentPID(nodes []processNode, pid int) {
	if pid <= 0 {
		return
	}
	for i := range nodes {
		if nodes[i].PID == pid {
			nodes[i].Classification = "agent"
		}
		markAgentPID(nodes[i].Children, pid)
	}
}

// hasAgentInTree reports whether any node in the tree is classified agent
// (comm-derived or pid-cross-checked).
func hasAgentInTree(nodes []processNode) bool {
	for _, n := range nodes {
		if n.Classification == "agent" {
			return true
		}
		if hasAgentInTree(n.Children) {
			return true
		}
	}
	return false
}

// runMuxProcess is the testable core: parse → resolve → pid → tree →
// cross-check → render (human / json).
func runMuxProcess(cmd *cobra.Command, target string) error {
	pt, err := tmux.ParsePaneTarget(target)
	if err != nil {
		return usageError(err)
	}

	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, muxCmdTimeout)
	defer cancel()

	server := muxServer()
	sink := newSink(cmd)

	paneID, err := resolvePaneTarget(ctx, pt, server)
	if err != nil {
		return err
	}

	pid, err := muxProcessPanePIDFn(ctx, paneID, server)
	if err != nil {
		return fmt.Errorf("get pane PID: %w", err)
	}

	tree, err := muxProcessDiscoverFn(ctx, pid)
	if err != nil {
		return fmt.Errorf("process discovery: %w", err)
	}

	// Agent-state pid cross-check: a reconciled 3-segment @rk_agent_state
	// carries the instrumented agent's live pid — reclassify that node as
	// agent regardless of comm. A failed state read degrades to comm-only
	// classification (the tree is still the data); the pane's existence was
	// already proven by the pid read.
	if facts, ferr := muxProcessFactsFn(ctx, paneID, server); ferr != nil {
		sink.Notef("warning: agent-state read failed (%v) — comm heuristics only\n", ferr)
	} else if facts.AgentState != "" {
		markAgentPID(tree, facts.AgentPID)
	}

	hasAgent := hasAgentInTree(tree)

	if muxProcessJSONFlag {
		out := muxProcessJSON{
			Pane:      paneID,
			PanePID:   pid,
			Processes: tree,
			HasAgent:  hasAgent,
		}
		enc := json.NewEncoder(sink.data)
		enc.SetIndent("", "  ")
		return enc.Encode(out)
	}

	printProcessTree(sink.data, paneID, pid, tree, hasAgent)
	return nil
}

// printProcessTree prints the human-readable process tree.
func printProcessTree(w io.Writer, paneID string, panePID int, nodes []processNode, hasAgent bool) {
	fmt.Fprintf(w, "Pane %s (PID %d)\n", paneID, panePID)
	for _, n := range nodes {
		printProcessNode(w, n, "")
	}
	if hasAgent {
		fmt.Fprintln(w, "\nAgent process detected.")
	}
}

// printProcessNode prints a single process node with indentation; the class
// tag is omitted for `other`.
func printProcessNode(w io.Writer, node processNode, indent string) {
	classification := ""
	if node.Classification != "other" {
		classification = fmt.Sprintf(" [%s]", node.Classification)
	}
	fmt.Fprintf(w, "%s%d %s%s\n", indent, node.PID, node.Comm, classification)
	for _, child := range node.Children {
		printProcessNode(w, child, indent+"  ")
	}
}
