# GUI combined execution — one merge-auto queue over the LXQt and viewer-ergonomics plans

> Operator handover — written 2026-09-10 from the azure-eagle thread. This
> file sequences two sibling plans into one autopilot queue:
> [`26-09-10-gui-lxqt-desktop.md`](26-09-10-gui-lxqt-desktop.md) (L0–L3: the
> supported desktop environment and the `rk gui wm` switch) and
> [`26-09-10-gui-viewer-ergonomics.md`](26-09-10-gui-viewer-ergonomics.md)
> (V1–V4: fixed geometry, zoom, touch pointer modes, quality, toolbar). It
> decides nothing about either plan's design — every stage below points at
> the section that owns it. It decides only **order, gates, and the three
> coordination points** the two plans share.

**Strategy**: `merge-auto` — one serial queue; the operator arms each PR with
GitHub auto-merge on completion and spawns the next stage only on the tick
that verifies the merge, after `git fetch origin` and a rebase onto
`origin/main`. Implicit `--base` chaining is off in this mode, so the queue
declares **no `depends_on`** — the order below *is* the dependency graph, and
every stage starts from a main that already contains its predecessors.

**Why serial, not two lanes**: `merge-auto` is a single lane by construction.
The two plans could run as two concurrent lanes (their code is nearly
disjoint), but the price would be a second operator or the
`cherry-pick-ladder` mode, plus rebasing over each other's edits to
`cmd/rk/gui.go`, `gui_supervise.go`, the palette file, the spec, and the
skill page. Serial-with-good-ordering costs one stage-length of latency per
pair and removes every mid-flight conflict, because each stage is created
after the previous one merged. The only genuinely concurrent work is the L0
spike (§ S0), which is not a fab change and runs beside the queue.

---

## Stages, in queue order

| # | Stage | Plan section | Slug | Size | Waits for | Why here |
|---|-------|--------------|------|------|-----------|----------|
| S0 | **LXQt spike** *(not queued — side task)* | lxqt § L0 | — | S | `lxqt-core` installed by the user (sudo) | Produces the § L0 verdict that S5 needs; runs on throwaway displays, so it can start on day one beside the queue |
| S1 | **Session starters + `rk gui wm`** | lxqt § L1 | `gui-session-starters-and-wm-verb` | S | — | Smallest backend change; lands the `guiOnSummary` `(session)` suffix and **owns the skill-page trim** (§ Coordination point 2) so S2 rebases over the smaller diff |
| S2 | **Fixed geometry + `rk gui resize`** | ergonomics § V1 | `gui-fixed-geometry-and-resize` | M | S1 merged | Amends D7; the one stage that changes a parent decision. Ships `gui.geometry` as a validated text field in Settings and defers the select control to S3 (§ Coordination point 1) |
| S3 | **Desktop picker** | lxqt § L3 | `gui-desktop-picker` | S | S1 merged | **Owns the "string with server-supplied choices" settings control** and the restart-confirm reuse; S4/S7 reuse it |
| S4 | **Zoom + touch pointer modes + key bar** | ergonomics § V2 | `gui-zoom-and-touch-pointer` | M | S2 merged | Frontend only; adopts the S3 control if the geometry row wants it, otherwise touches S3 only in the palette file |
| S5 | **LXQt seeded defaults** | lxqt § L2 | `gui-lxqt-seeded-defaults` | M | S1 merged **and** § L0 verdict appended to the lxqt plan | Backend only; placed here so S0 has four stages of wall-clock to finish. If the verdict is not in by the time S4 merges, the operator **pauses** before S5 rather than skipping it (§ Rules) |
| S6 | **Quality presets + stats overlay** | ergonomics § V3 | `gui-quality-presets-and-stats` | S | S4 merged | Shares the posture module and the toolbar seam with S4 |
| S7 | **Session toolbar + HiDPI + Send key** | ergonomics § V4 | `gui-toolbar-keybar-hidpi-sendkey` | M | S4 merged (S6 optional) | Last: pure polish; the pill mirrors rows every earlier stage created |

