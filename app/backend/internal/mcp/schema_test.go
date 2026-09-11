package mcp

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// syntheticTree builds a minimal Cobra tree for the schema tests: a mux
// family with the persistent -L flag, a capture carrying local -l/--json, a
// send with no flags, and a status with --json.
func syntheticTree() *cobra.Command {
	root := &cobra.Command{Use: "rk"}
	mux := &cobra.Command{Use: "mux"}
	mux.PersistentFlags().StringP("server", "L", "", "tmux server name (default: the caller's own server)")
	capture := &cobra.Command{Use: "capture", Short: "Capture a pane's scrollback", Long: "Capture the last N lines of a pane's scrollback."}
	capture.Flags().IntP("lines", "l", 50, "Number of scrollback lines to capture")
	capture.Flags().Bool("json", false, "Output as JSON with metadata")
	capture.Flags().StringArray("skill", nil, "Repeatable skill flag")
	send := &cobra.Command{Use: "send", Short: "Deliver a message into an agent's pane"}
	mux.AddCommand(capture, send)
	status := &cobra.Command{Use: "status", Short: "Show tmux session summary", Long: "Show the runkit server's session summary."}
	status.Flags().Bool("json", false, "Emit JSON")
	operator := &cobra.Command{Use: "operator"}
	request := &cobra.Command{Use: "request", Short: "Hand the operator a templated work item"}
	request.Flags().StringP("server", "L", "", "tmux server to address")
	request.Flags().String("window", "", "subject window id")
	request.Flags().String("text", "", "client text")
	request.Flags().String("session", "", "session scope")
	request.Flags().Bool("json", false, "Emit the envelope")
	operator.AddCommand(request)
	root.AddCommand(mux, status, operator)
	return root
}

// syntheticRows are the table rows the synthetic tree satisfies.
func syntheticRows() []Row {
	return []Row{
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
			Tool: "send", Path: "mux send",
			Args: []Arg{
				serverArg,
				targetArg,
				{Name: "message", Type: ArgString, Required: true, Description: "The text to deliver"},
				{Literal: "-"},
			},
			Stdin:  "message",
			Result: ResultText,
		},
	}
}

// TestResolveOK resolves the synthetic rows and confirms flag usage strings
// are captured for description defaulting.
func TestResolveOK(t *testing.T) {
	resolved, err := Resolve(syntheticTree(), syntheticRows())
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if len(resolved) != 2 {
		t.Fatalf("resolved %d rows, want 2", len(resolved))
	}
	if got := resolved[0].flagUsage["server"]; got != "tmux server name (default: the caller's own server)" {
		t.Errorf("server flag usage = %q", got)
	}
	if resolved[0].Cmd.CommandPath() != "rk mux capture" {
		t.Errorf("capture cmd path = %q", resolved[0].Cmd.CommandPath())
	}
}

