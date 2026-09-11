package main

// rk board — the shell door onto the five board routes (docs/specs/mcp.md
// § New verb families): show lists boards or one board's entries, and
// pin/unpin/reorder mutate membership. Unlike the rk tab family this one
// needs rk serve up — pin/unpin/reorder carry cross-server semantics and the
// board-changed SSE broadcast lives in api/boards.go, so the CLI wraps the
// routes (one bounded HTTP call per verb) rather than reimplementing them.
//
// The four shared flags (-L/--server, --json, --before, --after) are
// PERSISTENT on the parent — load-bearing placement: the MCP policy row
// resolves flags against the row's Path (the parent) and BuildArgv emits
// flags before positionals, so every flag the row uses must parse on every
// child. Children that do not use --before/--after reject them at run time
// as usage errors instead.
//
// NOT fail-silent (unlike notify): a pin that did not happen must say so —
// transport errors and daemon non-2xx exit 1 with a message. Exit codes
// follow the toolkit convention: 0 ok, 1 operational (daemon unreachable or
// daemon-reported error), 2 usage (bad board name, malformed window id or
// neighbour, --before/--after off reorder, arg counts). Stdout is data via
// sink.Dataf (survives --quiet); nothing is written to stdout on failure.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"text/tabwriter"
	"time"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// boardHTTPTimeout bounds the one request each verb makes. show <name> joins
// each entry with a per-server ListWindows daemon-side, so it gets more room
// than notify's 8s.
const boardHTTPTimeout = 10 * time.Second

// boardHTTPClient is the HTTP seam (the present*Fn / roleRunOutputFn idiom):
// tests point the verbs at an httptest server via pointConfigAt and may swap
// the client to observe or fail requests.
var boardHTTPClient = http.DefaultClient

var (
	boardServerFlag string
	boardJSONFlag   bool
	boardBeforeFlag string
	boardAfterFlag  string
)

var boardCmd = &cobra.Command{
	Use:   "board",
	Short: "List boards and pin/unpin/reorder windows on them (needs rk serve up)",
	Long: "Drive the cross-server board dashboards from the shell — a thin door onto\n" +
		"the daemon's board routes, so this family needs rk serve up (unlike rk tab,\n" +
		"which is substrate-only).\n\n" +
		"Subcommands:\n" +
		"  show     List boards, or one board's pinned windows\n" +
		"  pin      Pin a window to a board\n" +
		"  unpin    Remove a window from a board\n" +
		"  reorder  Move a pinned window within a board\n\n" +
		"See 'rk board <subcommand> --help' for details.",
}

var boardShowCmd = &cobra.Command{
	Use:   "show [name] [--json]",
	Short: "List boards, or one board's pinned windows",
	Long: "List boards (one name<TAB>pinCount row each, in the dashboard's display\n" +
		"order) or, with a name, one board's pinned windows (windowId, server,\n" +
		"session, windowIndex, windowName, pane count — in orderKey order).\n" +
		"An empty list prints nothing and exits 0. --json prints the route body\n" +
		"verbatim. -L is accepted and ignored: the list aggregates across servers.",
	Args:         cobra.MaximumNArgs(1),
	SilenceUsage: true,
	RunE:         runBoardShow,
}

var boardPinCmd = &cobra.Command{
	Use:   "pin <name> <@N|=session:window> [--json]",
	Short: "Pin a window to a board",
	Long: "Pin a window to a board; the board is created implicitly on first pin.\n" +
		"The window addresses as @N or =session:window exactly as in rk tab; -L\n" +
		"names the tmux server the window lives on (default: the caller's own\n" +
		"server from $TMUX, else the default server). Prints 'pinned @N to <name>';\n" +
		"--json prints {\"board\",\"window\"}.",
	Args:         cobra.ExactArgs(2),
	SilenceUsage: true,
	RunE:         runBoardPin,
}

var boardUnpinCmd = &cobra.Command{
	Use:   "unpin <name> <@N|=session:window> [--json]",
	Short: "Remove a window from a board",
	Long: "Remove a window from a board; the window stays alive in its home\n" +
		"session. The window addresses as @N or =session:window exactly as in\n" +
		"rk tab; -L names the tmux server the window lives on. Prints\n" +
		"'unpinned @N from <name>'; --json prints {\"board\",\"window\"}.",
	Args:         cobra.ExactArgs(2),
	SilenceUsage: true,
	RunE:         runBoardUnpin,
}

var boardReorderCmd = &cobra.Command{
	Use:   "reorder <name> <@N|=session:window> [--before @N] [--after @N] [--json]",
	Short: "Move a pinned window within a board",
	Long: "Move a pinned window within a board. --before/--after name neighbour\n" +
		"windows by id (@N only — the API takes window ids, so =session:window\n" +
		"does not resolve here); passing neither appends, passing both places the\n" +
		"window between them. Prints 'reordered @N on <name> → <orderKey>';\n" +
		"--json prints {\"board\",\"window\",\"orderKey\"}.",
	Args:         cobra.ExactArgs(2),
	SilenceUsage: true,
	RunE:         runBoardReorder,
}

