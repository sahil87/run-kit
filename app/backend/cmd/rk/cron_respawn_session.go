package main

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"time"

	"rk/internal/config"
	"rk/internal/cron"
	"rk/internal/inject"
	"rk/internal/riff"
	"rk/internal/snapshot"
	"rk/internal/tmux"
)

// cron_respawn_session.go — the production cron.Deps.SessionRespawner (wired
// in serve.go): brings a dead session target back by resuming the conversation
// from its recently-closed ring record, then delivers the ENTRY'S PAYLOAD
// ITSELF (resume restores context, so the role path's never-bare-tick rule
// does not apply and no kickoff exists for arbitrary sessions). It lives in
// cmd/rk for the same package-boundary reason as cron_respawn.go (riff.Spawn,
// the snapshot store).
//
// The respawn source is the server's recently-closed ring (newest-first), the
// FIRST record whose AgentRef equals the target session ref — without a record
// there is no cwd, and the clock never guesses one. Gates mirror
// handleClosedResume (api/closed.go): the record's provider must be claude
// (--resume is Claude-only), the ref must pass the strict UUID gate BEFORE it
// reaches launcher composition (constitution §I — the launcher string is the
// deliberately-unescaped element), and the record's first-pane cwd must be
// inside a git repo. Any gate failure escalates: fail-silent notify naming the
// entry and server, outcome respawn-failed, nothing created.
//
// The spawn resumes PLAIN (`--resume <uuid>`, ResumePlain — never
// --fork-session): the entry targets this session id, and a fork would mint a
// fresh id the entry could never resolve again. On success the record's
// @rk_win_* set is re-stamped on the spawned window and the consumed record
// dropped (both best-effort — a failure logs, never fails the respawn), then
// inject.DeliverWhenReady runs under the operatorDeliverDeadline-class bound.
// Walls escalate, never retry: any non-ready classification (parked / narrow /
// gone / readiness timeout) or a send error notifies fail-silently and returns
// respawn-failed — the clock never auto-answers walls.

// cronSessionRespawnBuffer is the session-respawn delivery's named paste
// buffer — the cronRespawnBuffer precedent: respawns are serialized by the
// tick flock, so one fixed name cannot interleave with itself.
const cronSessionRespawnBuffer = "rk-cron-respawn-session"

// cronSessionSpawnTimeout bounds the whole riff spawn (the api
// riffSpawnTimeout value): each inner subprocess stays individually bounded
// inside the engine.
const cronSessionSpawnTimeout = 90 * time.Second

// cronSessionResumeProvider is the only provider a session resume supports —
// --resume is a Claude Code flag.
const cronSessionResumeProvider = "claude"

// cronSessionUUIDRe is the strict Claude session-UUID shape — the SAME rule as
// riff's sessionUUIDRe and api's forkSessionUUIDRe, duplicated deliberately per
// that precedent: the ref enters the deliberately-unescaped launcher string,
// so the gate must hold locally before composition (constitution §I). A
// malformed ref escalates rather than reaching the launcher (where riff's own
// re-validation would silently drop it and spawn unresumed).
var cronSessionUUIDRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Seams so the respawner is testable without a live tmux server, snapshot
// store, or push subscription (the cronRespawn* pattern).
var (
	cronSessionListClosedFn = func(store *snapshot.Store, server string) ([]snapshot.ClosedWindow, error) {
		return store.ListClosed(server)
	}
	cronSessionDeleteClosedFn = func(store *snapshot.Store, server, id string) error {
		return store.DeleteClosed(server, id)
	}
	cronSessionFindGitRootFn      = config.FindGitRoot
	cronSessionSpawnFn            = riff.Spawn
	cronSessionSetWindowOptionsFn = tmux.SetWindowOptions
	// cronSessionRespawnDeliverFn mirrors cronRespawnDeliverFn:
	// DeliverWhenReady with the reconciled state reader under the
	// operatorDeliverDeadline bound.
	cronSessionRespawnDeliverFn = kickoffDeliverFn(func(ctx context.Context, engine *inject.Engine, t inject.Tmux, server, paneID, text string) (inject.Readiness, error) {
		return inject.DeliverWhenReady(ctx, t, server, paneID, inject.Sanitize(text), true, engine, inject.ReadyOpts{
			State:    boundedPaneAgentState,
			Deadline: operatorDeliverDeadline,
		})
	})
)

// rkCronRespawnSession binds the session respawner to the snapshot store —
// the Deps.SessionRespawner value wired in serve.go. Session-target fires
// only — the tick's disposition switch enforces that gate.
func rkCronRespawnSession(store *snapshot.Store) func(context.Context, cron.Fire) cron.Outcome {
	return func(ctx context.Context, fire cron.Fire) cron.Outcome {
		return cronRespawnSession(ctx, store, fire)
	}
}

