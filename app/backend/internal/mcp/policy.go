// Package mcp implements run-kit's MCP (Model Context Protocol) surface: a
// mechanical, allowlisted proxy over existing rk verbs (docs/specs/mcp.md).
// Every tool is exactly one verb invocation executed as an argv child process;
// the compiled-in policy Table is the only thing that exposes a verb. The
// package is transport-agnostic — rk mcp hosts it over stdio; nothing here may
// assume stdio (the daemon's /mcp route reuses New).
//
// The MCP SDK is imported under the mcpsdk alias because this package's own
// name collides with it.
package mcp

import "time"

// ToolTimeoutCap bounds every tool call's subprocess (docs/specs/mcp.md
// § Timeout contract: desktop MCP clients time out well under a minute). A row
// with Timeout 0 uses the cap; a row above the cap fails Resolve.
const ToolTimeoutCap = 45 * time.Second

// ArgType is the JSON-schema type of one tool input.
type ArgType int

const (
	ArgString ArgType = iota
	ArgInteger
	ArgBoolean
)

// ResultKind selects how a verb's stdout becomes MCP content.
type ResultKind int

const (
	// ResultJSON parses the --json envelope, falling back to a bare JSON
	// document (the interim form) and then to text.
	ResultJSON ResultKind = iota
	// ResultText returns stdout verbatim and maps exit code to isError.
	ResultText
	// ResultImage reads the PNG at the path the verb printed on stdout.
	ResultImage
)

// Annotations carries the MCP tool annotations as plain bools; server
// construction maps them onto the SDK's pointer fields.
type Annotations struct {
	ReadOnly    bool
	Destructive bool
	Idempotent  bool
	OpenWorld   bool
}

// Arg maps one tool input onto argv. Exactly one of Flag / Positional /
// Literal applies; an input with none of them (e.g. send's message) exists
// only in the schema and travels on stdin when named by Row.Stdin.
type Arg struct {
	Name        string   // input property name; "" for Literal
	Flag        string   // "-L", "--all", "-l" — mapped as flag [value]
	Positional  int      // 1-based positional slot (mutually exclusive with Flag)
	Literal     string   // fixed argv token appended in order ("--json", "-")
	Type        ArgType  // String | Integer | Boolean
	Required    bool     //
	Pattern     string   // JSON-schema pattern (strings)
	Enum        []string // closed set (strings)
	Minimum     *int     // integers
	Maximum     *int
	Description string // "" ⇒ the flag's pflag Usage string (positional args need one)
}

// Row is one allowlisted tool. The table is compiled in; a verb with no row is
// not a tool.
type Row struct {
	Tool        string        // MCP tool name — snake_case, unique, stable
	Path        string        // Cobra command path ("mux capture"); MUST resolve at startup
	Args        []Arg         // ordered input → argv mapping
	Stdin       string        // name of a string input streamed on stdin ("" = none)
	Result      ResultKind    // ResultJSON | ResultText | ResultImage
	Annotations Annotations   // ReadOnly, Destructive, Idempotent, OpenWorld
	Timeout     time.Duration // 0 ⇒ ToolTimeoutCap; MUST be ≤ ToolTimeoutCap (test-enforced)
	Description string        // "" ⇒ Cobra Short + "\n\n" + Long
}

// neverTools are command paths that MUST NOT gain a policy row
// (docs/specs/mcp.md § Never tools). Matched as a prefix of a row's Path, so
// "daemon" covers every daemon member. Tier-two verbs are not listed — they
// are simply not seeded yet.
var neverTools = []string{
	"serve",
	"daemon",
	"remote",
	"desktop",
	"update",
	"agent setup",
	"agent hook",
	"mux guard",
	"mux init-conf",
	"completion",
	"shell-init",
	"help-dump",
	"skill",
	"role",
	"tutorial",
	"cron tick",
	"gui supervise",
	"gui env",
	"mcp",
}

// readOnlyAnn is the annotation set of every See row.
var readOnlyAnn = Annotations{ReadOnly: true, Destructive: false, Idempotent: true, OpenWorld: false}

