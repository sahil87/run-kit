package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// TestSink_DatafToDataNotefToChatter pins the core outputSink contract directly
// (Toolkit Principle 9): Dataf writes to the data channel and Notef writes to
// the chatter channel, on independent buffers.
func TestSink_DatafToDataNotefToChatter(t *testing.T) {
	var data, chatter bytes.Buffer
	s := newSinkWriters(&data, &chatter)

	s.Dataf("outcome=%d\n", 7)
	s.Notef("progress %s\n", "step")

	if got := data.String(); got != "outcome=7\n" {
		t.Errorf("Dataf must write to the data channel, got data: %q", got)
	}
	if got := chatter.String(); got != "progress step\n" {
		t.Errorf("Notef must write to the chatter channel, got chatter: %q", got)
	}
}

// TestNewSink_QuietDiscardsChatterKeepsData pins that newSink routes chatter to
// io.Discard under --quiet while data always goes to the command's stdout, and
// that without --quiet chatter goes to the command's stderr. The --quiet signal
// is read off the command's own flag set.
func TestNewSink_QuietDiscardsChatterKeepsData(t *testing.T) {
	newCmd := func(q bool) *cobra.Command {
		c := &cobra.Command{Use: "x", RunE: func(*cobra.Command, []string) error { return nil }}
		c.Flags().Bool("quiet", q, "")
		return c
	}

	t.Run("quiet → chatter discarded, data to stdout", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		c := newCmd(true)
		c.SetOut(&stdout)
		c.SetErr(&stderr)

		s := newSink(c)
		if s.data != io.Writer(&stdout) {
			t.Errorf("data channel must be the command's stdout")
		}
		if s.chatter != io.Discard {
			t.Errorf("chatter channel must be io.Discard under --quiet, got %v", s.chatter)
		}
	})

	t.Run("not quiet → chatter to stderr", func(t *testing.T) {
		var stdout, stderr bytes.Buffer
		c := newCmd(false)
		c.SetOut(&stdout)
		c.SetErr(&stderr)

		s := newSink(c)
		if s.data != io.Writer(&stdout) {
			t.Errorf("data channel must be the command's stdout")
		}
		if s.chatter != io.Writer(&stderr) {
			t.Errorf("chatter channel must be the command's stderr when not quiet, got %v", s.chatter)
		}
	})
}

// TestSink_JSONResultOneDocument pins the envelope's success shape: exactly one
// newline-terminated {"ok":true,"result":…} document on the data channel,
// chatter untouched, no --quiet gating.
func TestSink_JSONResultOneDocument(t *testing.T) {
	var data, chatter bytes.Buffer
	s := newSinkWriters(&data, &chatter)

	s.JSONResult(map[string]any{"template": "brief-me", "queued": true})

	want := "{\n  \"ok\": true,\n  \"result\": {\n    \"queued\": true,\n    \"template\": \"brief-me\"\n  }\n}\n"
	if got := data.String(); got != want {
		t.Errorf("JSONResult data = %q, want %q (encoding/json sorts map keys)", got, want)
	}
	if chatter.Len() != 0 {
		t.Errorf("JSONResult must not touch the chatter channel, got %q", chatter.String())
	}
}

