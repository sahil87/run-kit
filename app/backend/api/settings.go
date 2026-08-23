package api

import (
	"encoding/json"
	"net/http"

	"rk/internal/settings"
	"rk/internal/tmux"
)

// settingEntry is one registry row in the GET /api/settings payload: the
// entry's metadata plus its current value in the natural JSON type (string or
// null for scalars, bool, object for maps, array for the list).
type settingEntry struct {
	Key         string `json:"key"`
	Kind        string `json:"kind"`
	Default     string `json:"default"`
	Description string `json:"description"`
	Category    string `json:"category"`
	UI          bool   `json:"ui"`
	Live        bool   `json:"live"`
	Value       any    `json:"value"`
}

// handleGetSettings returns the full settings registry plus current values,
// in registry order.
// GET /api/settings → {"settings": [{key, kind, default, description, category, ui, live, value}, ...]}
func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	current := settings.Load()
	infos := settings.Registry()
	entries := make([]settingEntry, 0, len(infos))
	for _, info := range infos {
		value, _ := settings.ReadValue(&current, info.Key)
		entries = append(entries, settingEntry{
			Key:         info.Key,
			Kind:        info.Kind,
			Default:     info.Default,
			Description: info.Description,
			Category:    info.Category,
			UI:          info.UI,
			Live:        info.Live,
			Value:       normalizeSettingValue(value),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": entries})
}

// normalizeSettingValue coerces a registry read into its JSON wire shape:
// empty maps surface as {} and an empty board order as [] (never null).
func normalizeSettingValue(value any) any {
	switch v := value.(type) {
	case map[string]string:
		if v == nil {
			return map[string]string{}
		}
		return v
	case []string:
		if v == nil {
			return []string{}
		}
		return v
	default:
		return value
	}
}

// handlePostSettings applies a partial-merge settings patch per Constitution
// IX: present keys set, absent keys are untouched, null unsets (resets to the
// registry default). Map keys merge per entry (an entry null unsets that
// entry); board_order replaces wholesale. The whole body is validated BEFORE
// anything persists — an unknown key, malformed body, or any per-key
// validation failure is a 400 with nothing written.
// POST /api/settings ← {"theme": "dark", "server_colors": {"dev": "4"}, ...} → 200 {"status": "ok"}
//
// Board-order entry validity (tmux.ValidBoardName, duplicates) is checked
// here, not in internal/settings — settings cannot import tmux (tmux imports
// settings; a back-reference would be an import cycle). When the patch
// contains board_order, a successful save broadcasts the new order to every
// connected SSE client (server-global — see broadcastBoardOrder).
func (s *Server) handlePostSettings(w http.ResponseWriter, r *http.Request) {
	var patch map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	// Validate the whole body before any write (all-or-nothing). Values are
	// applied to an in-memory copy, so a mid-patch failure leaves both the
	// loaded settings and the file untouched.
	current := settings.Load()
	_, hasBoardOrder := patch["board_order"]
	for key, raw := range patch {
		if key == "board_order" {
			if msg := validateBoardOrderPatch(raw); msg != "" {
				writeError(w, http.StatusBadRequest, msg)
				return
			}
		}
		if err := settings.ApplyValue(&current, key, raw); err != nil {
			writeError(w, http.StatusBadRequest, key+": "+err.Error())
			return
		}
	}

	if err := settings.Save(current); err != nil {
		s.logger.Error("failed to save settings", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save settings")
		return
	}

	// Broadcast the new order to every connected state-socket client
	// (host-global, so even a zero-attached-server Host tab with only a
	// metrics subscription hears it).
	if hasBoardOrder {
		s.initSSEHub()
		s.sseHub.broadcastBoardOrder(current.BoardOrder)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// validateBoardOrderPatch checks a board_order patch value's entry names and
// duplicate-freedom. Returns "" when valid, an error message otherwise.
func validateBoardOrderPatch(raw json.RawMessage) string {
	if string(raw) == "null" {
		return ""
	}
	var names []string
	if err := json.Unmarshal(raw, &names); err != nil {
		return "board_order: value must be an array or null"
	}
	seen := make(map[string]struct{}, len(names))
	for _, name := range names {
		if !tmux.ValidBoardName(name) {
			return "invalid board name: " + name
		}
		if _, dup := seen[name]; dup {
			return "Duplicate board name in order: " + name
		}
		seen[name] = struct{}{}
	}
	return ""
}
