package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"rk/internal/cron"
)

// cron.go — the cron HTTP surface (docs/specs/cron.md § API & CLI): entries +
// derived facts (GET /api/cron) and the create/delete/mute mutations. All
// schedule math lives in internal/cron (DeriveEntry reuses JoinAnchor /
// Ladder.NextFire / everyAnchor / LastDelivery); this file is the thin JSON
// translation layer over it. Unlike `rk cron list` (disk-only, zero tmux),
// the GET is a live-server endpoint — the frontend only calls it for a server
// it already knows is live — so it may gather resolved-target facts. Every
// mutation wakes the SSE hub explicitly: file writes emit no tmux event, so
// without the wake the change would wait for the safety tick.

// cronEntryJSON is the wire shape for one entry: the intent fields plus the
// derived facts (nextFire/rung/orphaned/lastFired), camelCase per the API
// convention (the on-disk YAML's snake_case never crosses the HTTP edge).
type cronEntryJSON struct {
	ID        string           `json:"id"`
	Name      string           `json:"name,omitempty"`
	Schedule  cronScheduleJSON `json:"schedule"`
	WakeOn    *cronWakeOnJSON  `json:"wakeOn,omitempty"`
	Target    cronTargetJSON   `json:"target"`
	Payload   string           `json:"payload"`
	Deliver   string           `json:"deliver,omitempty"`
	IfAbsent  string           `json:"ifAbsent,omitempty"`
	Pinned    bool             `json:"pinned,omitempty"`
	Muted     bool             `json:"muted,omitempty"`
	LastFired int64            `json:"lastFired"` // unix seconds; 0 = never
	NextFire  int64            `json:"nextFire,omitempty"`
	Rung      int              `json:"rung,omitempty"`
	Orphaned  bool             `json:"orphaned,omitempty"`
}

type cronScheduleJSON struct {
	Kind     string `json:"kind"`
	Interval string `json:"interval,omitempty"`
	Anchor   string `json:"anchor,omitempty"`
	Min      string `json:"min,omitempty"`
	Max      string `json:"max,omitempty"`
	Expr     string `json:"expr,omitempty"`
}

type cronWakeOnJSON struct {
	Event    string `json:"event"`
	Scope    string `json:"scope,omitempty"`
	Debounce string `json:"debounce,omitempty"`
}

type cronTargetJSON struct {
	Kind    string `json:"kind"`
	Role    string `json:"role,omitempty"`
	Session string `json:"session,omitempty"`
	Pane    string `json:"pane,omitempty"`
}

// cronDur renders a cron.Duration as its string form ("" when unset).
func cronDur(d cron.Duration) string {
	if d.Duration <= 0 {
		return ""
	}
	return d.String()
}

// cronEntryToJSON projects one entry plus its derived facts onto the wire.
func cronEntryToJSON(e cron.Entry, d cron.DerivedEntry) cronEntryJSON {
	out := cronEntryJSON{
		ID:   e.ID,
		Name: e.Name,
		Schedule: cronScheduleJSON{
			Kind:     e.Schedule.Kind,
			Interval: cronDur(e.Schedule.Interval),
			Anchor:   e.Schedule.Anchor,
			Min:      cronDur(e.Schedule.Min),
			Max:      cronDur(e.Schedule.Max),
			Expr:     e.Schedule.Expr,
		},
		Target: cronTargetJSON{
			Kind:    e.Target.Kind,
			Role:    e.Target.Role,
			Session: e.Target.Session,
			Pane:    e.Target.Pane,
		},
		Payload:   e.Payload,
		Deliver:   e.Deliver,
		IfAbsent:  e.IfAbsent,
		Pinned:    e.Pinned,
		Muted:     e.Muted,
		LastFired: d.LastFired,
		Rung:      d.Rung,
		Orphaned:  d.Orphaned,
	}
	if e.WakeOn != nil {
		out.WakeOn = &cronWakeOnJSON{
			Event:    e.WakeOn.Event,
			Scope:    e.WakeOn.Scope,
			Debounce: cronDur(e.WakeOn.Debounce),
		}
	}
	if d.HasNextFire {
		out.NextFire = d.NextFire.Unix()
	}
	return out
}

// cronLogDiagnostics logs load/gather diagnostics server-side; they never
// surface to the client (the tolerant-load posture the CLI already has).
func cronLogDiagnostics(server string, diags []cron.Diagnostic) {
	for _, d := range diags {
		slog.Warn("cron diagnostic", "server", server, "entry", d.EntryID, "reason", d.Reason, "detail", d.Detail)
	}
}

