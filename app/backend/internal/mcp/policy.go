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
	// When (Literal args only) gates the literal on the named input being
	// present in the call — BuildArgv skips the token when the input is
	// absent. Resolve rejects a When naming no input of the row.
	When string
	// Default (Flag args only, never Boolean) is the argv value BuildArgv
	// emits for the flag when the input is absent; InputSchema surfaces it as
	// the JSON-schema default (a number for Integer args). Resolve rejects a
	// Default on a positional/Literal/Boolean arg and a non-integer Default on
	// an Integer arg.
	Default string
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
	// OneOf lists input names of which exactly one must be present in a call;
	// ValidateArgs rejects zero or two before anything execs. Resolve rejects
	// a member naming no input of the row.
	OneOf []string
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

// sendDescription overrides `mux send`'s Cobra help for the model: it names
// the receipt's fields and keeps the load-bearing caveat — `delivered` is the
// injection engine's submission verification, not an acknowledgment from the
// agent.
const sendDescription = "Deliver a message into an agent's pane through run-kit's injection engine, gated on the pane's agent state (idle sends; waiting and active refuse; unknown warns and sends). The result is the delivery receipt: `report` (`delivered` means the engine verified the text was submitted — it does NOT mean the agent has acted on it; call `await` to wait for the agent's state, or `capture` to read the pane), `target` (the resolved pane id), `server`, and `enter` (true when Enter was sent). Failures return code operational with a `reason`: probe_failure (the paste never echoed; check the pane before resending — a resend would duplicate the staged text), staged_send_failure (text landed but Enter was not sent; press Enter in the pane to submit), submit_unverified (Enter was sent but the pane stayed unchanged; capture the pane before resending). `--force` is not exposed; answering a waiting agent or pressing a key is the `answer` tool."

// answerKeyEnum is the closed key set the answer tool may press (spec
// Allowlist v1: control chords are excluded — interrupting an agent is kill's
// job).
var answerKeyEnum = []string{"Enter", "Escape", "Tab", "Up", "Down", "Left", "Right", "Space", "BSpace", "y", "n", "1", "2", "3", "4", "5", "6", "7", "8", "9"}

// answerDescription overrides `mux send`'s Cobra help for the answer tool:
// the message-vs-key split and the gate posture are what a model needs to call
// it correctly.
const answerDescription = "Reply to a waiting agent or press one key in its pane — the two forms of `mux send`'s answer channel. Pass exactly one of `message` (the reply text for a waiting agent, submitted with Enter; receipt report `delivered`, enter true) or `key` (one tmux key name — for trust prompts, pickers, and menus; receipt report `sent`, enter false). A key press rides the plain gate: a `waiting` agent refuses a bare key (use `message` to reply) and an `active` agent refuses everything — never interrupt a working agent. Gate refusals return the verb's diagnostic as an operational error."

// awaitDescription overrides `mux await`'s Cobra help for the model: the
// report words and the running/re-arm contract are not obvious from terminal
// prose.
const awaitDescription = "Block until an agent pane reaches a state, then report the outcome: `report` is a reached `until` state (`idle`, or `waiting` — the agent is asking a question back; answer it with `answer`), or `running` (the timeout expired — nothing failed; call again to keep waiting). With `ready`, wait for a freshly spawned agent's BOOT readiness instead: `ready` (safe to type into; `detail` is `state` or `echo`), `parked` (a trust dialog or wall — read the pane with `capture` and answer it with `answer`), or `narrow` (the pane is below the 80x20 readiness floor; `detail` carries the WxH geometry — resize or relocate the pane). `until` and `ready` are mutually exclusive. The result also carries `target` (the pane; absent on running) and `elapsed_ms`. The pane dying mid-wait is an operational error with reason `gone`."

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

// snapshotListDescription overrides `mux snapshot list`'s Cobra help: the verb
// has no Long of its own, and the parent's help describes the unexposed
// show/restore subcommands (docs/specs/mcp.md § Policy table rules).
const snapshotListDescription = "List layout-recovery snapshots of tmux servers, newest first. Each row is {server, taken_at, died_at, audited_kill, sessions, windows, history_count}; died_at is null for a live server and set on a died tombstone. `show` and `restore` are not exposed."

