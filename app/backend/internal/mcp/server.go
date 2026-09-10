package mcp

import (
	"context"
	"log/slog"
	"sort"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/spf13/cobra"
)

// Config carries everything internal/mcp needs from its host (cmd/rk): the
// Cobra tree is introspected, never executed (Principle 8); Exe is the rk
// binary the executor spawns; Instructions is the core skill bundle verbatim.
// A zero Table defaults to the compiled-in allowlist.
type Config struct {
	Root         *cobra.Command
	Exe          string
	Version      string
	Instructions string
	Table        []Row
	Logger       *slog.Logger // stderr; stdout is the wire
}

// Server wraps the SDK server with the resolved policy table and the executor.
// It holds no state beyond the SDK session (Constitution II) and nothing in it
// assumes stdio — the daemon's /mcp route reuses New.
type Server struct {
	sdk      *mcpsdk.Server
	executor Executor
	resolved []Resolved
}

// New resolves the table against the Cobra tree (the startup drift guard) and
// registers exactly one tool per row. A resolution failure is an error naming
// the offending row.
func New(cfg Config) (*Server, error) {
	table := cfg.Table
	if table == nil {
		table = Table
	}
	resolved, err := Resolve(cfg.Root, table)
	if err != nil {
		return nil, err
	}
	sdkServer := mcpsdk.NewServer(
		&mcpsdk.Implementation{Name: "run-kit", Version: cfg.Version},
		&mcpsdk.ServerOptions{Instructions: cfg.Instructions, Logger: cfg.Logger},
	)
	s := &Server{sdk: sdkServer, executor: Executor{Exe: cfg.Exe}, resolved: resolved}
	for _, res := range resolved {
		res := res
		sdkServer.AddTool(&mcpsdk.Tool{
			Name:        res.Row.Tool,
			Description: ToolDescription(res),
			InputSchema: InputSchema(res),
			Annotations: toolAnnotations(res.Row.Annotations),
		}, s.handler(res))
	}
	return s, nil
}

// handler is the closure registered for one row: validate arguments (never
// exec an invalid call), build argv, run the verb, map the outcome.
func (s *Server) handler(res Resolved) mcpsdk.ToolHandler {
	row := res.Row
	return func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		args, err := ValidateArgs(row, req.Params.Arguments)
		if err != nil {
			return errorText(err.Error()), nil
		}
		stdin := ""
		if row.Stdin != "" {
			stdin, _ = args[row.Stdin].(string)
		}
		timeout := row.Timeout
		if timeout == 0 {
			timeout = ToolTimeoutCap
		}
		out := s.executor.Run(ctx, BuildArgv(row, args), stdin, timeout)
		return MapResult(row.Tool, row, timeout, out), nil
	}
}

// RunStdio serves the MCP protocol on stdin/stdout until the context is
// cancelled or the client disconnects.
func (s *Server) RunStdio(ctx context.Context) error {
	return s.sdk.Run(ctx, &mcpsdk.StdioTransport{})
}

// Tools returns the sorted tool names — for the doctor row and tests.
func (s *Server) Tools() []string {
	names := make([]string, 0, len(s.resolved))
	for _, res := range s.resolved {
		names = append(names, res.Row.Tool)
	}
	sort.Strings(names)
	return names
}

// toolAnnotations maps the row's plain-bool annotations onto the SDK's shape
// (pointer fields for Destructive/OpenWorld so every hint is explicit on the
// wire — a client drives its confirmation UX off destructiveHint).
func toolAnnotations(a Annotations) *mcpsdk.ToolAnnotations {
	return &mcpsdk.ToolAnnotations{
		ReadOnlyHint:    a.ReadOnly,
		DestructiveHint: &a.Destructive,
		IdempotentHint:  a.Idempotent,
		OpenWorldHint:   &a.OpenWorld,
	}
}
