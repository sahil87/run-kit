package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"rk/internal/validate"
)

// notifyTimeout bounds the POST so a hung server never blocks the caller. A
// notify failure must never stall the operator loop.
const notifyTimeout = 8 * time.Second

// notifyDeriveTimeout bounds the tmux window-id lookup for the auto-derived
// deep link, well inside the notifyTimeout budget — a hung tmux costs the
// notification its deep link, never the send.
const notifyDeriveTimeout = 3 * time.Second

var (
	notifyTitle string
	notifyURL   string
)

var notifyCmd = &cobra.Command{
	Use:   "notify <message>",
	Short: "Send a Web Push notification to subscribed devices",
	Long: "Send a Web Push notification via the local run-kit server to every " +
		"subscribed browser/device. Clicking the notification deep-links to the " +
		"calling tmux window's dashboard route when one can be derived (or to " +
		"--url). Fail-silent: if the server is unreachable or " +
		"returns an error, the command exits 0 and prints nothing, so it never " +
		"stalls a calling process.",
	Args: cobra.ExactArgs(1),
	// SilenceErrors/SilenceUsage: the fail-silent contract means we never want
	// cobra to print an error or usage on a failed send. RunE always returns nil.
	SilenceErrors: true,
	SilenceUsage:  true,
	RunE: func(cmd *cobra.Command, args []string) error {
		deepLink := notifyURL
		if !cmd.Flags().Changed("url") {
			deepLink = deriveNotifyURL(cmd.Context())
		}
		sendNotifyURL(cmd.Context(), notifyTitle, args[0], deepLink)
		return nil
	},
}

func init() {
	notifyCmd.Flags().StringVar(&notifyTitle, "title", "", "Optional notification title")
	notifyCmd.Flags().StringVar(&notifyURL, "url", "", "Relative dashboard path to open on click (default: the calling tmux window's route; --url= sends no deep link)")
}

// deriveNotifyURL resolves the calling pane's dashboard route ("/{server}/{N}",
// the same terminal route waitingPushURL composes server-side) so a hook-driven
// notify deep-links to the window it fired from. Every failure path returns ""
// — a notification without a deep link always beats no notification, and the
// fail-silent contract leaves no channel to report the miss anyway.
func deriveNotifyURL(parent context.Context) string {
	pane := os.Getenv("TMUX_PANE")
	if pane == "" {
		return ""
	}
	prefix, serverName, ok := callerContext()
	if !ok {
		return ""
	}
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, notifyDeriveTimeout)
	defer cancel()
	out, err := presentRunOutputFn(ctx, append(prefix, "display-message", "-pt", pane, "#{window_id}"))
	if err != nil {
		return ""
	}
	windowID := strings.TrimSpace(string(out))
	if validate.ValidateWindowID(windowID, "Window ID") != "" {
		return ""
	}
	seg := strings.TrimPrefix(windowID, "@")
	return "/" + url.PathEscape(serverName) + "/" + url.PathEscape(seg)
}

// sendNotify POSTs a deep-link-less notification — the seam shape present.go
// and mux_await.go consume. See sendNotifyURL.
func sendNotify(parent context.Context, title, body string) {
	sendNotifyURL(parent, title, body, "")
}

// sendNotifyURL POSTs {title, body, url?} to the local server's /api/notify,
// targeting the origin resolveOrigin() derives for the caller (explicit
// RK_HOST/RK_PORT env → the covering tmux server's @rk_origin → the
// 127.0.0.1:3000 default). The url key is included only when non-empty; the
// server soft-drops invalid values and the service worker re-validates before
// navigating. It is fail-silent by design: any error (unreachable server,
// non-2xx, timeout) is swallowed and produces no output.
func sendNotifyURL(parent context.Context, title, body, deepLink string) {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, notifyTimeout)
	defer cancel()

	endpoint := resolveOrigin(ctx) + "/api/notify"

	fields := map[string]string{"title": title, "body": body}
	if deepLink != "" {
		fields["url"] = deepLink
	}
	payload, err := json.Marshal(fields)
	if err != nil {
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return // server unreachable / timeout — fail silent
	}
	defer resp.Body.Close()
	// Non-2xx is also swallowed: nothing is surfaced, exit 0.
}
