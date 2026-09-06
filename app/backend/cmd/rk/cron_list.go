package main

import (
	"encoding/json"
	"fmt"
	"text/tabwriter"
	"time"

	"rk/internal/cron"

	"github.com/spf13/cobra"
)

// rk cron list — the disk-derived listing: entry file + delivery log only,
// ZERO tmux commands (a tmux probe against a dead socket would resurrect the
// server, so next-fire/rung/orphan derivations stay out of the CLI and belong
// to the API wave). An absent or empty entry file is an empty listing with
// exit 0; load diagnostics (corrupt entries) print to stderr without failing
// the listing — the tolerant-load posture.

var cronListJSONFlag bool

var cronListCmd = &cobra.Command{
	Use:   "list [--json]",
	Short: "List the server's cron entries (disk-derived; no tmux probes)",
	Long: "List one row per cron entry in the resolved server's intent file: id, " +
		"name, schedule, target, deliver policy, flags (muted/pinned), and " +
		"last-fired (the newest delivery-log line, `-` when none). Derived from " +
		"the entry file and delivery log only — no tmux commands are issued, so " +
		"listing never resurrects a dead server. Corrupt entries are skipped with " +
		"a stderr diagnostic; an absent or empty file yields an empty listing " +
		"with exit 0. --json emits the same records as a JSON array.",
	Example: `  rk cron list
  rk cron list -L work --json`,
	Args: usageArgs(cobra.NoArgs),
	RunE: func(cmd *cobra.Command, _ []string) error {
		return runCronList(cmd)
	},
}

func init() {
	cronListCmd.Flags().BoolVar(&cronListJSONFlag, "json", false, "Output as JSON")
}

// cronListRecord is one list row / --json element. The JSON shape is a fixed
// key set — unset values serialize as zero values, never as missing keys.
type cronListRecord struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Schedule  string `json:"schedule"`
	Target    string `json:"target"`
	Deliver   string `json:"deliver"`
	Pinned    bool   `json:"pinned"`
	Muted     bool   `json:"muted"`
	LastFired int64  `json:"last_fired"`
}

func runCronList(cmd *cobra.Command) error {
	slug, err := cronSlug()
	if err != nil {
		return err
	}
	dir, err := cronDir()
	if err != nil {
		return err
	}
	sink := newSink(cmd)

	entriesPath, err := cron.EntriesPath(dir, slug)
	if err != nil {
		return err
	}
	entries, diags := cron.LoadEntries(entriesPath)
	for _, d := range diags {
		sink.Notef("%s: %s\n", d.Reason, d.Detail)
	}

	logPath, err := cron.LogPath(dir, slug)
	if err != nil {
		return err
	}
	log := cron.ReadLog(logPath)

	records := make([]cronListRecord, 0, len(entries))
	for _, e := range entries {
		rec := cronListRecord{
			ID:       e.ID,
			Name:     e.Name,
			Schedule: cronScheduleSummary(e.Schedule),
			Target:   cronTargetSummary(e.Target),
			Deliver:  e.Deliver,
			Pinned:   e.Pinned,
			Muted:    e.Muted,
		}
		if last, ok := cron.LastDelivery(log, e.ID); ok {
			rec.LastFired = last.TS
		}
		records = append(records, rec)
	}

	if cronListJSONFlag {
		enc := json.NewEncoder(sink.data)
		enc.SetIndent("", "  ")
		return enc.Encode(records)
	}

	w := tabwriter.NewWriter(sink.data, 2, 8, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tSCHEDULE\tTARGET\tDELIVER\tFLAGS\tLAST-FIRED")
	for _, r := range records {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			r.ID, r.Name, r.Schedule, r.Target, r.Deliver, cronListFlags(r), cronListLastFired(r.LastFired))
	}
	return w.Flush()
}

// cronListFlags renders the FLAGS column ("muted,pinned", "-" when neither).
func cronListFlags(r cronListRecord) string {
	flags := ""
	if r.Muted {
		flags = "muted"
	}
	if r.Pinned {
		if flags != "" {
			flags += ","
		}
		flags += "pinned"
	}
	if flags == "" {
		return "-"
	}
	return flags
}

// cronListLastFired renders the LAST-FIRED column ("-" when never fired).
func cronListLastFired(ts int64) string {
	if ts == 0 {
		return "-"
	}
	return time.Unix(ts, 0).Format(time.RFC3339)
}
