package main

import (
	"bytes"
	"encoding/json"
	"io"
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

	want := "{\"ok\":true,\"result\":{\"queued\":true,\"template\":\"brief-me\"}}\n"
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
	if got, want := data.String(), "{\"ok\":false,\"error\":{\"code\":\"usage\",\"message\":\"bad template\"}}\n"; got != want {
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
