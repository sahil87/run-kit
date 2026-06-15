package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"rk/internal/config"

	"github.com/spf13/cobra"
)

// notifyTimeout bounds the POST so a hung server never blocks the caller. A
// notify failure must never stall the operator loop.
const notifyTimeout = 8 * time.Second

var notifyTitle string

var notifyCmd = &cobra.Command{
	Use:   "notify <message>",
	Short: "Send a Web Push notification to subscribed devices",
	Long: "Send a Web Push notification via the local run-kit server to every " +
		"subscribed browser/device. Fail-silent: if the server is unreachable or " +
		"returns an error, the command exits 0 and prints nothing, so it never " +
		"stalls a calling process.",
	Args: cobra.ExactArgs(1),
	// SilenceErrors/SilenceUsage: the fail-silent contract means we never want
	// cobra to print an error or usage on a failed send. RunE always returns nil.
	SilenceErrors: true,
	SilenceUsage:  true,
	RunE: func(cmd *cobra.Command, args []string) error {
		sendNotify(cmd.Context(), notifyTitle, args[0])
		return nil
	},
}

func init() {
	notifyCmd.Flags().StringVar(&notifyTitle, "title", "", "Optional notification title")
}

// sendNotify POSTs {title, body} to the local server's /api/notify. It is
// fail-silent by design: any error (unreachable server, non-2xx, timeout) is
// swallowed and produces no output.
func sendNotify(parent context.Context, title, body string) {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, notifyTimeout)
	defer cancel()

	cfg := config.Load()
	url := fmt.Sprintf("http://%s:%d/api/notify", cfg.Host, cfg.Port)

	payload, err := json.Marshal(map[string]string{"title": title, "body": body})
	if err != nil {
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
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
