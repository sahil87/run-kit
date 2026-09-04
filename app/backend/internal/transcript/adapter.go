// Package transcript resolves a window's reconciled chat session identity
// (<provider>:<session-ref>) to the agent's on-disk transcript path. It is a
// READ-ONLY view over the agent pane (Constitution VI — the pane stays the
// agent's parent process) and derives everything from disk at request time
// (Constitution II).
//
// The registry routes on the provider prefix so Codex/Gemini adapters are
// backend-only additions; v1 ships the Claude adapter (see claude.go).
package transcript

import (
	"errors"
	"sync"
)

// Adapter is one provider's transcript seam, keyed by its Provider routing
// prefix. An adapter holds no long-lived per-ref state between calls.
type Adapter interface {
	// Provider is the routing key (the provider prefix), e.g. "claude". It
	// matches the registry key under which the adapter is stored.
	Provider() string
}

// ErrNoAdapter is returned by Lookup when no adapter is registered for a
// well-formed provider. The API layer maps it to a 404-class JSON error —
// presence-gating stays provider-agnostic and codex/gemini adapters are additive.
var ErrNoAdapter = errors.New("transcript: no adapter for provider")

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

// Path resolves provider+ref to the absolute transcript path via the
// registry: Lookup routes to the provider's adapter, which is type-asserted to
// TranscriptLocator. An unregistered provider, or one without the capability,
// yields ErrNoAdapter (404-class at the API layer — the caller cannot do
// anything about a provider rk cannot read from disk).
func Path(provider, ref string) (string, error) {
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
