package main

import (
	"fmt"
	"time"

	"rk/internal/cron"

	"github.com/spf13/cobra"
)

// rk cron rm / mute / pin — the single-entry mutation verbs: thin wrappers
// over cron.Remove / cron.SetMuted / cron.SetMuteLease / cron.SetPinned (atomic
// read-modify-write; a corrupt file refuses to mutate and the error surfaces
// via RunE). The bare verb sets the flag; --off unsets it. An unknown id exits
// non-zero with `no entry <id>` on stderr. Confirmations are one line on
// stdout.

var cronRmCmd = &cobra.Command{
	Use:   "rm <id>",
	Short: "Remove a cron entry by id",
	Long: "Remove the cron entry with the given id from the resolved server's " +
		"intent file. Exits non-zero with `no entry <id>` when the id is unknown.",
	Example: `  rk cron rm a3f9`,
	Args:    usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		slug, dir, err := cronMutTarget()
		if err != nil {
			return err
		}
		ok, err := cron.Remove(dir, slug, args[0])
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("no entry %s", args[0])
		}
		newSink(cmd).Dataf("removed %s\n", args[0])
		return nil
	},
}

var (
	cronMuteOffFlag bool
	cronMuteForFlag time.Duration
	cronPinOffFlag  bool
)

var cronMuteCmd = &cobra.Command{
	Use:   "mute <id> [--for <dur>] [--off]",
	Short: "Mute a cron entry (skip its fires) — --for leases the mute, --off unmutes",
	Long: "Mute the cron entry with the given id: a muted entry never fires (the " +
		"evaluator skips it). --off unmutes. --for <dur> mutes until now+<dur> — " +
		"a lease, not a flag: an in-session loop that renews the lease each tick " +
		"holds the entry back while it is alive; when the loop dies the lease " +
		"lapses and the entry resumes on its own. Exits non-zero with " +
		"`no entry <id>` when the id is unknown.",
	Example: `  rk cron mute a3f9
  rk cron mute a3f9 --for 30m
  rk cron mute a3f9 --off`,
	Args: usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		if cmd.Flags().Changed("for") {
			return runCronMuteLease(cmd, args[0])
		}
		return runCronSetFlag(cmd, args[0], "muted", !cronMuteOffFlag, cron.SetMuted)
	},
}

var cronPinCmd = &cobra.Command{
	Use:   "pin <id> [--off]",
	Short: "Pin a cron entry (exempt from orphan expiry) — --off unpins",
	Long: "Pin the cron entry with the given id: a pinned entry is exempt from " +
		"orphan expiry. --off unpins. Exits non-zero with `no entry <id>` when " +
		"the id is unknown.",
	Example: `  rk cron pin a3f9
  rk cron pin a3f9 --off`,
	Args: usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runCronSetFlag(cmd, args[0], "pinned", !cronPinOffFlag, cron.SetPinned)
	},
}

func init() {
	cronMuteCmd.Flags().BoolVar(&cronMuteOffFlag, "off", false, "Unmute instead of mute")
	cronMuteCmd.Flags().DurationVar(&cronMuteForFlag, "for", 0, "Mute until now+<dur> (a self-expiring lease; positive Go duration; mutually exclusive with --off)")
	cronPinCmd.Flags().BoolVar(&cronPinOffFlag, "off", false, "Unpin instead of pin")
}

// runCronMuteLease implements `mute --for <dur>`: SetMuteLease(now+dur) via
// the cronNowFn seam, then the `muted <id> until <RFC3339 local>` confirmation.
func runCronMuteLease(cmd *cobra.Command, id string) error {
	if cronMuteOffFlag {
		return usageError(fmt.Errorf("--for and --off are mutually exclusive"))
	}
	if cronMuteForFlag <= 0 {
		return usageError(fmt.Errorf("--for must be a positive duration, got %s", cronMuteForFlag))
	}
	slug, dir, err := cronMutTarget()
	if err != nil {
		return err
	}
	until := cronNowFn().Add(cronMuteForFlag)
	ok, err := cron.SetMuteLease(dir, slug, id, until.Unix())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("no entry %s", id)
	}
	newSink(cmd).Dataf("muted %s until %s\n", id, until.Format(time.RFC3339))
	return nil
}

// cronMutTarget resolves the validated slug and state dir shared by the
// mutation verbs.
func cronMutTarget() (slug, dir string, err error) {
	slug, err = cronSlug()
	if err != nil {
		return "", "", err
	}
	dir, err = cronDir()
	if err != nil {
		return "", "", err
	}
	return slug, dir, nil
}

// runCronSetFlag is the shared mute/pin core: set the named bool flag on one
// entry via the cron helper, erroring `no entry <id>` when absent.
func runCronSetFlag(cmd *cobra.Command, id, flagName string, on bool, set func(dir, slug, id string, v bool) (bool, error)) error {
	slug, dir, err := cronMutTarget()
	if err != nil {
		return err
	}
	ok, err := set(dir, slug, id, on)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("no entry %s", id)
	}
	if on {
		newSink(cmd).Dataf("%s %s\n", flagName, id)
	} else {
		newSink(cmd).Dataf("un%s %s\n", flagName, id)
	}
	return nil
}
