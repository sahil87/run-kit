package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"rk/api"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

// rk operator request — the CLI door onto the daemon's operator-request lane
// (docs/specs/mcp.md § New verb families): a thin client over the two existing
// routes (window-scoped POST /api/windows/{windowId}/operator-request and
// server-scoped POST /api/operator-request) via resolveOrigin — the same door
// notify/present/tab wake use. It adds NO lane: the closed template registry
// (api.OperatorTemplateList — the daemon's own registry, read-only) is the
// single source of truth for --list and for the CLI-side pre-flight scope
// checks, and the daemon's own status codes drive the receipt.
//
// Unlike notify and tab wake this verb is NOT fail-silent: a request is work
// handed over, so an unreachable daemon or a non-2xx is a non-zero exit with a
// message. A busy operator is a SUCCESS — the routes convert the busy gate
// into an enqueue and answer 202, surfaced as queued:true / exit 0 (the lane's
// design: queued work drains when the operator goes idle; it is not refused).
//
// Constitution I: every input is validated before any HTTP call; --text travels
// as an argv flag into a JSON body — never a shell, never stdin.

const (
	// operatorRequestQueuedNote is the one-line stderr chatter emitted beside a
	// 202 receipt — the lane's busy posture explained (queued, drains on idle).
	operatorRequestQueuedNote = "operator is busy; the request is queued and drains when it is idle"
	// operatorRequestDaemonHint is the machine-neutral next step an unreachable
	// daemon carries under --json (spec § Envelope's optional hint).
	operatorRequestDaemonHint = "start it with rk daemon start"
)

// operatorRequestTimeout bounds the POST. The daemon's delivery budget is
// agentSendTotalBudget (4s) plus one FetchSessions; 20s clears it with margin
// and stays under the MCP proxy's 45s ToolTimeoutCap, so the verb always
// answers before the proxy deadline. A var (the tabWakeTimeout idiom) so tests
// can shrink it.
var operatorRequestTimeout = 20 * time.Second

// operatorRequestReceipt is the spec § Receipts success document: exactly
// {"template", "window"?, "queued"} in that field order — window present iff
// the request was window-scoped (echoing --window).
type operatorRequestReceipt struct {
	Template string `json:"template"`
	Window   string `json:"window,omitempty"`
	Queued   bool   `json:"queued"`
}

var (
	operatorRequestWindow  string
	operatorRequestText    string
	operatorRequestSession string
	operatorRequestServer  string
	operatorRequestList    bool
	operatorRequestJSON    bool
)

var operatorRequestCmd = &cobra.Command{
	Use:   "request <template> [--window @N] [--text <t>] [--session <s>] [-L <server>] [--json] | --list [--json]",
	Short: "Hand the server's operator agent a templated work item",
	Long: `Hand the server's operator agent a templated work item through the
operator-request lane — the same closed template registry the dashboard's
operator actions use. The daemon renders the prompt from facts it derives
itself and delivers it through the gated injection engine; there is no reply
channel — the outcome surfaces on the dashboard's normal derive tick.

Window-scoped templates (fix-tab-name, annotate-tab, user-message) REQUIRE
--window @N; every other template is server-scoped and REJECTS --window. --text
is accepted only by spawn-task, find-discussion, and user-message; --session
only by update-annotations. A busy operator QUEUES a non-chat request: the
daemon answers 202 and the receipt reports queued:true (exit 0) — the work
drains when the operator goes idle. user-message (the chat template) skips the
busy gate and is never queued.

--list prints the registry (id, scope, declared flags) and never contacts the
daemon. --json emits exactly one JSON document on stdout: on success the
receipt {"template","window"?,"queued"}; on failure
{"ok":false,"error":{"code","message","hint"?,"reason"?}}.

Flags:
  --window @N     subject window (window-scoped templates only)
  --text <t>      client text (acceptsText templates only)
  --session <s>   fact scope (acceptsSession templates only)
  -L, --server    tmux server (default: the caller's own server from $TMUX)
  --list          print the template registry and exit
  --json          machine-readable envelope on stdout

Examples:
  rk operator request --list
  rk operator request brief-me
  rk operator request fix-tab-name --window @7
  rk operator request spawn-task --text "add retry to the flaky poll"
  rk operator request user-message --window @2 --text "can you check the failing spec?"

Exit codes:
  0  delivered (200) or queued for a busy operator (202)
  1  operational failure (daemon unreachable, 404/409/5xx)
  2  usage error (unknown template, scope/flag violation)`,
	Args:         cobra.ArbitraryArgs, // arity is validated against --list in RunE
	SilenceUsage: true,                // an operational failure prints no usage block
	RunE: func(cmd *cobra.Command, args []string) error {
		return runOperatorRequest(cmd, args)
	},
}

