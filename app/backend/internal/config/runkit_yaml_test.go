package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadSessionColor_MissingFile(t *testing.T) {
	dir := t.TempDir()
	got := ReadSessionColor(dir)
	if got != nil {
		t.Errorf("ReadSessionColor(missing file) = %v, want nil", *got)
	}
}

func TestReadSessionColor_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, runkitYAMLFile), []byte(""), 0o644)
	got := ReadSessionColor(dir)
	if got != nil {
		t.Errorf("ReadSessionColor(empty file) = %v, want nil", *got)
	}
}

func TestReadSessionColor_ValidColor(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, runkitYAMLFile), []byte("session_color: 4\n"), 0o644)
	got := ReadSessionColor(dir)
	if got == nil || *got != 4 {
		t.Errorf("ReadSessionColor(valid) = %v, want 4", got)
	}
}

func TestReadSessionColor_MissingKey(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, runkitYAMLFile), []byte("other_key: value\n"), 0o644)
	got := ReadSessionColor(dir)
	if got != nil {
		t.Errorf("ReadSessionColor(missing key) = %v, want nil", *got)
	}
}

func TestReadSessionColor_InvalidValue(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, runkitYAMLFile), []byte("session_color: abc\n"), 0o644)
	got := ReadSessionColor(dir)
	if got != nil {
		t.Errorf("ReadSessionColor(invalid value) = %v, want nil", *got)
	}
}

func TestReadSessionColor_EmptyRoot(t *testing.T) {
	got := ReadSessionColor("")
	if got != nil {
		t.Errorf("ReadSessionColor('') = %v, want nil", *got)
	}
}

func TestReadSessionColor_WithComments(t *testing.T) {
	dir := t.TempDir()
	content := "# This is a comment\nsession_color: 9\n"
	os.WriteFile(filepath.Join(dir, runkitYAMLFile), []byte(content), 0o644)
	got := ReadSessionColor(dir)
	if got == nil || *got != 9 {
		t.Errorf("ReadSessionColor(with comments) = %v, want 9", got)
	}
}

func TestWriteSessionColor_Set(t *testing.T) {
	dir := t.TempDir()
	color := 6
	if err := WriteSessionColor(dir, &color); err != nil {
		t.Fatalf("WriteSessionColor() error: %v", err)
	}
	got := ReadSessionColor(dir)
	if got == nil || *got != 6 {
		t.Errorf("after WriteSessionColor(6), ReadSessionColor() = %v, want 6", got)
	}
}

func TestWriteSessionColor_Update(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, runkitYAMLFile), []byte("session_color: 2\nother_key: value\n"), 0o644)
	color := 8
	if err := WriteSessionColor(dir, &color); err != nil {
		t.Fatalf("WriteSessionColor() error: %v", err)
	}
	got := ReadSessionColor(dir)
	if got == nil || *got != 8 {
		t.Errorf("after WriteSessionColor(8), ReadSessionColor() = %v, want 8", got)
	}
	// Check that other_key is preserved
	data, _ := os.ReadFile(filepath.Join(dir, runkitYAMLFile))
	content := string(data)
	if !contains(content, "other_key") {
		t.Error("WriteSessionColor() did not preserve other_key")
	}
}

func TestWriteSessionColor_ClearDeletesFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, runkitYAMLFile), []byte("session_color: 4\n"), 0o644)
	if err := WriteSessionColor(dir, nil); err != nil {
		t.Fatalf("WriteSessionColor(nil) error: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, runkitYAMLFile)); !os.IsNotExist(err) {
		t.Error("WriteSessionColor(nil) did not delete file when it would be empty")
	}
}

func TestWriteSessionColor_ClearPreservesOtherKeys(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, runkitYAMLFile), []byte("session_color: 4\nother_key: value\n"), 0o644)
	if err := WriteSessionColor(dir, nil); err != nil {
		t.Fatalf("WriteSessionColor(nil) error: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, runkitYAMLFile))
	if err != nil {
		t.Fatalf("file should still exist: %v", err)
	}
	if contains(string(data), "session_color") {
		t.Error("WriteSessionColor(nil) did not remove session_color key")
	}
	if !contains(string(data), "other_key") {
		t.Error("WriteSessionColor(nil) did not preserve other_key")
	}
}

func TestWriteSessionColor_ClearMissingFile(t *testing.T) {
	dir := t.TempDir()
	// Should not error when file doesn't exist
	if err := WriteSessionColor(dir, nil); err != nil {
		t.Fatalf("WriteSessionColor(nil, missing file) error: %v", err)
	}
}

func contains(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && len(s) >= len(substr) && (s == substr || len(s) > len(substr) && (s[:len(substr)] == substr || containsHelper(s, substr)))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
