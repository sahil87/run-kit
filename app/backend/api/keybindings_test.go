package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleKeybindings(t *testing.T) {
	t.Run("returns filtered keybindings", func(t *testing.T) {
		// Override ListKeys to return sample list-keys output
		ops2 := &mockTmuxOpsWithKeys{
			listKeysResult: []string{
				`bind-key    -T root          F2                 new-window`,
				`bind-key    -T root          F3                 previous-window`,
				`bind-key    -T root          F4                 next-window`,
				`bind-key    -T prefix        |                  split-window -h`,
				`bind-key    -T prefix        -                  split-window -v`,
				`bind-key    -T root          S-F3               select-pane -t :.-`,
				`bind-key    -T root          S-F7               copy-mode`,
				`bind-key    -T root          F8                 command-prompt -I "#W" "rename-window -- '%%'"`,
				`bind-key    -T prefix        d                  detach-client`,
				`bind-key    -T prefix        x                  confirm-before -p "kill-pane #P? (y/n)" kill-pane`,
			},
		}
		router2 := newTestRouter(&mockSessionFetcher{}, ops2)

		req := httptest.NewRequest("GET", "/api/keybindings?server=runkit", nil)
		rec := httptest.NewRecorder()
		router2.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}

		var result []keybinding
		if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
			t.Fatalf("decode error: %v", err)
		}

		// Should include whitelisted bindings, exclude detach-client and confirm-before
		if len(result) != 8 {
			t.Fatalf("expected 8 bindings, got %d: %+v", len(result), result)
		}

		// Check specific entries
		found := map[string]bool{}
		for _, kb := range result {
			found[kb.Label] = true
		}
		expected := []string{"New window", "Previous window", "Next window", "Split vertically", "Split horizontally", "Previous pane", "Scroll / copy mode", "Rename window"}
		for _, e := range expected {
			if !found[e] {
				t.Errorf("expected label %q not found in results", e)
			}
		}
	})

	t.Run("returns empty array when no server", func(t *testing.T) {
		ops := &mockTmuxOpsWithKeys{
			listKeysResult: nil,
			listKeysErr:    nil,
		}
		router := newTestRouter(&mockSessionFetcher{}, ops)

		req := httptest.NewRequest("GET", "/api/keybindings?server=runkit", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}

		var result []keybinding
		if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
			t.Fatalf("decode error: %v", err)
		}
		if len(result) != 0 {
			t.Fatalf("expected 0 bindings, got %d", len(result))
		}
	})

	t.Run("returns empty array on ListKeys error", func(t *testing.T) {
		ops := &mockTmuxOpsWithKeys{
			listKeysResult: nil,
			listKeysErr:    fmt.Errorf("connection refused"),
		}
		router := newTestRouter(&mockSessionFetcher{}, ops)

		req := httptest.NewRequest("GET", "/api/keybindings?server=runkit", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}

		var result []keybinding
		if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
			t.Fatalf("decode error: %v", err)
		}
		if len(result) != 0 {
			t.Fatalf("expected 0 bindings, got %d", len(result))
		}
	})
}

func TestParseListKeysLine(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantOK  bool
		wantKey string
		wantTab string
		wantCmd string
	}{
		{
			name:    "root binding",
			input:   `bind-key    -T root          F2                 new-window`,
			wantOK:  true,
			wantKey: "F2",
			wantTab: "root",
			wantCmd: "new-window",
		},
		{
			name:    "prefix binding with args",
			input:   `bind-key    -T prefix        |                  split-window -h`,
			wantOK:  true,
			wantKey: "|",
			wantTab: "prefix",
			wantCmd: "split-window -h",
		},
		{
			name:   "copy-select table excluded",
			input:  `bind-key    -T copy-mode-vi  v                  send-keys -X begin-selection`,
			wantOK: false,
		},
		{
			name:   "too few fields",
			input:  `bind-key -T`,
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			kb, ok := parseListKeysLine(tt.input)
			if ok != tt.wantOK {
				t.Fatalf("parseListKeysLine ok = %v, want %v", ok, tt.wantOK)
			}
			if !ok {
				return
			}
			if kb.Key != tt.wantKey {
				t.Errorf("key = %q, want %q", kb.Key, tt.wantKey)
			}
			if kb.Table != tt.wantTab {
				t.Errorf("table = %q, want %q", kb.Table, tt.wantTab)
			}
			if kb.Command != tt.wantCmd {
				t.Errorf("command = %q, want %q", kb.Command, tt.wantCmd)
			}
		})
	}
}

func TestMatchWhitelist(t *testing.T) {
	tests := []struct {
		command   string
		wantLabel string
		wantFound bool
	}{
		{"new-window", "New window", true},
		{"split-window -h", "Split vertically", true},
		{"detach-client", "", false},
		{`command-prompt -I "#W" "rename-window -- '%%'"`, "Rename window", true},
	}

	for _, tt := range tests {
		t.Run(tt.command, func(t *testing.T) {
			label, found := matchWhitelist(tt.command)
			if found != tt.wantFound {
				t.Errorf("found = %v, want %v", found, tt.wantFound)
			}
			if label != tt.wantLabel {
				t.Errorf("label = %q, want %q", label, tt.wantLabel)
			}
		})
	}
}

// mockTmuxOpsWithKeys extends mockTmuxOps with ListKeys support.
type mockTmuxOpsWithKeys struct {
	mockTmuxOps
	listKeysResult []string
	listKeysErr    error
}

func (m *mockTmuxOpsWithKeys) ListKeys(server string) ([]string, error) {
	return m.listKeysResult, m.listKeysErr
}