func init() {
	// Flag help carries no backticks — pflag consumes a backtick-quoted span as
	// a metavar name (the mux new --ephemeral defect).
	f := operatorRequestCmd.Flags()
	f.StringVar(&operatorRequestWindow, "window", "", "subject window id @N (required by window-scoped templates, rejected by server-scoped ones)")
	f.StringVar(&operatorRequestText, "text", "", "client text carried into the rendered prompt (acceptsText templates only)")
	f.StringVar(&operatorRequestSession, "session", "", "scope a server-scoped template's facts to one session (acceptsSession templates only)")
	f.StringVarP(&operatorRequestServer, "server", "L", "", "tmux server to address (default: the caller's own server from $TMUX, else default)")
	f.BoolVar(&operatorRequestList, "list", false, "print the closed template registry and exit (no daemon call)")
	f.BoolVar(&operatorRequestJSON, "json", false, "emit the machine-readable envelope (exactly one JSON document on stdout)")
}

// findOperatorTemplate looks an id up in the registry descriptor list.
func findOperatorTemplate(templates []api.OperatorTemplateInfo, id string) *api.OperatorTemplateInfo {
	for i := range templates {
		if templates[i].ID == id {
			return &templates[i]
		}
	}
	return nil
}

// runOperatorRequest is the testable core: pure pre-flight validation first
// (every failure a usageError, exit 2, BEFORE any HTTP — Constitution I), then
// one bounded POST, then the response → exit-code mapping.
func runOperatorRequest(cmd *cobra.Command, args []string) error {
	sink := newSink(cmd)
	templates := api.OperatorTemplateList()

	if operatorRequestList {
		if len(args) > 0 {
			return usageError(fmt.Errorf("--list takes no template argument"))
		}
		printOperatorTemplateList(sink, templates, operatorRequestJSON)
		return nil
	}
	if len(args) != 1 {
		return usageError(fmt.Errorf("rk operator request takes exactly one template argument (%d given) — run `rk operator request --list`", len(args)))
	}
	id := args[0]
	tmpl := findOperatorTemplate(templates, id)
	if tmpl == nil {
		return usageError(fmt.Errorf("unknown operator template %q — run `rk operator request --list`", id))
	}

	window := operatorRequestWindow
	switch {
	case tmpl.ServerScoped && window != "":
		return usageError(fmt.Errorf("operator template %q is server-scoped; drop --window", id))
	case !tmpl.ServerScoped && window == "":
		return usageError(fmt.Errorf("operator template %q is window-scoped; pass --window @N", id))
	}
	if window != "" {
		if msg := validate.ValidateWindowID(window, "--window"); msg != "" {
			return usageError(errors.New(msg))
		}
	}
	if operatorRequestText != "" && !tmpl.AcceptsText {
		return usageError(fmt.Errorf("operator template %q does not accept --text", id))
	}
	if operatorRequestSession != "" && !tmpl.AcceptsSession {
		return usageError(fmt.Errorf("operator template %q does not accept --session", id))
	}

	// The ?server= query value: the explicit -L/--server flag when given (the
	// daemon silently coerces an invalid name to default, so the CLI rejects it
	// first), else the caller's own tmux server label (default when $TMUX is
	// unset — the MCP posture).
	server := operatorRequestServer
	if server != "" {
		if msg := validate.ValidateServerName(server); msg != "" {
			return usageError(errors.New(msg))
		}
	} else {
		server = cliServerLabel(operatorOriginalTMUXFn())
	}

	return postOperatorRequest(cmd, sink, *tmpl, window, operatorRequestText, operatorRequestSession, server)
}