// handleCronList serves GET /api/cron?server=<slug> — every entry joined with
// its derived next-fire/rung/orphaned/last-fired. An absent or empty entry
// file yields {"entries": []} at 200, never a 404.
func (s *Server) handleCronList(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)
	dir, err := cron.DefaultDir()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	entriesPath, err := cron.EntriesPath(dir, server)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	entries, diags := cron.LoadEntries(entriesPath)
	cronLogDiagnostics(server, diags)
	logPath, err := cron.LogPath(dir, server)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	log := cron.ReadLog(logPath)

	facts := map[string]cron.TargetFacts{}
	if s.cronFactsFn != nil {
		gathered := s.cronFactsFn(r.Context(), server, entries)
		facts = gathered.Targets
		cronLogDiagnostics(server, gathered.Diags)
	}

	now := s.now()
	out := make([]cronEntryJSON, 0, len(entries))
	for _, e := range entries {
		// A zero TargetFacts reads as resolved (Unresolved == ""), so a
		// missing entry must be made explicitly unresolved — otherwise a nil
		// cronFactsFn or a gatherer skip would mask the orphan and fabricate
		// a backoff next-fire, contradicting the cronFactsFn contract.
		f, ok := facts[e.ID]
		if !ok {
			f = cron.TargetFacts{Unresolved: "no target facts gathered"}
		}
		out = append(out, cronEntryToJSON(e, cron.DeriveEntry(e, log, f, now)))
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": out})
}

// cronCreateBody is the POST /api/cron/create body — the `rk cron add` schema
// fields (name, schedule kind+params, target kind+params, payload, deliver,
// ifAbsent, pinned) in camelCase.
type cronCreateBody struct {
	Name     string `json:"name"`
	Schedule struct {
		Kind     string `json:"kind"`
		Interval string `json:"interval"`
		Anchor   string `json:"anchor"`
		Min      string `json:"min"`
		Max      string `json:"max"`
		Expr     string `json:"expr"`
	} `json:"schedule"`
	Target struct {
		Kind    string `json:"kind"`
		Role    string `json:"role"`
		Session string `json:"session"`
		Pane    string `json:"pane"`
	} `json:"target"`
	Payload  string `json:"payload"`
	Deliver  string `json:"deliver"`
	IfAbsent string `json:"ifAbsent"`
	Pinned   bool   `json:"pinned"`
}

// handleCronCreate serves POST /api/cron/create: validate + persist via
// cron.Add (validation failure ⇒ 400 with the underlying error text), then
// wake the SSE hub and return the created entry (assigned id included) at 201.
func (s *Server) handleCronCreate(w http.ResponseWriter, r *http.Request) {
	var body cronCreateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	entry := cron.Entry{
		Name: body.Name,
		Schedule: cron.Schedule{
			Kind:   body.Schedule.Kind,
			Anchor: body.Schedule.Anchor,
			Expr:   body.Schedule.Expr,
		},
		Target: cron.Target{
			Kind:    body.Target.Kind,
			Role:    body.Target.Role,
			Session: body.Target.Session,
			Pane:    body.Target.Pane,
		},
		Payload:  body.Payload,
		Deliver:  body.Deliver,
		IfAbsent: body.IfAbsent,
		Pinned:   body.Pinned,
	}
	// created_by.at anchors `every` schedules pre-first-delivery — always
	// "now" (the CLI's rule); a zero value would anchor at the Unix epoch.
	entry.CreatedBy = cron.CreatedBy{At: s.now().Unix()}
	for _, dur := range []struct {
		dst *cron.Duration
		raw string
	}{
		{&entry.Schedule.Interval, body.Schedule.Interval},
		{&entry.Schedule.Min, body.Schedule.Min},
		{&entry.Schedule.Max, body.Schedule.Max},
	} {
		if dur.raw == "" {
			continue
		}
		d, err := time.ParseDuration(dur.raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad duration "+dur.raw+": "+err.Error())
			return
		}
		*dur.dst = cron.Duration{Duration: d}
	}

	server := serverFromRequest(r)
	dir, err := cron.DefaultDir()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	created, err := cron.Add(dir, server, entry)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	s.initSSEHub()
	s.sseHub.wake(server)

	writeJSON(w, http.StatusCreated, cronEntryToJSON(created, cron.DerivedEntry{}))
}

// cronIDBody is the shared {"id": "<4char>"} body of the delete/mute routes.
type cronIDBody struct {
	ID string `json:"id"`
}

// cronDirForMutation resolves the state dir for a mutation handler.
func cronDirForMutation(w http.ResponseWriter) (string, bool) {
	dir, err := cron.DefaultDir()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return "", false
	}
	return dir, true
}

// handleCronDelete serves POST /api/cron/delete ← {"id": "<4char>"}: remove
// via cron.Remove; unknown id ⇒ 404; success ⇒ 200 {"ok": true} + SSE wake.
func (s *Server) handleCronDelete(w http.ResponseWriter, r *http.Request) {
	var body cronIDBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.ID == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	server := serverFromRequest(r)
	dir, ok := cronDirForMutation(w)
	if !ok {
		return
	}
	removed, err := cron.Remove(dir, server, body.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !removed {
		writeError(w, http.StatusNotFound, "cron entry not found")
		return
	}

	s.initSSEHub()
	s.sseHub.wake(server)

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleCronMute serves POST /api/cron/mute ← {"id": "<4char>", "muted":
// <bool>}: set the flag via cron.SetMuted; unknown id ⇒ 404; success ⇒ 200
// {"ok": true} + SSE wake.
func (s *Server) handleCronMute(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID    string `json:"id"`
		Muted bool   `json:"muted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.ID == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	server := serverFromRequest(r)
	dir, ok := cronDirForMutation(w)
	if !ok {
		return
	}
	found, err := cron.SetMuted(dir, server, body.ID, body.Muted)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "cron entry not found")
		return
	}

	s.initSSEHub()
	s.sseHub.wake(server)

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
