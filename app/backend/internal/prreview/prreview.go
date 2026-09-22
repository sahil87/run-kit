// Package prreview is the ON-DEMAND half of run-kit's pull-request review
// data: the file list, the patches, and the full review-thread bodies for the
// PR a window's branch resolves to.
//
// WHY THIS IS NOT internal/prstatus. The two halves have opposite cost
// profiles and must not share a package:
//
//   - the DIGEST (thread id, resolved/outdated, path, line, the first
//     comment's id/author/👀) rides prstatus's existing batched
//     viewer.pullRequests query every 90s across every PR the viewer owns, for
//     zero additional gh calls. It is what the comment LISTENER reads, so it
//     must not depend on a tile being open.
//   - the DETAIL (this package) is fetched only while a review tile is
//     mounted. Pulling full comment bodies and patches into the batch would
//     multiply that payload by comment count across a 100-PR window every 90s.
//
// Posture is prstatus's, proven there: a refreshMu that single-flights whole
// passes INCLUDING their subprocesses, a separate mu guarding the map for
// readers that never spans a subprocess, stale-while-revalidate on error, an
// injectable availability gate, and exec.CommandContext with explicit argv
// slices under a timeout (Constitution I). Nothing is persisted: every cache
// here is in-memory, droppable, and re-derived from gh on a cold start
// (Constitution II).
//
// User-authored prose (comment bodies) NEVER reaches gh through argv — the
// write paths in write.go hand gh a JSON document on stdin.
package prreview

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"rk/internal/ghprobe"
)

// ghTimeout bounds every gh subprocess so a hung network can never block a
// request goroutine past the API's own cap (Constitution Process Execution).
const ghTimeout = 10 * time.Second

// reviewTTL is how long a fetched review document is served before a mount
// re-fetches it. The tile also has an explicit refresh verb and rides the SSE
// tick, so this is a floor on gh volume, not a freshness promise.
const reviewTTL = 60 * time.Second

// filesPerPage is the page size for the PR files listing. GitHub caps it at
// 100; --paginate walks the rest.
const filesPerPage = 100

// ErrNoPR is returned when a window carries no pull request. The surface is
// PR-backed only, so this is a state the handler maps to 404, not a failure.
var ErrNoPR = errors.New("window has no pull request")

// ErrUnavailable is returned when gh is absent or unauthenticated. Callers map
// it to a content state, never to an error banner — the same fail-silent
// posture prstatus takes.
var ErrUnavailable = errors.New("gh is unavailable")

// PRRef is a pull request's identity parsed out of its canonical URL. The host
// is carried because a GHE remote resolves through the same gh binary with a
// --hostname flag.
type PRRef struct {
	Host   string
	Owner  string
	Repo   string
	Number int
}

// Repository renders the `owner/name` path segment gh's REST routes take.
func (r PRRef) Repository() string { return r.Owner + "/" + r.Repo }

// ParsePRURL parses a canonical pull-request URL into its identity. It accepts
// exactly `<scheme>://<host>/<owner>/<repo>/pull/<number>` — the shape
// prstatus stores — and rejects everything else rather than guessing, because
// a mis-parsed identity would address a DIFFERENT repository's PR.
func ParsePRURL(raw string) (PRRef, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return PRRef{}, fmt.Errorf("pr url %q: %w", raw, err)
	}
	if u.Host == "" {
		return PRRef{}, fmt.Errorf("pr url %q: no host", raw)
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) != 4 || parts[2] != "pull" {
		return PRRef{}, fmt.Errorf("pr url %q: not an <owner>/<repo>/pull/<n> path", raw)
	}
	number, err := strconv.Atoi(parts[3])
	if err != nil || number <= 0 {
		return PRRef{}, fmt.Errorf("pr url %q: bad pull number %q", raw, parts[3])
	}
	if parts[0] == "" || parts[1] == "" {
		return PRRef{}, fmt.Errorf("pr url %q: empty owner or repo", raw)
	}
	return PRRef{Host: u.Hostname(), Owner: parts[0], Repo: parts[1], Number: number}, nil
}

// ghRunner is the single subprocess seam. `stdin` is nil for reads; the write
// paths pass a JSON document there so user prose never enters argv.
type ghRunner func(ctx context.Context, stdin []byte, args ...string) ([]byte, error)

