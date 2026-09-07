package cron

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"time"

	"rk/internal/push"
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
	// Held marks a deferred delivery (the when-idle gate found the target
	// busy). Held outcomes MUST NOT reach the delivery log: the log is the
	// anchor-derivation source for `every` and the backoff anchor-join streak,
	// so logging a held attempt would advance anchors and silently delay the
	// fire by a full period. Skipping the append makes re-evaluation the retry
	// mechanism — the fire recomputes as due on the next tick.
	Held bool
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
// FabOperatorStatePath, push.Notify). A nil Deliverer records outcome
// "no-deliverer" — the fire/log/cursor choreography still exercises.
type Deps struct {
	Dir         string
	Now         func() time.Time
	ListServers func(ctx context.Context) ([]string, error)
	Tmux        TmuxSeam
	Deliverer   Deliverer
	// Notifier backs the if_absent notify disposition. Fail-silent by
	// contract: a notify failure is a diagnostic, never a tick error.
	Notifier func(ctx context.Context, title, body, url string) error
	// Respawner brings a dead role target back (role targets only —
	// session-target respawn via claude --resume is a later wave). It is
	// consulted only for an if_absent: respawn entry whose target kind is
	// role; nil (or a non-role target) keeps the existing notify-degrade
	// path, byte-for-byte. The returned Outcome is logged as the
	// disposition (a non-held outcome class — respawned / respawn-failed).
	Respawner         func(ctx context.Context, fire Fire) Outcome
	OperatorStatePath func(slug string) (string, error)
	FreshThreshold    time.Duration
}

// notifyDefault is the production Notifier: the daemon-side push fan-out.
func notifyDefault(ctx context.Context, title, body, url string) error {
	_, err := push.Notify(ctx, title, body, url)
	return err
}