Dependency graph (arrows = "must be on main first"):

```
S0 (spike, side task) ─────────────────────────────┐
                                                   ▼
S1 ──▶ S2 ──▶ S4 ──▶ S6 ──▶ S7          S1 ──▶ S5 (needs S0 verdict)
 └───▶ S3 (after S1; before S4 so S4 can reuse its control)
```

Queue order honors every arrow: `S1, S2, S3, S4, S5, S6, S7`.

The LXQt plan's own § Execution order (L0 ∥ L1 first, then L2 ∥ L3, L2 gated on the L0 verdict) is satisfied by this queue: S1 = L1, S3 = L3, S5 = L2, with S0 = L0 running alongside. Its "L2 ∥ L3" parallelism collapses to S3-then-S5 because `merge-auto` is a single lane; nothing waits longer than one stage for it.

---

## Before the queue starts (operator checklist)

1. **User installs `lxqt-core`** on the host (`sudo apt install --no-install-recommends lxqt-core`, 38 packages here). rk never installs packages; S0, S1's acceptance, and S5 all need it present. Without it S1 still ships (its `rk gui wm xfce` refusal path is testable) but its LXQt acceptance line is skipped and noted.
2. **Draft the seven intakes** with `/fab-draft` (create-without-activate), one per stage, each pointing at its plan section and following that plan's § Pickup protocol. Record the 4-char IDs in the § Change breakdown of the owning plan and in § Queue below. The intake gate (confidence ≥ 3.0) runs at spawn; a below-gate draft blocks the queue at that position — clarify it with `/fab-clarify <id>` before the queue reaches it.
3. **Spawn S0** as an enrolled ad-hoc agent (not autopilot) with the lxqt plan's § L0 instructions; its deliverable is a `docs:` commit to main appending § L0 verdict to `26-09-10-gui-lxqt-desktop.md`. Throwaway displays only (`:9x`), never the live `rk-gui` session.
4. **Start the queue**: `fab operator autopilot start --queue <S1,S2,S3,S4,S5,S6,S7> --mode merge-auto`. Expect `mode: merge-auto (flag)`. Confirmation copy: "merges PRs on completion". No `depends_on` on any entry.
5. **Enroll each spawn with `--stop-stage ship`.** `/fab-fff`'s review-pr stage requests a Copilot review and polls 10 minutes; on this repo Copilot lands 15–90 minutes after the PR opens (observed on #905 and #908), so every run ends with `review-pr` left `active` and the pipeline stopped. Treating `ship` as the completion delta lets the operator arm auto-merge as soon as the PR exists and keeps the queue moving. Copilot's reviews on this surface have been body-level notes, not blocking findings; sweep them after the queue with `/git-pr-review <change>` on each merged PR's change (or accept them as follow-ups).

## Queue (fill at drafting time)

| # | Change ID | Folder | PR | Merged |
|---|-----------|--------|----|--------|
| S1 | | | | |
| S2 | | 260910-zuci-gui-fixed-geometry-and-resize | | |
| S3 | | | | |
| S4 | | | | |
| S5 | | | | |
| S6 | | | | |
| S7 | | | | |

---

## Coordination points (decided here so no agent re-decides them)

1. **The settings-dialog choice control belongs to S3.** The registry's `enum` kind has static options only; S3's picker needs choices the server discovers (`wm_candidates` on the status document) and S2's geometry field wants presets plus a free `WxH`. S3 builds the "string with suggestions" control and the `Restart the desktop now?` confirm; **S2 ships `gui.geometry` as a validated text field** plus its palette rows and does not touch the dialog's control model. S7 (or a later micro fix) may switch the geometry row to S3's control.
2. **The skill page has five lines of budget.** `docs/site/skill/gui.md` is at 145 of the 150-line cap the `skill_test.go` guard enforces. S1 adds `rk gui wm` and one gotcha; S2 adds `rk gui resize` and the note that a fixed desktop is what keeps `shot`/`click` coordinates stable. **S1 does the trim** as part of its docs task: fold the `env`/`exec` gotchas into one line and merge the `shot` default-path and `--out` notes into one, freeing at least eight lines. S2 then adds without trimming. Every later stage adds at most one line each.
3. **The live display is a shared fixture.** Playwright real-rig tests are isolated per worktree (own tmux socket family, own state home), so they never collide. **Manual acceptance is not**: S1 restarts the host desktop into LXQt and back, S2 resizes it, S5 restarts into seeded LXQt. The operator serializes manual acceptance on the live `rk-gui` session with the queue order and never runs it while an S0 spike display is being measured (the spike uses its own displays, but `rk gui restart` competes for the same CPU the idle-traffic measurement reads).