func init() {
	boardCmd.PersistentFlags().StringVarP(&boardServerFlag, "server", "L", "",
		"tmux server name the window lives on (default: the caller's own server from $TMUX, else the default server); applies to pin/unpin/reorder")
	boardCmd.PersistentFlags().BoolVar(&boardJSONFlag, "json", false,
		"Print the route body (show) or the {board, window[, orderKey]} receipt as JSON")
	boardCmd.PersistentFlags().StringVar(&boardBeforeFlag, "before", "",
		"reorder only: place the window before this neighbour (@N)")
	boardCmd.PersistentFlags().StringVar(&boardAfterFlag, "after", "",
		"reorder only: place the window after this neighbour (@N); neither flag appends")
	boardCmd.AddCommand(boardShowCmd)
	boardCmd.AddCommand(boardPinCmd)
	boardCmd.AddCommand(boardUnpinCmd)
	boardCmd.AddCommand(boardReorderCmd)

	// Arg-count violations on the family's members are usage-class (exit 2).
	// root.go's central wrap loop covers only rootCmd's direct children, so
	// the family wraps its own (the tab.go init idiom).
	for _, c := range boardCmd.Commands() {
		if c.Args != nil {
			c.Args = usageArgs(c.Args)
		}
	}
}

// boardMutationBody / boardReorderBody mirror the request-body contract of
// api/boards.go (pinRequestBody / reorderRequestBody): before/after are
// *string so an absent neighbour serializes as JSON null, the route's
// prepend/append sentinel.
type boardMutationBody struct {
	Server   string `json:"server"`
	WindowID string `json:"windowId"`
}

type boardReorderBody struct {
	Server   string  `json:"server"`
	WindowID string  `json:"windowId"`
	Before   *string `json:"before"`
	After    *string `json:"after"`
}

// boardEntryRow mirrors api.BoardEntryResponse for the human show <name> path
// (Panes decodes only for its count). The --json path never decodes — it
// passes the body through byte-for-byte.
type boardEntryRow struct {
	Server      string            `json:"server"`
	WindowID    string            `json:"windowId"`
	Session     string            `json:"session"`
	WindowIndex int               `json:"windowIndex"`
	WindowName  string            `json:"windowName"`
	OrderKey    string            `json:"orderKey"`
	Panes       []json.RawMessage `json:"panes"`
}

// boardRequest sends one bounded request to resolveOrigin(ctx)+path and
// returns the response body. A transport error or timeout maps to the
// unreachable-daemon message; a non-2xx maps to the body's "error" string
// verbatim, falling back to a status-named message when the body carries
// none. All daemon errors are operational (exit 1).
func boardRequest(ctx context.Context, method, path string, body any) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, boardHTTPTimeout)
	defer cancel()
	origin := resolveOrigin(ctx)

	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("board: encode request body: %w", err)
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, origin+path, reader)
	if err != nil {
		return nil, fmt.Errorf("board: build %s %s request: %w", method, path, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := boardHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("board: run-kit daemon unreachable at %s — is rk serve running?", origin)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("board: read %s %s response: %w", method, path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var doc struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &doc) == nil && doc.Error != "" {
			return nil, errors.New(doc.Error)
		}
		return nil, fmt.Errorf("board: %s %s returned %s", method, path, resp.Status)
	}
	return data, nil
}

// rejectBoardReorderFlags is the run-time guard balancing the persistent-flag
// placement: --before/--after parse on every child but mean something only on
// reorder.
func rejectBoardReorderFlags() error {
	if boardBeforeFlag != "" || boardAfterFlag != "" {
		return usageError(errors.New("--before/--after apply to reorder only"))
	}
	return nil
}

// validBoardNameArg validates the <name> positional before it reaches a URL
// path (Constitution I) — a bad name is usage (exit 2), never a request.
func validBoardNameArg(name string) error {
	if !tmux.ValidBoardName(name) {
		return usageError(fmt.Errorf("invalid board name %q", name))
	}
	return nil
}

