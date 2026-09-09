package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/cron"
)

// cron_test.go — table-driven HTTP round-trips for the five /api/cron routes
// against a directly-built Server (the newWakeSeamServer pattern). The cron
// state root is redirected per test via XDG_STATE_HOME; the facts seam
// (cronFactsFn) is stubbed so no live tmux server is touched. Wake assertions
// share the sessions_test.go seam helpers: a successful mutation must drive a
// fresh FetchSessions pass, a rejected one must not.

// setupCronState redirects the cron state root into a temp dir and returns it.
func setupCronState(t *testing.T) string {
	t.Helper()
	state := t.TempDir()
	t.Setenv("XDG_STATE_HOME", state)
	dir := filepath.Join(state, "run-kit", "cron")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	return dir
}

// writeCronEntries writes a server entry file verbatim (fixtures may include
// deliberately corrupt entries — LoadEntries is the tolerant reader).
func writeCronEntries(t *testing.T, dir, slug, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, slug+".yaml"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

// loadCronEntries reads back the persisted intent for assertions.
func loadCronEntries(t *testing.T, dir, slug string) []cron.Entry {
	t.Helper()
	path, err := cron.EntriesPath(dir, slug)
	if err != nil {
		t.Fatal(err)
	}
	entries, diags := cron.LoadEntries(path)
	if len(diags) > 0 {
		t.Fatalf("unexpected load diagnostics: %+v", diags)
	}
	return entries
}

// cronFactsStub is the resolved-target fixture seam for GET /api/cron.
func cronFactsStub(targets map[string]cron.TargetFacts) func(context.Context, string, []cron.Entry) cron.ServerFacts {
	return func(_ context.Context, _ string, _ []cron.Entry) cron.ServerFacts {
		return cron.ServerFacts{Targets: targets}
	}
}

func TestCronList(t *testing.T) {
	const T = int64(1_700_000_000)

	t.Run("absent entry file yields an empty list, never 404", func(t *testing.T) {
		setupCronState(t)
		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		var body struct {
			Entries []cronEntryJSON `json:"entries"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Entries) != 0 {
			t.Fatalf("entries = %+v, want empty", body.Entries)
		}
	})

	t.Run("valid entries carry derived facts; a corrupt entry is skipped", func(t *testing.T) {
		dir := setupCronState(t)
		writeCronEntries(t, dir, "default", `entries:
  - id: b1cd
    name: operator tick
    schedule: {kind: backoff, min: 60s, max: 30m}
    target: {kind: role, role: operator}
    payload: tick
    deliver: immediate
    if_absent: respawn
    pinned: true
  - id: e2fg
    name: hourly
    schedule: {kind: every, interval: 1h}
    target: {kind: session, session: s1}
    payload: ping
  - id: zz99
    schedule: {kind: bogonic}
    target: {kind: role, role: operator}
    payload: skipped
`)
		// Delivery log: b1cd at T+60s and T+180s (the anchor-join worked
		// scenario), e2fg at T.
		log := strings.Join([]string{
			`{"ts":` + jsonNumber(T+60) + `,"entry":"b1cd","target":"%5","reason":"schedule","outcome":"delivered"}`,
			`{"ts":` + jsonNumber(T+180) + `,"entry":"b1cd","target":"%5","reason":"schedule","outcome":"delivered"}`,
			`{"ts":` + jsonNumber(T) + `,"entry":"e2fg","target":"%6","reason":"schedule","outcome":"delivered"}`,
		}, "\n") + "\n"
		if err := os.WriteFile(filepath.Join(dir, "default.log"), []byte(log), 0o600); err != nil {
			t.Fatal(err)
		}

		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		server.cronFactsFn = cronFactsStub(map[string]cron.TargetFacts{
			// b1cd: raw idle epoch 5s after its newest delivery (attributed).
			"b1cd": {PaneID: "%5", AgentState: "idle", StateEpoch: T + 185},
			"e2fg": {PaneID: "%6", AgentState: "idle", StateEpoch: T},
		})
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		var body struct {
			Entries []cronEntryJSON `json:"entries"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Entries) != 2 {
			t.Fatalf("entries = %d, want 2 (corrupt entry skipped): %+v", len(body.Entries), body.Entries)
		}
		byID := map[string]cronEntryJSON{}
		for _, e := range body.Entries {
			byID[e.ID] = e
		}
		b := byID["b1cd"]
		if b.Name != "operator tick" || b.Schedule.Kind != "backoff" || b.Schedule.Min != "1m0s" || !b.Pinned || b.Muted {
			t.Errorf("b1cd intent fields wrong: %+v", b)
		}
		if b.Target.Kind != "role" || b.Target.Role != "operator" || b.Deliver != "immediate" || b.IfAbsent != "respawn" {
			t.Errorf("b1cd target/policy fields wrong: %+v", b)
		}
		if b.Rung != 3 || b.NextFire != T+420 || b.LastFired != T+180 || b.Orphaned {
			t.Errorf("b1cd derived fields wrong: rung=%d nextFire=%d lastFired=%d orphaned=%v (want 3/%d/%d/false)",
				b.Rung, b.NextFire, b.LastFired, b.Orphaned, T+420, T+180)
		}
		e := byID["e2fg"]
		if e.NextFire != T+3600 || e.Rung != 0 || e.LastFired != T || e.Orphaned {
			t.Errorf("e2fg derived fields wrong: %+v (want nextFire %d, rung 0, lastFired %d, orphaned false)", e, T+3600, T)
		}
	})

	t.Run("an entry whose target fails resolution reports orphaned", func(t *testing.T) {
		dir := setupCronState(t)
		writeCronEntries(t, dir, "default", `entries:
  - id: o3hi
    schedule: {kind: backoff, min: 60s, max: 30m}
    target: {kind: role, role: operator}
    payload: tick
`)
		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		server.cronFactsFn = cronFactsStub(map[string]cron.TargetFacts{
			"o3hi": {Unresolved: "no window carries role operator"},
		})
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
		}
		var body struct {
			Entries []cronEntryJSON `json:"entries"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Entries) != 1 || !body.Entries[0].Orphaned {
			t.Fatalf("want one orphaned entry, got %+v", body.Entries)
		}
		if body.Entries[0].NextFire != 0 {
			t.Errorf("orphaned backoff entry nextFire = %d, want unset (anchor unknowable)", body.Entries[0].NextFire)
		}
		// Role entries are never GC subjects: the orphan streak stays zero
		// even while the entry is orphaned.
		if body.Entries[0].OrphanedSince != 0 || body.Entries[0].ExpiresAt != 0 {
			t.Errorf("role entry orphanedSince/expiresAt = %d/%d, want 0/0",
				body.Entries[0].OrphanedSince, body.Entries[0].ExpiresAt)
		}
	})

	t.Run("an orphaned unpinned session entry carries the orphan streak", func(t *testing.T) {
		dir := setupCronState(t)
		writeCronEntries(t, dir, "default", `entries:
  - id: s5jk
    schedule: {kind: every, interval: 1h}
    target: {kind: session, session: 4fe2}
    payload: sweep
`)
		log := strings.Join([]string{
			`{"ts":` + jsonNumber(T) + `,"entry":"s5jk","target":"4fe2","reason":"schedule","outcome":"delivered"}`,
			`{"ts":` + jsonNumber(T+600) + `,"entry":"s5jk","target":"4fe2","reason":"schedule","outcome":"skipped-absent"}`,
		}, "\n") + "\n"
		if err := os.WriteFile(filepath.Join(dir, "default.log"), []byte(log), 0o600); err != nil {
			t.Fatal(err)
		}

		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		server.cronFactsFn = cronFactsStub(map[string]cron.TargetFacts{
			"s5jk": {Unresolved: "no pane stamped with session 4fe2"},
		})
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
		}
		var body struct {
			Entries []cronEntryJSON `json:"entries"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Entries) != 1 || !body.Entries[0].Orphaned {
			t.Fatalf("want one orphaned entry, got %+v", body.Entries)
		}
		if body.Entries[0].OrphanedSince != T+600 {
			t.Errorf("orphanedSince = %d, want %d (the oldest line after the newest resolved line)",
				body.Entries[0].OrphanedSince, T+600)
		}
		if want := T + 600 + int64(cron.OrphanTTL/time.Second); body.Entries[0].ExpiresAt != want {
			t.Errorf("expiresAt = %d, want %d (orphanedSince + OrphanTTL)", body.Entries[0].ExpiresAt, want)
		}
	})

	t.Run("missing facts report orphaned, never resolved", func(t *testing.T) {
		dir := setupCronState(t)
		writeCronEntries(t, dir, "default", `entries:
  - id: m4no
    schedule: {kind: backoff, min: 60s, max: 30m}
    target: {kind: role, role: operator}
    payload: tick
`)
		// Nil cronFactsFn (the test-router default): no live resolution
		// happened, so the entry must not read as resolved.
		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
		}
		var body struct {
			Entries []cronEntryJSON `json:"entries"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Entries) != 1 || !body.Entries[0].Orphaned {
			t.Fatalf("want one orphaned entry when facts are missing, got %+v", body.Entries)
		}
		if body.Entries[0].NextFire != 0 {
			t.Errorf("no-facts backoff entry nextFire = %d, want unset (anchor unknowable)", body.Entries[0].NextFire)
		}
	})

	t.Run("mute lease on the wire: live lease is muted+mutedUntil, an expired one is neither", func(t *testing.T) {
		dir := setupCronState(t)
		writeCronEntries(t, dir, "default", `entries:
  - id: l1ve
    schedule: {kind: every, interval: 1h}
    target: {kind: role, role: operator}
    payload: tick
    muted_until: 1700000300
  - id: xp1r
    schedule: {kind: every, interval: 1h}
    target: {kind: role, role: operator}
    payload: tick
    muted_until: 1699999900
  - id: fl4g
    schedule: {kind: every, interval: 1h}
    target: {kind: role, role: operator}
    payload: tick
    muted: true
`)
		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		server.nowFn = func() time.Time { return time.Unix(T, 0) }
		server.cronFactsFn = cronFactsStub(nil)
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		// Decode raw: key ABSENCE is the contract for an expired lease and the
		// retired schedule anchor, so a typed decode (which zero-fills) cannot
		// see it.
		var body struct {
			Entries []map[string]any `json:"entries"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Entries) != 3 {
			t.Fatalf("entries = %d, want 3", len(body.Entries))
		}
		byID := map[string]map[string]any{}
		for _, e := range body.Entries {
			byID[e["id"].(string)] = e
		}
		live := byID["l1ve"]
		if live["muted"] != true || live["mutedUntil"] != float64(T+300) {
			t.Errorf("live lease entry = %v, want muted:true mutedUntil:%d", live, T+300)
		}
		expired := byID["xp1r"]
		if expired["muted"] != false && expired["muted"] != nil {
			t.Errorf("expired lease entry muted = %v, want absent/false", expired["muted"])
		}
		if _, ok := expired["mutedUntil"]; ok {
			t.Errorf("expired lease entry carries mutedUntil — an expired lease must not surface: %v", expired)
		}
		flag := byID["fl4g"]
		if flag["muted"] != true {
			t.Errorf("indefinite mute entry = %v, want muted:true", flag)
		}
		if _, ok := flag["mutedUntil"]; ok {
			t.Errorf("indefinite mute entry carries mutedUntil: %v", flag)
		}
		for id, e := range byID {
			if sched, ok := e["schedule"].(map[string]any); ok {
				if _, has := sched["anchor"]; has {
					t.Errorf("entry %s schedule carries the retired anchor key: %v", id, sched)
				}
			}
		}
	})
}