// postOperatorRequest performs the one bounded POST and maps the daemon's
// answer onto the receipt / error classes (spec § Envelope: ok mirrors the
// exit code — 202 is a success, ok:true, queued:true).
func postOperatorRequest(cmd *cobra.Command, sink outputSink, tmpl api.OperatorTemplateInfo, window, text, session, server string) error {
	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, operatorRequestTimeout)
	defer cancel()

	origin := resolveOrigin(ctx)
	endpoint := origin + "/api/operator-request"
	if !tmpl.ServerScoped {
		endpoint = origin + "/api/windows/" + url.PathEscape(window) + "/operator-request"
	}
	reqURL := endpoint + "?" + url.Values{"server": {server}}.Encode()

	// Empty text/session keys are omitted: the daemon treats a present empty
	// text on an acceptsText template as a 400; omitting is the neutral form
	// (and matches the UI's button POSTs).
	body := map[string]string{"template": tmpl.ID}
	if text != "" {
		body["text"] = text
	}
	if session != "" {
		body["session"] = session
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		envErr := envelopeError{
			Code:    envelopeCodeOperational,
			Message: fmt.Sprintf("run-kit daemon unreachable at %s: %v", origin, err),
			Hint:    operatorRequestDaemonHint,
		}
		if operatorRequestJSON {
			sink.JSONError(envErr)
		}
		return errors.New(envErr.Message)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)

	switch resp.StatusCode {
	case http.StatusOK, http.StatusAccepted:
		queued := resp.StatusCode == http.StatusAccepted
		receipt := operatorRequestReceipt{Template: tmpl.ID, Queued: queued}
		if !tmpl.ServerScoped {
			receipt.Window = window
		}
		if operatorRequestJSON {
			sink.JSONResult(receipt)
		} else if queued {
			sink.Dataf("queued %s\n", tmpl.ID)
		} else {
			sink.Dataf("delivered %s\n", tmpl.ID)
		}
		if queued {
			sink.Notef("%s\n", operatorRequestQueuedNote)
		}
		return nil
	case http.StatusBadRequest:
		msg, _ := operatorRequestErrorBody(data, resp.Status)
		if operatorRequestJSON {
			sink.JSONError(envelopeError{Code: envelopeCodeUsage, Message: msg})
		}
		return usageError(errors.New(msg))
	default:
		msg, code := operatorRequestErrorBody(data, resp.Status)
		if operatorRequestJSON {
			sink.JSONError(envelopeError{Code: envelopeCodeOperational, Message: msg, Reason: code})
		}
		return errors.New(msg)
	}
}

// operatorRequestErrorBody extracts the daemon's {"error":…, "code":…} body —
// the optional code (today only staged_send_failure) rides through as the
// envelope's reason verbatim. A non-JSON body (or one lacking error) falls back
// to a message naming the status.
func operatorRequestErrorBody(data []byte, status string) (message, code string) {
	var body struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(data, &body); err == nil && body.Error != "" {
		return body.Error, body.Code
	}
	return fmt.Sprintf("run-kit daemon answered %s", status), ""
}

// printOperatorTemplateList renders --list: one line per template, sorted by id
// (OperatorTemplateList's order), scope word then the declared flag names in
// the registry-struct order; --json wraps the descriptors under a templates
// key. No HTTP call is made.
func printOperatorTemplateList(sink outputSink, templates []api.OperatorTemplateInfo, asJSON bool) {
	if asJSON {
		sink.JSONResult(struct {
			Templates []api.OperatorTemplateInfo `json:"templates"`
		}{Templates: templates})
		return
	}
	for _, t := range templates {
		scope := "window"
		if t.ServerScoped {
			scope = "server"
		}
		var flags []string
		if t.RequiresAgentSessionRef {
			flags = append(flags, "requiresAgentSessionRef")
		}
		if t.AcceptsText {
			flags = append(flags, "acceptsText")
		}
		if t.AcceptsSession {
			flags = append(flags, "acceptsSession")
		}
		if t.RequiresWaiting {
			flags = append(flags, "requiresWaiting")
		}
		if t.ChatDelivery {
			flags = append(flags, "chatDelivery")
		}
		line := fmt.Sprintf("%-20s %-7s", t.ID, scope)
		if len(flags) > 0 {
			line += " " + strings.Join(flags, " ")
		}
		sink.Dataf("%s\n", strings.TrimRight(line, " "))
	}
}
