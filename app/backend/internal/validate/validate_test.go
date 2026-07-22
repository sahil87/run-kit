package validate

import (
	"os"
	"testing"
)

func TestValidateName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		label    string
		wantErr  bool
		contains string
	}{
		{"valid name", "my-session", "Session name", false, ""},
		{"alphanumeric with hyphens/underscores", "test_session-123", "Name", false, ""},
		{"empty string", "", "Session name", true, "cannot be empty"},
		{"whitespace only", "   ", "Session name", true, "cannot be empty"},
		{"forbidden semicolon", "my;session", "Name", true, "forbidden characters"},
		{"forbidden ampersand", "my&session", "Name", true, "forbidden characters"},
		{"forbidden pipe", "my|session", "Name", true, "forbidden characters"},
		{"forbidden backtick", "my`session", "Name", true, "forbidden characters"},
		{"forbidden dollar", "my$session", "Name", true, "forbidden characters"},
		{"exceeds max length", string(make([]byte, 129)), "Name", true, "maximum length"},
		{"at max length", string(make([]byte, 128)), "Name", false, ""},
		{"contains colon", "my:session", "Name", true, "colons or periods"},
		{"contains period", "my.session", "Name", true, "colons or periods"},
		{"label in error", "", "Window name", true, "Window name"},
	}

	// Fill the max/over-max names with 'a'
	for i := range tests {
		if tests[i].name == "exceeds max length" {
			b := make([]byte, 129)
			for j := range b {
				b[j] = 'a'
			}
			tests[i].input = string(b)
		}
		if tests[i].name == "at max length" {
			b := make([]byte, 128)
			for j := range b {
				b[j] = 'a'
			}
			tests[i].input = string(b)
		}
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ValidateName(tt.input, tt.label)
			if tt.wantErr && result == "" {
				t.Error("expected error but got none")
			}
			if !tt.wantErr && result != "" {
				t.Errorf("expected no error but got: %s", result)
			}
			if tt.contains != "" && result == "" {
				t.Errorf("expected error containing %q but got none", tt.contains)
			}
			if tt.contains != "" && result != "" {
				if !contains(result, tt.contains) {
					t.Errorf("expected error containing %q but got: %s", tt.contains, result)
				}
			}
		})
	}
}

func TestValidateWindowID(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		label    string
		wantErr  bool
		contains string
	}{
		{"valid single digit", "@5", "Window ID", false, ""},
		{"valid multi digit", "@123", "Window ID", false, ""},
		{"valid zero", "@0", "Window ID", false, ""},
		{"empty string", "", "Window ID", true, "cannot be empty"},
		{"missing at sign", "5", "Window ID", true, "@N"},
		{"at sign only", "@", "Window ID", true, "@N"},
		{"injection attempt", "@5;rm", "Window ID", true, "@N"},
		{"non-numeric suffix", "window-5", "Window ID", true, "@N"},
		{"trailing space", "@5 ", "Window ID", true, "@N"},
		{"label in error", "bogus", "Window ID", true, "Window ID"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ValidateWindowID(tt.input, tt.label)
			if tt.wantErr && result == "" {
				t.Error("expected error but got none")
			}
			if !tt.wantErr && result != "" {
				t.Errorf("expected no error but got: %s", result)
			}
			if tt.contains != "" && result == "" {
				t.Errorf("expected error containing %q but got none", tt.contains)
			}
			if tt.contains != "" && result != "" {
				if !contains(result, tt.contains) {
					t.Errorf("expected error containing %q but got: %s", tt.contains, result)
				}
			}
		})
	}
}

func TestValidatePath(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		label    string
		wantErr  bool
		contains string
	}{
		{"valid path", "/home/user/project", "Path", false, ""},
		{"empty string", "", "Path", true, "cannot be empty"},
		{"null bytes", "/home/\x00evil", "Path", true, "invalid characters"},
		{"newlines", "/home/\nevil", "Path", true, "invalid characters"},
		{"exceeds max length", "/" + string(make([]byte, 1024)), "Path", true, "maximum length"},
	}

	// Fill the over-max path with 'a'
	for i := range tests {
		if tests[i].name == "exceeds max length" {
			b := make([]byte, 1024)
			for j := range b {
				b[j] = 'a'
			}
			tests[i].input = "/" + string(b)
		}
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ValidatePath(tt.input, tt.label)
			if tt.wantErr && result == "" {
				t.Error("expected error but got none")
			}
			if !tt.wantErr && result != "" {
				t.Errorf("expected no error but got: %s", result)
			}
		})
	}
}

