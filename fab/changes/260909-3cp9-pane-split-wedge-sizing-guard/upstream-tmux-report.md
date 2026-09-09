# Draft upstream report — tmux server spins ~21 s per redraw when a pane status line straddles a narrower client's edge

> Draft for https://github.com/tmux/tmux/issues. Not filed by the run-kit pipeline.
> Suggested title: "pane-border-status: u_int underflow in screen_redraw_draw_pane_status hangs the server when a client is narrower than the window"

## Summary

With `pane-border-status` on, a client whose viewport is narrower than the window it views (any
`window-size` policy that lets that happen — `latest` with two differently sized clients,
`largest`, or `manual`) hangs the whole tmux server for ~21 s per redraw whenever a pane's status
line starts inside the viewport and runs off its right (or left) edge and the status text is
shorter than its offset. Every client, including control-mode clients, stops responding for the
duration; the stall repeats on every subsequent redraw while the geometry persists.

Observed on tmux 3.7c (Linux, Homebrew build). Reproduces with plain `sleep` panes — no
application output is required.

## Reproduction

```sh
# Server with pane border status on and a wide initial window.
tmux -L repro new-session -d -s s -x 200 -y 50 'sleep 1000'
tmux -L repro set -g pane-border-status top
tmux -L repro set -g window-size latest      # the default

# Two sized clients of different widths, wide one first (use two terminals, or two ptys):
#   terminal A at 200x50:  tmux -L repro attach -t s
#   terminal B at 105x40:  tmux -L repro attach -t s
# Make A the most recently active client (press a key or send it a focus-in `\e[I`), so the
# window stays 200 columns wide and B is clipped.

# Split from anywhere:
tmux -L repro split-window -h -t s:1 'sleep 1000'

# Concurrently, from a third shell:
time tmux -L repro display -p ok             # blocks ~21 s, then ~21 s again on each redraw
```

The right pane's status line starts at column 103 (`xoff + 2`); B's viewport ends at 105, so the
status is partially visible and shorter than its x offset.

## Diagnosis

`screen-redraw.c`, `screen_redraw_draw_pane_status()` (3.7c, lines ~697–717):

```c
		if (xoff >= ctx->ox && xoff + size <= ctx->ox + ctx->sx) {
			/* All visible. */
			...
		} else if (xoff < ctx->ox && xoff + size > ctx->ox + ctx->sx) {
			/* Both left and right not visible. */
			...
		} else if (xoff < ctx->ox) {
			/* Left not visible. */
			l = ctx->ox - xoff;
			x = 0;
			width = size - l;        /* underflows when size < l */
		} else {
			/* Right not visible. */
			l = 0;
			x = xoff - ctx->ox;
			width = size - x;        /* underflows when size < x */
		}
		...
		tty_draw_line(tty, s, i, 0, width, x, yoff - ctx->oy, ...);
```

`size`, `l`, `x`, and `width` are `u_int`. In the two partially visible branches the width is
derived from the status text length minus its viewport offset, which is negative whenever the text
is shorter than the offset. The unsigned wrap yields a width near 4 billion and `tty_draw_line`
walks it (a `-vv` server log of one stall is >5 GB of `tty_draw_line: cell N empty 1 ...` with `N`
past 124,000,000). At ~200 M cells/s that is the observed ~21 s per draw.

The intended widths are the visible portions: `ctx->sx - x` for the right-clipped case and
`min(size - l, ctx->sx)` for the left-clipped case.

## Status in master

The redraw rewrite on master already clamps this in `redraw_draw_status_span()`:

```c
	px = span->data.st.offset + (x - span->x);
	if (px < sx) {
		if (n > sx - px)
			n = sx - px;
		tty_draw_line(tty, s, px, 0, n, x, y, NULL);
	}
```

so master is not affected. Request: backport a minimal clamp of the two partially visible
branches in `screen_redraw_draw_pane_status()` to the 3.7 release line, since released versions
through 3.7c hang on this geometry and `pane-border-status` plus multiple differently sized clients
is a common configuration for shared / remote sessions.

## Environment

- tmux 3.7c (`tmux -V`), Linux 6.8 (x86-64), Homebrew build
- Any two sized clients of different widths; control-mode clients are unaffected as triggers but
  are frozen along with everyone else
