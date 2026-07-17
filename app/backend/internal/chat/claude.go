package chat

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// providerClaude is the routing key for the Claude adapter (the `@rk_chat`
// provider prefix). Declared once here.
const providerClaude = "claude"

const (
	// tailPollInterval is the stat/read-from-offset cadence for an open tail.
	// One stat per tick per open stream is negligible and dependency-free (no
	// fsnotify). Midpoint of the intake's ~300-500ms range; named so it is
	// tunable in one place.
	tailPollInterval = 400 * time.Millisecond
)

// uuidRe matches the strict Claude session-UUID shape. The ref MUST match this
// before ANY filesystem use — it is the path-traversal guard (Constitution I
// posture applied to file paths): the UUID *is* the transcript filename, so a
// value carrying `/`, `..`, or glob metacharacters can never reach the glob.
var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// ErrTranscriptNotFound is returned when a strict-UUID ref resolves to no file
// under any project dir. A live agent's transcript exists by construction, so
// this surfaces the "missing transcript for a live ref" case as a read error
// (the endpoint where a missing transcript naturally shows).
var ErrTranscriptNotFound = errors.New("chat: transcript not found for ref")

// ErrInvalidRef is returned when a ref fails the strict-UUID guard, before any
// filesystem access. It is exported so the API layer can map a malformed ref
// (which, for a window-keyed route, means the client only supplied a windowID
// whose reconciled @rk_chat is malformed — not a server fault) to a 404-class
// response rather than a 500.
var ErrInvalidRef = errors.New("chat: invalid session ref (not a uuid)")

// claudeAdapter reads and tails a Claude Code session transcript
// (`<root>/projects/*/<ref>.jsonl`) into the rk chat schema.
type claudeAdapter struct{}

func init() { Register(claudeAdapter{}) }

func (claudeAdapter) Provider() string { return providerClaude }

// transcriptRoot returns the Claude config root: $CLAUDE_CONFIG_DIR if set, else
// ~/.claude. An empty HOME with no override yields ".claude" (relative) — the
// glob then simply finds nothing, which surfaces as ErrTranscriptNotFound.
func transcriptRoot() string {
	if dir := os.Getenv("CLAUDE_CONFIG_DIR"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	return filepath.Join(home, ".claude")
}

// locateTranscript resolves ref to its transcript path via the glob
// `<root>/projects/*/<ref>.jsonl`. The ref MUST already be a strict UUID (callers
// gate on uuidRe first); this function re-gates defensively so it can never be
// called with an unguarded ref. Returns ErrTranscriptNotFound when no file
// matches.
func locateTranscript(ref string) (string, error) {
	if !uuidRe.MatchString(ref) {
		return "", ErrInvalidRef
	}
	root := transcriptRoot()
	// ref is a strict UUID (validated above), so it contains no glob
	// metacharacters — the only wildcard is the projects/* segment.
	matches, err := filepath.Glob(filepath.Join(root, "projects", "*", ref+".jsonl"))
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", ErrTranscriptNotFound
	}
	// A session UUID is unique across projects; if more than one matched (a
	// resumed session copied across cwds), the first is deterministic enough for
	// v1 — they name the same session.
	return matches[0], nil
}

// Backfill reads the whole transcript for ref and returns the full conversation,
// including the end byte Offset (the count of complete-line bytes consumed) so a
// state-socket chat subscription can compose GET(offset)→TailFrom(from) without a
// gap or duplicate (260717-vhvz).
func (a claudeAdapter) Backfill(ctx context.Context, ref string) (*Conversation, error) {
	if !uuidRe.MatchString(ref) {
		return nil, ErrInvalidRef
	}
	path, err := locateTranscript(ref)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	p := newParser()
	n, err := p.consume(ctx, f)
	if err != nil {
		return nil, err
	}
	return &Conversation{
		Provider:   providerClaude,
		SessionRef: ref,
		Events:     p.events,
		Pending:    p.pending(),
		Offset:     n,
	}, nil
}

