// Package updatecheck periodically asks the GitHub Releases API whether a newer
// run-kit release is available and caches the verdict in memory. It notifies
// only on a minor/major increase (patch differences never notify) and suppresses
// itself entirely when the running version is the "dev" sentinel or unparseable.
//
// State is derived and ephemeral (Constitution II — no database, no file): the
// latest verdict lives in an in-memory struct guarded by a mutex. The single
// external surface is one unauthenticated JSON GET every ~6h — far under the
// unauthenticated GitHub rate limit (60/hr/IP). Fetch/parse failures retain the
// previous verdict and never crash the daemon or surface to clients.
package updatecheck

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// releasesLatestURL is the unauthenticated GitHub endpoint returning the
	// latest NON-draft, NON-prerelease release for the repo.
	releasesLatestURL = "https://api.github.com/repos/sahil87/run-kit/releases/latest"
	// fetchTimeout bounds the GitHub HTTP GET (context-bound; a context-bound
	// net/http client is the idiomatic Go equivalent of the process-execution
	// timeout rule and cannot hang the server — Constitution I / intake §13).
	fetchTimeout = 10 * time.Second
	// initialCheckDelay is how long after startup the first check runs, so it
	// never competes with boot.
	initialCheckDelay = 30 * time.Second
	// checkInterval is the steady-state cadence. ~4 requests/day.
	checkInterval = 6 * time.Hour
	// devVersion is the sentinel for local (non-ldflags) builds — the checker is
	// suppressed for it (matches cmd/rk/root.go's `version = "dev"`).
	devVersion = "dev"
)

// Result is the cached verdict of the most recent successful check. Zero value
// (Qualifies=false) is the "no update / not yet checked" state.
type Result struct {
	// Current is the running version (no leading "v"), as passed to New.
	Current string
	// Latest is the newest normalized release version (no leading "v") observed
	// on the last successful fetch. Empty until the first success.
	Latest string
	// Qualifies is true when Latest is a minor/major increase over Current.
	Qualifies bool
}

// Checker polls the GitHub Releases API and caches the latest verdict.
type Checker struct {
	current    string
	suppressed bool // true when current is "dev" or unparseable — no fetch ever runs

	mu     sync.RWMutex
	result Result

	// fetchFn returns the latest normalized version string (no leading "v"). The
	// default issues the real GitHub GET; tests stub it. Kept as a field (not a
	// package var) so parallel tests don't race a shared seam.
	fetchFn func(ctx context.Context) (string, error)

	// OnQualify, when set, is invoked with (current, latest) the first time a
	// check transitions the verdict to qualifying (and again only if it
	// re-qualifies after being cleared). Wired in serve.go to
	// sseHub.broadcastUpdateAvailable. Set before Start.
	OnQualify func(current, latest string)
}

// New constructs a Checker for the given running version. The version is
// normalized (leading "v" stripped) for comparison. When the version is the
// "dev" sentinel or does not parse as X.Y.Z, the checker is permanently
// suppressed: Start is a no-op and Snapshot always reports no update.
func New(current string) *Checker {
	norm := normalizeTag(current)
	c := &Checker{current: norm}
	c.result = Result{Current: norm}
	if current == devVersion {
		c.suppressed = true
	} else if _, _, err := parseMajorMinor(norm); err != nil {
		c.suppressed = true
	}
	c.fetchFn = defaultFetch
	return c
}

// Snapshot returns the current cached verdict (deep-copy-safe — Result is a
// value type with no reference fields).
func (c *Checker) Snapshot() Result {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.result
}

// Start launches the background poll goroutine: an initial check after
// initialCheckDelay, then a fixed checkInterval ticker, exiting on ctx.Done().
// A suppressed checker (dev/unparseable running version) is a no-op.
func (c *Checker) Start(ctx context.Context) {
	c.mu.RLock()
	suppressed := c.suppressed
	c.mu.RUnlock()
	if suppressed {
		slog.Info("update checker suppressed", "version", c.current)
		return
	}
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(initialCheckDelay):
		}
		c.checkOnce(ctx)

		ticker := time.NewTicker(checkInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.checkOnce(ctx)
			}
		}
	}()
}