// TestResolveErrors drives every drift-guard error class and asserts the
// message names the offending row (and flag where applicable).
func TestResolveErrors(t *testing.T) {
	cases := []struct {
		name  string
		build func() []Row // fresh rows per case — mutations must not share a backing array
		want  []string
	}{
		{"missing path", func() []Row {
			return []Row{{Tool: "bogus", Path: "mux bogus"}}
		}, []string{`"bogus"`, "mux bogus"}},
		{"missing flag", func() []Row {
			r := syntheticRows()[0]
			r.Args = append(slices.Clone(r.Args), Arg{Name: "nope", Flag: "--nope", Type: ArgString})
			return []Row{r}
		}, []string{`"capture"`, "--nope"}},
		{"missing shorthand flag", func() []Row {
			r := syntheticRows()[0]
			r.Args = append(slices.Clone(r.Args), Arg{Name: "nope", Flag: "-x", Type: ArgString})
			return []Row{r}
		}, []string{`"capture"`, "-x"}},
		{"type mismatch", func() []Row {
			r := syntheticRows()[0]
			r.Args[1] = Arg{Name: "lines", Flag: "-l", Type: ArgString}
			return []Row{r}
		}, []string{`"capture"`, "-l"}},
		{"missing literal flag", func() []Row {
			r := syntheticRows()[0]
			r.Args[len(r.Args)-1] = Arg{Literal: "--yaml"}
			return []Row{r}
		}, []string{`"capture"`, "--yaml"}},
		{"over-cap timeout", func() []Row {
			r := syntheticRows()[0]
			r.Timeout = ToolTimeoutCap + time.Second
			return []Row{r}
		}, []string{`"capture"`}},
		{"never-tool", func() []Row {
			return []Row{{Tool: "self", Path: "mcp"}}
		}, []string{`"self"`, "never-tool"}},
		{"never-tool prefix", func() []Row {
			return []Row{{Tool: "tick", Path: "cron tick"}}
		}, []string{`"tick"`, "never-tool"}},
		{"stdin not an arg", func() []Row {
			r := syntheticRows()[0]
			r.Stdin = "ghost"
			return []Row{r}
		}, []string{`"capture"`, "ghost"}},
		{"stdin not a string", func() []Row {
			r := syntheticRows()[0]
			r.Stdin = "lines"
			return []Row{r}
		}, []string{`"capture"`, "lines"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Resolve(syntheticTree(), tc.build())
			if err == nil {
				t.Fatalf("Resolve succeeded, want error containing %v", tc.want)
			}
			for _, want := range tc.want {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error %q missing %q", err.Error(), want)
				}
			}
		})
	}
}

// TestResolveDuplicateToolNames rejects two rows with the same tool name.
func TestResolveDuplicateToolNames(t *testing.T) {
	rows := syntheticRows()
	rows[1].Tool = rows[0].Tool
	if _, err := Resolve(syntheticTree(), rows); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("Resolve = %v, want a duplicate-name error", err)
	}
}

// TestResolveConditionalErrors drives the When/Default/OneOf drift-guard
// errors: gated names must be inputs of the row, a Default rides only a
// string/integer Flag arg, and an Integer default must parse.
func TestResolveConditionalErrors(t *testing.T) {
	cases := []struct {
		name  string
		build func() []Row
		want  []string
	}{
		{"when names no input", func() []Row {
			r := syntheticRows()[1]
			r.Args = append(slices.Clone(r.Args), Arg{Literal: "-", When: "ghost"})
			return []Row{r}
		}, []string{`"send"`, "ghost"}},
		{"one_of names no input", func() []Row {
			r := syntheticRows()[1]
			r.OneOf = []string{"message", "ghost"}
			return []Row{r}
		}, []string{`"send"`, "ghost"}},
		{"default on positional", func() []Row {
			r := syntheticRows()[0]
			r.Args[2] = targetArg
			r.Args[2].Default = "%1"
			return []Row{r}
		}, []string{`"capture"`, "target"}},
		{"default on boolean", func() []Row {
			return []Row{{Tool: "status", Path: "status", Args: []Arg{
				{Name: "j", Flag: "--json", Type: ArgBoolean, Default: "true"},
			}}}
		}, []string{`"status"`, "default"}},
		{"non-integer default on integer", func() []Row {
			r := syntheticRows()[0]
			r.Args[1].Default = "abc"
			return []Row{r}
		}, []string{`"capture"`, "lines", "abc"}},
		{"optional stdin outside one_of", func() []Row {
			r := syntheticRows()[1]
			r.Args[2] = Arg{Name: "message", Type: ArgString, Description: "optional but not one_of"}
			return []Row{r}
		}, []string{`"send"`, "message"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Resolve(syntheticTree(), tc.build())
			if err == nil {
				t.Fatalf("Resolve succeeded, want error containing %v", tc.want)
			}
			for _, want := range tc.want {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error %q missing %q", err.Error(), want)
				}
			}
		})
	}
}

// TestInputSchemaDefault: a Flag arg's Default surfaces as the JSON-schema
// default — a number for Integer args, a string otherwise.
func TestInputSchemaDefault(t *testing.T) {
	resolved, err := Resolve(syntheticTree(), []Row{{
		Tool: "capture", Path: "mux capture",
		Args: []Arg{
			serverArg,
			{Name: "lines", Flag: "-l", Type: ArgInteger, Default: "100"},
			targetArg,
			jsonLiteral,
		},
	}})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	props := InputSchema(resolved[0])["properties"].(map[string]any)
	if got := props["lines"].(map[string]any)["default"]; got != 100 {
		t.Errorf("lines default = %v (%T), want the integer 100", got, got)
	}
	if _, ok := props["server"].(map[string]any)["default"]; ok {
		t.Error("server (no Default) must not carry a schema default")
	}
}

