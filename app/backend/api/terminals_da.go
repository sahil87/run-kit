package api

import (
	"bytes"
	"io"
)

// Relay-side Device Attributes responder (change 260801-f715).
//
// Every rk terminal stream is a real `tmux attach-session` client on a PTY. On
// attach, tmux feature-detects that client by sending Device Attributes
// queries (DA1/DA2) to its tty. Before this filter, those queries traveled
// down the relay to the browser, xterm.js auto-answered them, and the answers
// flowed back through the keystroke channel — indistinguishable from typed
// input. tmux consumes exactly one DA1 and one DA2 reply per client tty
// (TTY_HAVEDA/TTY_HAVEDA2); extra or late replies (routine after a
// backgrounded-tab wake, where rAF-buffered queries from dead connections get
// re-answered into the CURRENT connection) fall through tmux's key parser and
// are TYPED into the active pane — the `1;2c0;276;0c…` junk at shell prompts.
//
// daFilter answers those queries at the relay instead: it scans the PTY output
// stream (bytes read from the ptmx, i.e. coming FROM the tmux client), writes
// the canned xterm.js-equivalent reply straight back to the ptmx on a match,
// and strips the matched query bytes from the browser-bound stream. xterm.js
// never sees a query, so it never answers one — replies become synchronous and
// exactly-once per attach, removing the browser round-trip (and with it the
// entire timing pathology) structurally.
//
// Interception scope is EXACTLY the four DA query forms below — no
// DSR/XTVERSION/OSC or other query handling. Pure stream processing: no
// subprocesses, no persisted state.

// Canned DA replies, byte-identical to what xterm.js would have sent (tmux
// previously feature-detected real xterm.js clients from these exact strings;
// 276 is xterm.js's hardcoded version number).
const (
	da1Reply = "\x1b[?1;2c"     // Primary Device Attributes: VT100 with AVO
	da2Reply = "\x1b[>0;276;0c" // Secondary Device Attributes: VT100, version 276
)

// daQueries is the exact recognized query set — nothing else is intercepted.
// No query is a prefix of another, so a full match is never ambiguous.
var daQueries = [...]struct{ query, reply string }{
	{"\x1b[c", da1Reply},   // DA1, no parameter
	{"\x1b[0c", da1Reply},  // DA1, explicit Ps=0
	{"\x1b[>c", da2Reply},  // DA2, no parameter
	{"\x1b[>0c", da2Reply}, // DA2, explicit Ps=0
}

// daEsc is the ESC byte every recognized query starts with — the fast-path
// scan key in process.
const daEsc = 0x1b

// daMatch classifies the held byte sequence against daQueries.
type daMatch int

const (
	daMatchNone   daMatch = iota // not a prefix of any query — release held bytes
	daMatchPrefix                // proper prefix of ≥1 query — keep holding
	daMatchFull                  // a complete query — reply and swallow
)

// daFilter is a per-stream scanner over the relay's PTY output. Feed each read
// chunk through process; matched queries are answered on `reply` (the ptmx)
// and removed from the returned browser-bound bytes. The carry-over `held`
// buffer holds a trailing partial-match prefix across chunk boundaries — it is
// bounded by the longest query minus one byte (4 bytes, `\x1b[>0` awaiting
// `c`), so it cannot grow. Bytes still held when the stream tears down are
// simply dropped with the filter (the pane is closing — moot).
type daFilter struct {
	reply io.Writer // the ptmx — tmux reads replies written here as client input
	held  []byte    // partial-match carry-over (≤ 4 bytes)
}

func newDAFilter(reply io.Writer) *daFilter {
	return &daFilter{reply: reply}
}

// process scans one PTY read chunk. It returns the browser-bound bytes with
// any matched query removed (order preserved) and writes the canned reply for
// each match to f.reply. The returned slice may alias chunk — callers must
// copy it before reusing the read buffer (pumpPTY does).
func (f *daFilter) process(chunk []byte) []byte {
	// Fast path: nothing held and no ESC anywhere — the chunk cannot contain
	// or start a query, so it passes through untouched (zero-copy).
	if len(f.held) == 0 && bytes.IndexByte(chunk, daEsc) < 0 {
		return chunk
	}
	out := make([]byte, 0, len(chunk)+len(f.held))
	for _, b := range chunk {
		out = f.step(out, b)
	}
	return out
}

// step advances the matcher by one byte, appending any released (non-query)
// bytes to out. Held bytes are always a valid query prefix between calls; on a
// mismatch the front byte is released and the remainder re-checked, so a false
// prefix is forwarded unmodified and in order — and a suffix that starts a new
// query (e.g. the second ESC in `\x1b\x1b[c`) keeps matching.
func (f *daFilter) step(out []byte, b byte) []byte {
	f.held = append(f.held, b)
	for len(f.held) > 0 {
		reply, match := f.matchHeld()
		switch match {
		case daMatchFull:
			// Answer at the relay. Best-effort: a write error means the PTY
			// died — the pump's next read observes EOF and tears down (the
			// same posture as handleDataFrame's keystroke write).
			_, _ = f.reply.Write([]byte(reply))
			f.held = f.held[:0]
			return out
		case daMatchPrefix:
			return out
		default:
			// Not a query: release the front byte, re-check the remainder.
			out = append(out, f.held[0])
			f.held = append(f.held[:0], f.held[1:]...)
		}
	}
	return out
}

// matchHeld classifies f.held against daQueries, returning the reply for a
// full match.
func (f *daFilter) matchHeld() (string, daMatch) {
	match := daMatchNone
	for _, q := range daQueries {
		if len(f.held) > len(q.query) || string(f.held) != q.query[:len(f.held)] {
			continue
		}
		if len(f.held) == len(q.query) {
			return q.reply, daMatchFull
		}
		match = daMatchPrefix
	}
	return "", match
}
