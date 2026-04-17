package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"rk/internal/config"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

const tmuxQueryTimeout = 5 * time.Second

var contextCmd = &cobra.Command{
	Use:   "context",
	Short: "Show agent-optimized environment info",
	RunE:  runContext,
}

// tmuxQuery runs a tmux command with a 5s timeout, targeting the pane's own
// tmux server (no -L flag). Returns trimmed stdout or an error.
//
// This does NOT use internal/tmux's execution functions because they add
// -L <server> targeting the managed runkit/default servers. The context
// command needs to query the pane's own tmux server, which could be any
// server. Since internal/tmux's init() strips $TMUX from the process env,
// we restore it in the child process via tmux.OriginalTMUX (captured before
// init() runs).
func tmuxQuery(ctx context.Context, args ...string) (string, error) {
	qctx, cancel := context.WithTimeout(ctx, tmuxQueryTimeout)
	defer cancel()

	cmd := exec.CommandContext(qctx, "tmux", args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr

	// Restore $TMUX in the child process so tmux targets the correct server.
	// internal/tmux init() strips it from the parent process env.
	if tmux.OriginalTMUX != "" {
		cmd.Env = append(os.Environ(), "TMUX="+tmux.OriginalTMUX)
	}

	out, err := cmd.Output()
	if err != nil {
		if stderr.Len() > 0 {
			return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
		}
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// serverURL derives the run-kit server URL via config.Load(), which reads
// RK_HOST/RK_PORT env vars with defaults (127.0.0.1:3000) and port validation.
func serverURL() string {
	cfg := config.Load()
	return fmt.Sprintf("http://%s:%d", cfg.Host, cfg.Port)
}

// writeEnvironment writes the Environment section to the output builder.
// If TMUX_PANE is unset, it shows "(not in tmux)" with just the server URL.
// Individual tmux query failures cause the corresponding field to be omitted.
func writeEnvironment(ctx context.Context, b *strings.Builder) {
	b.WriteString("## Environment\n\n")

	paneID := os.Getenv("TMUX_PANE")
	if paneID == "" {
		b.WriteString("(not in tmux)\n\n")
		b.WriteString(fmt.Sprintf("- **Server URL**: %s\n", serverURL()))
		b.WriteString("\n")
		return
	}

	if session, err := tmuxQuery(ctx, "display-message", "-t", paneID, "-p", "#{session_name}"); err == nil {
		b.WriteString(fmt.Sprintf("- **Session**: %s\n", session))
	}
	if window, err := tmuxQuery(ctx, "display-message", "-t", paneID, "-p", "#{window_name}"); err == nil {
		b.WriteString(fmt.Sprintf("- **Window**: %s\n", window))
	}
	b.WriteString(fmt.Sprintf("- **Pane ID**: %s\n", paneID))
	b.WriteString(fmt.Sprintf("- **Server URL**: %s\n", serverURL()))

	if rkType, err := tmuxQuery(ctx, "show-option", "-w", "-t", paneID, "-v", "@rk_type"); err == nil && rkType != "" {
		b.WriteString(fmt.Sprintf("- **Window type**: %s\n", rkType))
	}

	b.WriteString("\n")
}

// writeCapabilities writes the static Capabilities section.
func writeCapabilities(b *strings.Builder) {
	b.WriteString("## Capabilities\n\n")

	b.WriteString("### Terminal Windows\n\n")
	b.WriteString("Create a new terminal window in the current tmux session:\n\n")
	b.WriteString("```sh\n")
	b.WriteString("tmux new-window -n <name>\n")
	b.WriteString("```\n\n")

	b.WriteString("### Iframe Windows\n\n")
	b.WriteString("Create a window that displays a web page in an iframe instead of a terminal:\n\n")
	b.WriteString("```sh\n")
	b.WriteString("tmux new-window -n <name>\n")
	b.WriteString("tmux set-option -w @rk_type iframe\n")
	b.WriteString("tmux set-option -w @rk_url <url>\n")
	b.WriteString("```\n\n")
	b.WriteString("To change the URL of an existing iframe window:\n\n")
	b.WriteString("```sh\n")
	b.WriteString("tmux set-option -w @rk_url <new-url>\n")
	b.WriteString("```\n\n")

	b.WriteString("### Proxy\n\n")
	b.WriteString("Access local services through the run-kit server using the proxy URL pattern:\n\n")
	b.WriteString("```\n")
	b.WriteString("/proxy/{port}/...\n")
	b.WriteString("```\n\n")
	b.WriteString("For example, a service on port 8080 is available at `/proxy/8080/`.\n\n")

	b.WriteString("### CLI Commands\n\n")
	b.WriteString("**Server**\n\n")
	b.WriteString("- `rk serve` — Start the HTTP server\n")
	b.WriteString("- `rk update` — Update rk to the latest version\n\n")
	b.WriteString("**Workflow**\n\n")
	b.WriteString("- `rk riff` — Create a worktree, tmux window, and Claude Code session\n\n")
	b.WriteString("**Diagnostics**\n\n")
	b.WriteString("- `rk doctor` — Check runtime dependencies\n")
	b.WriteString("- `rk status` — Show tmux session summary\n\n")
	b.WriteString("**Info**\n\n")
	b.WriteString("- `rk context` — Show agent-optimized environment info\n")
	b.WriteString("- `rk init-conf` — Scaffold default tmux.conf and tmux.d/ directory\n\n")
}

// writeConventions writes the static Conventions section.
func writeConventions(b *strings.Builder) {
	b.WriteString("## Conventions\n\n")

	b.WriteString("### Tmux User Options\n\n")
	b.WriteString("- `@rk_type` — Window type: `terminal` (default) or `iframe`. Set via `tmux set-option -w @rk_type <value>`\n")
	b.WriteString("- `@rk_url` — URL for iframe windows. Set via `tmux set-option -w @rk_url <url>`\n\n")

	b.WriteString("### Window Lifecycle\n\n")
	b.WriteString("Killing a tmux window kills the backing process. No separate cleanup is needed.\n\n")

	b.WriteString("### SSE Reactivity\n\n")
	b.WriteString("Changes to tmux window options are detected automatically by the run-kit server via SSE polling. No manual refresh or API call is needed.\n")
}

func runContext(cmd *cobra.Command, _ []string) error {
	ctx := cmd.Context()

	var b strings.Builder

	b.WriteString("# rk context\n\n")

	writeEnvironment(ctx, &b)
	writeCapabilities(&b)
	writeConventions(&b)

	fmt.Fprint(cmd.OutOrStdout(), b.String())
	return nil
}