// Shared inputs. serverArg maps onto the mux/tab/cron families' persistent
// -L flag; its description defaults to the flag's pflag usage at schema
// generation. targetArg and windowArg are positional, so they carry their own
// descriptions (there is no pflag usage to inherit).
var (
	serverArg = Arg{Name: "server", Flag: "-L", Type: ArgString}
	targetArg = Arg{
		Name: "target", Positional: 1, Type: ArgString, Required: true,
		Pattern:     `^(%\d+|@\d+|=.+:.+)$`,
		Description: "The pane or window to address: %N (pane), @N (window — resolves to its agent pane), or =session:window (exact)",
	}
	windowArg = Arg{
		Name: "window", Positional: 1, Type: ArgString, Required: true,
		Pattern:     `^@\d+$`,
		Description: "The tab to address, by window id (@N)",
	}
	jsonLiteral = Arg{Literal: "--json"}
)

func intPtr(n int) *int { return &n }

// statusDescription overrides `status`'s Cobra help because the verb
// hard-codes the runkit server and its help does not say so — terminal prose
// that would mislead a model (docs/specs/mcp.md § Policy table rules).
const statusDescription = "Session summary of the `runkit` tmux server only (the verb takes no server flag); use `sessions`/`panes` for any other server."

// sendDescription overrides `mux send`'s Cobra help because the interim text
// receipt misleads a model: `delivered %N` is the injection engine's
// submission verification, not an acknowledgment from the agent.
const sendDescription = "Deliver a message into an agent's pane through run-kit's injection engine, gated on the pane's agent state (idle sends; waiting and active refuse; unknown warns and sends). Result is the verb's report line: `delivered %N` means the engine verified the text was submitted — it does NOT mean the agent has acted on it; read the pane with `capture` to see the effect. `staged`/`sent` do not occur through this tool. A refusal or `unverified %N` is returned as an error with the verb's diagnostic. `--force`, `--answer`, `--key`, and `--await` are not exposed."

// boardDescription overrides `board`'s Cobra help — the family Long is
// terminal prose; the row description names each action's required inputs and
// the receipt shapes (docs/specs/mcp.md § New verb families).
const boardDescription = "List boards and pin/unpin/reorder windows on the cross-server board dashboards; rides the daemon, so rk serve must be up. Actions: `show` lists boards (no `name`) or one board's pinned windows (with `name`); `pin`, `unpin`, and `reorder` mutate and require `name` and `window`. `server` applies to the three mutations and defaults to `default`. `before`/`after` are reorder-only neighbour window ids (@N); passing neither appends. The result is the route body for `show` (a bare JSON array) or a {board, window, orderKey?} receipt for the mutations (orderKey on reorder only)."

// operatorTemplateIDs is the closed template registry's id set, mirrored here
// because internal/mcp must not import rk/api (the daemon's /mcp route would
// close an import cycle). cmd/rk's TestOperatorRequestEnumMatchesRegistry pins
// it to api.OperatorTemplateList(); a registry edit that forgets this list
// fails the build.
var operatorTemplateIDs = []string{
	"annotate-tab", "brief-me", "color-tabs", "find-discussion", "fix-tab-name",
	"spawn-task", "update-annotations", "user-message", "whats-stuck",
}

// operatorRequestDescription overrides `operator request`'s Cobra help for the
// model: the conditional-window rule and the acceptor postures are what a
// model needs to call the tool correctly, and the queued receipt's meaning is
// not obvious from a report word.
const operatorRequestDescription = "Hand the server's operator agent a templated work item through run-kit's operator-request lane (the same closed registry the dashboard's operator actions use). Window-scoped templates (fix-tab-name, annotate-tab, user-message) REQUIRE `window`; every other template is server-scoped and REJECTS it. `text` is accepted only by spawn-task, find-discussion, and user-message; `session` only by update-annotations. A busy operator queues the request and the result reports `queued:true` — the work is not lost, it drains when the operator goes idle (user-message skips the gate and is never queued). whats-stuck refuses when nothing on the server is waiting. The verb's `--list` is the source of truth for the template set and its flags."

