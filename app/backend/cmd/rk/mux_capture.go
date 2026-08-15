package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"rk/internal/sessions"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk mux capture <target> — capture the last N lines of a pane's scrollback as
// PLAIN text (no -e ANSI escapes — agent-consumable output), with substrate-only
// enrichment: the pane's cwd and its reconciled @rk_agent_state (+ duration).
// fab's change/stage fields are deliberately NOT ported — those are
// choreography facts read from .fab-status.yaml, fab's layer (cli-layering.md
// delegation rule 1). No daemon dependency: tmux is addressed directly from the
// caller's context (the rk present pattern).
//
// Output shapes: default is the header block
//
//	--- pane %5 ---
//	cwd: /home/x/code/repo | agent: idle (5m)
//	---
//	<content>
//
// (the context line joins only the parts that resolved and is omitted entirely
// when empty); --raw prints the captured text only, byte-identical to tmux's
// output; --json emits the metadata wrapper. A duration shows for idle and
// waiting (the rollupAgentState semantics — how long at rest / how long the
// human has been the blocker), never for active. Exit codes follow the toolkit
// convention: 0 success, 1 operational (missing pane, tmux failure), 2 usage.

var (
	muxCaptureLinesFlag int
	muxCaptureJSONFlag  bool
	muxCaptureRawFlag   bool
)

var muxCaptureCmd = &cobra.Command{
	Use:   "capture <target> [-l <lines>] [--json | --raw]",
	Short: "Capture a pane's scrollback with substrate context",
	Long: "Capture the last N lines of the target pane's scrollback (default 50) as " +
		"plain text — no ANSI escapes — enriched with substrate facts only: the " +
		"pane's cwd and its reconciled @rk_agent_state with idle/waiting duration. " +
		"--raw prints the captured text only (byte-identical to tmux's output); " +
		"--json emits the metadata wrapper. The content is never trimmed.\n\n" +
		"Targets: %N (pane), @N (window — resolves to its agent pane), " +
		"=session:window (exact). Bare session:window names are rejected.",
	Example: `  rk mux capture %5
  rk mux capture @3 --lines 200
  rk mux capture %5 --raw
  rk mux capture %5 --json`,
	Args: usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runMuxCapture(cmd, args[0])
	},
}

func init() {
	muxCaptureCmd.Flags().IntVarP(&muxCaptureLinesFlag, "lines", "l", 50,
		"Number of scrollback lines to capture")
	muxCaptureCmd.Flags().BoolVar(&muxCaptureJSONFlag, "json", false,
		"Output as JSON with metadata")
	muxCaptureCmd.Flags().BoolVar(&muxCaptureRawFlag, "raw", false,
		"Output the captured text only, byte-identical to tmux's output")
	muxCaptureCmd.MarkFlagsMutuallyExclusive("json", "raw")
}

// muxCapture*Fn are package-level seams so runMuxCapture can be tested without
// a live tmux server (the mux_send.go pattern); the defaults delegate to
// internal/tmux. muxCaptureNowFn anchors duration math so tests are
// deterministic.
var (
	muxCapturePaneFn = func(ctx context.Context, paneID string, lines int, server string) (string, error) {
		return tmux.CapturePanePlainCtx(ctx, paneID, lines, server)
	}
	muxCaptureFactsFn = func(ctx context.Context, paneID, server string) (tmux.PaneFacts, error) {
		return tmux.PaneFactsCtx(ctx, paneID, server)
	}
	muxCaptureNowFn = func() time.Time { return time.Now() }
)

// muxCaptureJSON is the --json output shape: agent_state and
// agent_state_duration are null when the pane is uninstrumented (or carries no
// duration-bearing state).
type muxCaptureJSON struct {
	Pane               string  `json:"pane"`
	Lines              int     `json:"lines"`
	Content            string  `json:"content"`
	CWD                string  `json:"cwd"`
	AgentState         *string `json:"agent_state"`
	AgentStateDuration *string `json:"agent_state_duration"`
}

// runMuxCapture is the testable core: parse → resolve → capture → enrich →
// render (human / json / raw).
func runMuxCapture(cmd *cobra.Command, target string) error {
	pt, err := tmux.ParsePaneTarget(target)
	if err != nil {
		return usageError(err)
	}
	if muxCaptureLinesFlag < 1 {
		return usageError(fmt.Errorf("--lines must be >= 1"))
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

	content, err := muxCapturePaneFn(ctx, paneID, muxCaptureLinesFlag, server)
	if err != nil {
		return fmt.Errorf("capture-pane: %w", err)
	}

	// --raw is byte-identical to tmux's output — no enrichment, no header.
	if muxCaptureRawFlag {
		sink.Dataf("%s", content)
		return nil
	}

	facts, err := muxCaptureFactsFn(ctx, paneID, server)
	if err != nil {
		return fmt.Errorf("read pane context: %w", err)
	}

	// Duration follows the sessions rollup semantics: meaningful for idle and
	// waiting (epoch > 0), never shown for active.
	var duration string
	if (facts.AgentState == tmux.AgentStateIdle || facts.AgentState == tmux.AgentStateWaiting) && facts.AgentStateEpoch > 0 {
		duration = sessions.FormatAgentDuration(muxCaptureNowFn().Unix() - facts.AgentStateEpoch)
	}

	if muxCaptureJSONFlag {
		out := muxCaptureJSON{
			Pane:    paneID,
			Lines:   muxCaptureLinesFlag,
			Content: content,
			CWD:     facts.CWD,
		}
		if facts.AgentState != "" {
			out.AgentState = &facts.AgentState
		}
		if duration != "" {
			out.AgentStateDuration = &duration
		}
		enc := json.NewEncoder(sink.data)
		enc.SetIndent("", "  ")
		return enc.Encode(out)
	}

	sink.Dataf("--- pane %s ---\n", paneID)
	var parts []string
	if facts.CWD != "" {
		parts = append(parts, "cwd: "+facts.CWD)
	}
	if facts.AgentState != "" {
		state := facts.AgentState
		if duration != "" {
			state += " (" + duration + ")"
		}
		parts = append(parts, "agent: "+state)
	}
	if len(parts) > 0 {
		sink.Dataf("%s\n", strings.Join(parts, " | "))
	}
	sink.Dataf("---\n")
	sink.Dataf("%s", content)
	return nil
}
