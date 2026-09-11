package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"regexp"
	"strings"
	"time"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// pngSignature is the fixed 8-byte magic every PNG file starts with.
var pngSignature = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}

// ValidateArgs unmarshals a tool call's raw arguments and validates them
// against the row before anything execs (docs/specs/mcp.md Principle 8's
// counterpart: the SDK's Server.AddTool does not validate raw schemas — the
// handler owns validation). Unknown properties, missing required inputs, wrong
// JSON types, pattern/enum violations, and out-of-range integers all fail with
// a one-line message naming the input.
func ValidateArgs(row Row, raw json.RawMessage) (map[string]any, error) {
	args := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &args); err != nil {
			return nil, fmt.Errorf("arguments are not a JSON object: %v", err)
		}
	}
	known := map[string]Arg{}
	for _, arg := range row.Args {
		if arg.Literal == "" {
			known[arg.Name] = arg
		}
	}
	for name := range args {
		if _, ok := known[name]; !ok {
			return nil, fmt.Errorf("unknown argument %q", name)
		}
	}
	if len(row.OneOf) > 0 {
		present := 0
		for _, name := range row.OneOf {
			if _, ok := args[name]; ok {
				present++
			}
		}
		if present != 1 {
			return nil, fmt.Errorf("exactly one of %s is required, got %d", quotedNames(row.OneOf), present)
		}
	}
	for _, arg := range row.Args {
		if arg.Literal != "" {
			continue
		}
		v, present := args[arg.Name]
		if !present {
			if arg.Required {
				return nil, fmt.Errorf("missing required argument %q", arg.Name)
			}
			continue
		}
		if err := validateArg(arg, v); err != nil {
			return nil, err
		}
	}
	return args, nil
}

// quotedNames renders input names for one-line validation messages:
// `"message", "key"`.
func quotedNames(names []string) string {
	quoted := make([]string, len(names))
	for i, name := range names {
		quoted[i] = `"` + name + `"`
	}
	return strings.Join(quoted, ", ")
}

// validateArg checks one supplied value against its Arg's type and bounds.
func validateArg(arg Arg, v any) error {
	switch arg.Type {
	case ArgString:
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("argument %q must be a string", arg.Name)
		}
		if arg.Pattern != "" {
			re, err := regexp.Compile(arg.Pattern)
			if err != nil {
				return fmt.Errorf("argument %q has an invalid policy pattern: %v", arg.Name, err)
			}
			if !re.MatchString(s) {
				return fmt.Errorf("argument %q must match %s", arg.Name, arg.Pattern)
			}
		}
		if len(arg.Enum) > 0 {
			found := false
			for _, e := range arg.Enum {
				if s == e {
					found = true
					break
				}
			}
			if !found {
				return fmt.Errorf("argument %q must be one of %s", arg.Name, strings.Join(arg.Enum, ", "))
			}
		}
	case ArgInteger:
		f, ok := v.(float64)
		if !ok || f != math.Trunc(f) {
			return fmt.Errorf("argument %q must be an integer", arg.Name)
		}
		// Reject magnitudes that cannot survive the float64→int conversion;
		// an overflowed int would bypass the minimum/maximum checks below.
		if f >= float64(math.MaxInt) || f < float64(math.MinInt) {
			return fmt.Errorf("argument %q is out of range for an integer", arg.Name)
		}
		n := int(f)
		if arg.Minimum != nil && n < *arg.Minimum {
			return fmt.Errorf("argument %q must be >= %d", arg.Name, *arg.Minimum)
		}
		if arg.Maximum != nil && n > *arg.Maximum {
			return fmt.Errorf("argument %q must be <= %d", arg.Name, *arg.Maximum)
		}
	case ArgBoolean:
		if _, ok := v.(bool); !ok {
			return fmt.Errorf("argument %q must be a boolean", arg.Name)
		}
	}
	return nil
}

// MapResult maps a subprocess outcome onto MCP content per the row's result
// kind (docs/specs/mcp.md § Policy table rules). timeout is the effective
// timeout the call ran under, used in the deadline message.
func MapResult(tool string, row Row, timeout time.Duration, out Outcome) *mcpsdk.CallToolResult {
	if out.TimedOut {
		return errorText(fmt.Sprintf(`{"code":"operational","reason":"timeout","message":"%s exceeded %s"}`, tool, timeout))
	}
	switch row.Result {
	case ResultJSON:
		return mapJSONResult(out)
	case ResultImage:
		return mapImageResult(out)
	default:
		return mapTextResult(out)
	}
}

