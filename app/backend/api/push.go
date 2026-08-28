package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"rk/internal/push"
)

// maxPushBodyBytes bounds the request body for the push endpoints. Subscription
// and notify payloads are tiny; this guards against an oversized body.
const maxPushBodyBytes = 64 * 1024

// handlePushVAPIDPublicKey returns the server's VAPID public key (base64url) for
// the frontend to use as `applicationServerKey`. The keypair is generated and
// persisted lazily on first request.
// GET /api/push/vapid-public-key → {"key": "..."}
func (s *Server) handlePushVAPIDPublicKey(w http.ResponseWriter, r *http.Request) {
	keys, err := push.LoadOrCreateVAPIDKeys()
	if err != nil {
		s.logger.Error("failed to load VAPID keys", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load VAPID keys")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"key": keys.Public})
}

// handlePushSubscribe stores a browser PushSubscription, de-duplicated by
// endpoint. The body shape mirrors the Push API's PushSubscription JSON.
// POST /api/push/subscribe ← {endpoint, keys:{p256dh, auth}} → {"status":"ok"}
func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxPushBodyBytes)
	var sub push.Subscription
	if err := json.NewDecoder(r.Body).Decode(&sub); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if strings.TrimSpace(sub.Endpoint) == "" || sub.Keys.P256dh == "" || sub.Keys.Auth == "" {
		writeError(w, http.StatusBadRequest, "endpoint and keys (p256dh, auth) are required")
		return
	}
	if err := push.AddSubscription(sub); err != nil {
		s.logger.Error("failed to store push subscription", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to store subscription")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// notifyDeepLinkPath soft-validates an optional deep-link target from a notify
// request: only a same-origin relative path is accepted — it must start with
// "/" but not "//" (a protocol-relative "//evil.example" resolves to an
// external origin). Anything else drops to "" rather than erroring: callers of
// /api/notify are fail-soft by contract, and the service worker re-validates
// the value before navigating anyway.
func notifyDeepLinkPath(raw string) string {
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return ""
	}
	return raw
}

// handleNotify sends a Web Push to all stored subscriptions and prunes dead
// ones. The CLI ignores the response body; it is returned for observability.
// POST /api/notify ← {title?, body, url?} → {"sent": N, "pruned": M}
func (s *Server) handleNotify(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxPushBodyBytes)
	var body struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		URL   string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if strings.TrimSpace(body.Body) == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	title := body.Title
	if strings.TrimSpace(title) == "" {
		title = "RunKit"
	}
	url := notifyDeepLinkPath(body.URL)
	s.initSSEHub()
	s.sseHub.broadcastNotify(title, body.Body, url)
	result, err := push.Notify(r.Context(), title, body.Body, url)
	if err != nil {
		// Pruning may have failed; the send summary is still meaningful.
		s.logger.Warn("notify completed with error", "error", err, "sent", result.Sent, "pruned", result.Pruned)
	}
	writeJSON(w, http.StatusOK, result)
}
