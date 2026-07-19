// Package updatecheck periodically fetches the shll.ai version manifest and
// decides which shll-toolkit tools (run-kit and its siblings) have a newer
// release worth notifying about. It caches the verdict in memory and fires a
// callback whenever the set of matched tools changes.
//
// The manifest carries per-tool notify policy (`never`/`patch`/`minor`), so the
// notify thresholds are tuned centrally on shll.ai and picked up within one poll
// cycle — never compiled into this binary. The checker suppresses itself
// entirely when the running version is the "dev" sentinel or unparseable (a dev
// build never polls, which also keeps e2e runs off the network).
//
// State is derived and ephemeral (Constitution II — no database, no file): the
// latest verdict lives in an in-memory struct guarded by a mutex. The external
// surfaces are one unauthenticated JSON GET every ~6h (far under the CDN's
// budget) plus, per check, one `brew list --versions` exec to read installed
// versions of the sibling tools. Fetch/parse/exec failures retain the previous
// verdict and never crash the daemon or surface to clients.
package updatecheck

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// manifestURL is the shll.ai version manifest — a single static JSON document
	// listing the latest version + notify policy + brew formula per toolkit tool.
	// Produced by shll.ai's help-dump puller (a sibling change), it is the roster
	// authority so run-kit never hardcodes the tool list.
	manifestURL = "https://shll.ai/versions.json"
	// runKitTool is the manifest key for run-kit's own row — the one row compared
	// against the RUNNING ldflags version (not brew's on-disk version), and the
	// only row considered when shll is absent from PATH.
	runKitTool = "run-kit"
	// fetchTimeout bounds the manifest HTTP GET (context-bound; a context-bound
	// net/http client is the idiomatic Go equivalent of the process-execution
	// timeout rule and cannot hang the server — Constitution I).
	fetchTimeout = 10 * time.Second
	// brewTimeout bounds the `brew list --versions` exec (Constitution I).
	brewTimeout = 10 * time.Second
	// initialCheckDelay is how long after startup the first check runs, so it
	// never competes with boot.
	initialCheckDelay = 30 * time.Second
	// checkInterval is the steady-state cadence. ~4 requests/day.
	checkInterval = 6 * time.Hour
	// devVersion is the sentinel for local (non-ldflags) builds — the checker is
	// suppressed for it (matches cmd/rk/root.go's `version = "dev"`).
	devVersion = "dev"

	// notify policy values carried verbatim in the manifest.
	notifyNever = "never"
	notifyPatch = "patch"
	notifyMinor = "minor"
)

// ManifestTool is one tool's entry in the shll.ai manifest.
type ManifestTool struct {
	// Latest is the newest published version (no leading "v" expected, but
	// normalizeTag tolerates one).
	Latest string `json:"latest"`
	// Notify is the per-tool policy: "never", "patch", or "minor".
	Notify string `json:"notify"`
	// Formula is the Homebrew formula name used to read the installed version via
	// `brew list --versions <formula>`.
	Formula string `json:"formula"`
}

// Manifest is the decoded shll.ai/versions.json document.
type Manifest struct {
	Schema      int                     `json:"schema"`
	GeneratedAt string                  `json:"generated_at"`
	Tools       map[string]ManifestTool `json:"tools"`
}

// ToolUpdate is one matched tool in the verdict: a tool whose installed version
// crosses its notify threshold against the manifest's latest.
type ToolUpdate struct {
	// Tool is the manifest key (e.g. "run-kit", "fab-kit").
	Tool string
	// Installed is the version currently installed (the running ldflags version
	// for the run-kit row; the brew-listed version for every other tool).
	Installed string
	// Latest is the manifest's latest version for this tool.
	Latest string
}

// Result is the cached verdict of the most recent successful check. The zero
// value (empty Matched, empty Key) is the "no update / not yet checked" state.
type Result struct {
	// Matched lists every tool whose installed version crosses its notify
	// threshold, in deterministic sorted-name order (a Go JSON map cannot
	// preserve manifest order, and `shll update` re-normalizes argv to roster
	// order anyway).
	Matched []ToolUpdate
	// Key is the composite dismissal key: sorted "tool@latest" pairs, comma
	// joined (e.g. "fab-kit@2.17.0,run-kit@3.9.0"). Empty when nothing matches.
	Key string
	// Current and Latest are populated from the run-kit row when run-kit is in
	// the match set (else empty). Retained for transitional frontend compat — a
	// not-yet-reloaded client keys off a non-empty Latest.
	Current string
	Latest  string
}

