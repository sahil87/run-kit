package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

// win builds an enriched WindowInfo fixture entry. The variadic mutators set
// the rollup fields a test cares about.
func sortWin(index int, id string, mutate ...func(*tmux.WindowInfo)) tmux.WindowInfo {
	w := tmux.WindowInfo{Index: index, WindowID: id, Name: id}
	for _, f := range mutate {
		f(&w)
	}
	return w
}

func withAgent(state string) func(*tmux.WindowInfo) {
	return func(w *tmux.WindowInfo) { w.AgentState = state }
}

func withName(name string) func(*tmux.WindowInfo) {
	return func(w *tmux.WindowInfo) { w.Name = name }
}

func withPR(state, checks, review string) func(*tmux.WindowInfo) {
	return func(w *tmux.WindowInfo) {
		w.PrState = state
		w.PrChecks = checks
		w.PrReview = review
	}
}

func withFab(change, displayState string) func(*tmux.WindowInfo) {
	return func(w *tmux.WindowInfo) {
		w.FabChange = change
		w.FabDisplayState = displayState
	}
}

func windowIDs(windows []tmux.WindowInfo) []string {
	ids := make([]string, len(windows))
	for i, w := range windows {
		ids[i] = w.WindowID
	}
	return ids
}

// --- T002: pure order-computation tests ---