// TailFrom returns a channel of incremental Updates for ref, tailing from byte
// offset `from` (260717-vhvz). It primes parser state by parsing 0..from and
// discarding those events (the turn counter + pending derivation need the
// full-file walk), then stat-polls the file for growth (no fsnotify) and emits
// ONLY bytes >= from. Unlike the retired self-priming Tail, its first emission is
// NOT a full-Conv Reset — the backfill already reached the client via the GET —
// so the composition GET(offset)→TailFrom(from) is gap-free and duplicate-free.
// The poll goroutine exits and closes the channel when ctx is cancelled — no
// state outlives the stream (Constitution II).
func (a claudeAdapter) TailFrom(ctx context.Context, ref string, from int64) (<-chan Update, error) {
	if !uuidRe.MatchString(ref) {
		return nil, ErrInvalidRef
	}
	path, err := locateTranscript(ref)
	if err != nil {
		return nil, err
	}

	out := make(chan Update, 8)
	go a.tailFromLoop(ctx, path, from, out)
	return out, nil
}

// tailFromLoop owns the whole tail lifecycle for one TailFrom stream. It primes
// parser state by consuming 0..from (discarding those events), then polls for
// growth/shrink and emits incremental Events updates — and a bounded Reset
// (shrink SIGNAL, Conv nil) when the file shrank below the tail offset — until
// ctx is done.
func (a claudeAdapter) tailFromLoop(ctx context.Context, path string, from int64, out chan<- Update) {
	defer close(out)

	// Prime parser state by walking 0..from; the resulting events are DISCARDED
	// (they were delivered by the GET backfill) — only the turn counter + pending
	// derivation carry forward, so appended events stay continuous.
	p := newParser()
	offset, ok := a.primeTo(ctx, path, from, p)
	if !ok {
		return // ctx cancelled mid-prime
	}
	// The file may already be shorter than `from` (rotated/cleared between the
	// GET and the subscribe). Signal a reset so the caller re-composes; primeTo
	// consumed only up to the real EOF, so `offset < from` detects this.
	if offset < from {
		if !send(ctx, out, Update{Reset: true}) {
			return
		}
	}

	ticker := time.NewTicker(tailPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		fi, err := os.Stat(path)
		if err != nil {
			// File vanished (session rotated/cleared). Hold the offset and keep
			// polling — the API layer's ref re-resolve drives the actual reset;
			// a transient stat error must not kill the stream.
			continue
		}
		size := fi.Size()
		switch {
		case size < offset:
			// Shrink/rewrite below the tail offset: emit a bounded Reset SIGNAL
			// (no transcript payload — decision D5). The caller re-runs the
			// GET-backfill→subscribe composition. Re-prime a fresh parser from the
			// new EOF so the tail continues cleanly for any further growth.
			p = newParser()
			newOffset, ok := a.primeTo(ctx, path, size, p)
			if !ok {
				return
			}
			offset = newOffset
			if !send(ctx, out, Update{Reset: true}) {
				return
			}
		case size > offset:
			before := len(p.events)
			newOffset, ok := a.readFromOffset(ctx, path, offset, p)
			if !ok {
				return
			}
			offset = newOffset
			if added := p.events[before:]; len(added) > 0 {
				// Copy the slice so the receiver never races the parser's
				// backing array on a subsequent grow.
				evs := make([]Event, len(added))
				copy(evs, added)
				if !send(ctx, out, Update{Events: evs, Pending: p.pending()}) {
					return
				}
			}
		}
	}
}

// primeTo consumes complete lines of path up to at most `limit` bytes into p,
// discarding the resulting events (only the turn counter + pending state carry
// forward). It returns the actual end offset consumed (<= limit, and < limit
// when the file is shorter than limit — the rotated/cleared case) and ok=false
// only when ctx was cancelled. It parses ONLY complete lines, so a partial final
// line straddling `limit` is left for the next growth read.
func (a claudeAdapter) primeTo(ctx context.Context, path string, limit int64, p *parser) (int64, bool) {
	if limit <= 0 {
		return 0, ctx.Err() == nil
	}
	f, err := os.Open(path)
	if err != nil {
		// Transient open error — treat as empty so the tail keeps polling.
		return 0, ctx.Err() == nil
	}
	defer f.Close()
	n, err := p.consume(ctx, io.LimitReader(f, limit))
	if err != nil && ctx.Err() != nil {
		return 0, false
	}
	if err != nil {
		// A non-ctx read error (e.g. a mid-file I/O fault): the primed turn/pending
		// state may be incomplete, but the tail continues from the bytes read so
		// far. Log it (observability) rather than swallowing silently.
		slog.Debug("chat: prime read error (non-fatal)", "path", path, "err", err)
	}
	// Discard the primed events — they belong to the GET backfill. The turn
	// counter and pending state remain in p for continuity.
	p.events = p.events[:0]
	return n, true
}

