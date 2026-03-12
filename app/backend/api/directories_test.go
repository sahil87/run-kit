package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDirectoriesEmptyPrefix(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/api/directories", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var result struct {
		Directories []string `json:"directories"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if len(result.Directories) != 0 {
		t.Errorf("directories = %v, want empty", result.Directories)
	}
}

func TestDirectoriesListChildren(t *testing.T) {
	// Use a temp HOME so the test is hermetic and doesn't touch the real home dir
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	testDir := filepath.Join(tmpHome, ".run-kit-test-dirs")
	if err := os.MkdirAll(filepath.Join(testDir, "alpha"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(testDir, "beta"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(testDir, ".hidden"), 0o755); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/api/directories?prefix=~/.run-kit-test-dirs/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var result struct {
		Directories []string `json:"directories"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if len(result.Directories) != 2 {
		t.Fatalf("directories count = %d, want 2, got %v", len(result.Directories), result.Directories)
	}

	// Should contain alpha and beta but not .hidden
	foundAlpha := false
	foundBeta := false
	for _, d := range result.Directories {
		if strings.Contains(d, "alpha") {
			foundAlpha = true
		}
		if strings.Contains(d, "beta") {
			foundBeta = true
		}
		if strings.Contains(d, ".hidden") {
			t.Error("hidden directory should be excluded")
		}
	}
	if !foundAlpha {
		t.Error("alpha not found in results")
	}
	if !foundBeta {
		t.Error("beta not found in results")
	}
}

func TestDirectoriesPrefixFilter(t *testing.T) {
	// Use a temp HOME so the test is hermetic and doesn't touch the real home dir
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	testDir := filepath.Join(tmpHome, ".run-kit-test-filter")
	if err := os.MkdirAll(filepath.Join(testDir, "abc"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(testDir, "abd"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(testDir, "xyz"), 0o755); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/api/directories?prefix=~/.run-kit-test-filter/ab", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var result struct {
		Directories []string `json:"directories"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if len(result.Directories) != 2 {
		t.Fatalf("directories count = %d, want 2, got %v", len(result.Directories), result.Directories)
	}

	for _, d := range result.Directories {
		if strings.Contains(d, "xyz") {
			t.Error("xyz should be filtered out")
		}
	}
}

func TestDirectoriesInvalidPath(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/api/directories?prefix=~/nonexistent-dir-12345/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var result struct {
		Directories []string `json:"directories"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if len(result.Directories) != 0 {
		t.Errorf("directories = %v, want empty", result.Directories)
	}
}

func TestTildePrefix(t *testing.T) {
	home, _ := os.UserHomeDir()

	tests := []struct {
		name    string
		absPath string
		home    string
		want    string
	}{
		{"home itself", home, home, "~"},
		{"under home", home + "/code/project", home, "~/code/project"},
		{"outside home", "/etc/other", home, "/etc/other"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tildePrefix(tt.absPath, tt.home)
			if got != tt.want {
				t.Errorf("tildePrefix(%q, %q) = %q, want %q", tt.absPath, tt.home, got, tt.want)
			}
		})
	}
}
