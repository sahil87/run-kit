package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// textOf extracts the single TextContent's text from a result.
func textOf(t *testing.T, res *mcpsdk.CallToolResult) string {
	t.Helper()
	if len(res.Content) != 1 {
		t.Fatalf("content blocks = %d, want 1", len(res.Content))
	}
	tc, ok := res.Content[0].(*mcpsdk.TextContent)
	if !ok {
		t.Fatalf("content[0] is %T, want *TextContent", res.Content[0])
	}
	return tc.Text
}

// TestValidateArgsRejections: every rejection class returns an error naming
// the input, before anything could exec.
func TestValidateArgsRejections(t *testing.T) {
	row := syntheticRows()[0] // capture: server, lines, target
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"not an object", `[1]`, "arguments"},
		{"unknown property", `{"target":"%3","bogus":1}`, `"bogus"`},
		{"missing required", `{"server":"s"}`, `"target"`},
		{"bad pattern", `{"target":"bogus"}`, `"target"`},
		{"wrong type", `{"target":3}`, `"target"`},
		{"lines not integer", `{"target":"%3","lines":1.5}`, `"lines"`},
		{"lines below minimum", `{"target":"%3","lines":0}`, `"lines"`},
		{"lines above maximum", `{"target":"%3","lines":2001}`, `"lines"`},
		{"bool wrong type", `{"target":"%3","server":"s","lines":"100"}`, `"lines"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateArgs(row, json.RawMessage(tc.raw))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("ValidateArgs(%s) = %v, want error containing %s", tc.raw, err, tc.want)
			}
		})
	}
}

// TestValidateArgsEnumAndBool covers the enum and boolean paths on a synthetic
// row (no seeded W1 row uses them yet).
func TestValidateArgsEnumAndBool(t *testing.T) {
	row := Row{
		Tool: "x", Path: "x",
		Args: []Arg{
			{Name: "mode", Type: ArgString, Enum: []string{"a", "b"}},
			{Name: "flag", Type: ArgBoolean},
		},
	}
	if _, err := ValidateArgs(row, json.RawMessage(`{"mode":"c"}`)); err == nil || !strings.Contains(err.Error(), `"mode"`) {
		t.Errorf("enum violation = %v", err)
	}
	if _, err := ValidateArgs(row, json.RawMessage(`{"flag":"yes"}`)); err == nil || !strings.Contains(err.Error(), `"flag"`) {
		t.Errorf("bool type violation = %v", err)
	}
	if _, err := ValidateArgs(row, json.RawMessage(`{"mode":"a","flag":true}`)); err != nil {
		t.Errorf("valid args rejected: %v", err)
	}
}

// TestValidateArgsAcceptsValid: empty raw and full valid calls pass, and the
// accepted target grammar covers all three forms.
func TestValidateArgsAcceptsValid(t *testing.T) {
	row := syntheticRows()[0]
	if _, err := ValidateArgs(row, nil); err == nil {
		t.Error("nil raw should still fail the required target check")
	}
	for _, target := range []string{"%3", "@12", "=work:agent"} {
		raw := json.RawMessage(`{"server":"s","target":"` + target + `","lines":100}`)
		if _, err := ValidateArgs(row, raw); err != nil {
			t.Errorf("target %q rejected: %v", target, err)
		}
	}
}

// TestValidateArgsOneOf: a row declaring OneOf rejects a call supplying zero
// or two of the named inputs — the message names the members — and accepts
// exactly one.
func TestValidateArgsOneOf(t *testing.T) {
	row := Row{
		Tool: "answer", Path: "mux send",
		Args: []Arg{
			{Name: "target", Positional: 1, Type: ArgString, Required: true, Pattern: `^(%\d+|@\d+|=.+:.+)$`},
			{Name: "message", Type: ArgString},
			{Name: "key", Flag: "--key", Type: ArgString, Enum: []string{"Enter", "Escape"}},
		},
		Stdin: "message",
		OneOf: []string{"message", "key"},
	}
	for _, tc := range []struct {
		name string
		raw  string
		want string // "" = accepted
	}{
		{"zero members", `{"target":"%3"}`, `"message"`},
		{"two members", `{"target":"%3","message":"a","key":"Enter"}`, `"key"`},
		{"message only", `{"target":"%3","message":"a"}`, ""},
		{"key only", `{"target":"%3","key":"Enter"}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ValidateArgs(row, json.RawMessage(tc.raw))
			if tc.want == "" {
				if err != nil {
					t.Errorf("ValidateArgs(%s) = %v, want accepted", tc.raw, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.want) || !strings.Contains(err.Error(), "exactly one") {
				t.Errorf("ValidateArgs(%s) = %v, want a one-of rejection naming %s", tc.raw, err, tc.want)
			}
		})
	}
}