// readFromOffset seeks path to offset and consumes the newly-appended bytes into
// p, returning the new end offset. Only COMPLETE lines are parsed; a partial
// final line (no trailing newline) is left unread so it is picked up whole on the
// next tick. ok is false only when ctx was cancelled.
func (a claudeAdapter) readFromOffset(ctx context.Context, path string, offset int64, p *parser) (int64, bool) {
	f, err := os.Open(path)
	if err != nil {
		return offset, ctx.Err() == nil
	}
	defer f.Close()
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return offset, ctx.Err() == nil
	}
	n, err := p.consume(ctx, f)
	if err != nil && ctx.Err() != nil {
		return offset, false
	}
	return offset + n, true
}

// send delivers u on out unless ctx is cancelled first. Returns false when ctx
// won (the caller should stop).
func send(ctx context.Context, out chan<- Update, u Update) bool {
	select {
	case out <- u:
		return true
	case <-ctx.Done():
		return false
	}
}

// -------------------- tolerant JSONL parser --------------------

// looseEnvelope is the subset of a transcript line the parser reads. Every field
// is optional — unknown/absent fields are ignored (tolerant by design). content
// is json.RawMessage because it is EITHER a JSON array of blocks OR a plain
// string; the parser branches on the first non-space byte.
type looseEnvelope struct {
	Type        string `json:"type"`
	UUID        string `json:"uuid"`
	ParentUUID  string `json:"parentUuid"`
	Timestamp   string `json:"timestamp"`
	IsSidechain bool   `json:"isSidechain"`
	SessionID   string `json:"sessionId"`
	Message     *struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

// block is one content block inside message.content when content is an array.
type block struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	ID        string          `json:"id"`          // tool_use
	Name      string          `json:"name"`        // tool_use
	Input     json.RawMessage `json:"input"`       // tool_use
	ToolUseID string          `json:"tool_use_id"` // tool_result
	Content   json.RawMessage `json:"content"`     // tool_result (string or []block)
	IsError   bool            `json:"is_error"`    // tool_result
}

// parser accumulates rk-schema events across one or more consume() calls (backfill
// then tail increments share a parser so the turn counter and pending derivation
// stay continuous). It holds no I/O state — the byte offset lives in the adapter.
type parser struct {
	events    []Event
	turn      int // current turn number; incremented per user-initiated message
	malformed int // count of skipped malformed lines (observability)
	// openToolUses tracks tool_use ids that have NOT yet seen a matching
	// tool_result, keyed by id, so pending() can look up the unpaired one's meta.
	// openOrder holds the SAME still-open ids in append order (both are pruned in
	// lockstep by closeToolUse when a tool_result lands), so pending() can walk
	// from the tail to find the newest unpaired tool_use. Keeping openOrder pruned
	// bounds it to the currently-open set rather than to total tool traffic.
	openToolUses map[string]toolMeta
	openOrder    []string
}

type toolMeta struct {
	name string
	// question is the derived human-readable question text (AskUserQuestion), or
	// "" when not derivable.
	question string
}

func newParser() *parser {
	return &parser{
		openToolUses: map[string]toolMeta{},
	}
}

