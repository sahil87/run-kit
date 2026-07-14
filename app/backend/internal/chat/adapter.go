package chat

import (
	"context"
	"errors"
	"sync"
)

// Conversation is the rk-schema backfill result: the full conversation as
// neutral events plus the retractable pending marker. It is the body of the
// backfill endpoint and the payload of the stream's `chat-backfill` event.
type Conversation struct {
	Provider   string   `json:"provider"`
	SessionRef string   `json:"sessionRef"`
	Events     []Event  `json:"events"`
	Pending    *Pending `json:"pending"`
}

// Update is one increment emitted by a Tail stream. Exactly one of the two
// shapes is populated per Update:
//
//   - Events (with Reset=false): newly appended rk-schema events, sent as the
//     stream's `chat` event vocabulary. Pending carries the current pending
//     state AFTER applying these events (nil = no pending / retracted), sent as
//     the `chat-state` event.
//   - Reset=true: the referenced transcript shrank/rewrote (e.g. a re-derive is
//     required); Conversation carries a fresh full backfill to replace the
//     client's view. Emitted as a fresh `chat-backfill`.
//
// A Tail also emits a Reset update when the window's session ref rotates (the API
// layer re-resolves the ref and re-subscribes); the adapter itself only knows
// about shrink/rewrite of the file it is tailing.
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
	// conversation. A missing transcript is surfaced as an error (this endpoint
	// is where a missing transcript naturally shows — Change 1's
	// no-disk-validation rationale). ctx bounds the read.
	Backfill(ctx context.Context, ref string) (*Conversation, error)

	// Tail returns a channel of incremental Updates for ref, starting AFTER the
	// events already returned by a preceding Backfill (the caller passes the
	// backfill's end offset via the ref-scoped Backfill+Tail pairing — see the
	// claude adapter). The channel is closed when ctx is cancelled; no goroutine
	// outlives ctx (Constitution II — nothing cached beyond the stream). The
	// implementation MUST NOT block the caller: the poll loop runs on its own
	// goroutine feeding the returned channel.
	Tail(ctx context.Context, ref string) (<-chan Update, error)
}

// ErrNoAdapter is returned by Lookup when no adapter is registered for a
// well-formed provider. The API layer maps it to a 404-class JSON error —
// presence-gating stays provider-agnostic and codex/gemini adapters are additive.
var ErrNoAdapter = errors.New("chat: no adapter for provider")

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