func TestExpandTilde(t *testing.T) {
	home, _ := os.UserHomeDir()

	tests := []struct {
		name        string
		input       string
		wantPath    string
		wantErr     bool
		errContains string
	}{
		{"tilde alone", "~", home, false, ""},
		{"tilde path", "~/code/project", home + "/code/project", false, ""},
		{"bare relative", "code/project", home + "/code/project", false, ""},
		{"absolute under home", home + "/code/project", home + "/code/project", false, ""},
		{"dot-dot escape", "~/../../etc", "", true, "under home directory"},
		{"absolute outside home", "/etc/passwd", "", true, "under home directory"},
		{"tilde username", "~root", "", true, "~user expansion is not supported"},
		{"tilde other user path", "~otheruser/secret", "", true, "~user expansion is not supported"},
		{"home itself", home, home, false, ""},
		{"dot-dot within home", "~/code/../code/project", home + "/code/project", false, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path, errMsg := ExpandTilde(tt.input)
			if tt.wantErr {
				if errMsg == "" {
					t.Error("expected error but got none")
				}
				if tt.errContains != "" && !contains(errMsg, tt.errContains) {
					t.Errorf("expected error containing %q but got: %s", tt.errContains, errMsg)
				}
			} else {
				if errMsg != "" {
					t.Errorf("expected no error but got: %s", errMsg)
				}
				if path != tt.wantPath {
					t.Errorf("expected path %q but got %q", tt.wantPath, path)
				}
			}
		})
	}
}

func TestSanitizeFilename(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"simple filename", "screenshot.png", "screenshot.png"},
		{"forward slashes", "path/to/file.txt", "path-to-file.txt"},
		{"backslashes", "path\\to\\file.txt", "path-to-file.txt"},
		{"null bytes", "file\x00name.txt", "filename.txt"},
		{"leading dots", ".hidden", "hidden"},
		{"triple dots", "...triple", "triple"},
		{"path traversal", "../../../etc/passwd", "etc-passwd"},
		{"backslash traversal", "..\\..\\..\\etc\\passwd", "etc-passwd"},
		{"collapse dashes", "a---b", "a-b"},
		{"strip edges", "-file-", "file"},
		{"empty string", "", "upload"},
		{"dots only", "...", "upload"},
		{"slashes only", "///", "upload"},
		{"preserves extension", "my-document.pdf", "my-document.pdf"},
		{"spaces in name", "my file name.png", "my file name.png"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SanitizeFilename(tt.input)
			if got != tt.want {
				t.Errorf("SanitizeFilename(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestValidateTier(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantErr  bool
		contains string
	}{
		{"valid simple", "doing", false, ""},
		{"valid alphanumeric", "review2", false, ""},
		{"valid with hyphen", "my-tier", false, ""},
		{"valid with underscore", "my_tier", false, ""},
		{"valid leading underscore", "_tier", false, ""},
		{"valid single char", "d", false, ""},
		{"empty is rejected by the pattern", "", true, "alphanumeric"},
		{"leading hyphen rejected", "-doing", true, "must not start with a hyphen"},
		{"forbidden space", "a b", true, "alphanumeric"},
		{"forbidden slash", "a/b", true, "alphanumeric"},
		{"forbidden semicolon", "a;b", true, "alphanumeric"},
		{"forbidden dollar", "a$b", true, "alphanumeric"},
		{"at max length", "", false, ""},   // filled below
		{"exceeds max length", "", true, "maximum length"}, // filled below
	}

	// Fill the max/over-max cases with 'a' (kept valid-charset so the length
	// bound, not the pattern, is the failing rule).
	for i := range tests {
		if tests[i].name == "at max length" {
			b := make([]byte, MaxTierNameLength)
			for j := range b {
				b[j] = 'a'
			}
			tests[i].input = string(b)
		}
		if tests[i].name == "exceeds max length" {
			b := make([]byte, MaxTierNameLength+1)
			for j := range b {
				b[j] = 'a'
			}
			tests[i].input = string(b)
		}
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ValidateTier(tt.input)
			if tt.wantErr && result == "" {
				t.Errorf("ValidateTier(%q) = valid, want error", tt.input)
			}
			if !tt.wantErr && result != "" {
				t.Errorf("ValidateTier(%q) = %q, want valid", tt.input, result)
			}
			if tt.contains != "" && result != "" && !contains(result, tt.contains) {
				t.Errorf("ValidateTier(%q) = %q, want error containing %q", tt.input, result, tt.contains)
			}
		})
	}
}

