package api

import (
	"net/http"
	"strings"
)

// keybinding represents a single tmux keybinding in the API response.
type keybinding struct {
	Key     string `json:"key"`
	Table   string `json:"table"`
	Command string `json:"command"`
	Label   string `json:"label"`
}

// keybindingWhitelist maps tmux command patterns to human-friendly labels.
// Only commands in this map are included in the API response.
// Note: "command-prompt ... rename-window" is matched via special case in matchWhitelist().
var keybindingWhitelist = map[string]string{
	"new-window":           "New window",
	"previous-window":      "Previous window",
	"next-window":          "Next window",
	"split-window -h":      "Split vertically",
	"split-window -v":      "Split horizontally",
	"select-pane -t :.-":   "Previous pane",
	"select-pane -t :.+":   "Next pane",
	"copy-mode":            "Scroll / copy mode",
}

// handleKeybindings returns the curated keybindings for the active tmux server.
func (s *Server) handleKeybindings(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)

	lines, err := s.tmux.ListKeys(server)
	if err != nil {
		s.logger.Error("list-keys failed", "error", err)
		writeJSON(w, http.StatusOK, []keybinding{})
		return
	}

	var result []keybinding
	for _, line := range lines {
		kb, ok := parseListKeysLine(line)
		if !ok {
			continue
		}
		if label, found := matchWhitelist(kb.Command); found {
			kb.Label = label
			result = append(result, kb)
		}
	}

	if result == nil {
		result = []keybinding{}
	}
	writeJSON(w, http.StatusOK, result)
}

// parseListKeysLine parses a single line from `tmux list-keys`.
// Format: "bind-key    -T <table>       <key>              <command...>"
func parseListKeysLine(line string) (keybinding, bool) {
	fields := strings.Fields(line)
	// Minimum: bind-key -T <table> <key> <command>
	if len(fields) < 5 {
		return keybinding{}, false
	}

	// Find -T flag for table
	tableIdx := -1
	for i, f := range fields {
		if f == "-T" && i+1 < len(fields) {
			tableIdx = i
			break
		}
	}
	if tableIdx < 0 {
		return keybinding{}, false
	}

	table := fields[tableIdx+1]
	// Only include prefix and root tables
	if table != "prefix" && table != "root" {
		return keybinding{}, false
	}

	keyIdx := tableIdx + 2
	if keyIdx >= len(fields) {
		return keybinding{}, false
	}
	key := fields[keyIdx]

	// Command is everything after the key
	command := strings.Join(fields[keyIdx+1:], " ")

	return keybinding{
		Key:     key,
		Table:   table,
		Command: command,
	}, true
}

// matchWhitelist checks if a command matches any whitelist entry.
// Handles exact matches and prefix matches for commands like
// "command-prompt ... rename-window ...".
func matchWhitelist(command string) (string, bool) {
	// Exact match first
	if label, ok := keybindingWhitelist[command]; ok {
		return label, true
	}

	// Special case: rename-window via command-prompt
	if strings.HasPrefix(command, "command-prompt") && strings.Contains(command, "rename-window") {
		return "Rename window", true
	}

	return "", false
}
