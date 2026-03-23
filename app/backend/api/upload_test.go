package api

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/tmux"
)

func createMultipartRequest(t *testing.T, url string, fields map[string]string, fileName, fileContent string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	for k, v := range fields {
		if err := writer.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}

	if fileName != "" {
		part, err := writer.CreateFormFile("file", fileName)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(part, fileContent); err != nil {
			t.Fatal(err)
		}
	}

	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, url, &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestUploadFile(t *testing.T) {
	projectDir := t.TempDir()

	ops := &mockTmuxOps{
		listWindowsResult: []tmux.WindowInfo{
			{Index: 0, Name: "main", WorktreePath: projectDir},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := createMultipartRequest(t, "/api/sessions/run-kit/upload", nil, "screenshot.png", "fake-image-data")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var result map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if result["ok"] != true {
		t.Error("expected ok: true")
	}
	path, ok := result["path"].(string)
	if !ok || path == "" {
		t.Error("expected non-empty path in response")
	}

	// Verify file exists on disk
	if _, err := os.Stat(path); err != nil {
		t.Errorf("uploaded file does not exist: %v", err)
	}

	// Verify .uploads/ directory was created
	uploadsDir := filepath.Join(projectDir, ".uploads")
	if _, err := os.Stat(uploadsDir); err != nil {
		t.Errorf(".uploads/ directory does not exist: %v", err)
	}

	// Verify .gitignore was updated
	gitignore, err := os.ReadFile(filepath.Join(projectDir, ".gitignore"))
	if err != nil {
		t.Fatalf("failed to read .gitignore: %v", err)
	}
	if !strings.Contains(string(gitignore), ".uploads/") {
		t.Error(".gitignore does not contain .uploads/")
	}
}

func TestUploadFilenameSanitization(t *testing.T) {
	projectDir := t.TempDir()

	ops := &mockTmuxOps{
		listWindowsResult: []tmux.WindowInfo{
			{Index: 0, Name: "main", WorktreePath: projectDir},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := createMultipartRequest(t, "/api/sessions/run-kit/upload", nil, "../../../etc/passwd", "evil")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var result map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	path := result["path"].(string)
	// File should be in .uploads/, not in /etc/
	if !strings.HasPrefix(path, filepath.Join(projectDir, ".uploads")) {
		t.Errorf("file path escaped .uploads/: %s", path)
	}
}

func TestUploadMissingFile(t *testing.T) {
	ops := &mockTmuxOps{
		listWindowsResult: []tmux.WindowInfo{
			{Index: 0, Name: "main", WorktreePath: t.TempDir()},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	// Send multipart without a file field
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/upload", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestUploadInvalidSession(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := createMultipartRequest(t, "/api/sessions/bad;name/upload", nil, "file.txt", "data")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestUploadSessionFromURL(t *testing.T) {
	// Verify session comes from URL param, not form field
	projectDir := t.TempDir()

	ops := &mockTmuxOps{
		listWindowsResult: []tmux.WindowInfo{
			{Index: 0, Name: "main", WorktreePath: projectDir},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := createMultipartRequest(t, "/api/sessions/my-session/upload", nil, "test.txt", "data")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should succeed (session from URL)
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestUploadGitignoreNotDuplicated(t *testing.T) {
	projectDir := t.TempDir()

	// Pre-create .gitignore with .uploads/
	gitignorePath := filepath.Join(projectDir, ".gitignore")
	os.WriteFile(gitignorePath, []byte("node_modules/\n.uploads/\n"), 0o644)

	ops := &mockTmuxOps{
		listWindowsResult: []tmux.WindowInfo{
			{Index: 0, Name: "main", WorktreePath: projectDir},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := createMultipartRequest(t, "/api/sessions/run-kit/upload", nil, "test.txt", "data")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	// Verify .uploads/ not duplicated in .gitignore
	content, _ := os.ReadFile(gitignorePath)
	count := strings.Count(string(content), ".uploads/")
	if count != 1 {
		t.Errorf(".uploads/ appears %d times in .gitignore, want 1", count)
	}
}
