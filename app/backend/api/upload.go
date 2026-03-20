package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"run-kit/internal/tmux"
	"run-kit/internal/validate"
)

const uploadMaxBytes = 50 * 1024 * 1024 // 50MB

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	// Enforce size limit
	r.Body = http.MaxBytesReader(w, r.Body, uploadMaxBytes)

	if err := r.ParseMultipartForm(uploadMaxBytes); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(w, 413, "File exceeds 50MB limit")
			return
		}
		writeError(w, http.StatusBadRequest, "Invalid multipart form")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "Missing file field")
		return
	}
	defer file.Close()

	if header.Size > uploadMaxBytes {
		writeError(w, 413, "File exceeds 50MB limit")
		return
	}

	// Parse optional window index
	windowIndex := 0
	if wf := r.FormValue("window"); wf != "" {
		parsed, err := strconv.Atoi(wf)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "Invalid window index")
			return
		}
		windowIndex = parsed
	}

	// Get project root via tmux windows
	windows, err := s.tmux.ListWindows(session, "runkit")
	if err != nil || len(windows) == 0 {
		writeError(w, http.StatusBadRequest, "Session not found or has no windows")
		return
	}

	var targetWindow tmux.WindowInfo
	found := false
	for _, win := range windows {
		if win.Index == windowIndex {
			targetWindow = win
			found = true
			break
		}
	}
	if !found {
		targetWindow = windows[0]
	}

	projectRoot := targetWindow.WorktreePath
	if projectRoot == "" {
		writeError(w, http.StatusInternalServerError, "Could not determine project root from tmux window")
		return
	}

	// Ensure .uploads/ directory exists
	uploadsDir := filepath.Join(projectRoot, ".uploads")
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Ensure .uploads/ is in .gitignore
	gitignorePath := filepath.Join(projectRoot, ".gitignore")
	gitignoreContent, _ := os.ReadFile(gitignorePath)
	lines := strings.Split(string(gitignoreContent), "\n")
	hasUploadEntry := false
	for _, line := range lines {
		if strings.TrimSpace(line) == ".uploads/" {
			hasUploadEntry = true
			break
		}
	}
	if !hasUploadEntry {
		separator := ""
		if len(gitignoreContent) > 0 && !strings.HasSuffix(string(gitignoreContent), "\n") {
			separator = "\n"
		}
		newContent := string(gitignoreContent) + separator + ".uploads/\n"
		if err := os.WriteFile(gitignorePath, []byte(newContent), 0o644); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to update .gitignore: %v", err))
			return
		}
	}

	// Build timestamped filename
	now := time.Now()
	timestamp := fmt.Sprintf("%02d%02d%02d%02d%02d%02d",
		now.Year()%100, now.Month(), now.Day(),
		now.Hour(), now.Minute(), now.Second())
	safeName := validate.SanitizeFilename(header.Filename)
	finalName := fmt.Sprintf("%s-%s", timestamp, safeName)

	// Write file to disk
	filePath := filepath.Join(uploadsDir, finalName)
	out, err := os.Create(filePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":   true,
		"path": filePath,
	})
}