// TickResult summarizes one tick. Held reports that the flock was held by
// another invoker (the clean, quiet no-op — callers that print a summary use
// it to stay silent); Servers counts the live servers actually swept.
type TickResult struct {
	Held    bool
	Servers int
	Fires   int
	Diags   []Diagnostic
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

// DefaultTargetRatePerHour is the per-target delivery cap: at or past this
// many counted deliveries to the same target within rateWindow, a fire is
// suppressed with a logged "rate-capped" outcome (and a Warn — the one cron
// signal above debug, since tripping must be visible). It bounds tick storms
// and delivery feedback loops.
const DefaultTargetRatePerHour = 30

// rateWindow is the trailing window the rate cap counts over.
const rateWindow = time.Hour

// countsTowardRate classifies a log outcome for the rate cap: delivery-attempt
// classes count (delivered/failed/notified/respawned), suppressions and misses
// do not — and held outcomes never reach the log at all, so they are
// inherently excluded.
func countsTowardRate(outcome string) bool {
	switch {
	case outcome == "delivered":
		return true
	case strings.HasPrefix(outcome, "failed"):
		return true
	case outcome == "notified-absent":
		return true
	case outcome == "respawned", strings.HasPrefix(outcome, "respawn-failed"):
		return true
	}
	return false
}

// rateCount counts trailing-window log lines for one cap key. Resolved fires
// key on the target pane (matching Target, across ALL entries aimed at that
// pane); absent fires key on the entry id (their lines carry no pane).
func rateCount(lines []LogLine, key string, byPane bool, now time.Time) int {
	cutoff := now.Add(-rateWindow).Unix()
	n := 0
	for _, l := range lines {
		if l.TS < cutoff {
			continue
		}
		match := l.Entry == key
		if byPane {
			match = l.Target == key
		}
		if match && countsTowardRate(l.Outcome) {
			n++
		}
	}
	return n
}

// Tick runs one evaluation sweep. A held lock is a clean, quiet exit
// (TickResult{Held: true}, nil) — the idempotent-tick contract makes
// skip-on-contention correct.
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
			res.Held = true
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
	notifier := deps.Notifier
	if notifier == nil {
		notifier = notifyDefault
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
		fires, diags := tickServer(ctx, slug, dir, now(), seam, deps.Deliverer, notifier, deps.Respawner, opStatePath, deps.FreshThreshold)
		res.Servers++
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
func tickServer(ctx context.Context, slug, dir string, now time.Time, seam TmuxSeam, deliverer Deliverer, notifier func(context.Context, string, string, string) error, respawner func(context.Context, Fire) Outcome, opStatePath func(string) (string, error), freshThreshold time.Duration) (fires int, diags []Diagnostic) {
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

	logLines := ReadLog(logPath)
	eval := Evaluate(EvalInput{
		Server:         slug,
		Now:            now,
		Entries:        entries,
		Facts:          facts.Targets,
		Fingerprint:    facts.Fingerprint,
		Log:            logLines,
		Cursor:         cursor,
		Operator:       opState,
		FreshThreshold: freshThreshold,
	})
	diags = append(diags, eval.Diags...)

	// appendLine mirrors every on-disk append into logLines so the rate cap
	// sees lines written earlier in this same tick.
	appendLine := func(entryID string, line LogLine) {
		if err := AppendLog(logPath, line); err != nil {
			diags = append(diags, Diagnostic{Server: slug, EntryID: entryID, Reason: "log-append-failed", Detail: err.Error()})
			return
		}
		logLines = append(logLines, line)
		fires++
	}

	// rateCapped reports (and records) a suppression when the target is at or
	// past the per-target cap. The rate-capped line IS appended: it is the
	// derivation source for future surfaces, and advancing the anchor
	// self-throttles the storm.
	rateCapped := func(fire Fire, key string, byPane bool) bool {
		if rateCount(logLines, key, byPane, now) < DefaultTargetRatePerHour {
			return false
		}
		slog.Warn("cron delivery rate-capped", "server", slug, "entry", fire.Entry.ID, "target", fire.PaneID, "cap_key", key, "cap", DefaultTargetRatePerHour)
		appendLine(fire.Entry.ID, LogLine{
			TS:      now.Unix(),
			Entry:   fire.Entry.ID,
			Target:  fire.PaneID,
			Reason:  string(fire.Reason),
			Outcome: "rate-capped",
		})
		return true
	}

	for _, fire := range eval.Fires {
		if rateCapped(fire, fire.PaneID, true) {
			continue
		}
		outcome := Outcome{Status: "no-deliverer"}
		if deliverer != nil {
			outcome = deliverer.Deliver(ctx, fire)
		}
		if outcome.Held {
			// Held outcomes never reach the log (see Outcome.Held) — the hold
			// is realized as cross-tick retry: anchors stay put, so the fire
			// recomputes as due next tick.
			diags = append(diags, Diagnostic{Server: slug, EntryID: fire.Entry.ID, Reason: "delivery-held", Detail: outcome.String()})
			continue
		}
		appendLine(fire.Entry.ID, LogLine{
			TS:      now.Unix(),
			Entry:   fire.Entry.ID,
			Target:  fire.PaneID,
			Reason:  string(fire.Reason),
			Outcome: outcome.String(),
		})
	}

	// Due-but-absent fires: apply the entry's if_absent policy. Every
	// disposition appends one log line, so the anchor advances and a dead
	// target produces one line per due period, not one per tick.
	for _, fire := range eval.Absent {
		if rateCapped(fire, fire.Entry.ID, false) {
			continue
		}
		line := LogLine{TS: now.Unix(), Entry: fire.Entry.ID, Reason: string(fire.Reason)}
		switch {
		case fire.Entry.IfAbsent == IfAbsentRespawn && fire.Entry.Target.Kind == TargetRole && respawner != nil:
			// Role-target respawn is real: the seam's returned outcome
			// (respawned / respawn-failed) is the logged disposition. Session
			// and pane targets fall through to the notify-degrade — their
			// respawn is a later wave.
			line.Outcome = respawner(ctx, fire).String()
		case fire.Entry.IfAbsent == IfAbsentNotify || fire.Entry.IfAbsent == IfAbsentRespawn:
			if fire.Entry.IfAbsent == IfAbsentRespawn {
				// No respawner wired (or a non-role target): degrade to
				// notify, loudly.
				diags = append(diags, Diagnostic{Server: slug, EntryID: fire.Entry.ID, Reason: "respawn-unimplemented",
					Detail: "if_absent respawn is not implemented; degraded to notify"})
			}
			name := fire.Entry.Name
			if name == "" {
				name = fire.Entry.ID
			}
			if err := notifier(ctx, "cron: "+name, "target absent on "+slug, operatorPushURL(ctx, slug, seam)); err != nil {
				diags = append(diags, Diagnostic{Server: slug, EntryID: fire.Entry.ID, Reason: "notify-failed", Detail: err.Error()})
			}
			line.Outcome = "notified-absent"
		default:
			line.Outcome = "skipped-absent"
		}
		appendLine(fire.Entry.ID, line)
	}

	if err := WriteWakeCursor(cursorPath, eval.NextCursor); err != nil {
		diags = append(diags, Diagnostic{Server: slug, Reason: "cursor-write-failed", Detail: err.Error()})
	}
	return fires, diags
}