// checkOnce performs one fetch+compare, updating the cached verdict on success
// and firing OnQualify on a newly-qualifying transition. On fetch/parse error it
// logs a warning and retains the previous verdict (stale-while-revalidate).
func (c *Checker) checkOnce(ctx context.Context) {
	fetchCtx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	c.mu.RLock()
	fetchFn := c.fetchFn
	c.mu.RUnlock()

	latest, err := fetchFn(fetchCtx)
	if err != nil {
		slog.Warn("update check fetch failed (retaining previous result)", "err", err)
		return
	}
	latest = normalizeTag(latest)

	isQualifying := qualifies(c.current, latest)

	c.mu.Lock()
	wasQualifying := c.result.Qualifies
	prevLatest := c.result.Latest
	c.result = Result{Current: c.current, Latest: latest, Qualifies: isQualifying}
	c.mu.Unlock()

	// Fire on the first qualifying transition AND whenever a still-qualifying
	// check reports a NEWER latest (e.g. 0.6.0 → 0.7.0): the SSE cached slot must
	// refresh so the chip and the per-version dismissal re-show contract stay
	// current. An unchanged qualifying latest must NOT re-fire.
	if isQualifying && (!wasQualifying || latest != prevLatest) && c.OnQualify != nil {
		c.OnQualify(c.current, latest)
	}
}

// SetFetchForTest replaces the fetch seam with a stub. Exported so tests in
// OTHER packages (e.g. api handler tests that need a checker with a canned
// verdict) can drive the checker without a network call. The parameter is
// context-free for caller convenience; the context is supplied internally.
func (c *Checker) SetFetchForTest(fn func() (string, error)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fetchFn = func(context.Context) (string, error) { return fn() }
	c.suppressed = false
}

// CheckOnceForTest runs a single synchronous check (fetch + compare + verdict
// update + OnQualify). Exported so cross-package tests can materialise a
// qualifying snapshot deterministically without waiting for the ~30s scheduler.
func (c *Checker) CheckOnceForTest() {
	c.checkOnce(context.Background())
}

// defaultFetch issues the real unauthenticated GitHub GET and returns the
// release's tag_name. Context-bound (Constitution I) — never blocks the server.
func defaultFetch(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releasesLatestURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Drain a little so the connection can be reused, then error out.
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("github releases API returned status %d", resp.StatusCode)
	}
	var body struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	if strings.TrimSpace(body.TagName) == "" {
		return "", fmt.Errorf("release has no tag_name")
	}
	return body.TagName, nil
}

// normalizeTag strips a single leading "v" and surrounding whitespace so the
// GitHub tag ("v0.6.0") and the ldflags-injected version ("0.6.0") compare on
// equal footing.
func normalizeTag(tag string) string {
	return strings.TrimPrefix(strings.TrimSpace(tag), "v")
}

// parseMajorMinor parses the major and minor components of an X.Y.Z version.
// It requires at least "X.Y" and tolerates trailing components (patch,
// pre-release suffixes on the patch). Returns an error when major/minor are
// absent or non-numeric.
func parseMajorMinor(v string) (major, minor int, err error) {
	parts := strings.Split(v, ".")
	if len(parts) < 2 {
		return 0, 0, fmt.Errorf("version %q has fewer than 2 components", v)
	}
	major, err = strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil {
		return 0, 0, fmt.Errorf("version %q major not an int: %w", v, err)
	}
	minor, err = strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil {
		return 0, 0, fmt.Errorf("version %q minor not an int: %w", v, err)
	}
	return major, minor, nil
}

// qualifies reports whether latest is a minor OR major increase over current.
// Patch-level differences (equal major+minor) never qualify. An unparseable
// current or latest never qualifies (defensive — current is validated at New,
// but a malformed latest tag from GitHub must not panic or falsely notify).
func qualifies(current, latest string) bool {
	cMaj, cMin, err := parseMajorMinor(current)
	if err != nil {
		return false
	}
	lMaj, lMin, err := parseMajorMinor(latest)
	if err != nil {
		return false
	}
	if lMaj != cMaj {
		return lMaj > cMaj
	}
	return lMin > cMin
}