func runBoardShow(cmd *cobra.Command, args []string) error {
	if err := rejectBoardReorderFlags(); err != nil {
		return err
	}
	name := ""
	if len(args) == 1 {
		name = args[0]
		if err := validBoardNameArg(name); err != nil {
			return err
		}
	}
	path := "/api/boards"
	if name != "" {
		path += "/" + name
	}
	body, err := boardRequest(tabContext(cmd), http.MethodGet, path, nil)
	if err != nil {
		return err
	}

	sink := newSink(cmd)
	if boardJSONFlag {
		// Byte-for-byte pass-through (no re-marshal): a daemon-side field
		// addition arrives without a CLI release.
		sink.Dataf("%s\n", body)
		return nil
	}

	if name == "" {
		var boards []tmux.BoardSummary
		if err := json.Unmarshal(body, &boards); err != nil {
			return fmt.Errorf("board: decode daemon response: %w", err)
		}
		if len(boards) == 0 {
			return nil
		}
		var buf strings.Builder
		tw := tabwriter.NewWriter(&buf, 0, 0, 2, ' ', 0)
		for _, b := range boards {
			fmt.Fprintf(tw, "%s\t%d\n", b.Name, b.PinCount)
		}
		if err := tw.Flush(); err != nil {
			return err
		}
		sink.Dataf("%s", buf.String())
		return nil
	}

	var entries []boardEntryRow
	if err := json.Unmarshal(body, &entries); err != nil {
		return fmt.Errorf("board: decode daemon response: %w", err)
	}
	if len(entries) == 0 {
		return nil
	}
	var buf strings.Builder
	tw := tabwriter.NewWriter(&buf, 0, 0, 2, ' ', 0)
	for _, e := range entries {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\t%d\n",
			e.WindowID, e.Server, e.Session, e.WindowIndex, e.WindowName, len(e.Panes))
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	sink.Dataf("%s", buf.String())
	return nil
}

// boardReceipt is the pin/unpin --json receipt (spec § Receipts: orderKey is
// omitted — the pin/unpin routes return none).
type boardReceipt struct {
	Board  string `json:"board"`
	Window string `json:"window"`
}

func runBoardPin(cmd *cobra.Command, args []string) error {
	return runBoardPinLike(cmd, args, "pin")
}

func runBoardUnpin(cmd *cobra.Command, args []string) error {
	return runBoardPinLike(cmd, args, "unpin")
}

// runBoardPinLike is the shared body of pin and unpin — identical validation,
// resolution, body shape, and receipt; only the route's last segment and the
// report line differ.
func runBoardPinLike(cmd *cobra.Command, args []string, action string) error {
	if err := rejectBoardReorderFlags(); err != nil {
		return err
	}
	name := args[0]
	if err := validBoardNameArg(name); err != nil {
		return err
	}
	ctx := tabContext(cmd)
	_, windowID, server, err := resolveTabAddr(ctx, args[1], boardServerFlag)
	if err != nil {
		return err
	}
	_, err = boardRequest(ctx, http.MethodPost, "/api/boards/"+name+"/"+action,
		boardMutationBody{Server: server, WindowID: windowID})
	if err != nil {
		return err
	}

	sink := newSink(cmd)
	if boardJSONFlag {
		b, err := json.Marshal(boardReceipt{Board: name, Window: windowID})
		if err != nil {
			return fmt.Errorf("board: encode receipt: %w", err)
		}
		sink.Dataf("%s\n", b)
		return nil
	}
	if action == "pin" {
		sink.Dataf("pinned %s to %s\n", windowID, name)
	} else {
		sink.Dataf("unpinned %s from %s\n", windowID, name)
	}
	return nil
}

func runBoardReorder(cmd *cobra.Command, args []string) error {
	name := args[0]
	if err := validBoardNameArg(name); err != nil {
		return err
	}
	// Neighbours are @N window ids only — the API takes ids, so no tmux
	// resolution of =session:window here (unlike the window positional).
	var before, after *string
	if boardBeforeFlag != "" {
		if !tmux.ValidWindowID(boardBeforeFlag) {
			return usageError(fmt.Errorf("invalid --before window id %q: want @N", boardBeforeFlag))
		}
		before = &boardBeforeFlag
	}
	if boardAfterFlag != "" {
		if !tmux.ValidWindowID(boardAfterFlag) {
			return usageError(fmt.Errorf("invalid --after window id %q: want @N", boardAfterFlag))
		}
		after = &boardAfterFlag
	}
	ctx := tabContext(cmd)
	_, windowID, server, err := resolveTabAddr(ctx, args[1], boardServerFlag)
	if err != nil {
		return err
	}
	body, err := boardRequest(ctx, http.MethodPost, "/api/boards/"+name+"/reorder",
		boardReorderBody{Server: server, WindowID: windowID, Before: before, After: after})
	if err != nil {
		return err
	}
	var resp struct {
		NewOrderKey string `json:"newOrderKey"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Errorf("board: decode daemon response: %w", err)
	}

	sink := newSink(cmd)
	if boardJSONFlag {
		receipt := struct {
			Board    string `json:"board"`
			Window   string `json:"window"`
			OrderKey string `json:"orderKey"`
		}{Board: name, Window: windowID, OrderKey: resp.NewOrderKey}
		b, err := json.Marshal(receipt)
		if err != nil {
			return fmt.Errorf("board: encode receipt: %w", err)
		}
		sink.Dataf("%s\n", b)
		return nil
	}
	sink.Dataf("reordered %s on %s → %s\n", windowID, name, resp.NewOrderKey)
	return nil
}