// FileEntry is one changed file in the PR.
type FileEntry struct {
	Path         string `json:"path"`
	PreviousPath string `json:"previousPath,omitempty"`
	Status       string `json:"status"`
	Additions    int    `json:"additions"`
	Deletions    int    `json:"deletions"`
	// Patch is the unified patch gh returns. Empty for binary files and for
	// diffs GitHub declines to render — the client shows those as a
	// no-diff row rather than an error.
	Patch string `json:"-"`
	// Sha is the post-image blob sha; "" on a removed file.
	Sha string `json:"sha,omitempty"`
	// HasPatch lets the client render the "no diff available" row without
	// shipping the patch text it is not going to use (R4: the list and the
	// body are separate reads).
	HasPatch bool `json:"hasPatch"`
}

// Comment is one review comment inside a thread.
type Comment struct {
	ID         string    `json:"id"`
	DatabaseID int64     `json:"databaseId,omitempty"`
	Author     string    `json:"author"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"createdAt"`
	URL        string    `json:"url,omitempty"`
	// Eyes is the 👀 reaction presence. It is ACTOR-BLIND by design (spec
	// § Dedupe): the predicate performs no identity join, so a human's 👀 and
	// the listener's own mean the same thing — claimed.
	Eyes bool `json:"eyes"`
}

// Thread is one review thread: its state plus every comment in it, in order.
type Thread struct {
	ID         string    `json:"id"`
	IsResolved bool      `json:"isResolved"`
	IsOutdated bool      `json:"isOutdated"`
	Path       string    `json:"path"`
	Line       int       `json:"line"`
	StartLine  int       `json:"startLine,omitempty"`
	Side       string    `json:"side"`
	Comments   []Comment `json:"comments"`
}

// Review is one fetched PR-detail document.
type Review struct {
	URL       string      `json:"url"`
	Number    int         `json:"number"`
	Repo      string      `json:"repo"`
	Title     string      `json:"title"`
	State     string      `json:"state"`
	HeadSha   string      `json:"headSha"`
	BaseSha   string      `json:"baseSha"`
	Viewer    string      `json:"viewer"`
	Files     []FileEntry `json:"files"`
	Threads   []Thread    `json:"threads"`
	FetchedAt time.Time   `json:"fetchedAt"`
}

// Fetcher serves PR-detail documents, cached in memory.
//
// The cache is keyed (prURL, headSha) as the spec requires: the map is keyed by
// URL and the entry carries its head sha, so a lookup naming a different head
// sha misses and the next fetch REPLACES the entry wholesale. Keying the map
// itself by the pair would retain one document per push forever, which is the
// unbounded growth prstatus's wholesale-rebuild rule exists to avoid.
type Fetcher struct {
	// mu guards byURL for readers. It never spans a subprocess.
	mu    sync.RWMutex
	byURL map[string]*Review

	// refreshMu single-flights whole fetch passes INCLUDING their gh calls, so
	// two mounts of the same tile cannot interleave their swaps. Distinct from
	// mu for exactly prstatus's reason.
	refreshMu sync.Mutex

	ghExec    ghRunner
	available func(ctx context.Context) bool
	now       func() time.Time
	ttl       time.Duration

	blobs *blobCache
	// refineMu guards the tier-2 latch and result on blob entries. Separate
	// from the cache's own mutex because the background pass publishes its
	// spans long after the cache handed the entry out.
	refineMu sync.Mutex
}

// NewFetcher builds a fetcher with production seams.
func NewFetcher() *Fetcher {
	return &Fetcher{
		byURL:     make(map[string]*Review),
		ghExec:    defaultGhExec,
		available: ghAvailable,
		now:       time.Now,
		ttl:       reviewTTL,
		blobs:     newBlobCache(blobBudgetBytes),
	}
}

// Snapshot returns the cached document for a PR URL when it is still within
// the TTL, else nil. Callers treat nil as "fetch".
func (f *Fetcher) Snapshot(prURL string) *Review {
	f.mu.RLock()
	defer f.mu.RUnlock()
	got := f.byURL[prURL]
	if got == nil {
		return nil
	}
	if f.now().Sub(got.FetchedAt) > f.ttl {
		return got // stale: still serveable, the caller decides whether to refresh
	}
	return got
}