// mapJSONResult parses stdout in three tiers: (a) an object with a boolean ok
// key is the --json envelope; (b) any other valid JSON document is the interim
// bare form, returned verbatim with isError taken from the exit code
// (docs/specs/mcp.md § Policy table rules); (c) non-JSON falls through to the
// text rule with a leading note. On a non-zero exit the envelope still wins (a
// verb may emit ok:false with exit 1/2); otherwise the text is a
// machine-shaped code/message document built from stderr, with exit 2
// classifying as usage.
func mapJSONResult(out Outcome) *mcpsdk.CallToolResult {
	stdout := bytes.TrimSpace(out.Stdout)
	var doc any
	if len(stdout) > 0 && json.Unmarshal(stdout, &doc) == nil {
		if obj, ok := doc.(map[string]any); ok {
			if okVal, isBool := obj["ok"].(bool); isBool {
				return mapEnvelope(obj, okVal)
			}
		}
		return textResult(string(stdout), out.ExitCode != 0)
	}
	if out.ExitCode == 0 {
		return textResult("(non-JSON output)\n"+string(stdout), false)
	}
	code := "operational"
	if out.ExitCode == 2 {
		code = "usage"
	}
	msg := strings.TrimSpace(string(out.Stderr))
	if msg == "" {
		msg = string(stdout)
	}
	errDoc, _ := json.Marshal(map[string]string{"code": code, "message": msg})
	return errorText(string(errDoc))
}

// mapEnvelope renders a parsed --json envelope: ok:true returns result
// re-serialised; ok:false maps error.message (+ hint/reason when present).
func mapEnvelope(obj map[string]any, ok bool) *mcpsdk.CallToolResult {
	if ok {
		result, err := json.Marshal(obj["result"])
		if err != nil {
			return errorText(fmt.Sprintf(`{"code":"operational","message":"envelope result is not serializable: %v"}`, err))
		}
		return textResult(string(result), false)
	}
	errDoc, _ := json.Marshal(obj["error"])
	if string(errDoc) == "" || string(errDoc) == "null" {
		errDoc = []byte(`{"code":"operational","message":"unknown error"}`)
	}
	return errorText(string(errDoc))
}

// mapTextResult returns stdout verbatim (trailing newline trimmed) on success
// and `exit <n>: <stderr>` on failure — the receipt form for verbs without
// --json (the send report word rides this).
func mapTextResult(out Outcome) *mcpsdk.CallToolResult {
	if out.ExitCode == 0 {
		return textResult(strings.TrimRight(string(out.Stdout), "\n"), false)
	}
	msg := strings.TrimSpace(string(out.Stderr))
	if msg == "" {
		msg = strings.TrimSpace(string(out.Stdout))
	}
	return errorText(fmt.Sprintf("exit %d: %s", out.ExitCode, msg))
}

// mapImageResult turns an image verb's outcome into an image content block.
// An --json envelope stdout is unwrapped first and wins even on a non-zero
// exit (symmetric with mapJSONResult): ok:false ⇒ mapEnvelope's error
// rendering, no file read; ok:true ⇒ result.path names the PNG and the
// re-serialized result rides beside the image so width/height/scale/display
// reach the model. Non-envelope stdout keeps the interim form: the first
// non-empty line is the path, and a non-zero exit is the text rule. Only the
// PNG signature is accepted — no globbing, no other type.
func mapImageResult(out Outcome) *mcpsdk.CallToolResult {
	stdout := bytes.TrimSpace(out.Stdout)
	var doc any
	if len(stdout) > 0 && json.Unmarshal(stdout, &doc) == nil {
		if obj, ok := doc.(map[string]any); ok {
			if okVal, isBool := obj["ok"].(bool); isBool {
				if !okVal {
					return mapEnvelope(obj, false)
				}
				result, _ := obj["result"].(map[string]any)
				path, isString := result["path"].(string)
				if !isString || path == "" {
					return errorText("envelope result.path is missing or not a string")
				}
				return imageResult(path, obj["result"])
			}
		}
	}
	if out.ExitCode != 0 {
		return mapTextResult(out)
	}
	path := ""
	for _, line := range strings.Split(string(out.Stdout), "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			path = trimmed
			break
		}
	}
	if path == "" {
		return errorText("image verb printed no path on stdout")
	}
	return imageResult(path, map[string]string{"path": path})
}

// imageResult reads the PNG at path and returns an image content block plus a
// text block carrying payload re-serialized (the receipt the model reads).
func imageResult(path string, payload any) *mcpsdk.CallToolResult {
	data, err := os.ReadFile(path)
	if err != nil {
		return errorText(fmt.Sprintf("cannot read image at %s: %v", path, err))
	}
	if len(data) < len(pngSignature) || !bytes.Equal(data[:len(pngSignature)], pngSignature) {
		return errorText(fmt.Sprintf("%s is not a PNG file", path))
	}
	payloadDoc, err := json.Marshal(payload)
	if err != nil {
		return errorText(fmt.Sprintf("image payload is not serializable: %v", err))
	}
	return &mcpsdk.CallToolResult{
		Content: []mcpsdk.Content{
			&mcpsdk.ImageContent{Data: data, MIMEType: "image/png"},
			&mcpsdk.TextContent{Text: string(payloadDoc)},
		},
	}
}

func textResult(text string, isError bool) *mcpsdk.CallToolResult {
	return &mcpsdk.CallToolResult{
		Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: text}},
		IsError: isError,
	}
}

func errorText(text string) *mcpsdk.CallToolResult {
	return textResult(text, true)
}