// Table is the compiled-in policy table — the allowlist (docs/specs/mcp.md
// § Policy table). Seeded with the verbs that are already MCP-shaped: the nine
// structured-today read verbs ride result: json on their existing bare
// documents until the --json envelope lands, send rides result: text on its
// report-word receipt, and board rides result: json on its route bodies
// (show) and {board, window, orderKey?} receipts (pin/unpin/reorder).
var Table = []Row{
	{
		Tool: "sessions", Path: "mux sessions",
		Args:        []Arg{serverArg, {Name: "all", Flag: "--all", Type: ArgBoolean}, jsonLiteral},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
	},
	{
		Tool: "panes", Path: "mux panes",
		Args:        []Arg{serverArg, jsonLiteral},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
	},
	{
		Tool: "capture", Path: "mux capture",
		Args: []Arg{
			serverArg,
			{Name: "lines", Flag: "-l", Type: ArgInteger, Minimum: intPtr(1), Maximum: intPtr(2000)},
			targetArg,
			jsonLiteral,
		},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
	},
	{
		Tool: "process", Path: "mux process",
		Args:        []Arg{serverArg, targetArg, jsonLiteral},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
	},
	{
		Tool: "status", Path: "status",
		Args:        []Arg{jsonLiteral},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
		Description: statusDescription,
	},
	{
		Tool: "cron_list", Path: "cron list",
		Args:        []Arg{serverArg, jsonLiteral},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
	},
	{
		Tool: "gui_status", Path: "gui status",
		Args:        []Arg{jsonLiteral},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
	},
	{
		Tool: "tab_show", Path: "tab show",
		Args:        []Arg{serverArg, windowArg, jsonLiteral},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
	},
	{
		Tool: "tab_web_ls", Path: "tab web ls",
		Args:        []Arg{serverArg, windowArg, jsonLiteral},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
	},
	{
		Tool: "send", Path: "mux send",
		Args: []Arg{
			serverArg,
			targetArg,
			{Name: "message", Type: ArgString, Required: true, Description: "The text to deliver; submitted with Enter"},
			{Literal: "-"},
		},
		Stdin:       "message",
		Result:      ResultText,
		Annotations: Annotations{},
		Description: sendDescription,
	},
	{
		// The one action-enum row besides tab_web: the parent path carries the
		// flags (BuildArgv emits them before positionals), so -L/--json/
		// --before/--after MUST be persistent on the board command — defining
		// them on a child fails this drift guard.
		Tool: "board", Path: "board",
		Args: []Arg{
			serverArg,
			{Name: "action", Positional: 1, Type: ArgString, Required: true,
				Enum:        []string{"show", "pin", "unpin", "reorder"},
				Description: "show lists boards (no name) or one board's entries (with name); pin/unpin/reorder mutate and require name and window"},
			{Name: "name", Positional: 2, Type: ArgString, Pattern: `^[A-Za-z0-9_-]{1,32}$`,
				Description: "Board name; optional for show, required for pin/unpin/reorder"},
			{Name: "window", Positional: 3, Type: ArgString, Pattern: `^@\d+$`,
				Description: "The window to pin/unpin/reorder, by window id (@N); required for the three mutations"},
			{Name: "before", Flag: "--before", Type: ArgString, Pattern: `^@\d+$`},
			{Name: "after", Flag: "--after", Type: ArgString, Pattern: `^@\d+$`},
			jsonLiteral,
		},
		Result:      ResultJSON,
		Annotations: Annotations{}, // mixed read/write tool: no hints
		Description: boardDescription,
	},
	{
		Tool: "operator_request", Path: "operator request",
		Args: []Arg{
			serverArg,
			{Name: "template", Positional: 1, Type: ArgString, Required: true, Enum: operatorTemplateIDs,
				Description: "The operator template id (closed registry; see the tool description for which take window/text/session)"},
			{Name: "window", Flag: "--window", Type: ArgString, Pattern: `^@\d+$`},
			{Name: "text", Flag: "--text", Type: ArgString},
			{Name: "session", Flag: "--session", Type: ArgString},
			jsonLiteral,
		},
		Result:      ResultJSON,
		Annotations: Annotations{}, // Talk row: no annotations (spec allowlist "—")
		Description: operatorRequestDescription,
	},
}