// fresh reports whether a cached document is inside the TTL.
func (f *Fetcher) fresh(got *Review) bool {
	return got != nil && f.now().Sub(got.FetchedAt) <= f.ttl
}

// Get returns the PR-detail document, fetching when the cache is cold, stale,
// or explicitly invalidated by `force`.
//
// STALE-WHILE-REVALIDATE: a gh error or a parse failure on a pass that has a
// cached document returns the cached document, never an error — the network
// blip must not blank a mounted tile.
func (f *Fetcher) Get(ctx context.Context, prURL string, force bool) (*Review, error) {
	if cached := f.Snapshot(prURL); f.fresh(cached) && !force {
		return cached, nil
	}

	f.refreshMu.Lock()
	defer f.refreshMu.Unlock()

	// A pass that blocked on refreshMu may find the work already done.
	if cached := f.Snapshot(prURL); f.fresh(cached) && !force {
		return cached, nil
	}
	if f.available != nil && !f.available(ctx) {
		if cached := f.Snapshot(prURL); cached != nil {
			return cached, nil
		}
		return nil, ErrUnavailable
	}

	next, err := f.fetch(ctx, prURL)
	if err != nil {
		if cached := f.Snapshot(prURL); cached != nil {
			return cached, nil
		}
		return nil, err
	}

	f.mu.Lock()
	f.byURL[prURL] = next
	f.mu.Unlock()
	return next, nil
}

// Invalidate drops a PR's cached document so the next Get re-fetches. Called
// by every write path — a posted comment must be visible on the next read.
func (f *Fetcher) Invalidate(prURL string) {
	f.mu.Lock()
	delete(f.byURL, prURL)
	f.mu.Unlock()
}

// Scavenge releases idle cache memory. Safe to call on any cadence; it is
// latched internally so a long idle period pays once.
func (f *Fetcher) Scavenge() { f.blobs.scavenge(f.now()) }

// fetch runs the three gh reads one document needs: PR metadata, the file list,
// and the review threads (the viewer login rides the thread query, so it costs
// no call of its own).
func (f *Fetcher) fetch(ctx context.Context, prURL string) (*Review, error) {
	ref, err := ParsePRURL(prURL)
	if err != nil {
		return nil, err
	}
	meta, err := f.fetchMeta(ctx, ref)
	if err != nil {
		return nil, err
	}
	files, err := f.fetchFiles(ctx, ref)
	if err != nil {
		return nil, err
	}
	threads, viewer, err := f.fetchThreads(ctx, ref)
	if err != nil {
		return nil, err
	}
	return &Review{
		URL:       prURL,
		Number:    ref.Number,
		Repo:      ref.Repository(),
		Title:     meta.Title,
		State:     meta.State,
		HeadSha:   meta.HeadSha,
		BaseSha:   meta.BaseSha,
		Viewer:    viewer,
		Files:     files,
		Threads:   threads,
		FetchedAt: f.now(),
	}, nil
}

// defaultGhExec runs one gh invocation with an explicit argv slice under
// ghTimeout. `stdin`, when non-nil, is the request body — the ONLY channel
// user-authored prose ever takes (Constitution I).
func defaultGhExec(ctx context.Context, stdin []byte, args ...string) ([]byte, error) {
	callCtx, cancel := context.WithTimeout(ctx, ghTimeout)
	defer cancel()
	cmd := exec.CommandContext(callCtx, "gh", args...)
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return nil, fmt.Errorf("gh: %s", msg)
		}
		return nil, err
	}
	return out, nil
}

// ghAvailable is the package's default `available` seam — the shared probe
// under this package's own gh budget (internal/ghprobe is the single source,
// so prstatus and prreview cannot drift on what "gh is unavailable" means).
func ghAvailable(ctx context.Context) bool {
	return ghprobe.Available(ctx, ghTimeout)
}

// NewTestFetcher builds a fetcher with the two subprocess seams injected. It
// exists because the api package's handler tests must exercise the real
// fetch/parse/highlight path without a gh binary; every other field keeps its
// production default.
func NewTestFetcher(available func(context.Context) bool, gh func(ctx context.Context, stdin []byte, args ...string) ([]byte, error)) *Fetcher {
	f := NewFetcher()
	if available != nil {
		f.available = available
	}
	if gh != nil {
		f.ghExec = ghRunner(gh)
	}
	return f
}