// Checker polls the shll.ai manifest and caches the latest verdict.
type Checker struct {
	current    string // running run-kit version (no leading "v")
	selfBrew   bool   // whether THIS run-kit binary is a Homebrew install
	suppressed bool   // true when current is "dev" or unparseable — no check ever runs

	mu     sync.RWMutex
	result Result

	// fetchFn returns the decoded manifest. The default issues the real shll.ai
	// GET; tests stub it. Kept as a field (not a package var) so parallel tests
	// don't race a shared seam.
	fetchFn func(ctx context.Context) (Manifest, error)
	// brewListFn returns a formula→installed-version map for the given formulae
	// via `brew list --versions`. A missing formula simply produces no entry. The
	// default runs the real exec; tests stub it.
	brewListFn func(ctx context.Context, formulae []string) (map[string]string, error)
	// lookShllFn reports whether `shll` is on PATH. Default wraps exec.LookPath;
	// tests stub it. When false, matching scopes to the run-kit row only.
	lookShllFn func() bool

	// OnQualify, when set, is invoked with the new verdict whenever a check
	// changes Key at all — to a non-empty value (first match, re-match after
	// clearing, any newer latest or newly-matching tool) OR to empty (all
	// previously-matched tools became current: the "consumed match" clear). An
	// unchanged key (empty or not) never re-fires. Wired in serve.go to
	// sseHub.broadcastUpdateAvailable. Set before Start.
	OnQualify func(Result)

	// startCtx is the daemon context captured at Start, so a RecheckAfter timer
	// is bound to the daemon lifetime (it dies with the process). nil until
	// Start; RecheckAfter is a no-op before Start or on a suppressed checker.
	startCtx context.Context

	// recheckHook, when set (SetRecheckHookForTest), replaces RecheckAfter's real
	// scheduling with a delay-recording hook for cross-package handler tests.
	recheckHook func(time.Duration)
}

// New constructs a Checker for the given running run-kit version and its own
// brew-install status. The version is normalized (leading "v" stripped). When
// the version is the "dev" sentinel or does not parse as X.Y.Z, the checker is
// permanently suppressed: Start is a no-op and Snapshot always reports no update.
func New(current string, selfBrew bool) *Checker {
	norm := normalizeTag(current)
	c := &Checker{current: norm, selfBrew: selfBrew}
	c.result = Result{}
	if current == devVersion {
		c.suppressed = true
	} else if _, _, err := parseMajorMinor(norm); err != nil {
		c.suppressed = true
	}
	c.fetchFn = defaultFetch
	c.brewListFn = defaultBrewList
	c.lookShllFn = func() bool { _, err := exec.LookPath("shll"); return err == nil }
	return c
}

// Snapshot returns the current cached verdict. The returned Result shares its
// Matched slice with the checker; callers MUST NOT mutate it.
func (c *Checker) Snapshot() Result {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.result
}