func TestValidateToolName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantErr  bool
		contains string
	}{
		{"valid run-kit", "run-kit", false, ""},
		{"valid fab-kit", "fab-kit", false, ""},
		{"valid short tu", "tu", false, ""},
		{"valid wt", "wt", false, ""},
		{"valid alphanumeric", "tool2", false, ""},
		{"valid underscore", "my_tool", false, ""},
		{"valid leading underscore", "_tool", false, ""},
		{"empty rejected", "", true, "cannot be empty"},
		{"leading hyphen rejected (flag injection)", "-rf", true, "must not start with a hyphen"},
		{"leading double-hyphen rejected", "--force", true, "must not start with a hyphen"},
		{"forbidden space", "run kit", true, "alphanumeric"},
		{"forbidden tab", "run\tkit", true, "alphanumeric"},
		{"forbidden newline", "run\nkit", true, "alphanumeric"},
		{"forbidden semicolon", "a;b", true, "alphanumeric"},
		{"forbidden dollar", "a$b", true, "alphanumeric"},
		{"at max length", "", false, ""},                   // filled below
		{"exceeds max length", "", true, "maximum length"}, // filled below
	}

	for i := range tests {
		if tests[i].name == "at max length" {
			b := make([]byte, MaxToolNameLength)
			for j := range b {
				b[j] = 'a'
			}
			tests[i].input = string(b)
		}
		if tests[i].name == "exceeds max length" {
			b := make([]byte, MaxToolNameLength+1)
			for j := range b {
				b[j] = 'a'
			}
			tests[i].input = string(b)
		}
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ValidateToolName(tt.input)
			if tt.wantErr && result == "" {
				t.Errorf("ValidateToolName(%q) = valid, want error", tt.input)
			}
			if !tt.wantErr && result != "" {
				t.Errorf("ValidateToolName(%q) = %q, want valid", tt.input, result)
			}
			if tt.contains != "" && result != "" && !contains(result, tt.contains) {
				t.Errorf("ValidateToolName(%q) = %q, want error containing %q", tt.input, result, tt.contains)
			}
		})
	}
}

func TestValidateNewName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		label    string
		wantErr  bool
		contains string
	}{
		// The tightened rule: spaces rejected on NEW names.
		{"space rejected", "My problem", "Session name", true, "cannot contain spaces"},
		{"leading space rejected", " name", "Session name", true, "cannot contain spaces"},
		{"trailing space rejected", "name ", "Session name", true, "cannot contain spaces"},
		{"label in space error", "a b", "Window name", true, "Window name"},
		// Inherited from the permissive ValidateName rule.
		{"empty rejected", "", "Session name", true, "cannot be empty"},
		{"forbidden semicolon", "my;session", "Session name", true, "forbidden characters"},
		{"contains colon", "my:session", "Session name", true, "colons or periods"},
		{"contains period", "my.session", "Session name", true, "colons or periods"},
		// Hyphens stay legal on the backend (UI-only steering): internal
		// sessions (_rk-pin-*, rk-test-e2e, group names) rely on them.
		{"hyphens allowed", "my-session", "Session name", false, ""},
		{"underscores allowed", "My_problem", "Session name", false, ""},
		{"alphanumeric allowed", "session123", "Session name", false, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ValidateNewName(tt.input, tt.label)
			if tt.wantErr && result == "" {
				t.Errorf("ValidateNewName(%q) = valid, want error", tt.input)
			}
			if !tt.wantErr && result != "" {
				t.Errorf("ValidateNewName(%q) = %q, want valid", tt.input, result)
			}
			if tt.contains != "" && result != "" && !contains(result, tt.contains) {
				t.Errorf("ValidateNewName(%q) = %q, want error containing %q", tt.input, result, tt.contains)
			}
		})
	}
}

// TestValidateNewNameMaxLength pins that the length bound is inherited from
// ValidateName (128), not redefined.
func TestValidateNewNameMaxLength(t *testing.T) {
	long := make([]byte, 129)
	for i := range long {
		long[i] = 'a'
	}
	if result := ValidateNewName(string(long), "Session name"); result == "" {
		t.Error("expected max-length error, got valid")
	}
	if result := ValidateNewName(string(long[:128]), "Session name"); result != "" {
		t.Errorf("128-char name should be valid, got %q", result)
	}
}

