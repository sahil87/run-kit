package chat

import (
	"context"
	"errors"
	"sync"
)

// Conversation is the rk-schema backfill result: the full conversation as
// neutral events plus the retractable pending marker. It is the body of the
// backfill endpoint (GET /api/windows/{id}/chat).
//
// Offset is the transcript BYTE offset the backfill read up to — additive
// (older readers ignore it). It is the enabler for the state-socket chat
// subscription's gap-free/duplicate-free composition (260717-vhvz): the client
// GETs the backfill, then subscribes `kind:"chat"` with `from: <this offset>`,
// and the server's TailFrom emits only bytes >= from (see TailFrom). Events
// with byte position < Offset are in this body; events >= Offset are the tail's;
// no overlap, no gap.
type Conversation struct {
	Provider   string   `json:"provider"`
	SessionRef string   `json:"sessionRef"`
	Events     []Event  `json:"events"`
	Pending    *Pending `json:"pending"`
	Offset     int64    `json:"offset"`
}

// Update is one increment emitted by a TailFrom stream. Exactly one of the two
// shapes is populated per Update:
//
//   - Events (with Reset=false): newly appended rk-schema events, sent as the
//     stream's `chat` event vocabulary. Pending carries the current pending
//     state AFTER applying these events (nil = no pending / retracted), sent as
//     the `chat-state` event.
//   - Reset=true: the referenced transcript shrank/rewrote below the tail offset
//     (a re-derive is required). Under TailFrom, Reset is a bounded SHRINK SIGNAL
//     with no transcript payload (Conv is nil) — the caller re-runs the
//     GET-backfill→subscribe composition (emitted as a `chat-reset`), so a large
//     rotated conversation never rides the shared socket (decision D5).
//
// The API layer additionally re-resolves a rotated window ref and restarts the
// subscription; the adapter itself only knows about shrink/rewrite of the file
// it is tailing.
type Update struct {
	Events  []Event
	Pending *Pending
	Reset   bool
	Conv    *Conversation
}

// Adapter normalizes one provider's on-disk transcript into the rk chat schema.
// Both methods take the provider-defined session ref (the `@rk_chat` ref half)
// and are per-ref — an adapter holds no long-lived per-ref state between calls.
type Adapter interface {
	// Provider is the routing key (the `@rk_chat` provider prefix), e.g.
	// "claude". It matches the registry key under which the adapter is stored.
	Provider() string

	// Backfill reads the whole transcript for ref and returns the full
	// conversation (including its end byte Offset). A missing transcript is
	// surfaced as an error (this endpoint is where a missing transcript naturally
	// shows — Change 1's no-disk-validation rationale). ctx bounds the read.
	Backfill(ctx context.Context, ref string) (*Conversation, error)

	// TailFrom returns a channel of incremental Updates for ref, tailing from the
	// byte offset `from` (260717-vhvz). It PRIMES parser state by parsing bytes
	// 0..from (the turn counter + pending derivation need the full-file walk —
	// backfill and tail share one parser) and DISCARDS those primed events, then
	// emits ONLY bytes >= from as incremental `Events` updates and tails the file
	// for growth. Unlike the retired self-priming Tail, its first emission is NOT a
	// full-Conv Reset: the backfill (bytes 0..from) already reached the client via
	// GET /api/windows/{id}/chat, so the composition GET(offset)→TailFrom(from) is
	// gap-free and duplicate-free. A file already SHORTER than `from` at prime time
	// (or a later shrink/rewrite) yields a Reset (shrink signal) so the caller can
	// re-run the composition. The channel is closed when ctx is cancelled; no
	// goroutine outlives ctx (Constitution II). The implementation MUST NOT block
	// the caller: the poll loop runs on its own goroutine feeding the channel.
	TailFrom(ctx context.Context, ref string, from int64) (<-chan Update, error)
}

// ErrNoAdapter is returned by Lookup when no adapter is registered for a
// well-formed provider. The API layer maps it to a 404-class JSON error —
// presence-gating stays provider-agnostic and codex/gemini adapters are additive.
var ErrNoAdapter = errors.New("chat: no adapter for provider")

// TranscriptLocator is an OPTIONAL adapter capability: resolving a session ref
// to its on-disk transcript path. File-based providers (claude) implement it;
// a future protocol-based provider may have no on-disk transcript at all, so
// the capability lives off the core Adapter interface. The implementing
// adapter MUST keep the ref-format guard (see uuidRe) in front of every path
// resolution (Constitution I — path-traversal guard).
type TranscriptLocator interface {
	// TranscriptPath resolves ref to the absolute path of the session's
	// transcript file. An invalid ref is ErrInvalidRef (returned BEFORE any
	// filesystem access); a valid ref with no file is ErrTranscriptNotFound.
	TranscriptPath(ref string) (string, error)
}

// TranscriptPath resolves provider+ref to the absolute transcript path via the
// registry: Lookup routes to the provider's adapter, which is type-asserted to
// TranscriptLocator. An unregistered provider, or one without the capability,
// yields ErrNoAdapter (404-class at the API layer — the caller cannot do
// anything about a provider rk cannot read from disk).
func TranscriptPath(provider, ref string) (string, error) {
	a, err := Lookup(provider)
	if err != nil {
		return "", err
	}
	loc, ok := a.(TranscriptLocator)
	if !ok {
		return "", ErrNoAdapter
	}
	return loc.TranscriptPath(ref)
}

// registry maps a provider prefix to its Adapter. Guarded by mu so Register
// (called from adapter init) and Lookup (called per request) are race-free.
var (
	mu       sync.RWMutex
	registry = map[string]Adapter{}
)

// Register adds an adapter to the registry keyed by a.Provider(). Intended to be
// called from package init (see claude.go's init). A duplicate provider
// overwrites the prior registration — the last writer wins (there is only ever
// one adapter per provider in-tree).
func Register(a Adapter) {
	mu.Lock()
	defer mu.Unlock()
	registry[a.Provider()] = a
}

// Lookup returns the adapter registered for provider, or ErrNoAdapter when none
// is registered. An empty provider also returns ErrNoAdapter.
func Lookup(provider string) (Adapter, error) {
	mu.RLock()
	defer mu.RUnlock()
	a, ok := registry[provider]
	if !ok {
		return nil, ErrNoAdapter
	}
	return a, nil
}