// Start launches the background poll goroutine: an initial check after
// initialCheckDelay, then a fixed checkInterval ticker, exiting on ctx.Done().
// A suppressed checker (dev/unparseable running version) is a no-op.
func (c *Checker) Start(ctx context.Context) {
	c.mu.Lock()
	suppressed := c.suppressed
	c.startCtx = ctx
	c.mu.Unlock()
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

// checkOnce performs one fetch + match + verdict update, firing OnQualify when
// the composite Key changes at all (including to empty). On fetch/parse error it
// logs a warning and retains the previous verdict (stale-while-revalidate).
func (c *Checker) checkOnce(ctx context.Context) {
	c.mu.RLock()
	fetchFn := c.fetchFn
	brewListFn := c.brewListFn
	lookShllFn := c.lookShllFn
	c.mu.RUnlock()

	fetchCtx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	manifest, err := fetchFn(fetchCtx)
	if err != nil {
		slog.Warn("update check fetch failed (retaining previous result)", "err", err)
		return
	}

	matched := c.computeMatched(ctx, manifest, brewListFn, lookShllFn)
	key := computeKey(matched)
	current, latest := runKitFields(matched)
	newResult := Result{Matched: matched, Key: key, Current: current, Latest: latest}

	c.mu.Lock()
	prevKey := c.result.Key
	c.result = newResult
	onQualify := c.OnQualify
	c.mu.Unlock()

	// Fire whenever the key CHANGES at all: to a non-empty value (first match,
	// re-match after clearing, a newer latest, or a newly-matching tool) OR to
	// empty (all previously-matched tools became current — the consumed-match
	// clear). An unchanged key (empty or not) must NOT re-fire. The cleared
	// verdict is first-class: it broadcasts + replaces the cached SSE slot so a
	// reconnecting/new tab never replays a stale consumed match (R7/R8).
	if key != prevKey && onQualify != nil {
		onQualify(newResult)
	}
}

// computeMatched builds the matched-tool list for a manifest. The run-kit row is
// compared against the running ldflags version (and gated on this binary being a
// brew install); every other tool's installed version comes from one
// `brew list --versions` exec joined on the manifest's formula. When shll is
// absent from PATH, matching scopes to the run-kit row only.
func (c *Checker) computeMatched(
	ctx context.Context,
	manifest Manifest,
	brewListFn func(context.Context, []string) (map[string]string, error),
	lookShllFn func() bool,
) []ToolUpdate {
	shllPresent := lookShllFn()

	// Gather the formulae for every non-run-kit tool so a single brew exec reads
	// them all. Only needed when shll is present (otherwise only run-kit matters).
	var installed map[string]string
	if shllPresent {
		var formulae []string
		for name, tool := range manifest.Tools {
			if name == runKitTool {
				continue
			}
			if f := strings.TrimSpace(tool.Formula); f != "" {
				formulae = append(formulae, f)
			}
		}
		if len(formulae) > 0 {
			brewCtx, cancel := context.WithTimeout(ctx, brewTimeout)
			out, err := brewListFn(brewCtx, formulae)
			cancel()
			if err != nil {
				// A brew failure is not fatal: the sibling tools simply have no
				// installed version this pass and cannot match (stale-while-
				// revalidate applies to the manifest, not the brew join).
				slog.Warn("brew list --versions failed (sibling tools unmatched this pass)", "err", err)
			} else {
				installed = out
			}
		}
	}

	// Iterate the manifest in a stable roster order (sorted tool names) so the
	// Matched slice order is deterministic regardless of map iteration.
	names := make([]string, 0, len(manifest.Tools))
	for name := range manifest.Tools {
		names = append(names, name)
	}
	sort.Strings(names)

	var matched []ToolUpdate
	for _, name := range names {
		tool := manifest.Tools[name]
		latest := normalizeTag(tool.Latest)

		if name == runKitTool {
			// The run-kit row compares against the RUNNING version and additionally
			// requires this binary to be a brew install (a go-install/dev rk cannot
			// self-update through the brew-based remediation).
			if !c.selfBrew {
				continue
			}
			if crossesThreshold(c.current, latest, tool.Notify) {
				matched = append(matched, ToolUpdate{Tool: name, Installed: c.current, Latest: latest})
			}
			continue
		}

		// Every other tool: only when shll is present (its remediation is the
		// only one that can update a sibling), and only when brew reports an
		// installed version to compare (a not-brew-installed tool never matches).
		if !shllPresent {
			continue
		}
		inst, ok := installed[strings.TrimSpace(tool.Formula)]
		if !ok || strings.TrimSpace(inst) == "" {
			continue
		}
		inst = normalizeTag(inst)
		if crossesThreshold(inst, latest, tool.Notify) {
			matched = append(matched, ToolUpdate{Tool: name, Installed: inst, Latest: latest})
		}
	}
	return matched
}

// SetFetchForTest replaces the manifest fetch seam with a stub and clears
// suppression. Exported so tests in OTHER packages (e.g. api handler tests that
// need a checker with a canned verdict) can drive the checker without a network
// call. The parameter is context-free for caller convenience.
func (c *Checker) SetFetchForTest(fn func() (Manifest, error)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fetchFn = func(context.Context) (Manifest, error) { return fn() }
	c.suppressed = false
}

// SetBrewListForTest replaces the brew-list seam with a stub. Context-free for
// caller convenience.
func (c *Checker) SetBrewListForTest(fn func(formulae []string) (map[string]string, error)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.brewListFn = func(_ context.Context, formulae []string) (map[string]string, error) { return fn(formulae) }
}

// SetLookShllForTest replaces the shll-lookup seam with a stub.
func (c *Checker) SetLookShllForTest(present bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lookShllFn = func() bool { return present }
}

// SetSelfBrewForTest overrides the run-kit brew-install gate.
func (c *Checker) SetSelfBrewForTest(brew bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.selfBrew = brew
}

// CheckOnceForTest runs a single synchronous check (fetch + match + verdict
// update + OnQualify). Exported so cross-package tests can materialise a
// qualifying snapshot deterministically without waiting for the ~30s scheduler.
func (c *Checker) CheckOnceForTest() {
	c.checkOnce(context.Background())
}

// afterFuncFn schedules fn to run after d, returning a no-op. Package-var seam
// (mirrors the fetch/brew seams) so tests can capture the scheduled delay + fn
// and invoke it synchronously instead of waiting a real ~2 minutes. Default is
// time.AfterFunc; the returned timer is intentionally not retained (the timer is
// fire-and-forget — a superseding check simply recomputes the verdict).
var afterFuncFn = func(d time.Duration, fn func()) { time.AfterFunc(d, fn) }

// RecheckAfter schedules a single delayed re-check (one fetch + match + verdict
// pass) after d, bound to the daemon context captured at Start. It is the
// post-remediation trigger the /api/update handler calls after spawning a scoped
// `shll update`: a consumed match then propagates as a cleared/changed verdict
// (OnQualify fire → SSE broadcast → frontend clear) within minutes instead of
// waiting for the 6h ticker (R17). No-op on a suppressed checker or before Start
// (no daemon context yet). When run-kit was in the spawned scope the daemon
// restarts and this process-local timer dies with it — harmless.
func (c *Checker) RecheckAfter(d time.Duration) {
	c.mu.RLock()
	suppressed := c.suppressed
	ctx := c.startCtx
	hook := c.recheckHook
	c.mu.RUnlock()
	if hook != nil {
		hook(d)
		return
	}
	if suppressed || ctx == nil {
		return
	}
	afterFuncFn(d, func() {
		select {
		case <-ctx.Done():
			return
		default:
			c.checkOnce(ctx)
		}
	})
}

// SetRecheckHookForTest replaces RecheckAfter's scheduling with a hook that
// simply records the requested delay. Exported so CROSS-PACKAGE tests (the
// api/update handler test) can assert the handler triggers a post-remediation
// re-check without wiring a real daemon context or timer. Same-package tests
// drive the real path via the afterFuncFn seam instead.
func (c *Checker) SetRecheckHookForTest(fn func(time.Duration)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.recheckHook = fn
}

// defaultFetch issues the real unauthenticated GET and decodes the manifest.
// Context-bound (Constitution I) — never blocks the server.
func defaultFetch(ctx context.Context) (Manifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return Manifest{}, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return Manifest{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Drain a little so the connection can be reused, then error out.
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return Manifest{}, fmt.Errorf("manifest fetch returned status %d", resp.StatusCode)
	}
	var m Manifest
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return Manifest{}, err
	}
	if len(m.Tools) == 0 {
		return Manifest{}, fmt.Errorf("manifest has no tools")
	}
	return m, nil
}

