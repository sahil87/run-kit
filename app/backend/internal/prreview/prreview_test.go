package prreview

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestParsePRURL(t *testing.T) {
	cases := []struct {
		raw     string
		want    PRRef
		wantErr bool
	}{
		{raw: "https://github.com/sahil87/run-kit/pull/1024", want: PRRef{Host: "github.com", Owner: "sahil87", Repo: "run-kit", Number: 1024}},
		{raw: "https://ghe.corp.example/acme/tool/pull/7", want: PRRef{Host: "ghe.corp.example", Owner: "acme", Repo: "tool", Number: 7}},
		{raw: "https://github.com/sahil87/run-kit/pull/1024/files", wantErr: true},
		{raw: "https://github.com/sahil87/run-kit/issues/12", wantErr: true},
		{raw: "https://github.com/sahil87/run-kit/pull/zero", wantErr: true},
		{raw: "https://github.com/sahil87/run-kit/pull/0", wantErr: true},
		{raw: "not a url at all", wantErr: true},
		{raw: "", wantErr: true},
	}
	for _, tc := range cases {
		got, err := ParsePRURL(tc.raw)
		if tc.wantErr {
			if err == nil {
				t.Errorf("ParsePRURL(%q) = %+v, want error", tc.raw, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParsePRURL(%q): %v", tc.raw, err)
			continue
		}
		if got != tc.want {
			t.Errorf("ParsePRURL(%q) = %+v, want %+v", tc.raw, got, tc.want)
		}
	}
}

func TestParsePatchAnchorsDeletions(t *testing.T) {
	patch := strings.Join([]string{
		"@@ -10,4 +10,5 @@ func Example() {",
		" ctxA",
		"-gone",
		"+first",
		"+second",
		" ctxB",
		`\ No newline at end of file`,
	}, "\n")

	rows := ParsePatch(patch)
	if len(rows) != 6 {
		t.Fatalf("rows = %d, want 6 (header + 5 body rows)", len(rows))
	}
	if rows[0].Kind != RowHunk || rows[0].Header != "@@ -10,4 +10,5 @@ func Example() {" {
		t.Errorf("row 0 = %+v, want the hunk header", rows[0])
	}
	if rows[1] != (PatchRow{Kind: RowCtx, Left: 10, Right: 10, At: 10, Text: "ctxA"}) {
		t.Errorf("ctx row = %+v", rows[1])
	}
	// The deletion has no post-image line of its own; its anchor is the
	// post-image line it sat BEFORE.
	if rows[2].Kind != RowDel || rows[2].Left != 11 || rows[2].Right != 0 || rows[2].At != 11 {
		t.Errorf("del row = %+v, want left 11 / right 0 / at 11", rows[2])
	}
	if rows[3].Kind != RowAdd || rows[3].Right != 11 || rows[3].Left != 0 {
		t.Errorf("first add row = %+v", rows[3])
	}
	if rows[4].Kind != RowAdd || rows[4].Right != 12 {
		t.Errorf("second add row = %+v", rows[4])
	}
	if rows[5].Kind != RowCtx || rows[5].Left != 12 || rows[5].Right != 13 {
		t.Errorf("trailing ctx row = %+v", rows[5])
	}
}

func TestParsePatchDegradesOnMalformedInput(t *testing.T) {
	if rows := ParsePatch(""); rows != nil {
		t.Errorf("empty patch = %+v, want nil", rows)
	}
	// Body lines before any header are dropped rather than mis-numbered.
	if rows := ParsePatch("+orphan\n-orphan"); rows != nil {
		t.Errorf("headerless patch = %+v, want nil", rows)
	}
	rows := ParsePatch("@@ garbage @@\n+x")
	if len(rows) != 2 || rows[1].Right != 1 {
		t.Errorf("unparseable header: rows = %+v, want the hunk to start at line 1", rows)
	}
}

func TestCollectRunsGroupsBySideAndContiguity(t *testing.T) {
	rows := ParsePatch(strings.Join([]string{
		"@@ -1,3 +1,3 @@",
		" a",
		"-b",
		"+B",
		" c",
	}, "\n"))
	runs := collectRuns(rows)
	if len(runs) != 3 {
		t.Fatalf("runs = %d (%+v), want 3", len(runs), runs)
	}
	if runs[0].side != SideRight || runs[0].start != 1 || runs[0].count != 1 {
		t.Errorf("run 0 = %+v", runs[0])
	}
	// The deletion lexes against the PRE-image, so it cannot join the
	// post-image run around it.
	if runs[1].side != SideLeft || runs[1].start != 2 || runs[1].count != 1 {
		t.Errorf("run 1 = %+v", runs[1])
	}
	if runs[2].side != SideRight || runs[2].start != 2 || runs[2].count != 2 {
		t.Errorf("run 2 = %+v", runs[2])
	}
}

func TestTokenClassUsesChromaShortNames(t *testing.T) {
	lexer := lexerFor("main.go")
	if lexer == nil {
		t.Fatal("lexerFor(main.go) = nil, want the Go lexer")
	}
	spans := lexLines(lexer, []string{"package main", "", "func f() int { return 1 }"})
	if len(spans) != 3 {
		t.Fatalf("spans = %d lines, want 3", len(spans))
	}
	classes := map[string]bool{}
	for _, line := range spans {
		for _, span := range line {
			classes[span.Class] = true
		}
	}
	// Chroma's table maps the most specific type it knows (mi = integer
	// literal), which is why the stylesheet colours the sub-classes too.
	for _, want := range []string{"kn", "nf", "mi"} {
		if !classes[want] {
			t.Errorf("class %q absent; got %v", want, classes)
		}
	}
	// Reassembling the spans must reproduce the source line byte for byte —
	// the renderer concatenates them straight into the row.
	var rebuilt strings.Builder
	for _, span := range spans[2] {
		rebuilt.WriteString(span.Text)
	}
	if rebuilt.String() != "func f() int { return 1 }" {
		t.Errorf("rebuilt line = %q", rebuilt.String())
	}
}

func TestLexerForUnknownExtensionIsNil(t *testing.T) {
	if lexer := lexerFor("notes.unknown-extension"); lexer != nil {
		t.Errorf("lexerFor(unknown) = %v, want nil (plain rows)", lexer.Config().Name)
	}
}

func TestLexWindowPadsAndReportsRefine(t *testing.T) {
	lines := make([]string, 400)
	for i := range lines {
		lines[i] = "x := 1"
	}
	lexer := lexerFor("a.go")

	// A window anchored at line 1 needs no leading pad, so it cannot have
	// guessed.
	spans, refine, coloured := lexWindow(lexer, lines, 1, 10)
	if len(spans) != 10 {
		t.Fatalf("spans = %d, want 10", len(spans))
	}
	if refine {
		t.Error("refine = true for a window at line 1, want false")
	}
	if !coloured {
		t.Error("coloured = false with a real lexer, want true")
	}

	// A window in the middle entered with a guessed state.
	spans, refine, _ = lexWindow(lexer, lines, 200, 10)
	if len(spans) != 10 || !refine {
		t.Errorf("mid-blob window: spans = %d, refine = %v; want 10, true", len(spans), refine)
	}

	// Past the end is an empty answer, not a panic.
	if spans, refine, _ := lexWindow(lexer, lines, 5000, 10); spans != nil || refine {
		t.Errorf("out-of-range window = %v, %v", spans, refine)
	}

	// No matching lexer: plain rows, and `coloured` says so — the wire's
	// `highlighted` flag is derived from it.
	if _, _, coloured := lexWindow(nil, lines, 1, 10); coloured {
		t.Error("coloured = true with a nil lexer, want false")
	}
}

func TestLexWindowByteCapDropsContextThenColour(t *testing.T) {
	// One line just over the byte cap: even with the pads dropped the window
	// cannot be lexed, so the rows serve plain.
	huge := []string{strings.Repeat("a", windowByteCap+1)}
	spans, refine, coloured := lexWindow(lexerFor("a.go"), huge, 1, 1)
	if refine {
		t.Error("refine = true over the byte cap, want false (nothing will improve it)")
	}
	if coloured {
		t.Error("coloured = true over the byte cap, want false (the rows serve plain)")
	}
	if len(spans) != 1 || len(spans[0]) != 1 || spans[0][0].Class != "" {
		t.Errorf("over-cap spans = %+v, want one classless span", spans)
	}

	// Lines that fit only once the pads are dropped still get colour.
	padHeavy := make([]string, 400)
	for i := range padHeavy {
		padHeavy[i] = strings.Repeat("b", 4096)
	}
	padHeavy[200] = "package main"
	spans, _, _ = lexWindow(lexerFor("a.go"), padHeavy, 201, 1)
	if len(spans) != 1 {
		t.Fatalf("pad-dropped spans = %+v", spans)
	}
	if len(spans[0]) == 0 || spans[0][0].Class == "" {
		t.Errorf("pad-dropped window lost its colour: %+v", spans[0])
	}
}

func TestBlobCacheEvictsByBudgetAndScavengesOnceIdle(t *testing.T) {
	cache := newBlobCache(100)
	cache.put("sha1", "a.go", &blobEntry{lines: []string{"a"}, bytes: 60})
	cache.put("sha2", "b.go", &blobEntry{lines: []string{"b"}, bytes: 60})
	if cache.get("sha1", "a.go") != nil {
		t.Error("sha1 survived the budget; want evicted (LRU)")
	}
	if cache.get("sha2", "b.go") == nil {
		t.Error("sha2 evicted; want retained")
	}

	// An untouched cache scavenges exactly once per idle period.
	cache.lastUse = time.Now().Add(-2 * blobIdleWindow)
	cache.scavenge(time.Now())
	if len(cache.entries) != 0 {
		t.Errorf("entries after scavenge = %d, want 0", len(cache.entries))
	}
	cache.put("sha3", "c.go", &blobEntry{lines: []string{"c"}, bytes: 10})
	cache.scavenge(time.Now())
	if cache.get("sha3", "c.go") == nil {
		t.Error("a freshly-touched cache was scavenged; the latch must clear on touch")
	}
}

func TestSuggestionOnlyThreads(t *testing.T) {
	suggestion := "```suggestion\nreturn nil\n```"
	cases := []struct {
		name string
		body []string
		want bool
	}{
		{"single suggestion", []string{suggestion}, true},
		{"two suggestions", []string{suggestion, suggestion}, true},
		{"argument plus suggestion", []string{"this is wrong because…\n" + suggestion}, false},
		{"plain prose", []string{"please fix this"}, false},
		{"other fence", []string{"```go\nreturn nil\n```"}, false},
		{"unterminated fence", []string{"```suggestion\nreturn nil"}, false},
		{"no comments", nil, false},
	}
	for _, tc := range cases {
		thread := Thread{}
		for _, body := range tc.body {
			thread.Comments = append(thread.Comments, Comment{Body: body})
		}
		if got := thread.SuggestionOnly(); got != tc.want {
			t.Errorf("%s: SuggestionOnly() = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// recordedCall is one gh invocation captured by the test seam.
type recordedCall struct {
	args  []string
	stdin string
}

func newRecordingFetcher(t *testing.T, responses map[string]string) (*Fetcher, *[]recordedCall) {
	t.Helper()
	calls := &[]recordedCall{}
	f := NewFetcher()
	f.available = func(context.Context) bool { return true }
	f.ghExec = func(_ context.Context, stdin []byte, args ...string) ([]byte, error) {
		*calls = append(*calls, recordedCall{args: args, stdin: string(stdin)})
		joined := strings.Join(args, " ")
		for match, response := range responses {
			if strings.Contains(joined, match) {
				return []byte(response), nil
			}
		}
		return []byte("{}"), nil
	}
	return f, calls
}

// The whole point of --input -: a comment body is user-authored prose and must
// never appear in argv, where it is readable from the process table and one
// quoting mistake from a shell injection.
// GitHub's REST side/start_side and its GraphQL DiffSide enum take LEFT/RIGHT,
// never this package's one-letter wire form. Posting "R" fails the
// create-comment oneOf with `R is not a member of ["LEFT", "RIGHT"]`, and
// because the side is what breaks the match, the 422 names every OTHER
// subschema ("position wasn't supplied", "in_reply_to wasn't supplied",
// "subject_type wasn't supplied") and never the field at fault.
func TestWritePathsSpellSidesTheWayGitHubDoes(t *testing.T) {
	review := &Review{URL: "https://github.com/acme/tool/pull/7", HeadSha: "headsha"}

	for _, tc := range []struct {
		wire string
		want string
	}{
		{SideRight, "RIGHT"},
		{SideLeft, "LEFT"},
		{"", "RIGHT"}, // unset defaults to the post-image, as the composer does
	} {
		t.Run("single/"+tc.want, func(t *testing.T) {
			f, calls := newRecordingFetcher(t, nil)
			if err := f.AddComment(context.Background(), review, NewComment{
				Path: "a.go", Line: 12, StartLine: 9, Side: tc.wire, Body: "b", Mode: ModeSingle,
			}); err != nil {
				t.Fatalf("AddComment: %v", err)
			}
			var decoded map[string]any
			if err := json.Unmarshal([]byte((*calls)[0].stdin), &decoded); err != nil {
				t.Fatalf("stdin is not JSON: %v", err)
			}
			if decoded["side"] != tc.want {
				t.Errorf("side = %v, want %q", decoded["side"], tc.want)
			}
			// The multi-line anchor carries the same vocabulary.
			if decoded["start_side"] != tc.want {
				t.Errorf("start_side = %v, want %q", decoded["start_side"], tc.want)
			}
		})
	}

	// addPullRequestReviewThread's $side is DiffSide!, the same enum.
	t.Run("pending review thread", func(t *testing.T) {
		f, calls := newRecordingFetcher(t, map[string]string{
			"graphql": `{"data":{"repository":{"pullRequest":{"id":"PR_1","reviews":{"nodes":[{"id":"REV_1"}]}}}}}`,
		})
		if err := f.AddComment(context.Background(), review, NewComment{
			Path: "a.go", Line: 12, Side: SideLeft, Body: "b", Mode: ModeReview,
		}); err != nil {
			t.Fatalf("AddComment(review mode): %v", err)
		}
		if !strings.Contains((*calls)[1].stdin, `"LEFT"`) {
			t.Errorf("thread mutation variables = %s, want side LEFT", (*calls)[1].stdin)
		}
	})
}

func TestWritePathsSendBodiesOnStdinNeverArgv(t *testing.T) {
	body := "please fix `$(rm -rf /)`\nand also \"quote\" this"
	review := &Review{URL: "https://github.com/acme/tool/pull/7", HeadSha: "headsha"}

	t.Run("single comment", func(t *testing.T) {
		f, calls := newRecordingFetcher(t, nil)
		if err := f.AddComment(context.Background(), review, NewComment{
			Path: "a.go", Line: 12, Side: SideRight, Body: body, Mode: ModeSingle,
		}); err != nil {
			t.Fatalf("AddComment: %v", err)
		}
		if len(*calls) != 1 {
			t.Fatalf("calls = %d, want 1", len(*calls))
		}
		assertBodyOnStdin(t, (*calls)[0], body)
		var decoded map[string]any
		if err := json.Unmarshal([]byte((*calls)[0].stdin), &decoded); err != nil {
			t.Fatalf("stdin is not JSON: %v", err)
		}
		if decoded["commit_id"] != "headsha" || decoded["side"] != "RIGHT" || decoded["line"] != float64(12) {
			t.Errorf("stdin document = %v", decoded)
		}
	})

	t.Run("reply", func(t *testing.T) {
		f, calls := newRecordingFetcher(t, nil)
		if err := f.Reply(context.Background(), review, 4242, body); err != nil {
			t.Fatalf("Reply: %v", err)
		}
		assertBodyOnStdin(t, (*calls)[0], body)
		if !strings.Contains(strings.Join((*calls)[0].args, " "), "/comments/4242/replies") {
			t.Errorf("reply argv = %v", (*calls)[0].args)
		}
	})

	t.Run("pending review", func(t *testing.T) {
		f, calls := newRecordingFetcher(t, map[string]string{
			"graphql": `{"data":{"repository":{"pullRequest":{"id":"PR_1","reviews":{"nodes":[{"id":"REV_1"}]}}}}}`,
		})
		if err := f.AddComment(context.Background(), review, NewComment{
			Path: "a.go", Line: 12, Side: SideRight, Body: body, Mode: ModeReview,
		}); err != nil {
			t.Fatalf("AddComment(review mode): %v", err)
		}
		if len(*calls) != 2 {
			t.Fatalf("calls = %d, want 2 (find pending review, then add thread)", len(*calls))
		}
		// Even the GraphQL variables ride stdin, so the body never lands on argv.
		assertBodyOnStdin(t, (*calls)[1], body)
	})

	t.Run("resolve and react", func(t *testing.T) {
		f, calls := newRecordingFetcher(t, nil)
		if err := f.SetThreadResolved(context.Background(), review, "THREAD_1", true); err != nil {
			t.Fatalf("SetThreadResolved: %v", err)
		}
		if !strings.Contains((*calls)[0].stdin, "resolveReviewThread") {
			t.Errorf("resolve stdin = %q", (*calls)[0].stdin)
		}
		if err := f.MarkEyes(context.Background(), review, 99); err != nil {
			t.Fatalf("MarkEyes: %v", err)
		}
		last := (*calls)[len(*calls)-1]
		if !strings.Contains(last.stdin, `"content":"eyes"`) {
			t.Errorf("reaction stdin = %q", last.stdin)
		}
		if !strings.Contains(strings.Join(last.args, " "), "/pulls/comments/99/reactions") {
			t.Errorf("reaction argv = %v", last.args)
		}
	})
}

func assertBodyOnStdin(t *testing.T, call recordedCall, body string) {
	t.Helper()
	if !strings.Contains(call.stdin, "rm -rf") {
		t.Errorf("stdin does not carry the body: %q", call.stdin)
	}
	for _, arg := range call.args {
		if strings.Contains(arg, "rm -rf") || arg == body {
			t.Fatalf("body leaked into argv: %v", call.args)
		}
	}
	if !containsPair(call.args, "--input", "-") {
		t.Errorf("argv missing --input -: %v", call.args)
	}
}

func containsPair(args []string, first, second string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == first && args[i+1] == second {
			return true
		}
	}
	return false
}

// Stale-while-revalidate: a gh blip on a PR that already has a cached document
// serves the cached one rather than blanking a mounted tile.
func TestGetKeepsLastGoodOnFetchError(t *testing.T) {
	f := NewFetcher()
	f.available = func(context.Context) bool { return true }
	cached := &Review{URL: "https://github.com/acme/tool/pull/7", FetchedAt: time.Now().Add(-time.Hour)}
	f.byURL[cached.URL] = cached
	f.ghExec = func(context.Context, []byte, ...string) ([]byte, error) {
		return nil, context.DeadlineExceeded
	}
	got, err := f.Get(context.Background(), cached.URL, true)
	if err != nil || got != cached {
		t.Errorf("Get on a gh error = %v, %v; want the cached document", got, err)
	}
}

func TestGetWithoutGhReportsUnavailable(t *testing.T) {
	f := NewFetcher()
	f.available = func(context.Context) bool { return false }
	if _, err := f.Get(context.Background(), "https://github.com/acme/tool/pull/7", false); err != ErrUnavailable {
		t.Errorf("Get with gh absent = %v, want ErrUnavailable", err)
	}
}

// The tier-2 background pass publishes its spans on its own goroutine while
// readers take them on request goroutines, so every touch of blobEntry.full
// goes through refineMu. This drives that seam concurrently — under
// `go test -race` it is what proves the guard, and without a test nothing ever
// STARTS the background goroutine, so removing the mutex would still pass.
func TestSpansForIsRaceFreeAcrossTheTier2Refine(t *testing.T) {
	// Long enough that a mid-blob window needs a leading pad (so refine fires
	// and queues the background pass), small enough to sit under
	// refinePassByteCap.
	lines := make([]string, 600)
	for i := range lines {
		lines[i] = "package main // line"
	}
	blob := strings.Join(lines, "\n")
	encoded, err := json.Marshal(ghContents{
		Content:  base64.StdEncoding.EncodeToString([]byte(blob)),
		Encoding: "base64",
		Type:     "file",
	})
	if err != nil {
		t.Fatal(err)
	}

	f := NewFetcher()
	f.available = func(context.Context) bool { return true }
	f.ghExec = func(context.Context, []byte, ...string) ([]byte, error) { return encoded, nil }
	ref := PRRef{Owner: "acme", Repo: "tool", Number: 7}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			// Repeat so a reader is live both before and after the background
			// pass publishes.
			for r := 0; r < 20; r++ {
				start := 200 + n
				spans, _, coloured := f.spansFor(context.Background(), ref, "a.go", "headsha", start, 10)
				if len(spans) != 10 || !coloured {
					t.Errorf("spansFor(%d) = %d spans, coloured=%v; want 10, true", start, len(spans), coloured)
					return
				}
			}
		}(i)
	}
	wg.Wait()

	entry := f.blobs.get("headsha", "a.go")
	if entry == nil {
		t.Fatal("blob entry evicted; want cached")
	}
	// Wait for the background pass to publish before asserting on its effects.
	// Bounded so a broken tier 2 fails the test rather than hanging it.
	deadline := time.Now().Add(5 * time.Second)
	for {
		f.refineMu.Lock()
		published := entry.full != nil
		f.refineMu.Unlock()
		if published {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the tier-2 pass never published its spans")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Once published, a repeat read answers from the whole-blob result, so the
	// client is told there is nothing left to refine.
	if _, refine, _ := f.spansFor(context.Background(), ref, "a.go", "headsha", 200, 10); refine {
		t.Error("refine = true after the tier-2 pass published, want false")
	}
	// The pass credited its footprint to the ENTRY, not just the running total:
	// crediting only `used` would ratchet the budget upward on every refine and
	// evict live entries early, because evictLocked subtracts entry.bytes.
	if entry.bytes <= entryBytes(lines) {
		t.Errorf("entry.bytes = %d after the refine; want more than the %d the lines alone cost",
			entry.bytes, entryBytes(lines))
	}
}

// The budget must come back down when a refined entry is evicted. Before the
// fix, `note` credited only the running total, so `used` ratcheted up across
// refines until the list fully drained.
func TestBlobCacheRefineFootprintIsReclaimedOnEviction(t *testing.T) {
	cache := newBlobCache(500)
	cache.put("sha1", "a.go", &blobEntry{lines: []string{"a"}, bytes: 100})
	cache.note("sha1", "a.go", 100)
	if cache.used != 200 {
		t.Fatalf("used after note = %d, want 200", cache.used)
	}
	// Force the refined entry out: a second entry that fits only if sha1 goes.
	cache.put("sha2", "b.go", &blobEntry{lines: []string{"b"}, bytes: 400})
	if cache.get("sha1", "a.go") != nil {
		t.Fatal("sha1 survived the budget; want evicted (LRU)")
	}
	if cache.used != 400 {
		t.Errorf("used after evicting the refined entry = %d, want 400 (its spans returned too)", cache.used)
	}
	// A note for an entry that is already gone owes the budget nothing.
	cache.note("sha1", "a.go", 100)
	if cache.used != 400 {
		t.Errorf("used after noting an evicted entry = %d, want 400", cache.used)
	}
}

// Defense in depth behind the FindFile gates: pathEscape deliberately leaves
// `.` unescaped so a real filename survives the route segment intact, which
// means a `..` segment would otherwise be resolved by GitHub rather than by us.
func TestRepoRelativePathRefusesTraversalAndAbsolutePaths(t *testing.T) {
	for _, path := range []string{"app/main.go", "a.go", "dir/.env", "x..y/a.go"} {
		if !repoRelativePath(path) {
			t.Errorf("repoRelativePath(%q) = false, want true", path)
		}
	}
	for _, path := range []string{
		"",
		"/etc/passwd",
		"../../etc/passwd",
		"app/../../etc/passwd",
		"app/./main.go",
		"app//main.go",
		"app/main.go\nx",
		"app/ma\x00in.go",
	} {
		if repoRelativePath(path) {
			t.Errorf("repoRelativePath(%q) = true, want false", path)
		}
	}
}
