package main

import (
	"fmt"

	"rk/internal/cron"

	"github.com/spf13/cobra"
)

// rk cron rm / mute / pin — the single-entry mutation verbs: thin wrappers
// over cron.Remove / cron.SetMuted / cron.SetPinned (atomic read-modify-write;
// a corrupt file refuses to mutate and the error surfaces via RunE). The bare
// verb sets the flag; --off unsets it. An unknown id exits non-zero with
// `no entry <id>` on stderr. Confirmations are one line on stdout.

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
	cronPinOffFlag  bool
)

var cronMuteCmd = &cobra.Command{
	Use:   "mute <id> [--off]",
	Short: "Mute a cron entry (skip its fires) — --off unmutes",
	Long: "Mute the cron entry with the given id: a muted entry never fires (the " +
		"evaluator skips it). --off unmutes. Exits non-zero with `no entry <id>` " +
		"when the id is unknown.",
	Example: `  rk cron mute a3f9
  rk cron mute a3f9 --off`,
	Args: usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
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
	cronPinCmd.Flags().BoolVar(&cronPinOffFlag, "off", false, "Unpin instead of pin")
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