// defaultBrewList runs `brew list --versions <formula…>` and parses the
// `<formula> <version>` output into a formula→version map. A formula absent from
// the output (not installed) simply produces no entry. Context-bound
// (Constitution I) with an explicit argument slice and no shell string.
func defaultBrewList(ctx context.Context, formulae []string) (map[string]string, error) {
	args := append([]string{"list", "--versions"}, formulae...)
	cmd := exec.CommandContext(ctx, "brew", args...)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return parseBrewVersions(out), nil
}

// parseBrewVersions parses `brew list --versions` output — one line per installed
// formula: `<formula> <version>[ <version>…]`. The first version token is used
// (brew lists multiple installed kegs newest-... but a single line's first token
// is the primary). A blank or single-token line is skipped.
func parseBrewVersions(out []byte) map[string]string {
	versions := make(map[string]string)
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		versions[fields[0]] = fields[1]
	}
	return versions
}

// computeKey builds the composite dismissal key: sorted "tool@latest" pairs,
// comma-joined. Empty when nothing matched.
func computeKey(matched []ToolUpdate) string {
	if len(matched) == 0 {
		return ""
	}
	pairs := make([]string, 0, len(matched))
	for _, m := range matched {
		pairs = append(pairs, m.Tool+"@"+m.Latest)
	}
	sort.Strings(pairs)
	return strings.Join(pairs, ",")
}

