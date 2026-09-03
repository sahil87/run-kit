package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"rk/internal/sessions"
	"rk/internal/settings"
	"rk/internal/stt"
	"rk/internal/tmux"
)

// enableVoice isolates settings at a throwaway HOME and flips voice_enabled on.
func enableVoice(t *testing.T) {
	t.Helper()
	isolateSettings(t)
	st := settings.Default()
	st.VoiceEnabled = true
	if err := settings.Save(st); err != nil {
		t.Fatalf("Save: %v", err)
	}
}

// swapTranscribe replaces the transcription seam with fn for the test's
// duration and returns a call log.
func swapTranscribe(t *testing.T, fn func(ctx context.Context, opts stt.TranscribeOptions) (string, error)) *[]stt.TranscribeOptions {
	t.Helper()
	var calls []stt.TranscribeOptions
	orig := transcribeAudio
	transcribeAudio = func(ctx context.Context, opts stt.TranscribeOptions) (string, error) {
		calls = append(calls, opts)
		if fn == nil {
			return "", nil
		}
		return fn(ctx, opts)
	}
	t.Cleanup(func() { transcribeAudio = orig })
	return &calls
}

func postWav(t *testing.T, router http.Handler, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "audio/wav")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestVoiceTranscribe_disabledGate404s(t *testing.T) {
	isolateSettings(t)
	calls := swapTranscribe(t, nil)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postWav(t, router, "/api/voice/transcribe", []byte("RIFF...."))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
	if len(*calls) != 0 {
		t.Errorf("transcription invoked %d times with voice disabled, want 0", len(*calls))
	}
}

func TestVoiceTranscribe_happyPath(t *testing.T) {
	enableVoice(t)
	calls := swapTranscribe(t, func(ctx context.Context, opts stt.TranscribeOptions) (string, error) {
		if _, err := os.Stat(opts.WavPath); err != nil {
			t.Errorf("staged WAV unreadable at invocation: %v", err)
		}
		return "hello there", nil
	})
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postWav(t, router, "/api/voice/transcribe", []byte("RIFF-fake-wav"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result["text"] != "hello there" {
		t.Errorf("text = %q, want %q", result["text"], "hello there")
	}

	if len(*calls) != 1 {
		t.Fatalf("transcription calls = %d, want 1", len(*calls))
	}
	opts := (*calls)[0]
	if opts.ModelTag != "small.en" {
		t.Errorf("ModelTag = %q, want %q (the registry default)", opts.ModelTag, "small.en")
	}
	if strings.Join(opts.Vocabulary, ",") != "tmux,fab,run-kit,worktree,pane" {
		t.Errorf("Vocabulary = %v, want the base terms (no ?server=)", opts.Vocabulary)
	}
	// The staged WAV must not outlive the request.
	if _, err := os.Stat(opts.WavPath); !os.IsNotExist(err) {
		t.Errorf("staged WAV still exists after the request: %v", err)
	}
}

func TestVoiceTranscribe_oversize413(t *testing.T) {
	enableVoice(t)
	calls := swapTranscribe(t, nil)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postWav(t, router, "/api/voice/transcribe", make([]byte, voiceMaxAudioBytes+1))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusRequestEntityTooLarge, rec.Body.String())
	}
	if len(*calls) != 0 {
		t.Errorf("transcription invoked %d times on an oversize body, want 0", len(*calls))
	}
}

func TestVoiceTranscribe_notInstalled503(t *testing.T) {
	enableVoice(t)
	swapTranscribe(t, func(ctx context.Context, opts stt.TranscribeOptions) (string, error) {
		return "", stt.ErrNotInstalled
	})
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postWav(t, router, "/api/voice/transcribe", []byte("RIFF-fake-wav"))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "whisper is not installed — run rk voice install") {
		t.Errorf("body = %s, want the remediation message", rec.Body.String())
	}
}

func TestVoiceTranscribe_failure502(t *testing.T) {
	enableVoice(t)
	swapTranscribe(t, func(ctx context.Context, opts stt.TranscribeOptions) (string, error) {
		return "", errors.New("whisper exploded")
	})
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postWav(t, router, "/api/voice/transcribe", []byte("RIFF-fake-wav"))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusBadGateway, rec.Body.String())
	}
}

func TestVoiceTranscribe_vocabularyDerivedFromServer(t *testing.T) {
	enableVoice(t)
	calls := swapTranscribe(t, nil)
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{
			Name: "run-kit",
			Windows: []tmux.WindowInfo{
				{WindowID: "@1", Name: "voice-round-trip", WorktreePath: "/home/user/code/coastal-yak"},
			},
		},
	}}
	router := newTestRouter(sf, &mockTmuxOps{})

	rec := postWav(t, router, "/api/voice/transcribe?server=test", []byte("RIFF-fake-wav"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if sf.calls != 1 {
		t.Errorf("FetchSessions calls = %d, want exactly 1", sf.calls)
	}
	vocab := strings.Join((*calls)[0].Vocabulary, ",")
	for _, term := range []string{"tmux", "fab", "run-kit", "worktree", "pane", "voice-round-trip", "coastal-yak"} {
		if !strings.Contains(vocab, term) {
			t.Errorf("vocabulary %q missing %q", vocab, term)
		}
	}
}

func TestVoiceTranscribe_invalidServerDegradesToBaseVocabulary(t *testing.T) {
	enableVoice(t)
	calls := swapTranscribe(t, nil)
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{{Name: "leaked-name"}}}
	router := newTestRouter(sf, &mockTmuxOps{})

	rec := postWav(t, router, "/api/voice/transcribe?server=bad%3Bname", []byte("RIFF-fake-wav"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if sf.calls != 0 {
		t.Errorf("FetchSessions calls = %d, want 0 (an invalid server name must not fall back to default)", sf.calls)
	}
	if got := strings.Join((*calls)[0].Vocabulary, ","); got != "tmux,fab,run-kit,worktree,pane" {
		t.Errorf("Vocabulary = %q, want the base terms only", got)
	}
}

func TestVoiceTranscribe_fetchErrorDegradesToBaseVocabulary(t *testing.T) {
	enableVoice(t)
	calls := swapTranscribe(t, nil)
	sf := &mockSessionFetcher{err: errors.New("tmux down")}
	router := newTestRouter(sf, &mockTmuxOps{})

	rec := postWav(t, router, "/api/voice/transcribe?server=test", []byte("RIFF-fake-wav"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (a fetch failure degrades, never errors); body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := strings.Join((*calls)[0].Vocabulary, ","); got != "tmux,fab,run-kit,worktree,pane" {
		t.Errorf("Vocabulary = %q, want the base terms only", got)
	}
}