// consume reads r line-by-line, decoding each complete line and appending any
// resulting rk-schema events. It parses ONLY complete (newline-terminated) lines:
// a trailing partial line (no newline) is not consumed and its bytes are excluded
// from the returned byte count, so a tail picks it up whole next tick. Returns
// the number of bytes consumed (sum of complete-line lengths incl. their
// newlines). ctx cancellation stops the scan and returns ctx.Err().
func (p *parser) consume(ctx context.Context, r io.Reader) (int64, error) {
	br := bufio.NewReader(r)
	var consumed int64
	for {
		if err := ctx.Err(); err != nil {
			return consumed, err
		}
		line, err := br.ReadBytes('\n')
		if err != nil {
			// ReadBytes returns io.EOF ONLY when it hit EOF before finding the
			// delimiter, so `line` here is a partial (non-newline-terminated)
			// final chunk. Leave it unconsumed (do not count its bytes) so the
			// next read picks it up whole once its newline lands.
			if err == io.EOF {
				return consumed, nil
			}
			return consumed, err
		}
		consumed += int64(len(line))
		p.parseLine(line)
	}
}

// parseLine decodes one raw line and appends any resulting events. A malformed
// (non-JSON) line is counted and skipped. Non-conversation line types, sidechain
// lines, and unknown block types are skipped silently.
func (p *parser) parseLine(raw []byte) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return
	}
	var env looseEnvelope
	if err := json.Unmarshal([]byte(trimmed), &env); err != nil {
		p.malformed++
		slog.Debug("chat: skipping malformed transcript line", "err", err)
		return
	}
	// Only assistant/user lines carry the conversation. Everything else
	// (permission-mode, mode, custom-title, agent-name, last-prompt, attachment,
	// file-history-*, summary, system, ...) is skipped.
	if env.Type != "assistant" && env.Type != "user" {
		return
	}
	// Subagent traffic is excluded from the v1 stream.
	if env.IsSidechain {
		return
	}
	if env.Message == nil {
		return
	}
	blocks := p.decodeContent(env.Message.Content)
	// Turn accounting: a user-role message opens a new turn UNLESS it is solely a
	// tool_result carrier (which continues the current turn).
	if env.Type == "user" && !isToolResultCarrier(blocks) {
		p.turn++
	}
	for _, b := range blocks {
		p.appendBlockEvent(env, b)
	}
}

// decodeContent normalizes message.content — EITHER a plain string OR an array of
// blocks — into a []block. A string becomes a single text block. An array is
// decoded tolerantly (a block that fails to decode is skipped). Anything else
// (null, number, object) yields no blocks.
func (p *parser) decodeContent(raw json.RawMessage) []block {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return nil
	}
	switch s[0] {
	case '"':
		var str string
		if err := json.Unmarshal(raw, &str); err != nil {
			p.malformed++
			return nil
		}
		return []block{{Type: "text", Text: str}}
	case '[':
		var arr []block
		if err := json.Unmarshal(raw, &arr); err != nil {
			p.malformed++
			return nil
		}
		return arr
	default:
		return nil
	}
}

// appendBlockEvent maps one content block to an rk-schema Event (or nothing for
// unknown/skipped block types) and updates pending-tracking state.
func (p *parser) appendBlockEvent(env looseEnvelope, b block) {
	switch b.Type {
	case "text":
		if b.Text == "" {
			return
		}
		p.events = append(p.events, Event{
			Type:      EventMessage,
			ID:        env.UUID,
			Turn:      p.turn,
			Role:      Role(env.Message.Role),
			Text:      b.Text,
			Timestamp: env.Timestamp,
		})
	case "tool_use":
		p.events = append(p.events, Event{
			Type:      EventToolUse,
			ID:        env.UUID,
			Turn:      p.turn,
			ToolUseID: b.ID,
			ToolName:  b.Name,
			ToolInput: nonEmptyRaw(b.Input),
			Timestamp: env.Timestamp,
		})
		if b.ID != "" {
			p.openToolUses[b.ID] = toolMeta{name: b.Name, question: deriveQuestion(b.Name, b.Input)}
			p.openOrder = append(p.openOrder, b.ID)
		}
	case "tool_result":
		p.events = append(p.events, Event{
			Type:       EventToolResult,
			ID:         env.UUID,
			Turn:       p.turn,
			ToolUseID:  b.ToolUseID,
			ToolOutput: flattenToolResult(b.Content),
			IsError:    b.IsError,
			Timestamp:  env.Timestamp,
		})
		// The matching tool_use is now paired — drop it from both the open map
		// and the order slice so neither grows unbounded across a long session
		// (openOrder tracks only still-open ids, keeping pending()'s tail scan
		// proportional to the pending set, not to total tool traffic).
		if b.ToolUseID != "" {
			p.closeToolUse(b.ToolUseID)
		}
	default:
		// thinking (v1) and any unknown block type: skipped.
	}
}