// cronRespawnSession runs the ring-scan → gate → spawn → postlude → deliver
// composite for one due-but-absent session-target fire.
func cronRespawnSession(ctx context.Context, store *snapshot.Store, fire cron.Fire) cron.Outcome {
	server := fire.Server
	ref := fire.Entry.Target.Session

	if store == nil {
		return cronSessionRespawnEscalate(ctx, fire, "", "closed-window store unavailable")
	}
	closed, err := cronSessionListClosedFn(store, server)
	if err != nil {
		return cronSessionRespawnEscalate(ctx, fire, "", "list closed: "+err.Error())
	}
	// Newest-first scan; the first AgentRef match wins (the newest capture
	// carries the freshest cwd/options).
	var rec *snapshot.ClosedWindow
	for i := range closed {
		if closed[i].AgentRef == ref {
			rec = &closed[i]
			break
		}
	}
	if rec == nil {
		return cronSessionRespawnEscalate(ctx, fire, "", fmt.Sprintf("no closed-window record carries session %s", ref))
	}

	if rec.AgentProvider != cronSessionResumeProvider {
		return cronSessionRespawnEscalate(ctx, fire, "",
			fmt.Sprintf("cannot resume a %q session — conversation resume requires provider %q", rec.AgentProvider, cronSessionResumeProvider))
	}
	if !cronSessionUUIDRe.MatchString(rec.AgentRef) {
		return cronSessionRespawnEscalate(ctx, fire, "", "malformed agent session ref "+rec.AgentRef)
	}
	// The record's first pane cwd is the resume directory verbatim (the
	// handleClosedResume rule: claude keys its transcript store by the exact
	// cwd). FindGitRoot only answers "is this inside a repo at all".
	cwd := ""
	if len(rec.Window.Panes) > 0 {
		cwd = rec.Window.Panes[0].Cwd
	}
	if cronSessionFindGitRootFn(cwd) == "" {
		return cronSessionRespawnEscalate(ctx, fire, "", fmt.Sprintf("cwd %q is not inside a git repository", cwd))
	}

	sctx, scancel := context.WithTimeout(ctx, cronSessionSpawnTimeout)
	defer scancel()
	res, err := cronSessionSpawnFn(sctx, riff.Options{
		Server:  server,
		Session: rec.Session,
		// Byte-for-byte the closed-resume wiring: checkout mode roots the
		// window at the record cwd (no wt create); ResumePlain composes
		// `--resume <uuid>` WITHOUT --fork-session — the entry targets this
		// session id, so a fork's fresh id would orphan it forever.
		Where:            "checkout",
		RepoRoot:         cwd,
		ResumeSessionRef: rec.AgentRef,
		ResumePlain:      true,
		WindowNameBase:   rec.Window.Name,
	})
	if err != nil {
		return cronSessionRespawnEscalate(ctx, fire, "", "spawn: "+err.Error())
	}

	// Postlude (both best-effort — the window exists and works, so a failure
	// logs and never fails the respawn): re-stamp the record's @rk_win_* set
	// riff's spawn does not know, and drop the consumed ring record.
	stampCtx, stampCancel := context.WithTimeout(ctx, operatorCmdTimeout)
	defer stampCancel()
	if wops := snapshot.WindowOptionOps(rec.Window); len(wops) > 0 {
		if serr := cronSessionSetWindowOptionsFn(stampCtx, res.WindowID, server, wops); serr != nil {
			slog.Warn("cron session respawn: options not re-stamped on spawned window",
				"server", server, "window", res.WindowID, "err", serr)
		}
	}
	if derr := cronSessionDeleteClosedFn(store, server, rec.ID); derr != nil {
		slog.Warn("cron session respawn: closed-window record not dropped after resume",
			"server", server, "id", rec.ID, "err", derr)
	}

	// Spawn-then-deliver: the context outlives the readiness wait by one
	// command timeout so the engine's bounded subprocesses still fit after a
	// slow boot (the cronRespawnRole shape). The text is the entry's payload
	// itself — resume restores the conversation's context, so no kickoff.
	dctx, dcancel := context.WithTimeout(ctx, operatorDeliverDeadline+operatorCmdTimeout)
	defer dcancel()
	engine := inject.NewEngine(cronSessionRespawnBuffer)
	readiness, err := cronSessionRespawnDeliverFn(dctx, engine, awaitReadyTmux{}, server, res.PaneID, fire.Entry.Payload)
	if err != nil {
		// DeliverWhenReady's contract: a readiness classification error
		// (parked/narrow/gone/timeout) returns the zero Readiness; a send
		// error returns the readiness that fired — the phase prefix keeps the
		// two apart in the logged detail.
		if readiness != 0 {
			return cronSessionRespawnEscalate(ctx, fire, res.WindowID, "send: "+err.Error())
		}
		return cronSessionRespawnEscalate(ctx, fire, res.WindowID, "readiness: "+err.Error())
	}
	return cron.Outcome{Status: "respawned", Detail: "resumed " + rec.AgentRef + " in " + res.WindowID}
}

// cronSessionRespawnEscalate notifies fail-silently (naming the entry and
// server) and returns the respawn-failed outcome — the cronRespawnEscalate
// contract. windowID is the spawned window on a post-spawn failure (the
// deep-link target); "" pre-spawn notifies URL-less. A notify failure is
// logged, never propagated — the outcome (and its anchor advance) stands
// either way.
func cronSessionRespawnEscalate(ctx context.Context, fire cron.Fire, windowID, detail string) cron.Outcome {
	name := fire.Entry.Name
	if name == "" {
		name = fire.Entry.ID
	}
	if err := cronRespawnNotifyFn(ctx, "cron: "+name, fmt.Sprintf("session respawn failed on %s: %s", fire.Server, detail), cron.PushURL(fire.Server, windowID)); err != nil {
		slog.Warn("cron session respawn escalation notify failed", "server", fire.Server, "entry", fire.Entry.ID, "err", err)
	}
	return cron.Outcome{Status: "respawn-failed", Detail: detail}
}
