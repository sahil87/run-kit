package api

import (
	"bytes"
	"testing"
)

// runDAFilter feeds each chunk through a fresh filter in order and returns the
// concatenated browser-bound output plus everything written to the reply
// writer (the test double for the ptmx).
func runDAFilter(t *testing.T, chunks []string) (out, replies string) {
	t.Helper()
	var replyBuf bytes.Buffer
	f := newDAFilter(&replyBuf)
	var outBuf bytes.Buffer
	for _, c := range chunks {
		outBuf.Write(f.process([]byte(c)))
	}
	return outBuf.String(), replyBuf.String()
}

// TestDAFilter_Table drives the Device Attributes filter (terminals_da.go,
// change 260801-f715) through the recognized query forms, false prefixes, and
// interleavings — each case a sequence of read chunks, asserting the
// browser-bound output (queries stripped, everything else intact and in
// order) and the canned replies written back to the (test-doubled) ptmx.
func TestDAFilter_Table(t *testing.T) {
	cases := []struct {
		name        string
		chunks      []string
		wantOut     string
		wantReplies string
	}{
		{
			name:    "plain passthrough",
			chunks:  []string{"hello world\r\n$ "},
			wantOut: "hello world\r\n$ ",
		},
		{
			name:    "passthrough with unrelated escape sequences",
			chunks:  []string{"\x1b[31mred\x1b[0m \x1b[2J\x1b[H"},
			wantOut: "\x1b[31mred\x1b[0m \x1b[2J\x1b[H",
		},
		{
			name:        "DA1 bare form matched and replaced",
			chunks:      []string{"\x1b[c"},
			wantOut:     "",
			wantReplies: da1Reply,
		},
		{
			name:        "DA1 explicit-0 form matched and replaced",
			chunks:      []string{"\x1b[0c"},
			wantOut:     "",
			wantReplies: da1Reply,
		},
		{
			name:        "DA2 bare form matched and replaced",
			chunks:      []string{"\x1b[>c"},
			wantOut:     "",
			wantReplies: da2Reply,
		},
		{
			name:        "DA2 explicit-0 form matched and replaced",
			chunks:      []string{"\x1b[>0c"},
			wantOut:     "",
			wantReplies: da2Reply,
		},
		{
			name:        "query embedded in payload is stripped, payload preserved in order",
			chunks:      []string{"before\x1b[cafter"},
			wantOut:     "beforeafter",
			wantReplies: da1Reply,
		},
		{
			name:        "interleaved queries and payload",
			chunks:      []string{"abc\x1b[cdef\x1b[>0cghi\x1b[0cjkl"},
			wantOut:     "abcdefghijkl",
			wantReplies: da1Reply + da2Reply + da1Reply,
		},
		{
			name:        "attach-time DA1+DA2 pair (the real tmux handshake)",
			chunks:      []string{"\x1b[c\x1b[>c"},
			wantOut:     "",
			wantReplies: da1Reply + da2Reply,
		},
		{
			name:    "false prefix ESC [ + non-matching byte forwarded intact",
			chunks:  []string{"\x1b[Zfoo"},
			wantOut: "\x1b[Zfoo",
		},
		{
			name:    "false prefix straddling the chunk boundary forwarded intact and in order",
			chunks:  []string{"tail\x1b[", "Zfoo"},
			wantOut: "tail\x1b[Zfoo",
		},
		{
			name:    "false prefix ESC [ > + non-matching byte forwarded intact",
			chunks:  []string{"\x1b[>1c"}, // >1c is not in the recognized set
			wantOut: "\x1b[>1c",
		},
		{
			name:    "false prefix ESC [ 0 + non-matching byte forwarded intact",
			chunks:  []string{"\x1b[0m"}, // SGR reset, not DA1
			wantOut: "\x1b[0m",
		},
		{
			name:    "bare trailing ESC then non-matching chunk forwarded intact",
			chunks:  []string{"end\x1b", "Anext"},
			wantOut: "end\x1bAnext",
		},
		{
			name:        "ESC ESC — released first ESC, second starts a real query",
			chunks:      []string{"\x1b\x1b[c"},
			wantOut:     "\x1b",
			wantReplies: da1Reply,
		},
		{
			name:    "partial prefix held at end of stream is not emitted (teardown drops it)",
			chunks:  []string{"visible\x1b[>0"},
			wantOut: "visible",
		},
		{
			name:        "held partial prefix resolves to a match on the next chunk",
			chunks:      []string{"visible\x1b[>0", "c tail"},
			wantOut:     "visible tail",
			wantReplies: da2Reply,
		},
		{
			name:        "duplicate queries each answered (relay replies are per-query)",
			chunks:      []string{"\x1b[c", "\x1b[c"},
			wantOut:     "",
			wantReplies: da1Reply + da1Reply,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, replies := runDAFilter(t, tc.chunks)
			if out != tc.wantOut {
				t.Errorf("output = %q, want %q", out, tc.wantOut)
			}
			if replies != tc.wantReplies {
				t.Errorf("replies = %q, want %q", replies, tc.wantReplies)
			}
		})
	}
}