// pending returns the retractable Pending marker: the most-recently-opened
// tool_use that still has no matching tool_result. Returns nil when every
// tool_use is paired (idle sessions end in text → no pending).
func (p *parser) pending() *Pending {
	// Walk openOrder from the tail so the newest unpaired tool_use wins.
	for i := len(p.openOrder) - 1; i >= 0; i-- {
		id := p.openOrder[i]
		if meta, ok := p.openToolUses[id]; ok {
			return &Pending{ToolUseID: id, ToolName: meta.name, Text: meta.question}
		}
	}
	return nil
}

// closeToolUse removes a now-paired tool_use id from BOTH the open map and the
// open-order slice, keeping the two in lockstep so openOrder never accumulates
// paired ids. Order of the remaining (still-open) ids is preserved, so pending()'s
// tail walk still finds the newest unpaired tool_use. A no-op if id was never open
// (e.g. a tool_result with no preceding tool_use in this stream).
func (p *parser) closeToolUse(id string) {
	if _, ok := p.openToolUses[id]; !ok {
		return
	}
	delete(p.openToolUses, id)
	for i, oid := range p.openOrder {
		if oid == id {
			p.openOrder = append(p.openOrder[:i], p.openOrder[i+1:]...)
			break
		}
	}
}

// isToolResultCarrier reports whether a user message's blocks are solely
// tool_result blocks (with at least one). Such a message continues the current
// turn rather than opening a new one.
func isToolResultCarrier(blocks []block) bool {
	if len(blocks) == 0 {
		return false
	}
	for _, b := range blocks {
		if b.Type != "tool_result" {
			return false
		}
	}
	return true
}

// flattenToolResult flattens a tool_result's content — a string OR an array of
// text blocks — to plain text. Non-text inner blocks are dropped (v1 text-only
// scope). Returns "" for empty/null content.
func flattenToolResult(raw json.RawMessage) string {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return ""
	}
	switch s[0] {
	case '"':
		var str string
		if err := json.Unmarshal(raw, &str); err != nil {
			return ""
		}
		return str
	case '[':
		var arr []block
		if err := json.Unmarshal(raw, &arr); err != nil {
			return ""
		}
		var parts []string
		for _, b := range arr {
			if b.Type == "text" && b.Text != "" {
				parts = append(parts, b.Text)
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}

// nonEmptyRaw returns raw unless it is empty/"null", in which case it returns nil
// so the Event's omitempty ToolInput is omitted.
func nonEmptyRaw(raw json.RawMessage) json.RawMessage {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return nil
	}
	return raw
}

// askQuestionInput is the AskUserQuestion tool_use input shape (only the fields
// needed to derive a human-readable question). The tool's input has a
// `questions` array; each question carries a prompt/question string.
type askQuestionInput struct {
	Questions []struct {
		Question string `json:"question"`
		Prompt   string `json:"prompt"`
		Header   string `json:"header"`
	} `json:"questions"`
}

// deriveQuestion extracts a human-readable question from a tool_use input when
// the tool is one whose input carries one (AskUserQuestion). Returns "" for any
// other tool or an undecodable input — pending still carries toolUseId/toolName.
func deriveQuestion(name string, input json.RawMessage) string {
	if name != "AskUserQuestion" || len(input) == 0 {
		return ""
	}
	var in askQuestionInput
	if err := json.Unmarshal(input, &in); err != nil {
		return ""
	}
	for _, q := range in.Questions {
		if q.Question != "" {
			return q.Question
		}
		if q.Prompt != "" {
			return q.Prompt
		}
		if q.Header != "" {
			return q.Header
		}
	}
	return ""
}