// TestInputSchemaShape pins the generated schema: required set, pattern,
// integer bounds, additionalProperties:false, literals excluded, and the
// server input's description defaulted from the -L flag's usage.
func TestInputSchemaShape(t *testing.T) {
	resolved, err := Resolve(syntheticTree(), syntheticRows())
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	schema := InputSchema(resolved[0])
	if schema["type"] != "object" || schema["additionalProperties"] != false {
		t.Errorf("schema envelope = %v", schema)
	}
	props := schema["properties"].(map[string]any)
	if _, ok := props["--json"]; ok {
		t.Error("literal --json leaked into properties")
	}
	target := props["target"].(map[string]any)
	if target["type"] != "string" || target["pattern"] != `^(%\d+|@\d+|=.+:.+)$` {
		t.Errorf("target prop = %v", target)
	}
	if target["description"] == nil || target["description"] == "" {
		t.Error("positional target must carry its own description")
	}
	lines := props["lines"].(map[string]any)
	if lines["type"] != "integer" || lines["minimum"] != 1 || lines["maximum"] != 2000 {
		t.Errorf("lines prop = %v", lines)
	}
	if lines["description"] != "Number of scrollback lines to capture" {
		t.Errorf("lines description = %v, want the flag usage", lines["description"])
	}
	server := props["server"].(map[string]any)
	if server["description"] != "tmux server name (default: the caller's own server)" {
		t.Errorf("server description = %v, want the -L flag usage", server["description"])
	}
	required := schema["required"].([]string)
	if len(required) != 1 || required[0] != "target" {
		t.Errorf("required = %v, want [target]", required)
	}

	sendSchema := InputSchema(resolved[1])
	sendRequired := sendSchema["required"].([]string)
	if len(sendRequired) != 2 || sendRequired[0] != "target" || sendRequired[1] != "message" {
		t.Errorf("send required = %v, want [target message]", sendRequired)
	}
	if _, ok := sendSchema["properties"].(map[string]any)["message"]; !ok {
		t.Error("stdin-only message input must appear in properties")
	}
}

// TestToolDescription pins defaulting: override wins; otherwise Short + Long.
func TestToolDescription(t *testing.T) {
	resolved, err := Resolve(syntheticTree(), syntheticRows())
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got := ToolDescription(resolved[0]); got != "Capture a pane's scrollback\n\nCapture the last N lines of a pane's scrollback." {
		t.Errorf("default description = %q", got)
	}
	overridden := resolved[0]
	overridden.Row.Description = "override"
	if got := ToolDescription(overridden); got != "override" {
		t.Errorf("override description = %q", got)
	}
}

// TestInputSchemaOperatorRequest pins the generated schema of the real
// operator_request row against the synthetic tree: the closed enum on
// template, required == [template] only (window is conditional — the verb
// enforces it), and the pattern on window.
func TestInputSchemaOperatorRequest(t *testing.T) {
	resolved, err := Resolve(syntheticTree(), []Row{findRow(t, "operator_request")})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	schema := InputSchema(resolved[0])
	props := schema["properties"].(map[string]any)

	template := props["template"].(map[string]any)
	enum, ok := template["enum"].([]string)
	if !ok || !slices.Equal(enum, operatorTemplateIDs) {
		t.Errorf("template enum = %v, want the mirrored registry ids", template["enum"])
	}
	window := props["window"].(map[string]any)
	if window["pattern"] != `^@\d+$` {
		t.Errorf("window prop = %v, want the @N pattern", window)
	}
	for _, name := range []string{"server", "window", "text", "session", "template"} {
		if _, ok := props[name]; !ok {
			t.Errorf("properties missing %q", name)
		}
	}
	required := schema["required"].([]string)
	if !slices.Equal(required, []string{"template"}) {
		t.Errorf("required = %v, want [template] (window is conditional, verb-enforced)", required)
	}
}

