package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"rk/internal/inject"
	"rk/internal/push"
	"rk/internal/settings"
	"rk/internal/validate"
)

// notifyPush is the push seam (the waitingPushTracker.notify seam, at package
// scope because handleSay has no tracker struct): tests swap it to observe
// degradation-path pushes.
var notifyPush = push.Notify

// sayRequest is the POST body for handleSay. Server/Window are optional origin
// hints that become the push deep link when the request degrades to Web Push.
type sayRequest struct {
	Text   string `json:"text"`
	Server string `json:"server"`
	Window string `json:"window"`
}

// sayPayload is the `say` state-socket event payload fanned out by broadcastSay.
type sayPayload struct {
	Text   string `json:"text"`
	Server string `json:"server,omitempty"`
	Window string `json:"window,omitempty"`
	Ts     string `json:"ts"`
}

// handleSay serves POST /api/say — the spoken-reply leg: with voice enabled
// and at least one dashboard connected, the text fans out as a `say` event;
// otherwise it degrades to Web Push (plain notify when voice is disabled; a
// deep-link notify to the origin window when enabled but no dashboard is
// connected). Push failures are fail-soft, mirroring handleNotify.
// POST /api/say ← {"text", "server"?, "window"?} → {"ok": true}
func (s *Server) handleSay(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxPushBodyBytes)
	var body sayRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	// Strip terminal control bytes BEFORE the emptiness check so an all-control
	// message collapses to empty and takes the 400 path (the handleChatSend
	// ordering).
	text := inject.Sanitize(body.Text)
	if strings.TrimSpace(text) == "" {
		writeError(w, http.StatusBadRequest, "text is required")
		return
	}
	server := strings.TrimSpace(body.Server)
	if server != "" {
		if msg := validate.ValidateServerName(server); msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
	}
	window := strings.TrimSpace(body.Window)
	if window != "" {
		// The bare-N form normalizes to the canonical @N the shared validator
		// expects.
		window = "@" + strings.TrimPrefix(window, "@")
		if msg := validate.ValidateWindowID(window, "window"); msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
	}

	s.initSSEHub()
	if !settings.Load().VoiceEnabled {
		s.sayNotify(r, text, "")
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if !s.sseHub.hasStateConns() {
		url := ""
		if server != "" && window != "" {
			url = waitingPushURL(server, window, false)
		}
		s.sayNotify(r, text, url)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	s.sseHub.broadcastSay(sayPayload{
		Text:   text,
		Server: server,
		Window: window,
		Ts:     s.now().UTC().Format(time.RFC3339),
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// sayNotify runs the Web Push degradation path; failures stay fail-soft (the
// caller still answers 200), mirroring handleNotify.
func (s *Server) sayNotify(r *http.Request, text, url string) {
	result, err := notifyPush(r.Context(), "RunKit", text, url)
	if err != nil {
		s.logger.Warn("say notify completed with error", "error", err, "sent", result.Sent, "pruned", result.Pruned)
	}
}