func TestValidateWorktreeName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantErr  bool
		contains string
	}{
		{"valid simple", "swift-fox", false, ""},
		{"valid with underscore", "my_agent", false, ""},
		{"valid alphanumeric", "agent123", false, ""},
		// Inherited from the shared ValidateName rule (deliberately unchanged).
		{"empty rejected", "", true, "cannot be empty"},
		{"forbidden semicolon", "bad;name", true, "forbidden characters"},
		{"forbidden dollar", "bad$name", true, "forbidden characters"},
		{"contains colon", "bad:name", true, "colons or periods"},
		{"contains period", "bad.name", true, "colons or periods"},
		// riff-seam-only hardening (NOT applied by the shared ValidateName).
		{"leading hyphen rejected", "-agent", true, "must not start with a hyphen"},
		{"slash rejected", "a/b", true, "must not contain a slash"},
		{"space rejected", "a b", true, "must not contain spaces"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ValidateWorktreeName(tt.input)
			if tt.wantErr && result == "" {
				t.Errorf("ValidateWorktreeName(%q) = valid, want error", tt.input)
			}
			if !tt.wantErr && result != "" {
				t.Errorf("ValidateWorktreeName(%q) = %q, want valid", tt.input, result)
			}
			if tt.contains != "" && result != "" && !contains(result, tt.contains) {
				t.Errorf("ValidateWorktreeName(%q) = %q, want error containing %q", tt.input, result, tt.contains)
			}
		})
	}
}

func TestValidateColorValue(t *testing.T) {
	// Canonical and whitespace-tolerant forms (parts are trimmed, matching the
	// frontend parseColorValue), plus leading-zero indices.
	valid := []string{"0", "4", "15", "1+3", "0+15", "1+2", " 4 ", " 1 + 3 ", "01"}
	for _, v := range valid {
		if msg := ValidateColorValue(v); msg != "" {
			t.Errorf("ValidateColorValue(%q) = %q, want valid", v, msg)
		}
	}
	// Empty parts are rejected explicitly; "1 3" (space, no '+') is one part and
	// fails strconv after trimming.
	invalid := []string{"", "99", "-1", "16", "x", "1+", "+3", "1+2+3", "1.5", "1 3", "  +  ", "1 + "}
	for _, v := range invalid {
		if msg := ValidateColorValue(v); msg == "" {
			t.Errorf("ValidateColorValue(%q) = valid, want error", v)
		}
	}
}

func TestValidateMarkerValue(t *testing.T) {
	// The empty string is valid — it means "unset" (no marker).
	valid := []string{"", "dotted", "solid", "double"}
	for _, v := range valid {
		if msg := ValidateMarkerValue(v); msg != "" {
			t.Errorf("ValidateMarkerValue(%q) = %q, want valid", v, msg)
		}
	}
	// Anything outside the closed set is rejected (case-sensitive, no whitespace
	// tolerance — the frontend only ever writes the canonical tokens).
	invalid := []string{"Dotted", "DASHED", "dot", " solid ", "4", "1+3", "none", "true"}
	for _, v := range invalid {
		if msg := ValidateMarkerValue(v); msg == "" {
			t.Errorf("ValidateMarkerValue(%q) = valid, want error", v)
		}
	}
}

func TestNormalizeColorValue(t *testing.T) {
	cases := map[string]struct {
		want string
		ok   bool
	}{
		"4":      {"4", true},
		" 4 ":    {"4", true},
		"1+3":    {"1+3", true},
		" 1 + 3 ": {"1+3", true}, // internal whitespace collapses to canonical form
		"01":     {"1", true},    // leading zeros re-serialized
		"0+15":   {"0+15", true},
		"":       {"", false},
		"  ":     {"", false},
		"99":     {"", false},
		"1+2+3":  {"", false},
		"x":      {"", false},
	}
	for in, exp := range cases {
		got, ok := NormalizeColorValue(in)
		if got != exp.want || ok != exp.ok {
			t.Errorf("NormalizeColorValue(%q) = (%q, %v), want (%q, %v)", in, got, ok, exp.want, exp.ok)
		}
	}
}