func TestCronListDeliveries(t *testing.T) {
	const T = int64(1_700_000_000)

	t.Run("newest-first with names joined; a deleted entry's name is empty", func(t *testing.T) {
		dir := setupCronState(t)
		writeCronEntries(t, dir, "default", `entries:
  - id: b1cd
    name: operator tick
    schedule: {kind: every, interval: 1h}
    target: {kind: role, role: operator}
    payload: tick
`)
		log := strings.Join([]string{
			`{"ts":` + jsonNumber(T) + `,"entry":"b1cd","target":"%5","reason":"schedule","outcome":"delivered"}`,
			`{"ts":` + jsonNumber(T+60) + `,"entry":"zz99","target":"%6","reason":"schedule","outcome":"delivered"}`,
			`{"ts":` + jsonNumber(T+120) + `,"entry":"b1cd","target":"%5","reason":"wake","outcome":"failed: probe"}`,
		}, "\n") + "\n"
		if err := os.WriteFile(filepath.Join(dir, "default.log"), []byte(log), 0o600); err != nil {
			t.Fatal(err)
		}

		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		var body struct {
			Deliveries []cronDeliveryJSON `json:"deliveries"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Deliveries) != 3 {
			t.Fatalf("deliveries = %+v, want 3", body.Deliveries)
		}
		wantTS := []int64{T + 120, T + 60, T}
		for i, d := range body.Deliveries {
			if d.TS != wantTS[i] {
				t.Errorf("deliveries[%d].ts = %d, want %d (newest-first)", i, d.TS, wantTS[i])
			}
		}
		newest := body.Deliveries[0]
		if newest.Entry != "b1cd" || newest.Name != "operator tick" || newest.Target != "%5" ||
			newest.Reason != "wake" || newest.Outcome != "failed: probe" {
			t.Errorf("newest delivery = %+v, want the b1cd line with its joined name", newest)
		}
		if gone := body.Deliveries[1]; gone.Entry != "zz99" || gone.Name != "" {
			t.Errorf("deleted entry's delivery = %+v, want an empty name", gone)
		}
	})

	t.Run("absent or empty log yields deliveries: [] at 200, never null", func(t *testing.T) {
		for _, tc := range []struct {
			name string
			log  *string // nil = no log file at all
		}{
			{"absent log", nil},
			{"empty log", new(string)},
		} {
			t.Run(tc.name, func(t *testing.T) {
				dir := setupCronState(t)
				if tc.log != nil {
					if err := os.WriteFile(filepath.Join(dir, "default.log"), []byte(*tc.log), 0o600); err != nil {
						t.Fatal(err)
					}
				}
				server, _ := newWakeSeamServer(t, &mockTmuxOps{})
				router := server.buildRouter()
				req := httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				if rec.Code != http.StatusOK {
					t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
				}
				var body struct {
					Deliveries []cronDeliveryJSON `json:"deliveries"`
				}
				if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if body.Deliveries == nil || len(body.Deliveries) != 0 {
					t.Errorf("deliveries = %+v, want a non-nil empty array (never null)", body.Deliveries)
				}
			})
		}
	})

	t.Run("the projection caps at maxCronDeliveries, keeping the newest", func(t *testing.T) {
		dir := setupCronState(t)
		var lines []string
		for i := range maxCronDeliveries + 5 {
			lines = append(lines, `{"ts":`+jsonNumber(T+int64(i))+`,"entry":"b1cd","target":"%5","reason":"schedule","outcome":"delivered"}`)
		}
		if err := os.WriteFile(filepath.Join(dir, "default.log"), []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		var body struct {
			Deliveries []cronDeliveryJSON `json:"deliveries"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Deliveries) != maxCronDeliveries {
			t.Fatalf("deliveries = %d, want the %d cap", len(body.Deliveries), maxCronDeliveries)
		}
		if body.Deliveries[0].TS != T+int64(maxCronDeliveries)+4 {
			t.Errorf("newest delivery ts = %d, want %d (the cap keeps the tail)", body.Deliveries[0].TS, T+int64(maxCronDeliveries)+4)
		}
	})
}