// TestMapJSONResultTiers drives the three parsing tiers and the failure
// mapping of a result: json row.
func TestMapJSONResultTiers(t *testing.T) {
	row := Row{Tool: "capture", Result: ResultJSON}
	cases := []struct {
		name       string
		out        Outcome
		wantError  bool
		wantText   string
		wantSubstr []string
	}{
		{"envelope ok", Outcome{Stdout: []byte(`{"ok":true,"result":{"a":1}}`)}, false, `{"a":1}`, nil},
		{"envelope fail", Outcome{Stdout: []byte(`{"ok":false,"error":{"code":"usage","message":"bad","hint":"try x"}}`), ExitCode: 2}, true, "", []string{`"usage"`, "bad", "try x"}},
		{"envelope fail exit 1", Outcome{Stdout: []byte(`{"ok":false,"error":{"code":"operational","message":"no pane","reason":"probe_failure"}}`), ExitCode: 1}, true, "", []string{"no pane", "probe_failure"}},
		{"bare JSON", Outcome{Stdout: []byte(`[{"name":"boot"}]`)}, false, `[{"name":"boot"}]`, nil},
		{"non-JSON note", Outcome{Stdout: []byte("plain prose\n")}, false, "(non-JSON output)\nplain prose", nil},
		{"exit 1 no envelope", Outcome{Stderr: []byte("no such pane %999\n"), ExitCode: 1}, true, `{"code":"operational","message":"no such pane %999"}`, nil},
		{"exit 2 usage", Outcome{Stderr: []byte("bad flag\n"), ExitCode: 2}, true, `{"code":"usage","message":"bad flag"}`, nil},
		{"exit 1 falls back to stdout", Outcome{Stdout: []byte("some prose"), ExitCode: 1}, true, `{"code":"operational","message":"some prose"}`, nil},
		{"bare JSON with nonzero exit is verbatim error", Outcome{Stdout: []byte(`[]`), ExitCode: 1}, true, `[]`, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := MapResult("capture", row, ToolTimeoutCap, tc.out)
			if res.IsError != tc.wantError {
				t.Errorf("IsError = %v, want %v", res.IsError, tc.wantError)
			}
			text := textOf(t, res)
			if tc.wantText != "" && text != tc.wantText {
				t.Errorf("text = %q, want %q", text, tc.wantText)
			}
			for _, sub := range tc.wantSubstr {
				if !strings.Contains(text, sub) {
					t.Errorf("text %q missing %q", text, sub)
				}
			}
		})
	}
}

// TestMapTextResult pins the exit-code → isError mapping of a text row.
func TestMapTextResult(t *testing.T) {
	row := Row{Tool: "send", Result: ResultText}
	res := MapResult("send", row, ToolTimeoutCap, Outcome{Stdout: []byte("delivered %3\n")})
	if res.IsError || textOf(t, res) != "delivered %3" {
		t.Errorf("success = %v %q", res.IsError, textOf(t, res))
	}
	res = MapResult("send", row, ToolTimeoutCap, Outcome{Stderr: []byte("refused: %3 is active\n"), ExitCode: 1})
	if !res.IsError || textOf(t, res) != "exit 1: refused: %3 is active" {
		t.Errorf("failure = %v %q", res.IsError, textOf(t, res))
	}
}

// TestMapResultTimeout: a deadline outcome on any kind renders the machine
// timeout error naming the tool and the budget.
func TestMapResultTimeout(t *testing.T) {
	row := Row{Tool: "capture", Result: ResultJSON}
	res := MapResult("capture", row, ToolTimeoutCap, Outcome{TimedOut: true, ExitCode: -1})
	if !res.IsError {
		t.Fatal("timeout must be IsError")
	}
	text := textOf(t, res)
	if !strings.Contains(text, `"reason":"timeout"`) || !strings.Contains(text, "capture exceeded 45s") {
		t.Errorf("text = %q", text)
	}
}

// TestMapImageResult: a valid PNG at the printed path yields an image block
// plus the path JSON; anything else is an error naming the path.
func TestMapImageResult(t *testing.T) {
	row := Row{Tool: "gui_shot", Result: ResultImage}
	dir := t.TempDir()
	png := filepath.Join(dir, "shot.png")
	if err := os.WriteFile(png, append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, 1, 2, 3), 0o644); err != nil {
		t.Fatal(err)
	}
	res := MapResult("gui_shot", row, ToolTimeoutCap, Outcome{Stdout: []byte("\n" + png + "\n")})
	if res.IsError {
		t.Fatalf("IsError on a valid PNG: %v", res.Content)
	}
	if len(res.Content) != 2 {
		t.Fatalf("content blocks = %d, want 2", len(res.Content))
	}
	img, ok := res.Content[0].(*mcpsdk.ImageContent)
	if !ok {
		t.Fatalf("content[0] is %T, want *ImageContent", res.Content[0])
	}
	if img.MIMEType != "image/png" || len(img.Data) != 11 {
		t.Errorf("image block = %v bytes, mime %q", len(img.Data), img.MIMEType)
	}
	tc, ok := res.Content[1].(*mcpsdk.TextContent)
	if !ok || !strings.Contains(tc.Text, png) {
		t.Errorf("path text block = %v", res.Content[1])
	}

	txt := filepath.Join(dir, "not.txt")
	if err := os.WriteFile(txt, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	res = MapResult("gui_shot", row, ToolTimeoutCap, Outcome{Stdout: []byte(txt + "\n")})
	if !res.IsError || !strings.Contains(textOf(t, res), txt) {
		t.Errorf("non-PNG = %v %v", res.IsError, res.Content)
	}
	res = MapResult("gui_shot", row, ToolTimeoutCap, Outcome{Stdout: []byte(filepath.Join(dir, "gone.png") + "\n")})
	if !res.IsError || !strings.Contains(textOf(t, res), "gone.png") {
		t.Errorf("unreadable = %v %v", res.IsError, res.Content)
	}
	res = MapResult("gui_shot", row, ToolTimeoutCap, Outcome{Stderr: []byte("no display\n"), ExitCode: 1})
	if !res.IsError || !strings.Contains(textOf(t, res), "exit 1: no display") {
		t.Errorf("exit!=0 image row = %v %v", res.IsError, res.Content)
	}
}

