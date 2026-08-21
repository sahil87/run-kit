# recovery-section.spec.ts

Verifies the **Recovery section** on the Host Overview (`/`) — the zone for
reboot-orphaned tmux servers whose layout snapshots survived on disk
(260820-4psk R8/R9/R10). It renders ONLY when `GET /api/recovery` returns a
non-empty offers list (zero footprint otherwise), slotted between the TMUX
SERVERS and SERVICES zones with a `SectionHeading` labelled "Recovery". Each
offer renders one row: a hollow (non-live) dot, the server name, a meta line
(`N sessions · M tabs · last seen X ago · system restart`), a **Restore**
button, an **×** dismiss button, and a chevron that expands a read-only
session tree (session color swatches, per-tab pane counts and former
commands, `resumable` tags on agent tabs — display-only). **Restore all
(N)** and **Dismiss all** ride the heading's side slot when more than one
offer exists and run sequential per-server restore/dismiss POSTs (no bulk
endpoint). A restore shows an
indeterminate per-row "restoring…" state, and on success removes the row,
refetches the offers, and refreshes the live server list; a dismiss removes
its row on success.

## Shared setup

- The three recovery endpoints are route-mocked; every other request (state
  socket, boards, metrics) rides the real e2e backend:
  - `**/api/recovery` (GET) → `{"offers": [...]}` from a MUTABLE list the
    mutation tests shrink before the component's post-mutation refetch, plus a
    call counter that proves mount-fetch + refetch.
  - `**/api/recovery/restore*` (POST) → 200 with a report body; the request
    body (`{"server": "..."}`) is captured. The trailing `*` glob is the
    mutating-route idiom (withServer-style `?server=` suffixes must never slip
    past the mock).
  - `**/api/recovery/dismiss*` (POST) → 200 `{"ok":true}`; body captured.
- `**/api/servers` (GET) → a single server `dev`, so the TMUX SERVERS zone is
  deterministic (the section under test sits directly below it, and a restore
  success refetches this list).
- Two offer fixtures: `kit` (one session `dev` with color `4`, a 1-pane `zsh`
  window and a 2-pane `zsh, claude -c` tab flagged `resumable`, `takenAt`
  one hour old) and `work` (two sessions, three tabs, `takenAt` two minutes
  old).
- Readiness signal: the `Tmux Servers` zone heading is visible.
- Rows are located by `data-testid="recovery-row-<server>"`; the expanded tree
  by `data-testid="recovery-session-<name>"`; controls by their accessible
  names (`Restore <name>`, `Dismiss recovery for <name>`, `Show layout for
  <name>`).

## Tests

### `empty offers render NO Recovery section — zero footprint between TMUX SERVERS and SERVICES`

What it proves: with an empty offers list the section leaves no heading, no
region landmark, and no reserved space — the surrounding zones render
normally.

1. Mock `/api/recovery` with an empty offers list; load `/`.
2. Assert no `region` or `heading` named "Recovery" exists.
3. Assert the neighbouring `Services` zone heading renders.

### `populated offers render the heading, one row per offer, and Restore all (2)`

What it proves: the section anatomy — heading, one row per offer (hollow
dot, meta line, Restore + dismiss buttons), and the Restore-all control in
the heading's side slot gated on more than one offer.

1. Mock two offers (`kit`, `work`); load `/`.
2. Assert the `Recovery` region and heading are visible, plus the
   `Restore all (2)` button.
3. On the `kit` row assert the hollow dot (`not running`), the meta line
   `1 session · 2 tabs · last seen 1h ago · system restart`, and the
   `Restore kit` / `Dismiss recovery for kit` buttons; assert the `work` row
   exists.

### `the chevron expands the read-only session tree (swatch, tabs, commands, resumable tag)`

What it proves: the row's expand affordance reveals the offer payload's
inline layout tree — no second request — with tabs, pane counts, former
commands, and the display-only resumable tag.

1. Mock one offer (`kit`); load `/`.
2. Assert the toggle starts `aria-expanded="false"` and no `resumable` tag is
   in the DOM.
3. Click `Show layout for kit`; assert the toggle flips to `Hide layout for
   kit` with `aria-expanded="true"` and the tree carries the session name,
   both tab lines (`0: shell · 1 pane`, `1: agent · 2 panes`), the joined
   former commands (`zsh, claude -c`), and the `resumable` tag.
4. Assert the tree contains no buttons (read-only — no resume affordance).

### `restore POSTs the server name, removes the row, and refetches the offers`

What it proves: the restore flow's success path — body-addressed POST, row
removal, and the mount-fetch + post-mutation refetch cadence.

1. Mock two offers; load `/`; assert the `kit` row and exactly one GET so far.
2. Shrink the mocked offers to `work` only (what the backend returns after the
   restore), then click `Restore kit`.
3. Assert one restore POST with body `{"server": "kit"}`.
4. Assert the `kit` row is gone, `work` remains, and the GET counter reaches
   2 (mount fetch + post-mutation refetch).

### `dismiss POSTs the server name and removes the row`

What it proves: the dismiss flow — POST, then the row leaves the offer list.

1. Mock two offers; load `/`.
2. Shrink the mocked offers to `work` only, then click
   `Dismiss recovery for kit`.
3. Assert one dismiss POST with body `{"server": "kit"}`.
4. Assert the `kit` row is gone and `work` remains.

### `Dismiss all POSTs one dismiss per server and the section leaves the DOM`

What it proves: the heading's Dismiss-all control drives the same sequential
per-server dismiss flow as the per-row × (one POST per offer, no bulk
endpoint), and with every offer dismissed the Recovery region disappears
entirely — zero footprint.

1. Mock two offers (`kit`, `work`); load `/`; assert the `Dismiss all` button
   is visible in the heading's side slot.
2. Empty the mocked offers list (what the backend returns once everything is
   dismissed), then click `Dismiss all`.
3. Assert two dismiss POSTs land, in offer order: `{"server": "kit"}` then
   `{"server": "work"}`.
4. Assert the `Recovery` region has left the DOM.
