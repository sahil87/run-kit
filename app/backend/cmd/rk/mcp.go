package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"rk/internal/mcp"

	"github.com/spf13/cobra"
)

// rk mcp — serve run-kit's MCP tools over stdio (docs/specs/mcp.md §
// Transports). A transport verb typed into connector configs (the Claude
// Desktop connector command is `ssh <box> rk mcp`), not by humans: stdout is
// the protocol channel, nothing but protocol may be written to it, and every
// diagnostic goes to stderr. Every tool is exactly one allowlisted rk verb
// invocation executed as an argv child of this same binary (Principle 8); the
// allowlist is internal/mcp's compiled-in policy table. The server's
// instructions are the core skill bundle, verbatim from the embed.
var mcpCmd = &cobra.Command{
	Use:   "mcp",
	Short: "Serve run-kit's MCP tools over stdio (connector command: ssh <box> rk mcp)",
	Long: "Serve run-kit's MCP (Model Context Protocol) tools over stdio — an " +
		"allowlisted proxy over rk verbs for chat clients with no shell on the box " +
		"(Claude Desktop connector command: `ssh <box> rk mcp`). Every tool is exactly " +
		"one rk verb invocation; the tool list is the compiled-in policy table " +
		"(docs/specs/mcp.md). stdout is the protocol channel — all diagnostics go to " +
		"stderr.",
	Args:         usageArgs(cobra.NoArgs),
	SilenceUsage: true,
	RunE:         runMCP,
}

func runMCP(cmd *cobra.Command, _ []string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	server, err := mcp.New(mcp.Config{
		Root:         rootCmd,
		Exe:          exe,
		Version:      displayVersion(),
		Instructions: string(skillBundle),
		Logger:       slog.New(slog.NewTextHandler(cmd.ErrOrStderr(), nil)),
	})
	if err != nil {
		// The drift guard fired at runtime: exit 1 naming the offending row.
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return server.RunStdio(ctx)
}
