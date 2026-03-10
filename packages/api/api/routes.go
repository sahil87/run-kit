package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"run-kit/internal/sessions"
	"run-kit/internal/tmux"
	"run-kit/internal/validate"
)

// NewRouter creates the chi router with all middleware and routes.
func NewRouter(logger *slog.Logger) chi.Router {
	r := chi.NewRouter()

	// Middleware stack
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// API routes
	r.Get("/api/health", handleHealth)
	r.Get("/api/sessions", handleSessionsGet)
	r.Post("/api/sessions", handleSessionsPost)
	r.Get("/api/sessions/stream", handleSSE)
	r.Get("/api/directories", handleDirectories)
	r.Post("/api/upload", handleUpload)

	// WebSocket relay
	r.Get("/relay/{session}/{window}", handleRelay)

	// SPA static serving — catch-all, must be last
	mountSPA(r)

	return r
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func handleSessionsGet(w http.ResponseWriter, r *http.Request) {
	result, err := sessions.FetchSessions()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func handleSessionsPost(w http.ResponseWriter, r *http.Request) {
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	action, ok := body["action"].(string)
	if !ok || action == "" {
		writeError(w, http.StatusBadRequest, "Missing or invalid action")
		return
	}

	switch action {
	case "createSession":
		name := stringField(body, "name")
		if err := validate.ValidateName(name, "Session name"); err != "" {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		var resolvedCwd string
		if cwd, ok := body["cwd"].(string); ok && cwd != "" {
			if err := validate.ValidatePath(cwd, "Working directory"); err != "" {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			expanded, expandErr := validate.ExpandTilde(cwd)
			if expandErr != "" {
				writeError(w, http.StatusBadRequest, expandErr)
				return
			}
			resolvedCwd = expanded
		}

		if err := tmux.CreateSession(name, resolvedCwd); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

	case "createWindow":
		session := stringField(body, "session")
		name := stringField(body, "name")
		cwd := stringField(body, "cwd")
		if cwd == "" {
			wd, _ := os.Getwd()
			cwd = wd
		}

		if err := validate.ValidateName(session, "Session name"); err != "" {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := validate.ValidateName(name, "Window name"); err != "" {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := validate.ValidatePath(cwd, "Working directory"); err != "" {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		if err := tmux.CreateWindow(session, name, cwd); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

	case "killSession":
		session := stringField(body, "session")
		if err := validate.ValidateName(session, "Session name"); err != "" {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := tmux.KillSession(session); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

	case "killWindow":
		session := stringField(body, "session")
		if err := validate.ValidateName(session, "Session name"); err != "" {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		index, ok := intField(body, "index")
		if !ok || index < 0 {
			writeError(w, http.StatusBadRequest, "Invalid window index")
			return
		}
		if err := tmux.KillWindow(session, index); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

	case "renameWindow":
		session := stringField(body, "session")
		name := stringField(body, "name")
		if err := validate.ValidateName(session, "Session name"); err != "" {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		index, ok := intField(body, "index")
		if !ok || index < 0 {
			writeError(w, http.StatusBadRequest, "Invalid window index")
			return
		}
		if err := validate.ValidateName(name, "Window name"); err != "" {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := tmux.RenameWindow(session, index, name); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

	case "sendKeys":
		session := stringField(body, "session")
		if err := validate.ValidateName(session, "Session name"); err != "" {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		window, ok := intField(body, "window")
		if !ok || window < 0 {
			writeError(w, http.StatusBadRequest, "Invalid window index")
			return
		}
		keys := stringField(body, "keys")
		if keys == "" {
			writeError(w, http.StatusBadRequest, "Keys cannot be empty")
			return
		}
		if err := tmux.SendKeys(session, window, keys); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

	default:
		writeError(w, http.StatusBadRequest, "Unknown action")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleDirectories(w http.ResponseWriter, r *http.Request) {
	prefix := r.URL.Query().Get("prefix")
	if prefix == "" {
		writeJSON(w, http.StatusOK, map[string][]string{"directories": {}})
		return
	}

	expanded, expandErr := validate.ExpandTilde(prefix)
	if expandErr != "" {
		writeError(w, http.StatusBadRequest, expandErr)
		return
	}

	home, _ := os.UserHomeDir()

	var parentDir, filter string
	if strings.HasSuffix(prefix, "/") {
		parentDir = expanded
		filter = ""
	} else {
		parentDir = filepath.Dir(expanded)
		filter = strings.ToLower(filepath.Base(expanded))
	}

	entries, err := os.ReadDir(parentDir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string][]string{"directories": {}})
		return
	}

	var directories []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if filter != "" && !strings.HasPrefix(strings.ToLower(entry.Name()), filter) {
			continue
		}
		// Skip hidden directories
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		absPath := filepath.Join(parentDir, entry.Name())
		display := tildePrefix(absPath, home) + "/"
		directories = append(directories, display)
	}

	if directories == nil {
		directories = []string{}
	}

	writeJSON(w, http.StatusOK, map[string][]string{"directories": directories})
}

func tildePrefix(absPath, home string) string {
	if absPath == home {
		return "~"
	}
	if strings.HasPrefix(absPath, home+"/") {
		return "~/" + absPath[len(home)+1:]
	}
	return absPath
}

// Helper to extract a string field from a JSON body.
func stringField(body map[string]interface{}, key string) string {
	v, ok := body[key]
	if !ok {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return s
}

// Helper to extract an integer field from a JSON body (handles float64 from JSON).
func intField(body map[string]interface{}, key string) (int, bool) {
	v, ok := body[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		i := int(n)
		if float64(i) != n {
			return 0, false // not an integer
		}
		return i, true
	case string:
		i, err := strconv.Atoi(n)
		if err != nil {
			return 0, false
		}
		return i, true
	}
	return 0, false
}
