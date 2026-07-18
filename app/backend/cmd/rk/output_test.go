package main

import (
	"bytes"
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