func TestStatusRankTiers(t *testing.T) {
	cases := []struct {
		name string
		w    tmux.WindowInfo
		want int
	}{
		{"agent waiting is rank 0", sortWin(0, "@1", withAgent("waiting")), 0},
		{"PR open + checks fail is rank 0", sortWin(0, "@1", withPR("open", "fail", "")), 0},
		{"PR open + changes requested is rank 0", sortWin(0, "@1", withPR("open", "pass", "changes_requested")), 0},
		{"fab failed is rank 0", sortWin(0, "@1", withFab("c1", "failed")), 0},
		{"agent active is rank 1", sortWin(0, "@1", withAgent("active")), 1},
		{"fab active is rank 1", sortWin(0, "@1", withFab("c1", "active")), 1},
		{"fab ready is rank 1", sortWin(0, "@1", withFab("c1", "ready")), 1},
		{"fab pending is rank 1", sortWin(0, "@1", withFab("c1", "pending")), 1},
		{"PR open + checks pending is rank 1", sortWin(0, "@1", withPR("open", "pending", "")), 1},
		{"PR merged is rank 2", sortWin(0, "@1", withPR("merged", "", "")), 2},
		{"fab done is rank 2", sortWin(0, "@1", withFab("c1", "done")), 2},
		{"healthy open PR is rank 2", sortWin(0, "@1", withPR("open", "pass", "")), 2},
		{"open PR with no checks is rank 2", sortWin(0, "@1", withPR("open", "none", "")), 2},
		{"agent idle is rank 3", sortWin(0, "@1", withAgent("idle")), 3},
		{"plain window is rank 4", sortWin(0, "@1"), 4},
		{"fab skipped with no other signal is rank 4", sortWin(0, "@1", withFab("c1", "skipped")), 4},
		{"unknown fab display state is rank 4", sortWin(0, "@1", withFab("c1", "weird")), 4},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := statusRank(tc.w); got != tc.want {
				t.Errorf("statusRank = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestStatusRankMinComposition(t *testing.T) {
	// A window carrying several signals takes its MINIMUM rank: idle agent (3)
	// with a failing PR (0) ranks 0.
	w := sortWin(0, "@1", withAgent("idle"), withPR("open", "fail", ""))
	if got := statusRank(w); got != 0 {
		t.Errorf("statusRank = %d, want 0 (min of matched ranks)", got)
	}
	// waiting (0) under an active (1) fab stage still ranks 0.
	w = sortWin(0, "@1", withAgent("waiting"), withFab("c1", "active"))
	if got := statusRank(w); got != 0 {
		t.Errorf("statusRank = %d, want 0", got)
	}
	// fab done (2) under an active agent (1) ranks 1.
	w = sortWin(0, "@1", withAgent("active"), withFab("c1", "done"))
	if got := statusRank(w); got != 1 {
		t.Errorf("statusRank = %d, want 1", got)
	}
}

func TestSortWindowsTargetStatus(t *testing.T) {
	// The plan's R2 example: [plain@1, waiting@2, merged@3, active-agent@4] →
	// [waiting@2, active-agent@4, merged@3, plain@1].
	windows := []tmux.WindowInfo{
		sortWin(0, "@1"),
		sortWin(1, "@2", withAgent("waiting")),
		sortWin(2, "@3", withPR("merged", "", "")),
		sortWin(3, "@4", withAgent("active")),
	}
	got := windowIDs(sortWindowsTarget(windows, []string{"status"}))
	want := []string{"@2", "@4", "@3", "@1"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("status target = %v, want %v", got, want)
	}
	// The input slice must not be mutated.
	if windows[1].WindowID != "@2" {
		t.Errorf("input mutated: windows[1].WindowID = %q", windows[1].WindowID)
	}
}

func TestSortWindowsTargetCreatedNumeric(t *testing.T) {
	// @9 sorts before @10 — numeric, not lexicographic.
	windows := []tmux.WindowInfo{sortWin(0, "@10"), sortWin(1, "@9"), sortWin(2, "@2")}
	got := windowIDs(sortWindowsTarget(windows, []string{"created"}))
	want := []string{"@2", "@9", "@10"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("created target = %v, want %v", got, want)
	}
}

func TestSortWindowsTargetStable(t *testing.T) {
	// Equal keys preserve current relative order.
	windows := []tmux.WindowInfo{
		sortWin(0, "@1", withAgent("idle")),
		sortWin(1, "@2", withAgent("active")),
		sortWin(2, "@3", withAgent("idle")),
		sortWin(3, "@4"),
	}
	got := windowIDs(sortWindowsTarget(windows, []string{"status"}))
	want := []string{"@2", "@1", "@3", "@4"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("status target = %v, want %v", got, want)
	}
}

func TestSortWindowsTargetComposite(t *testing.T) {
	// [beta@5(idle), alpha@3(idle), alpha@8(waiting)] under ["status","name"]:
	// waiting first; the idle tie is broken by name; equal names would keep
	// current order.
	windows := []tmux.WindowInfo{
		sortWin(0, "@5", withAgent("idle"), withName("beta")),
		sortWin(1, "@3", withAgent("idle"), withName("alpha")),
		sortWin(2, "@8", withAgent("waiting"), withName("alpha")),
	}
	got := windowIDs(sortWindowsTarget(windows, []string{"status", "name"}))
	want := []string{"@8", "@3", "@5"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("composite target = %v, want %v", got, want)
	}

	// A created-primary composite is degenerate (@N never ties) but accepted:
	// the name tie-break simply never fires.
	got = windowIDs(sortWindowsTarget(windows, []string{"created", "name"}))
	want = []string{"@3", "@5", "@8"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("created-primary composite target = %v, want %v", got, want)
	}
}

func TestSortWindowsTargetNameCaseInsensitive(t *testing.T) {
	// Case-insensitive ascending: "alpha" precedes "Zeta" (ASCII-ordinal would
	// put 'Z' before 'a').
	windows := []tmux.WindowInfo{sortWin(0, "@1", withName("Zeta")), sortWin(1, "@2", withName("alpha"))}
	got := windowIDs(sortWindowsTarget(windows, []string{"name"}))
	want := []string{"@2", "@1"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("name target = %v, want %v", got, want)
	}
}

func TestPlanSortMovesOnlyWhenChanged(t *testing.T) {
	windows := []tmux.WindowInfo{
		sortWin(0, "@1"),
		sortWin(1, "@2", withAgent("idle")),
		sortWin(2, "@3"),
		sortWin(3, "@4", withAgent("waiting")),
	}

	// Target [w@4, i@2, p@1, p@3]: @4 walks to slot 0 and @2 to slot 1 — the
	// two windows out of place.
	moves := planSortMoves(windows, sortWindowsTarget(windows, []string{"status"}))
	want := []sortMove{{windowID: "@4", dstIndex: 0}, {windowID: "@2", dstIndex: 1}}
	if !reflect.DeepEqual(moves, want) {
		t.Errorf("moves = %v, want %v", moves, want)
	}

	// Exactly one misplaced window (@2 should sit before @1) ⇒ exactly one move.
	one := []tmux.WindowInfo{
		sortWin(0, "@4", withAgent("waiting")),
		sortWin(1, "@1"),
		sortWin(2, "@2", withAgent("idle")),
		sortWin(3, "@3"),
	}
	moves = planSortMoves(one, sortWindowsTarget(one, []string{"status"}))
	want = []sortMove{{windowID: "@2", dstIndex: 1}}
	if !reflect.DeepEqual(moves, want) {
		t.Errorf("single-misplaced moves = %v, want %v", moves, want)
	}

	// Already sorted ⇒ empty batch (idempotence: the stable re-sort reproduces
	// the current order, so every window is already in its target slot).
	sorted := sortWindowsTarget(windows, []string{"status"})
	moves = planSortMoves(sorted, sortWindowsTarget(sorted, []string{"status"}))
	if len(moves) != 0 {
		t.Errorf("already-sorted moves = %v, want empty", moves)
	}
}

func TestPlanSortMovesRotation(t *testing.T) {
	// [a, b, c] → [b, c, a]: a walks to the end, b and c each shift up one.
	windows := []tmux.WindowInfo{sortWin(0, "@1"), sortWin(1, "@2"), sortWin(2, "@3")}
	target := []tmux.WindowInfo{windows[1], windows[2], windows[0]}
	moves := planSortMoves(windows, target)
	want := []sortMove{
		{windowID: "@2", dstIndex: 0},
		{windowID: "@3", dstIndex: 1},
	}
	if !reflect.DeepEqual(moves, want) {
		t.Errorf("moves = %v, want %v", moves, want)
	}
}

func TestPlanSortMovesNonZeroBaseIndex(t *testing.T) {
	// tmux window indexes need not start at 0: the plan targets the sorted
	// current index VALUES, not positional counts.
	windows := []tmux.WindowInfo{sortWin(5, "@1"), sortWin(7, "@2", withAgent("waiting")), sortWin(9, "@3")}
	moves := planSortMoves(windows, sortWindowsTarget(windows, []string{"status"}))
	want := []sortMove{{windowID: "@2", dstIndex: 5}}
	if !reflect.DeepEqual(moves, want) {
		t.Errorf("moves = %v, want %v", moves, want)
	}
}

func TestCompositeIdempotence(t *testing.T) {
	// Re-running any composite on its own result yields an empty move plan.
	windows := []tmux.WindowInfo{
		sortWin(0, "@5", withAgent("idle"), withName("beta")),
		sortWin(1, "@3", withAgent("idle"), withName("alpha")),
		sortWin(2, "@8", withAgent("waiting"), withName("alpha")),
	}
	sorted := sortWindowsTarget(windows, []string{"status", "name"})
	moves := planSortMoves(sorted, sortWindowsTarget(sorted, []string{"status", "name"}))
	if len(moves) != 0 {
		t.Errorf("re-run composite moves = %v, want empty", moves)
	}
}

// --- T004: handler tests ---

// sortFixture is a scrambled three-window session: plain @1 at slot 0, idle
// agent @2 at slot 1, waiting agent @3 at slot 2 — status order wants
// [@3, @2, @1] and created order wants [@1, @2, @3].
func sortFixture() []sessions.ProjectSession {
	return []sessions.ProjectSession{
		{
			Name: "work",
			Windows: []tmux.WindowInfo{
				sortWin(0, "@1"),
				sortWin(1, "@2", withAgent("idle")),
				sortWin(2, "@3", withAgent("waiting")),
			},
		},
	}
}

func postSort(t *testing.T, router http.Handler, session, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/"+session+"/sort-windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestSortWindowsSuccess(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{result: sortFixture()}, ops)

	rec := postSort(t, router, "work", `{"by":["status"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	// Target [w@3, i@2, p@1]: @3 walks to slot 0 and @2 to slot 1.
	wantCalls := []moveWindowCall{{windowID: "@3", dstIndex: 0}, {windowID: "@2", dstIndex: 1}}
	if !reflect.DeepEqual(ops.moveWindowCalls, wantCalls) {
		t.Errorf("MoveWindow calls = %v, want %v", ops.moveWindowCalls, wantCalls)
	}

	var result struct {
		Order []string `json:"order"`
		Moved int      `json:"moved"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if want := []string{"@3", "@2", "@1"}; !reflect.DeepEqual(result.Order, want) {
		t.Errorf("order = %v, want %v", result.Order, want)
	}
	if result.Moved != 2 {
		t.Errorf("moved = %d, want 2", result.Moved)
	}
}

func TestSortWindowsCreated(t *testing.T) {
	// Scrambled by created key: [@10, @2] ⇒ one move pulling @2 to the front.
	ops := &mockTmuxOps{}
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "work", Windows: []tmux.WindowInfo{sortWin(0, "@10"), sortWin(1, "@2")}},
	}}
	router := newTestRouter(sf, ops)

	rec := postSort(t, router, "work", `{"by":["created"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	wantCalls := []moveWindowCall{{windowID: "@2", dstIndex: 0}}
	if !reflect.DeepEqual(ops.moveWindowCalls, wantCalls) {
		t.Errorf("MoveWindow calls = %v, want %v", ops.moveWindowCalls, wantCalls)
	}
}

func TestSortWindowsAlreadySortedNoMoves(t *testing.T) {
	// Fixture is already in created order (@1, @2, @3 across slots 0–2): the
	// batch is empty and the response still carries 200 + the unchanged order.
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{result: sortFixture()}, ops)

	rec := postSort(t, router, "work", `{"by":["created"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ops.swapWindowCalled {
		t.Errorf("MoveWindow called on an already-sorted session: %v", ops.moveWindowCalls)
	}

	var result struct {
		Order []string `json:"order"`
		Moved int      `json:"moved"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if want := []string{"@1", "@2", "@3"}; !reflect.DeepEqual(result.Order, want) {
		t.Errorf("order = %v, want %v", result.Order, want)
	}
	if result.Moved != 0 {
		t.Errorf("moved = %d, want 0", result.Moved)
	}
}

func TestSortWindowsInvalidBy(t *testing.T) {
	// The 400 matrix: empty array, bare string (the pre-amendment form),
	// duplicate key, >3 keys, unknown key, missing key, empty string —
	// each rejected before ANY tmux call.
	bodies := []string{
		`{"by":[]}`,
		`{"by":"status"}`,
		`{"by":["status","status"]}`,
		`{"by":["status","created","name","created"]}`,
		`{"by":["size"]}`,
		`{"by":""}`,
		`{}`,
	}
	for _, body := range bodies {
		ops := &mockTmuxOps{}
		router := newTestRouter(&mockSessionFetcher{result: sortFixture()}, ops)
		rec := postSort(t, router, "work", body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want %d", body, rec.Code, http.StatusBadRequest)
		}
		if ops.swapWindowCalled {
			t.Errorf("body %s: MoveWindow called despite invalid by", body)
		}
	}
}

func TestSortWindowsInvalidJSON(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{result: sortFixture()}, ops)
	rec := postSort(t, router, "work", "not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.swapWindowCalled {
		t.Error("MoveWindow called despite invalid JSON")
	}
}

func TestSortWindowsInvalidSessionName(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{result: sortFixture()}, ops)
	// A semicolon is a forbidden shell metacharacter — validate.ValidateName rejects.
	rec := postSort(t, router, "bad;name", `{"by":["status"]}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.swapWindowCalled {
		t.Error("MoveWindow called despite invalid session name")
	}
}

func TestSortWindowsUnknownSession(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{result: sortFixture()}, ops)
	rec := postSort(t, router, "nope", `{"by":["status"]}`)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if ops.swapWindowCalled {
		t.Error("MoveWindow called for an unknown session")
	}
}

func TestSortWindowsCompositeHandler(t *testing.T) {
	// [beta@5(idle), alpha@3(idle), alpha@8(waiting)] under ["status","name"]:
	// @8 first (waiting), then the idle tie broken by name ⇒ @3 before @5.
	// Two moves pull @8 and @3 into slots 0 and 1.
	ops := &mockTmuxOps{}
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "work", Windows: []tmux.WindowInfo{
			sortWin(0, "@5", withAgent("idle"), withName("beta")),
			sortWin(1, "@3", withAgent("idle"), withName("alpha")),
			sortWin(2, "@8", withAgent("waiting"), withName("alpha")),
		}},
	}}
	router := newTestRouter(sf, ops)

	rec := postSort(t, router, "work", `{"by":["status","name"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	wantCalls := []moveWindowCall{{windowID: "@8", dstIndex: 0}, {windowID: "@3", dstIndex: 1}}
	if !reflect.DeepEqual(ops.moveWindowCalls, wantCalls) {
		t.Errorf("MoveWindow calls = %v, want %v", ops.moveWindowCalls, wantCalls)
	}

	var result struct {
		Order []string `json:"order"`
		Moved int      `json:"moved"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if want := []string{"@8", "@3", "@5"}; !reflect.DeepEqual(result.Order, want) {
		t.Errorf("order = %v, want %v", result.Order, want)
	}
}