// stubValue is a pflag.Value with a controllable Type() so checkFlagType can
// be table-tested over pflag types no synthetic-tree flag carries.
type stubValue struct{ typ string }

func (v stubValue) String() string   { return "" }
func (v stubValue) Set(string) error { return nil }
func (v stubValue) Type() string     { return v.typ }

// TestCheckFlagTypeWidened pins the accepted pflag-type ↔ input-type pairs,
// including the W2c widenings: duration feeds a string input (the row carries
// the Go-duration pattern); stringArray/stringSlice and riff's custom skill
// type feed a string-array input.
func TestCheckFlagTypeWidened(t *testing.T) {
	cases := []struct {
		flagType string
		argType  ArgType
		ok       bool
	}{
		{"bool", ArgBoolean, true},
		{"int", ArgInteger, true},
		{"int64", ArgInteger, true},
		{"string", ArgString, true},
		{"duration", ArgString, true},
		{"duration", ArgInteger, false},
		{"stringArray", ArgStringArray, true},
		{"stringSlice", ArgStringArray, true},
		{"skill", ArgStringArray, true},
		{"stringArray", ArgString, true}, // one element of a repeatable flag (answer's --key)
		{"string", ArgStringArray, false},
	}
	for _, tc := range cases {
		flag := &pflag.Flag{Name: "x", Value: stubValue{tc.flagType}}
		err := checkFlagType("t", Arg{Name: "in", Flag: "--x", Type: tc.argType}, flag)
		if tc.ok && err != nil {
			t.Errorf("flag type %q with input type %d: unexpected error %v", tc.flagType, tc.argType, err)
		}
		if !tc.ok && err == nil {
			t.Errorf("flag type %q with input type %d: want an incompatibility error", tc.flagType, tc.argType)
		}
	}
}

// TestResolveFormatErrors pins the Format drift guards: a template naming an
// input the row lacks is rejected (naming the row and the input), as is a
// Format on a non-positional arg.
func TestResolveFormatErrors(t *testing.T) {
	row := Row{
		Tool: "capture", Path: "mux capture",
		Args: []Arg{
			targetArg,
			{Positional: 2, Format: "{target}[/web/{slot}]"},
		},
	}
	_, err := Resolve(syntheticTree(), []Row{row})
	if err == nil || !strings.Contains(err.Error(), `"capture"`) || !strings.Contains(err.Error(), `"slot"`) {
		t.Errorf("unknown format input = %v, want an error naming the row and slot", err)
	}

	row.Args[1] = Arg{Name: "lines", Flag: "-l", Type: ArgInteger, Format: "{target}"}
	_, err = Resolve(syntheticTree(), []Row{row})
	if err == nil || !strings.Contains(err.Error(), "non-positional") {
		t.Errorf("non-positional format = %v, want a non-positional error", err)
	}
}

// TestInputSchemaStringArray pins the array property shape: type array with
// string items and maxItems when the row sets MaxItems.
func TestInputSchemaStringArray(t *testing.T) {
	row := Row{
		Tool: "capture", Path: "mux capture",
		Args: []Arg{
			targetArg,
			{Name: "skill", Flag: "--skill", Type: ArgStringArray, MaxItems: intPtr(4), Description: "repeatable"},
		},
	}
	resolved, err := Resolve(syntheticTree(), []Row{row})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	props := InputSchema(resolved[0])["properties"].(map[string]any)
	skill := props["skill"].(map[string]any)
	if skill["type"] != "array" {
		t.Errorf("skill prop = %v, want type array", skill)
	}
	items, ok := skill["items"].(map[string]any)
	if !ok || items["type"] != "string" {
		t.Errorf("skill items = %v, want {type: string}", skill["items"])
	}
	if skill["maxItems"] != 4 {
		t.Errorf("skill maxItems = %v, want 4", skill["maxItems"])
	}
	if skill["description"] != "repeatable" {
		t.Errorf("skill description = %v", skill["description"])
	}
}