// TestMapImageResultEnvelope: an --json envelope stdout is unwrapped — ok:true
// reads result.path and carries the result document beside the image;
// ok:false renders the error with no file read; a missing or non-string
// result.path is an error naming the field.
func TestMapImageResultEnvelope(t *testing.T) {
	row := Row{Tool: "gui_shot", Result: ResultImage}
	dir := t.TempDir()
	png := filepath.Join(dir, "shot.png")
	if err := os.WriteFile(png, append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, 1, 2, 3), 0o644); err != nil {
		t.Fatal(err)
	}

	envelope := fmt.Sprintf(`{"ok":true,"result":{"path":%q,"width":8,"height":8,"scale":1,"display":":1"}}`, png)
	res := MapResult("gui_shot", row, ToolTimeoutCap, Outcome{Stdout: []byte(envelope)})
	if res.IsError {
		t.Fatalf("IsError on an enveloped success: %v", res.Content)
	}
	if len(res.Content) != 2 {
		t.Fatalf("content blocks = %d, want 2", len(res.Content))
	}
	img, ok := res.Content[0].(*mcpsdk.ImageContent)
	if !ok {
		t.Fatalf("content[0] is %T, want *ImageContent", res.Content[0])
	}
	if img.MIMEType != "image/png" || len(img.Data) != 11 {
		t.Errorf("image block = %v bytes, mime %q", len(img.Data), img.MIMEType)
	}
	tc, ok := res.Content[1].(*mcpsdk.TextContent)
	if !ok {
		t.Fatalf("content[1] is %T, want *TextContent", res.Content[1])
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(tc.Text), &doc); err != nil {
		t.Fatalf("text block is not JSON: %v", err)
	}
	if doc["width"] != float64(8) || doc["display"] != ":1" || doc["path"] != png {
		t.Errorf("text block = %v, want the result document (width 8, display :1, path)", doc)
	}

	// ok:false renders mapEnvelope's error document without touching the
	// filesystem — the named path must never be read.
	gone := filepath.Join(dir, "gone.png")
	res = MapResult("gui_shot", row, ToolTimeoutCap, Outcome{
		Stdout:   []byte(fmt.Sprintf(`{"ok":false,"result":{"path":%q},"error":{"code":"operational","message":"no display"}}`, gone)),
		ExitCode: 1,
	})
	if !res.IsError {
		t.Fatal("enveloped failure must be IsError")
	}
	if text := textOf(t, res); !strings.Contains(text, "no display") || strings.Contains(text, gone) {
		t.Errorf("enveloped failure text = %q, want the error message and no path probe", text)
	}

	res = MapResult("gui_shot", row, ToolTimeoutCap, Outcome{Stdout: []byte(`{"ok":true,"result":{"width":8}}`)})
	if !res.IsError || !strings.Contains(textOf(t, res), "path") {
		t.Errorf("missing result.path = %v %v", res.IsError, res.Content)
	}
	res = MapResult("gui_shot", row, ToolTimeoutCap, Outcome{Stdout: []byte(`{"ok":true,"result":{"path":42}}`)})
	if !res.IsError || !strings.Contains(textOf(t, res), "path") {
		t.Errorf("non-string result.path = %v %v", res.IsError, res.Content)
	}
}

// TestValidateArgsStringArray pins array validation: a valid string array
// passes; a non-array, a non-string element, and a MaxItems overflow are
// rejected with messages naming the input.
func TestValidateArgsStringArray(t *testing.T) {
	row := Row{
		Tool: "x", Path: "x",
		Args: []Arg{
			{Name: "skill", Type: ArgStringArray, MaxItems: intPtr(2)},
		},
	}
	if _, err := ValidateArgs(row, json.RawMessage(`{"skill":["/a","/b"]}`)); err != nil {
		t.Errorf("valid array rejected: %v", err)
	}
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"not an array", `{"skill":"/a"}`, `"skill"`},
		{"non-string element", `{"skill":["/a",3]}`, `"skill"`},
		{"maxItems overflow", `{"skill":["/a","/b","/c"]}`, `"skill"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ValidateArgs(row, json.RawMessage(tc.raw)); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("ValidateArgs = %v, want an error naming %s", err, tc.want)
			}
		})
	}
}