// guiShotDescription overrides `gui shot`'s Cobra help because its Long
// promises "the absolute path on stdout" (true only without --json) and names
// three flags this tool does not expose.
const guiShotDescription = "Capture a screenshot of the rk GUI display. Result is an image block (PNG) plus a text block carrying {path, width, height, scale, display}; width/height are the source geometry and scale the applied downscale. `--out`, `--scale`, and `--window` are not exposed — the capture always lands at the verb's temp path and covers the full display."

// Table is the compiled-in policy table — the allowlist (docs/specs/mcp.md
// § Policy table). Seeded with the verbs that are already MCP-shaped: the nine
// structured-today read verbs ride result: json on their existing bare
// documents until the --json envelope lands, send/answer/await ride result:
// json on the mux verbs' --json receipts, and board rides result: json on its
// route bodies (show) and {board, window, orderKey?} receipts
// (pin/unpin/reorder).
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
			jsonLiteral,
		},
		Stdin:       "message",
		Result:      ResultJSON,
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
	{
		// One tool for both answer forms: --answer applies only to the message
		// form (the When literals), so a bare key press rides the plain gate
		// column — a waiting agent refuses it.
		Tool: "answer", Path: "mux send",
		Args: []Arg{
			serverArg,
			targetArg,
			{Name: "message", Type: ArgString, Description: "The reply text for a waiting agent; submitted with Enter (mutually exclusive with key)"},
			{Name: "key", Flag: "--key", Type: ArgString,
				Enum:        answerKeyEnum,
				Description: "One tmux key name to press instead of a message — for trust prompts, pickers, and menus (mutually exclusive with message)"},
			{Literal: "--answer", When: "message"},
			{Literal: "-", When: "message"},
			jsonLiteral,
		},
		Stdin:       "message",
		OneOf:       []string{"message", "key"},
		Result:      ResultJSON,
		Annotations: Annotations{}, // Talk row: no annotations (spec allowlist "—")
		Description: answerDescription,
	},
	{
		// The timeout is structurally clamped to the proxy cap: bounded 1..40
		// by the schema with Default "40" emitted when absent, so the verb
		// always reports running before the 45s deadline (docs/specs/mcp.md
		// § Timeout contract). --any/--file/--after-active/--notify are not
		// exposed (a path, N targets, and no chat-client use).
		Tool: "await", Path: "mux await",
		Args: []Arg{
			serverArg,
			targetArg,
			{Name: "until", Flag: "--until", Type: ArgString,
				Pattern:     `^(idle|waiting|active)(,(idle|waiting|active)){0,2}$`,
				Description: "Comma-separated agent states that end the wait (default idle); waiting wakes when the agent asks a question back"},
			{Name: "timeout", Flag: "--timeout", Type: ArgInteger, Minimum: intPtr(1), Maximum: intPtr(40), Default: "40",
				Description: "Seconds to wait before reporting running (1–40; default 40). On running, call again"},
			{Name: "ready", Flag: "--ready", Type: ArgBoolean,
				Description: "Wait for a freshly spawned agent's BOOT readiness instead of a state: ready | parked (a trust dialog or wall — read the pane and answer it with answer) | narrow (pane below 80x20). Mutually exclusive with until"},
			jsonLiteral,
		},
		Result:      ResultJSON,
		Annotations: readOnlyAnn, // read-only even though it blocks
		Description: awaitDescription,
	},
	{
		// No serverArg: the verb rejects the inherited -L at runtime while the
		// drift guard would still resolve it — the positional filter is the
		// only server input. The pattern mirrors ValidateServerName
		// (serverNamePattern + MaxServerNameLength).
		Tool: "snapshot_list", Path: "mux snapshot list",
		Args: []Arg{
			{
				Name: "server", Positional: 1, Type: ArgString,
				Pattern:     `^[a-zA-Z0-9_-]{1,64}$`,
				Description: "Only this server's snapshots (live latest + died tombstones); omit for the store-wide list across every server",
			},
			jsonLiteral,
		},
		Result:      ResultJSON,
		Annotations: readOnlyAnn,
		Description: snapshotListDescription,
	},
	{
		// max_width is the only exposed input: --scale is float64 and --window
		// uint64 (both outside the drift guard's type set), and --out is a
		// filesystem path outside the target rule.
		Tool: "gui_shot", Path: "gui shot",
		Args: []Arg{
			{Name: "max_width", Flag: "--max-width", Type: ArgInteger, Minimum: intPtr(1)},
			jsonLiteral,
		},
		Result:      ResultImage,
		Annotations: readOnlyAnn,
		Description: guiShotDescription,
	},
}
