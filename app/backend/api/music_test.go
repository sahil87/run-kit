package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// --- mock backend ---

type mockMusicBackend struct {
	nowPlayingResp NowPlayingResponse
	nowPlayingErr  error
	controlErr     error
	lastAction     string
}

func (m *mockMusicBackend) NowPlaying() (NowPlayingResponse, error) {
	return m.nowPlayingResp, m.nowPlayingErr
}

func (m *mockMusicBackend) Control(action string) error {
	m.lastAction = action
	return m.controlErr
}

// --- helpers ---

func newMusicRouter(t *testing.T, backend MusicBackend) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	s := &Server{
		logger:   logger,
		sessions: &mockSessionFetcher{},
		tmux:     &mockTmuxOps{},
		hostname: "test-host",
		music:    backend,
	}
	return s.buildRouter()
}

func nowPlayingRequest(t *testing.T, router http.Handler) (int, NowPlayingResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/music/now-playing", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var resp NowPlayingResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return rec.Code, resp
}

func controlRequest(t *testing.T, router http.Handler, action string) (int, map[string]interface{}) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"action": action})
	req := httptest.NewRequest(http.MethodPost, "/api/music/control", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var resp map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return rec.Code, resp
}

// --- now-playing tests ---

func TestNowPlaying_AppleMusic_Playing(t *testing.T) {
	backend := &mockMusicBackend{
		nowPlayingResp: NowPlayingResponse{
			Title:  "Confident",
			Artist: "Demi Lovato",
			State:  "playing",
			App:    "nowplaying",
		},
	}
	router := newMusicRouter(t, backend)
	code, resp := nowPlayingRequest(t, router)

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if resp.Title != "Confident" {
		t.Errorf("title = %q, want %q", resp.Title, "Confident")
	}
	if resp.Artist != "Demi Lovato" {
		t.Errorf("artist = %q, want %q", resp.Artist, "Demi Lovato")
	}
	if resp.State != "playing" {
		t.Errorf("state = %q, want playing", resp.State)
	}
}

func TestNowPlaying_AppleMusic_Paused(t *testing.T) {
	backend := &mockMusicBackend{
		nowPlayingResp: NowPlayingResponse{
			Title:  "Cool for the Summer",
			Artist: "Demi Lovato",
			State:  "paused",
			App:    "nowplaying",
		},
	}
	router := newMusicRouter(t, backend)
	_, resp := nowPlayingRequest(t, router)

	if resp.State != "paused" {
		t.Errorf("state = %q, want paused", resp.State)
	}
	if resp.Title != "Cool for the Summer" {
		t.Errorf("title = %q, want %q", resp.Title, "Cool for the Summer")
	}
}

func TestNowPlaying_Spotify_Playing(t *testing.T) {
	// Spotify registers with the macOS Media Remote framework, so nowplaying-cli
	// surfaces it identically — state is "playing" when playbackRate == 1.
	backend := &mockMusicBackend{
		nowPlayingResp: NowPlayingResponse{
			Title:  "Blinding Lights",
			Artist: "The Weeknd",
			State:  "playing",
			App:    "nowplaying",
		},
	}
	router := newMusicRouter(t, backend)
	code, resp := nowPlayingRequest(t, router)

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if resp.Title != "Blinding Lights" {
		t.Errorf("title = %q, want %q", resp.Title, "Blinding Lights")
	}
	if resp.Artist != "The Weeknd" {
		t.Errorf("artist = %q, want %q", resp.Artist, "The Weeknd")
	}
	if resp.State != "playing" {
		t.Errorf("state = %q, want playing", resp.State)
	}
}

func TestNowPlaying_Spotify_Paused(t *testing.T) {
	backend := &mockMusicBackend{
		nowPlayingResp: NowPlayingResponse{
			Title:  "Blinding Lights",
			Artist: "The Weeknd",
			State:  "paused",
			App:    "nowplaying",
		},
	}
	router := newMusicRouter(t, backend)
	_, resp := nowPlayingRequest(t, router)

	if resp.State != "paused" {
		t.Errorf("state = %q, want paused", resp.State)
	}
}

func TestNowPlaying_YouTubeMusic_Chrome_Playing(t *testing.T) {
	// YouTube Music in Chrome/Safari registers with macOS Media Remote — same
	// nowplaying-cli output, just different title/artist metadata.
	backend := &mockMusicBackend{
		nowPlayingResp: NowPlayingResponse{
			Title:  "As It Was",
			Artist: "Harry Styles",
			State:  "playing",
			App:    "nowplaying",
		},
	}
	router := newMusicRouter(t, backend)
	code, resp := nowPlayingRequest(t, router)

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if resp.Title != "As It Was" {
		t.Errorf("title = %q, want %q", resp.Title, "As It Was")
	}
	if resp.State != "playing" {
		t.Errorf("state = %q, want playing", resp.State)
	}
}

