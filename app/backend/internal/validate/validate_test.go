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

func TestValidateColorValue(t *testing.T) {
	valid := []string{"0", "4", "15", "1+3", "0+15", "1+2"}
	for _, v := range valid {
		if msg := ValidateColorValue(v); msg != "" {
			t.Errorf("ValidateColorValue(%q) = %q, want valid", v, msg)
		}
	}
	invalid := []string{"", "99", "-1", "16", "x", "1+", "+3", "1+2+3", "1.5", "1 3"}
	for _, v := range invalid {
		if msg := ValidateColorValue(v); msg == "" {
			t.Errorf("ValidateColorValue(%q) = valid, want error", v)
		}
	}
}

func TestNormalizeColorValue(t *testing.T) {
	cases := map[string]struct {
		want string
		ok   bool
	}{
		"4":     {"4", true},
		" 4 ":   {"4", true},
		"1+3":   {"1+3", true},
		"":      {"", false},
		"  ":    {"", false},
		"99":    {"", false},
		"1+2+3": {"", false},
		"x":     {"", false},
	}
	for in, exp := range cases {
		got, ok := NormalizeColorValue(in)
		if got != exp.want || ok != exp.ok {
			t.Errorf("NormalizeColorValue(%q) = (%q, %v), want (%q, %v)", in, got, ok, exp.want, exp.ok)
		}
	}
}
