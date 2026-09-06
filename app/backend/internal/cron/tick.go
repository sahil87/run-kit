package cron

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"time"

	"rk/internal/tmux"
)

// tick.go — the tick orchestrator (R12–R15). Tick is short-lived, idempotent,
// and serialized by the non-blocking flock: flock → live-server set from
// tmux.ListServers (entry files for dead servers are skipped entirely — zero
// tmux commands target them, so a tick can never resurrect a dead socket) →
// load entries → gather facts → Evaluate → deliver through the caller-supplied
// Deliverer seam → append one log line per attempted delivery → persist the
// wake cursor.

// Outcome is what a Deliverer reports for one attempted delivery.
type Outcome struct {
	Status string // e.g. "delivered", "failed"
	Detail string
}

func (o Outcome) String() string {
	if o.Detail == "" {
		return o.Status
	}
	return o.Status + ": " + o.Detail
}

// Deliverer is the delivery seam (R15): this change ships no delivery
// implementation (C3 substitutes the injection engine); tests use fakes.
type Deliverer interface {
	Deliver(ctx context.Context, fire Fire) Outcome
}

// Deps are Tick's seams. Zero values select the production defaults
// (DefaultDir, tmux.ListServers, the real tmux seam, time.Now,
// FabOperatorStatePath). A nil Deliverer records outcome "no-deliverer" — the
// fire/log/cursor choreography still exercises.
type Deps struct {
	Dir               string
	Now               func() time.Time
	ListServers       func(ctx context.Context) ([]string, error)
	Tmux              TmuxSeam
	Deliverer         Deliverer
	OperatorStatePath func(slug string) (string, error)
	FreshThreshold    time.Duration
}

// TickResult summarizes one tick.
type TickResult struct {
	Fires int
	Diags []Diagnostic
}

// entrySlugs lists the server slugs with entry files in dir, in deterministic
// (filename) order. Non-slug file stems are skipped.
func entrySlugs(dir string) ([]string, error) {
	fis, err := os.ReadDir(dir) // sorted by name
	if err != nil {
		return nil, err
	}
	var slugs []string
	for _, fi := range fis {
		name := fi.Name()
		if fi.IsDir() || !strings.HasSuffix(name, ".yaml") || strings.HasSuffix(name, ".cursor.yaml") {
			continue
		}
		slug := strings.TrimSuffix(name, ".yaml")
		if ValidSlug(slug) {
			slugs = append(slugs, slug)
		}
	}
	return slugs, nil
}

// Tick runs one evaluation sweep. A held lock is a clean, quiet exit
// (TickResult{}, nil) — the idempotent-tick contract makes skip-on-contention
// correct.
func Tick(ctx context.Context, deps Deps) (TickResult, error) {
	var res TickResult
	dir := deps.Dir
	if dir == "" {
		var err error
		dir, err = DefaultDir()
		if err != nil {
			return res, err
		}
	}
	if err := EnsureDir(dir); err != nil {
		return res, err
	}
	release, err := acquireLock(LockPath(dir))
	if err != nil {
		if errors.Is(err, ErrTickHeld) {
			slog.Debug("cron tick: lock held, skipping", "dir", dir)
			return res, nil
		}
		return res, err
	}
	defer release()

	now := time.Now
	if deps.Now != nil {
		now = deps.Now
	}
	listServers := deps.ListServers
	if listServers == nil {
		listServers = tmux.ListServers
	}
	seam := deps.Tmux
	if seam == nil {
		seam = realTmux{}
	}
	opStatePath := deps.OperatorStatePath
	if opStatePath == nil {
		opStatePath = FabOperatorStatePath
	}

	// R12: the live-server filter comes first — every tmux touch below is for
	// a server in this set.
	liveServers, err := listServers(ctx)
	if err != nil {
		return res, err
	}
	live := make(map[string]bool, len(liveServers))
	for _, s := range liveServers {
		live[s] = true
	}

	slugs, err := entrySlugs(dir)
	if err != nil {
		return res, err
	}
	for _, slug := range slugs {
		if !live[slug] {
			// Dead server: skip entirely — diagnostic only, ZERO tmux commands.
			res.Diags = append(res.Diags, Diagnostic{Server: slug, Reason: "server-not-live",
				Detail: "entry file skipped: server not in the live set"})
			continue
		}
		fires, diags := tickServer(ctx, slug, dir, now(), seam, deps.Deliverer, opStatePath, deps.FreshThreshold)
		res.Fires += fires
		res.Diags = append(res.Diags, diags...)
	}
	for _, d := range res.Diags {
		slog.Debug("cron tick diagnostic", "server", d.Server, "entry", d.EntryID, "reason", d.Reason, "detail", d.Detail)
	}
	return res, nil
}

// tickServer runs the per-server pipeline: load → facts → Evaluate → deliver →
// log → cursor. A per-file failure is a diagnostic, never an aborted tick.
func tickServer(ctx context.Context, slug, dir string, now time.Time, seam TmuxSeam, deliverer Deliverer, opStatePath func(string) (string, error), freshThreshold time.Duration) (fires int, diags []Diagnostic) {
	entriesPath, err := EntriesPath(dir, slug)
	if err != nil {
		return 0, []Diagnostic{{Server: slug, Reason: "path-invalid", Detail: err.Error()}}
	}
	entries, loadDiags := LoadEntries(entriesPath)
	for _, d := range loadDiags {
		d.Server = slug
		diags = append(diags, d)
	}

	facts := GatherFacts(ctx, slug, entries, seam)
	diags = append(diags, facts.Diags...)

	logPath, err := LogPath(dir, slug)
	if err != nil {
		return fires, append(diags, Diagnostic{Server: slug, Reason: "path-invalid", Detail: err.Error()})
	}
	cursorPath, err := CursorPath(dir, slug)
	if err != nil {
		return fires, append(diags, Diagnostic{Server: slug, Reason: "path-invalid", Detail: err.Error()})
	}
	cursor, _ := ReadWakeCursor(cursorPath) // absent/corrupt = cold start

	var opState OperatorState
	if p, err := opStatePath(slug); err != nil {
		diags = append(diags, Diagnostic{Server: slug, Reason: "operator-state-path", Detail: err.Error()})
	} else {
		opState = ReadOperatorState(p)
	}

	eval := Evaluate(EvalInput{
		Server:         slug,
		Now:            now,
		Entries:        entries,
		Facts:          facts.Targets,
		Fingerprint:    facts.Fingerprint,
		Log:            ReadLog(logPath),
		Cursor:         cursor,
		Operator:       opState,
		FreshThreshold: freshThreshold,
	})
	diags = append(diags, eval.Diags...)

	for _, fire := range eval.Fires {
		outcome := Outcome{Status: "no-deliverer"}
		if deliverer != nil {
			outcome = deliverer.Deliver(ctx, fire)
		}
		if err := AppendLog(logPath, LogLine{
			TS:      now.Unix(),
			Entry:   fire.Entry.ID,
			Target:  fire.PaneID,
			Reason:  string(fire.Reason),
			Outcome: outcome.String(),
		}); err != nil {
			diags = append(diags, Diagnostic{Server: slug, EntryID: fire.Entry.ID, Reason: "log-append-failed", Detail: err.Error()})
			continue
		}
		fires++
	}

	if err := WriteWakeCursor(cursorPath, eval.NextCursor); err != nil {
		diags = append(diags, Diagnostic{Server: slug, Reason: "cursor-write-failed", Detail: err.Error()})
	}
	return fires, diags
}