// TestDAFilter_StraddleEverySplitPoint splits every recognized query at every
// possible chunk boundary (including surrounding payload) and asserts the
// match still fires exactly once with the query fully stripped — the
// carry-over requirement (a query can straddle the 4096-byte streamFrameSize
// read boundary).
func TestDAFilter_StraddleEverySplitPoint(t *testing.T) {
	for _, q := range daQueries {
		for split := 1; split < len(q.query); split++ {
			chunks := []string{"pre" + q.query[:split], q.query[split:] + "post"}
			out, replies := runDAFilter(t, chunks)
			if out != "prepost" {
				t.Errorf("query %q split at %d: output = %q, want %q", q.query, split, out, "prepost")
			}
			if replies != q.reply {
				t.Errorf("query %q split at %d: replies = %q, want %q", q.query, split, replies, q.reply)
			}
		}
	}
}

// TestDAFilter_StraddleByteAtATime feeds a query one byte per chunk — the
// worst-case straddle — and asserts a single match.
func TestDAFilter_StraddleByteAtATime(t *testing.T) {
	for _, q := range daQueries {
		chunks := make([]string, 0, len(q.query))
		for i := 0; i < len(q.query); i++ {
			chunks = append(chunks, q.query[i:i+1])
		}
		out, replies := runDAFilter(t, chunks)
		if out != "" {
			t.Errorf("query %q byte-at-a-time: output = %q, want empty", q.query, out)
		}
		if replies != q.reply {
			t.Errorf("query %q byte-at-a-time: replies = %q, want %q", q.query, replies, q.reply)
		}
	}
}

// TestDAFilter_HeldPrefixBounded asserts the carry-over buffer never exceeds
// the longest proper query prefix (4 bytes — `\x1b[>0` awaiting `c`), even
// under adversarial repeated prefixes: the filter must hold back only a
// genuine partial match, releasing false prefixes as it goes.
func TestDAFilter_HeldPrefixBounded(t *testing.T) {
	var replyBuf bytes.Buffer
	f := newDAFilter(&replyBuf)
	const maxHold = 4
	// Repeated longest-proper-prefix: every iteration re-enters the hold state;
	// the previous hold must have been released (mismatch) or consumed.
	for i := 0; i < 100; i++ {
		f.process([]byte("\x1b[>0"))
		if len(f.held) > maxHold {
			t.Fatalf("held grew to %d bytes (want ≤ %d)", len(f.held), maxHold)
		}
	}
	if replyBuf.Len() != 0 {
		t.Errorf("no reply expected for unfinished prefixes, got %q", replyBuf.String())
	}
}

// TestDAFilter_FastPathZeroCopy pins the no-ESC fast path: with nothing held
// and no ESC in the chunk, process returns the chunk itself (zero-copy) — the
// common case for plain program output.
func TestDAFilter_FastPathZeroCopy(t *testing.T) {
	var replyBuf bytes.Buffer
	f := newDAFilter(&replyBuf)
	chunk := []byte("plain output, no escapes")
	out := f.process(chunk)
	if &out[0] != &chunk[0] || len(out) != len(chunk) {
		t.Errorf("fast path did not return the input chunk unmodified")
	}
}
