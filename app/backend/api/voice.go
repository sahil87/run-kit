package api

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"rk/internal/settings"
	"rk/internal/stt"
	"rk/internal/validate"
)

const (
	// voiceMaxAudioBytes bounds one transcription upload (a 16kHz mono PCM16
	// WAV holds ~5 minutes of audio inside it).
	voiceMaxAudioBytes = 10 << 20
	// voiceVocabMaxTerms caps the whisper initial-prompt vocabulary — base
	// terms plus derived session/window/worktree names.
	voiceVocabMaxTerms = 50
)

// voiceBaseVocabulary is the jargon floor every transcription is primed with.
var voiceBaseVocabulary = []string{"tmux", "fab", "run-kit", "worktree", "pane"}

// transcribeAudio is the transcription seam: tests swap it to intercept the
// whisper invocation (the mux_send.go package-var pattern).
var transcribeAudio = stt.Transcribe

// handleVoiceTranscribe serves POST /api/voice/transcribe — transcribes a
// 16kHz mono WAV body via the managed whisper install. The voice_enabled gate
// is fail-closed (404, evaluated before any body read or subprocess); the body
// is staged to a temp file that never outlives the request. Vocabulary priming
// is best-effort: with ?server= the server's session/window/worktree names are
// derived from ONE FetchSessions pass, and a fetch failure degrades to the
// base terms rather than erroring.
// POST /api/voice/transcribe?server=<srv> ← WAV body → {"text": "<transcript>"}
func (s *Server) handleVoiceTranscribe(w http.ResponseWriter, r *http.Request) {
	cfg := settings.Load()
	if !cfg.VoiceEnabled {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, voiceMaxAudioBytes)
	f, err := os.CreateTemp("", "rk-voice-*.wav")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to stage audio")
		return
	}
	defer os.Remove(f.Name())
	_, copyErr := io.Copy(f, r.Body)
	closeErr := f.Close()
	if copyErr != nil {
		var maxErr *http.MaxBytesError
		if errors.As(copyErr, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "audio body too large")
			return
		}
		writeError(w, http.StatusBadRequest, "failed to read audio body")
		return
	}
	if closeErr != nil {
		writeError(w, http.StatusInternalServerError, "failed to stage audio")
		return
	}

	text, err := transcribeAudio(r.Context(), stt.TranscribeOptions{
		WavPath:    f.Name(),
		ModelTag:   cfg.VoiceSTTModel,
		Vocabulary: s.voiceVocabulary(r),
	})
	if err != nil {
		if errors.Is(err, stt.ErrNotInstalled) {
			writeError(w, http.StatusServiceUnavailable, "whisper is not installed — run rk voice install")
			return
		}
		s.logger.Warn("voice transcribe failed", "error", err)
		writeError(w, http.StatusBadGateway, "transcription failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": text})
}

// voiceVocabulary builds the whisper initial-prompt term list: the base terms
// plus — when the request names a server — session names, window names, and
// worktree directory names from one session-snapshot pass. Deduplicated,
// capped at voiceVocabMaxTerms; a fetch failure yields the base terms only.
func (s *Server) voiceVocabulary(r *http.Request) []string {
	vocab := append([]string(nil), voiceBaseVocabulary...)
	// Validated here rather than via serverFromRequest: that helper falls back
	// to "default" on an invalid name, which would prime the vocabulary from
	// the wrong server — an invalid name degrades to base terms instead.
	server := r.URL.Query().Get("server")
	if server == "" || validate.ValidateServerName(server) != "" {
		return vocab
	}
	sess, err := s.sessions.FetchSessions(r.Context(), server)
	if err != nil {
		s.logger.Warn("voice vocabulary derivation failed", "error", err)
		return vocab
	}
	seen := make(map[string]bool, len(vocab))
	for _, term := range vocab {
		seen[term] = true
	}
	add := func(term string) {
		if term == "" || seen[term] || len(vocab) >= voiceVocabMaxTerms {
			return
		}
		seen[term] = true
		vocab = append(vocab, term)
	}
	for si := range sess {
		add(sess[si].Name)
		for wi := range sess[si].Windows {
			add(sess[si].Windows[wi].Name)
			if path := sess[si].Windows[wi].WorktreePath; path != "" {
				add(filepath.Base(path))
			}
		}
	}
	return vocab
}