// TestSink_JSONErrorOmitsEmptyFields pins the error document: exactly one
// newline-terminated {"ok":false,"error":…} document, with hint/reason omitted
// when empty and carried when set.
func TestSink_JSONErrorOmitsEmptyFields(t *testing.T) {
	var data bytes.Buffer
	s := newSinkWriters(&data, io.Discard)

	s.JSONError(envelopeError{Code: envelopeCodeUsage, Message: "bad template"})
	if got, want := data.String(), "{\n  \"ok\": false,\n  \"error\": {\n    \"code\": \"usage\",\n    \"message\": \"bad template\"\n  }\n}\n"; got != want {
		t.Errorf("bare JSONError = %q, want %q", got, want)
	}

	data.Reset()
	s.JSONError(envelopeError{Code: envelopeCodeOperational, Message: "down", Hint: "start it", Reason: "timeout"})
	var doc struct {
		OK    bool `json:"ok"`
		Error struct {
			Code   string `json:"code"`
			Hint   string `json:"hint"`
			Reason string `json:"reason"`
		} `json:"error"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(data.Bytes()), &doc); err != nil {
		t.Fatalf("JSONError document does not parse: %v (%q)", err, data.String())
	}
	if doc.OK || doc.Error.Code != "operational" || doc.Error.Hint != "start it" || doc.Error.Reason != "timeout" {
		t.Errorf("full JSONError = %+v, want ok:false + code/hint/reason carried", doc)
	}
}

// decodeEnvelope parses the single JSON document Envelope wrote and asserts
// the trailing-newline, two-space-indent shape (R1): the buffer must hold
// exactly one document.
func decodeEnvelope(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	got := buf.String()
	if !strings.HasSuffix(got, "}\n") {
		t.Errorf("envelope must end with a trailing newline, got %q", got)
	}
	if !strings.HasPrefix(got, "{\n  ") {
		t.Errorf("envelope must be two-space indented, got %q", got)
	}
	var doc map[string]any
	if err := json.Unmarshal(buf.Bytes(), &doc); err != nil {
		t.Fatalf("envelope must be one valid JSON document: %v\ngot %q", err, got)
	}
	return doc
}

// unwrapEnvelopeResult parses the ok:true envelope a wrapped --json verb wrote
// to stdout (R8) and unmarshals result into v — the test-side mirror of
// Envelope for callers that want the verb's document typed.
func unwrapEnvelopeResult(t *testing.T, stdout string, v any) {
	t.Helper()
	var doc struct {
		OK     bool            `json:"ok"`
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal([]byte(stdout), &doc); err != nil {
		t.Fatalf("stdout is not the envelope: %v\n%s", err, stdout)
	}
	if !doc.OK || doc.Error != nil {
		t.Fatalf("envelope is not the ok:true success form: %s", stdout)
	}
	if err := json.Unmarshal(doc.Result, v); err != nil {
		t.Fatalf("result does not decode: %v\n%s", err, stdout)
	}
}

// TestEnvelope_SuccessShape pins the ok:true form: result deep-equals the
// document, no error key, and the method returns nil.
func TestEnvelope_SuccessShape(t *testing.T) {
	var data bytes.Buffer
	s := newSinkWriters(&data, io.Discard)

	want := map[string]any{"name": "runkit", "windows": 3}
	if err := s.Envelope(want, nil); err != nil {
		t.Fatalf("Envelope(doc, nil) returned %v, want nil", err)
	}

	doc := decodeEnvelope(t, &data)
	if doc["ok"] != true {
		t.Errorf("ok = %v, want true", doc["ok"])
	}
	if _, hasErr := doc["error"]; hasErr {
		t.Errorf("success envelope must not carry an error key: %v", doc)
	}
	result, ok := doc["result"].(map[string]any)
	if !ok {
		t.Fatalf("result missing or wrong type: %v", doc)
	}
	if result["name"] != "runkit" || result["windows"] != float64(3) {
		t.Errorf("result = %v, want %v", result, want)
	}
}

// TestEnvelope_FailureShapes pins the ok:false form: code derives from
// exitCode (usage iff 2), message is err.Error(), and result rides along only
// when non-nil.
func TestEnvelope_FailureShapes(t *testing.T) {
	cases := []struct {
		name       string
		result     any
		err        error
		wantCode   string
		wantResult bool
	}{
		{"operational error, no result", nil, errors.New("tmux is dead"), "operational", false},
		{"usage error, no result", nil, usageError(errors.New("bad arg")), "usage", false},
		{"verdict: operational with result", map[string]any{"ok": false}, errors.New("one or more dependency checks failed"), "operational", true},
		{"verdict: usage with result", []int{1}, usageError(errors.New("bad arg")), "usage", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var data bytes.Buffer
			s := newSinkWriters(&data, io.Discard)

			ret := s.Envelope(tc.result, tc.err)
			if ret == nil {
				t.Fatal("Envelope(doc, err) must return the error (wrapped)")
			}

			doc := decodeEnvelope(t, &data)
			if doc["ok"] != false {
				t.Errorf("ok = %v, want false", doc["ok"])
			}
			envErr, ok := doc["error"].(map[string]any)
			if !ok {
				t.Fatalf("error key missing or wrong type: %v", doc)
			}
			if envErr["code"] != tc.wantCode {
				t.Errorf("error.code = %v, want %q", envErr["code"], tc.wantCode)
			}
			if envErr["message"] != tc.err.Error() {
				t.Errorf("error.message = %v, want %q", envErr["message"], tc.err.Error())
			}
			if _, hasHint := envErr["hint"]; hasHint {
				t.Errorf("hint must be omitted when unset: %v", envErr)
			}
			if _, hasReason := envErr["reason"]; hasReason {
				t.Errorf("reason must be omitted when unset: %v", envErr)
			}
			if _, hasResult := doc["result"]; hasResult != tc.wantResult {
				t.Errorf("result key present = %v, want %v (doc: %v)", hasResult, tc.wantResult, doc)
			}
		})
	}
}

// TestEnvelope_ReturnedErrorStillClassifies pins the R2/R3 contract: the
// returned error is an envelopedError whose Unwrap lets exitCode's errors.As
// still find a carried *exitCodeError, and whose Error() text is unchanged —
// so --json never changes an exit code or cobra's stderr line.
func TestEnvelope_ReturnedErrorStillClassifies(t *testing.T) {
	var data bytes.Buffer
	s := newSinkWriters(&data, io.Discard)

	usage := usageError(errors.New("unknown flag: --nope"))
	ret := s.Envelope(nil, usage)

	var marker envelopedError
	if !errors.As(ret, &marker) {
		t.Fatalf("returned error must carry envelopedError, got %T", ret)
	}
	if got := exitCode(ret); got != exitUsage {
		t.Errorf("exitCode(enveloped usageError) = %d, want %d", got, exitUsage)
	}
	if ret.Error() != usage.Error() {
		t.Errorf("enveloped Error() = %q, want unchanged %q", ret.Error(), usage.Error())
	}

	op := errors.New("dead socket")
	if got := exitCode(s.Envelope(nil, op)); got != 1 {
		t.Errorf("exitCode(enveloped operational error) = %d, want 1", got)
	}
	if err := s.Envelope(nil, nil); err != nil {
		t.Errorf("nil in must be nil out, got %v", err)
	}
}