func TestNowPlaying_YouTubeMusic_Safari_Playing(t *testing.T) {
	backend := &mockMusicBackend{
		nowPlayingResp: NowPlayingResponse{
			Title:  "Flowers",
			Artist: "Miley Cyrus",
			State:  "playing",
			App:    "nowplaying",
		},
	}
	router := newMusicRouter(t, backend)
	_, resp := nowPlayingRequest(t, router)

	if resp.State != "playing" {
		t.Errorf("state = %q, want playing", resp.State)
	}
	if resp.Title != "Flowers" {
		t.Errorf("title = %q, want %q", resp.Title, "Flowers")
	}
}

func TestNowPlaying_Stopped_NoActivePlayer(t *testing.T) {
	backend := &mockMusicBackend{
		nowPlayingResp: NowPlayingResponse{State: "stopped"},
	}
	router := newMusicRouter(t, backend)
	code, resp := nowPlayingRequest(t, router)

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if resp.State != "stopped" {
		t.Errorf("state = %q, want stopped", resp.State)
	}
	if resp.Title != "" {
		t.Errorf("title should be empty when stopped, got %q", resp.Title)
	}
}

func TestNowPlaying_BackendError_ReturnsStopped(t *testing.T) {
	// If nowplaying-cli fails (e.g. not installed), we return stopped gracefully.
	backend := &mockMusicBackend{
		nowPlayingErr: errors.New("nowplaying-cli: command not found"),
		nowPlayingResp: NowPlayingResponse{State: "stopped"},
	}
	router := newMusicRouter(t, backend)
	code, resp := nowPlayingRequest(t, router)

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if resp.State != "stopped" {
		t.Errorf("state = %q, want stopped", resp.State)
	}
}

func TestNowPlaying_ResponseShape(t *testing.T) {
	// Verify all expected fields are present in JSON output.
	backend := &mockMusicBackend{
		nowPlayingResp: NowPlayingResponse{
			Title:  "T",
			Artist: "A",
			State:  "playing",
			App:    "nowplaying",
		},
	}
	router := newMusicRouter(t, backend)
	req := httptest.NewRequest(http.MethodGet, "/api/music/now-playing", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var raw map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, field := range []string{"title", "artist", "state", "app"} {
		if _, ok := raw[field]; !ok {
			t.Errorf("missing field %q in JSON response", field)
		}
	}
}

// --- control tests ---

func TestControl_Play(t *testing.T) {
	backend := &mockMusicBackend{}
	router := newMusicRouter(t, backend)
	code, resp := controlRequest(t, router, "play")

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if resp["ok"] != true {
		t.Errorf("ok = %v, want true", resp["ok"])
	}
	if backend.lastAction != "play" {
		t.Errorf("action = %q, want play", backend.lastAction)
	}
}

func TestControl_Pause(t *testing.T) {
	backend := &mockMusicBackend{}
	router := newMusicRouter(t, backend)
	code, _ := controlRequest(t, router, "pause")

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if backend.lastAction != "pause" {
		t.Errorf("action = %q, want pause", backend.lastAction)
	}
}

func TestControl_Next(t *testing.T) {
	backend := &mockMusicBackend{}
	router := newMusicRouter(t, backend)
	code, _ := controlRequest(t, router, "next")

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if backend.lastAction != "next" {
		t.Errorf("action = %q, want next", backend.lastAction)
	}
}

func TestControl_Previous(t *testing.T) {
	backend := &mockMusicBackend{}
	router := newMusicRouter(t, backend)
	code, _ := controlRequest(t, router, "previous")

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if backend.lastAction != "previous" {
		t.Errorf("action = %q, want previous", backend.lastAction)
	}
}

func TestControl_Toggle(t *testing.T) {
	backend := &mockMusicBackend{}
	router := newMusicRouter(t, backend)
	code, _ := controlRequest(t, router, "toggle")

	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if backend.lastAction != "toggle" {
		t.Errorf("action = %q, want toggle", backend.lastAction)
	}
}

func TestControl_InvalidAction(t *testing.T) {
	backend := &mockMusicBackend{}
	router := newMusicRouter(t, backend)
	code, resp := controlRequest(t, router, "eject")

	if code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", code)
	}
	if _, ok := resp["error"]; !ok {
		t.Error("expected error field in response")
	}
}

func TestControl_MalformedBody(t *testing.T) {
	backend := &mockMusicBackend{}
	router := newMusicRouter(t, backend)

	req := httptest.NewRequest(http.MethodPost, "/api/music/control", bytes.NewBufferString("not-json"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestControl_BackendError(t *testing.T) {
	// If nowplaying-cli fails mid-command, we return 500.
	backend := &mockMusicBackend{controlErr: errors.New("media remote unavailable")}
	router := newMusicRouter(t, backend)
	code, resp := controlRequest(t, router, "play")

	if code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", code)
	}
	if _, ok := resp["error"]; !ok {
		t.Error("expected error field in response")
	}
}

// --- nowplayingCommand mapping ---

func TestNowplayingCommand(t *testing.T) {
	cases := []struct{ action, want string }{
		{"play", "play"},
		{"pause", "pause"},
		{"toggle", "togglePlayPause"},
		{"next", "next"},
		{"previous", "previous"},
		{"eject", ""},
		{"", ""},
	}
	for _, c := range cases {
		got := nowplayingCommand(c.action)
		if got != c.want {
			t.Errorf("nowplayingCommand(%q) = %q, want %q", c.action, got, c.want)
		}
	}
}