// jsonNumber renders an int64 for inline JSON fixture construction.
func jsonNumber(n int64) string {
	return strings.TrimSpace(string(mustJSON(n)))
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func TestCronCreate(t *testing.T) {
	t.Run("valid body persists the entry, returns 201 with the assigned id, wakes the hub", func(t *testing.T) {
		dir := setupCronState(t)
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/create?server=default", strings.NewReader(
			`{"name":"operator tick","schedule":{"kind":"backoff","min":"60s","max":"30m"},"target":{"kind":"role","role":"operator"},"payload":"operator tick","deliver":"immediate","ifAbsent":"respawn","respawn":["rk","operator","-L","{server}"],"pinned":true}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
		}
		var created cronEntryJSON
		if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
			t.Fatal(err)
		}
		if len(created.ID) != 4 {
			t.Errorf("created id = %q, want a 4-char id", created.ID)
		}
		if want := []string{"rk", "operator", "-L", "{server}"}; strings.Join(created.Respawn, " ") != strings.Join(want, " ") {
			t.Errorf("created respawn = %v, want %v (the body field echoes on the wire)", created.Respawn, want)
		}
		entries := loadCronEntries(t, dir, "default")
		if len(entries) != 1 {
			t.Fatalf("persisted entries = %d, want 1", len(entries))
		}
		e := entries[0]
		if e.ID != created.ID || e.Name != "operator tick" || e.Schedule.Kind != cron.ScheduleBackoff ||
			e.Schedule.Min.Duration.String() != "1m0s" || e.Target.Role != cron.RoleOperator ||
			e.Payload != "operator tick" || !e.Pinned || e.Deliver != cron.DeliverImmediate || e.IfAbsent != cron.IfAbsentRespawn {
			t.Errorf("persisted entry wrong: %+v", e)
		}
		if want := []string{"rk", "operator", "-L", "{server}"}; strings.Join(e.Respawn, " ") != strings.Join(want, " ") {
			t.Errorf("persisted respawn = %v, want %v", e.Respawn, want)
		}
		if e.CreatedBy.At == 0 {
			t.Error("created_by.at = 0, want now (the every-schedule pre-delivery anchor)")
		}
		expectWake(t, tracker, before, "cron create")
	})

	t.Run("a role target with ifAbsent respawn and no respawn command is a 400", func(t *testing.T) {
		dir := setupCronState(t)
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/create?server=default", strings.NewReader(
			`{"schedule":{"kind":"every","interval":"1h"},"target":{"kind":"role","role":"operator"},"payload":"tick","ifAbsent":"respawn"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "respawn command") {
			t.Errorf("body = %s, want it naming the missing respawn command", rec.Body.String())
		}
		if entries := loadCronEntries(t, dir, "default"); len(entries) != 0 {
			t.Errorf("persisted entries = %d after a rejected create, want 0", len(entries))
		}
		expectNoWake(t, tracker, before, "cron create respawn-less role respawn rejected")
	})

	t.Run("invalid schedule is a 400, persists nothing, does not wake", func(t *testing.T) {
		dir := setupCronState(t)
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/create?server=default", strings.NewReader(
			`{"schedule":{"kind":"every"},"target":{"kind":"role","role":"operator"},"payload":"nope"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
		}
		if entries := loadCronEntries(t, dir, "default"); len(entries) != 0 {
			t.Errorf("persisted entries = %d after a rejected create, want 0", len(entries))
		}
		expectNoWake(t, tracker, before, "cron create rejected")
	})

	t.Run("unparsable duration is a 400", func(t *testing.T) {
		setupCronState(t)
		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/create?server=default", strings.NewReader(
			`{"schedule":{"kind":"every","interval":"soon"},"target":{"kind":"role","role":"operator"},"payload":"nope"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("catchUp round-trips through create and GET", func(t *testing.T) {
		dir := setupCronState(t)
		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		server.cronFactsFn = cronFactsStub(nil)
		router := server.buildRouter()

		req := httptest.NewRequest(http.MethodPost, "/api/cron/create?server=default", strings.NewReader(
			`{"schedule":{"kind":"cron","expr":"0 9 * * *","catchUp":"once"},"target":{"kind":"role","role":"operator"},"payload":"standup"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
		}
		var created cronEntryJSON
		if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
			t.Fatal(err)
		}
		if created.Schedule.CatchUp != cron.CatchUpOnce {
			t.Errorf("created catchUp = %q, want %q", created.Schedule.CatchUp, cron.CatchUpOnce)
		}
		entries := loadCronEntries(t, dir, "default")
		if len(entries) != 1 || entries[0].Schedule.CatchUp != cron.CatchUpOnce {
			t.Fatalf("persisted entries = %+v, want one with catch_up: once", entries)
		}

		req = httptest.NewRequest(http.MethodGet, "/api/cron?server=default", nil)
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		var list struct {
			Entries []cronEntryJSON `json:"entries"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&list); err != nil {
			t.Fatal(err)
		}
		if len(list.Entries) != 1 || list.Entries[0].Schedule.CatchUp != cron.CatchUpOnce {
			t.Errorf("GET entries = %+v, want the catchUp echoed", list.Entries)
		}
		if list.Entries[0].NextFire == 0 {
			t.Error("GET nextFire = 0, want the cron entry's next occurrence")
		}
	})

	t.Run("bad catchUp value is a 400", func(t *testing.T) {
		dir := setupCronState(t)
		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/create?server=default", strings.NewReader(
			`{"schedule":{"kind":"cron","expr":"0 9 * * *","catchUp":"always"},"target":{"kind":"role","role":"operator"},"payload":"standup"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
		}
		if entries := loadCronEntries(t, dir, "default"); len(entries) != 0 {
			t.Errorf("persisted entries = %d after a rejected create, want 0", len(entries))
		}
	})
}

// seedCronEntry persists one entry via cron.Add and returns it.
func seedCronEntry(t *testing.T, dir, slug string) cron.Entry {
	t.Helper()
	e, err := cron.Add(dir, slug, cron.Entry{
		Schedule: cron.Schedule{Kind: cron.ScheduleEvery, Interval: cron.Duration{Duration: 3600000000000}},
		Target:   cron.Target{Kind: cron.TargetRole, Role: cron.RoleOperator},
		Payload:  "seed",
	})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func TestCronDelete(t *testing.T) {
	t.Run("existing id deletes, 200, wakes", func(t *testing.T) {
		dir := setupCronState(t)
		seeded := seedCronEntry(t, dir, "default")
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/delete?server=default", strings.NewReader(`{"id":"`+seeded.ID+`"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if entries := loadCronEntries(t, dir, "default"); len(entries) != 0 {
			t.Errorf("entries after delete = %+v, want none", entries)
		}
		expectWake(t, tracker, before, "cron delete")
	})

	t.Run("unknown id is a 404, no mutation, no wake", func(t *testing.T) {
		dir := setupCronState(t)
		seeded := seedCronEntry(t, dir, "default")
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/delete?server=default", strings.NewReader(`{"id":"zzzz"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
		}
		if entries := loadCronEntries(t, dir, "default"); len(entries) != 1 || entries[0].ID != seeded.ID {
			t.Errorf("entries after failed delete = %+v, want the seeded entry untouched", entries)
		}
		expectNoWake(t, tracker, before, "cron delete unknown id")
	})
}

func TestCronMute(t *testing.T) {
	t.Run("existing id sets muted, 200, wakes", func(t *testing.T) {
		dir := setupCronState(t)
		seeded := seedCronEntry(t, dir, "default")
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/mute?server=default", strings.NewReader(`{"id":"`+seeded.ID+`","muted":true}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		entries := loadCronEntries(t, dir, "default")
		if len(entries) != 1 || !entries[0].Muted {
			t.Errorf("entries after mute = %+v, want the seeded entry muted", entries)
		}
		expectWake(t, tracker, before, "cron mute")
	})

	t.Run("unknown id is a 404, no wake", func(t *testing.T) {
		setupCronState(t)
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/mute?server=default", strings.NewReader(`{"id":"zzzz","muted":true}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
		}
		expectNoWake(t, tracker, before, "cron mute unknown id")
	})
}

// postCronPin fires one POST /api/cron/pin round-trip and returns the status.
func postCronPin(t *testing.T, router http.Handler, id string, pinned bool) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/cron/pin?server=default", strings.NewReader(
		`{"id":"`+id+`","pinned":`+strings.TrimSpace(string(mustJSON(pinned)))+`}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec.Code
}

func TestCronPin(t *testing.T) {
	t.Run("existing id sets pinned, 200 {\"ok\":true}, wakes", func(t *testing.T) {
		dir := setupCronState(t)
		seeded := seedCronEntry(t, dir, "default")
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/pin?server=default", strings.NewReader(`{"id":"`+seeded.ID+`","pinned":true}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		var body map[string]bool
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if !body["ok"] {
			t.Errorf("body = %v, want {\"ok\":true}", body)
		}
		entries := loadCronEntries(t, dir, "default")
		if len(entries) != 1 || !entries[0].Pinned {
			t.Errorf("entries after pin = %+v, want the seeded entry pinned", entries)
		}
		expectWake(t, tracker, before, "cron pin")
	})

	t.Run("unknown id is a 404, no mutation, no wake", func(t *testing.T) {
		dir := setupCronState(t)
		seeded := seedCronEntry(t, dir, "default")
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		if code := postCronPin(t, router, "zzzz", true); code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", code)
		}
		if entries := loadCronEntries(t, dir, "default"); len(entries) != 1 || entries[0].ID != seeded.ID || entries[0].Pinned {
			t.Errorf("entries after failed pin = %+v, want the seeded entry untouched", entries)
		}
		expectNoWake(t, tracker, before, "cron pin unknown id")
	})

	t.Run("un-pin after pin succeeds identically", func(t *testing.T) {
		dir := setupCronState(t)
		seeded := seedCronEntry(t, dir, "default")
		server, _ := newWakeSeamServer(t, &mockTmuxOps{})
		router := server.buildRouter()
		if code := postCronPin(t, router, seeded.ID, true); code != http.StatusOK {
			t.Fatalf("pin status = %d, want 200", code)
		}
		if code := postCronPin(t, router, seeded.ID, false); code != http.StatusOK {
			t.Fatalf("un-pin status = %d, want 200", code)
		}
		if entries := loadCronEntries(t, dir, "default"); len(entries) != 1 || entries[0].Pinned {
			t.Errorf("entries after un-pin = %+v, want the seeded entry unpinned", entries)
		}
	})
}