Shared files, for the rebase step's awareness (all resolve mechanically because each stage starts after its predecessor merged): `app/backend/cmd/rk/gui.go` (S1 and S2 each add a verb and a summary segment), `cmd/rk/gui_supervise.go` (S1, S2, S5 each add a log line or an env entry), `internal/gui/apps_linux.go` (S1 only), `api/gui.go` (S2 adds `resize`, S3 adds `wm_candidates`), `app/frontend/src/lib/palette/gui.ts` (S2, S3, S4, S6, S7 each add rows), `docs/specs/gui.md` (every stage, different sections), `docs/memory/run-kit/gui.md` and `ui/*` (hydrate, every stage).

---

## Rules for the operator on this queue

- **Skip is not the default for a base stage.** `merge-auto`'s failure policy skips a change on review exhaustion or a rebase conflict. S1 and S2 are bases for everything after them: if either is skipped, run `fab operator autopilot pause` immediately and escalate — do not let S3–S7 start on a main that lacks their base. S3, S5, S6, S7 may be skipped and re-queued individually; a skipped S4 also pauses (S6/S7 depend on it).
- **S5 gate.** Before spawning S5, check that `26-09-10-gui-lxqt-desktop.md` contains a `## L0 verdict` section on `origin/main`. Absent ⇒ `pause`, notify, and resume when it lands. Do not reorder S5 behind S6/S7 silently; the user decides.
- **Arming.** Every autopilot PR is a draft (`/git-pr` creates drafts): `gh pr ready` then `gh pr merge --auto --squash`. One armed PR at a time (single repo, single sequence). Verify the merge on a later tick before `git fetch origin`, rebase, and the next spawn. Record the sequence in a `kind: coordination` note per § 6 Auto-Merge Choreography.
- **Copilot.** A `review-pr` left `active` after `/fab-fff` is the expected Copilot-timeout outcome, not a stall; with `--stop-stage ship` it does not gate the queue. After the queue completes, run `/git-pr-review <change>` per merged change once as a sweep and open follow-ups for anything Copilot flagged.
- **Decision authority.** Each stage's intake treats its owning plan's § Decision log as Certain except the rows those plans mark Likely (lxqt L-D4 and L-D7's non-apt names; ergonomics V-D3's xrandr incantation and V-D6's zoom mechanism). Agents do not cross-edit the other plan's decisions; a conflict between the two plans is an escalation to the user, not a local fix.
- **Bookkeeping per stage.** Fill the § Change breakdown row in the owning plan when the change is created, mark Done when merged, and fill § Queue above. The final stage's PR updates both plans' § Status lines.

## Timeouts and escalation

Per `fab-operator` § Autopilot: stage > 30 min ⇒ flag; total > 2 h ⇒ flag. Expect S2 and S4 to run 45–60 min each (full lane, e2e phase included), the rest 20–40 min; the whole queue is a working day with S0 running alongside. Copilot waits do not count against these budgets under `--stop-stage ship`.

## Done means

All seven PRs merged and squashed on main; both child plans' breakdown tables show Done with PR links; `docs/specs/gui.md` § Resize policy reads the `auto`-value form of D7 and § Switching desktops exists; the parent plan's D7 row carries the pointer to the ergonomics plan; the skill page is ≤ 150 lines; `rk gui wm lxqt --restart` on this VM shows the seeded LXQt desktop at the geometry `rk gui resize` last set, and the phone drives it in trackpad mode.