// runKitFields returns the (current, latest) for the run-kit row when it is in
// the match set — for transitional frontend compat. Empty otherwise.
func runKitFields(matched []ToolUpdate) (current, latest string) {
	for _, m := range matched {
		if m.Tool == runKitTool {
			return m.Installed, m.Latest
		}
	}
	return "", ""
}

// normalizeTag strips a single leading "v" and surrounding whitespace so a "v"-
// prefixed manifest value and a bare ldflags version compare on equal footing.
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

// parsePatch parses the patch (third) component of an X.Y.Z version, tolerating
// a pre-release suffix (e.g. "0-rc1" → 0). Returns 0 when the patch component is
// absent, and an error when it is present but non-numeric.
func parsePatch(v string) (int, error) {
	parts := strings.Split(v, ".")
	if len(parts) < 3 {
		return 0, nil
	}
	patchField := parts[2]
	if i := strings.IndexAny(patchField, "-+"); i >= 0 {
		patchField = patchField[:i]
	}
	patchField = strings.TrimSpace(patchField)
	if patchField == "" {
		return 0, nil
	}
	p, err := strconv.Atoi(patchField)
	if err != nil {
		return 0, fmt.Errorf("version %q patch not an int: %w", v, err)
	}
	return p, nil
}

// crossesThreshold reports whether latest crosses installed under the given
// notify policy:
//   - "never": never matches.
//   - "patch": matches on ANY version increase (major, minor, or patch).
//   - "minor": matches on a minor-or-major increase; patch differences never
//     match (exactly today's run-kit qualify semantics).
//
// An unparseable installed or latest never matches (defensive — a malformed
// manifest value or brew line must not panic or falsely notify). An unknown
// notify value is treated as "never" (fail-closed).
func crossesThreshold(installed, latest, notify string) bool {
	switch notify {
	case notifyNever:
		return false
	case notifyMinor:
		return minorOrMajorIncrease(installed, latest)
	case notifyPatch:
		return anyIncrease(installed, latest)
	default:
		return false
	}
}

// minorOrMajorIncrease reports whether latest is a minor OR major increase over
// installed. Patch-level differences (equal major+minor) never qualify.
func minorOrMajorIncrease(installed, latest string) bool {
	iMaj, iMin, err := parseMajorMinor(installed)
	if err != nil {
		return false
	}
	lMaj, lMin, err := parseMajorMinor(latest)
	if err != nil {
		return false
	}
	if lMaj != iMaj {
		return lMaj > iMaj
	}
	return lMin > iMin
}

// anyIncrease reports whether latest is any increase (major, minor, or patch)
// over installed.
func anyIncrease(installed, latest string) bool {
	iMaj, iMin, err := parseMajorMinor(installed)
	if err != nil {
		return false
	}
	lMaj, lMin, err := parseMajorMinor(latest)
	if err != nil {
		return false
	}
	if lMaj != iMaj {
		return lMaj > iMaj
	}
	if lMin != iMin {
		return lMin > iMin
	}
	iPatch, err := parsePatch(installed)
	if err != nil {
		return false
	}
	lPatch, err := parsePatch(latest)
	if err != nil {
		return false
	}
	return lPatch > iPatch
}
