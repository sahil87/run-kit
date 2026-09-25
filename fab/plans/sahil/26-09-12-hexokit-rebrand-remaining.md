# HexoKit rebrand — remaining work (announce gate + Phase 3)

> Focus doc — split 2026-09-12 from the master plan
> [`26-09-10-hexokit-rebrand.md`](26-09-10-hexokit-rebrand.md), which keeps the
> full evidence, decision log (D1–D15), site shape, and the done history of
> Phases 0–2. **This file is the tracker for everything still open.** Update
> rows here; the master gets one line when a phase closes.

**Where we are**: hexokit.com is live and is the canonical site. shll.ai is a
permanent redirect host (meta-refresh + canonical to the mapped hexokit.com
page; `/install` and `/versions.json` are byte copies, verified). The product
README, docs, specs, and every companion README already say HexoKit. **Nothing
installed on a user's machine has changed its name yet** — `brew list` says
`run-kit`, the desktop app says "Run Kit", the command is `run-kit`/`rk`, config
lives in `~/.config/run-kit/`, and the GitHub repo is `sahil87/run-kit`. That is
deliberate: the disruptive renames are all in Phase 3, which runs when Sahil
calls it.

**Status (2026-09-25)**: **announce gate clear** — A1 done (shll v0.1.33),
A2 merged. A3 (announce) is yours whenever you want it. P1 merged ([run-kit#1050](https://github.com/sahil87/run-kit/pull/1050)); P2 PR open ([run-kit#1049](https://github.com/sahil87/run-kit/pull/1049)); P3 merged ([run-kit#1051](https://github.com/sahil87/run-kit/pull/1051)). Phase 3 not started; R0's code sits on a
parked draft PR now 120 commits behind main. **Account decision fixed
(2026-09-25): everything stays under `sahil87`; R2 renames to
`sahil87/hexokit`** (D15). Port migration folded in (rule P, rows P1/P2 now,
C5 in Phase 3; confirmed 2026-09-12). **2026-09-25: port gets a config.yaml
key (P3, D17) so the C4 pin has somewhere to live; binary stays `rk` with `xk`
added as an alias (D16).**
---

## Rules that bind every row here (from the master decision log)

| # | Rule |
|---|------|
| D2 | **Binary stays `rk`.** `hexokit` replaces `run-kit` as the long command name; **`rk` stays the canonical short name** and **`xk` is added as a second alias** (D16). Docs, skills, help text, and examples use `rk` only; `xk` is mentioned once, as an alias. `hk` is rejected: homebrew-core ships `hk` (jdx's git-hook manager), so installing both is a `bin/hk` link conflict. Every `RK_*` env var, `@rk_*` tmux option, `rk-*` socket/session name, the Go module path `rk`, `rk-code-bridge` and its `rk.*` settings keys, and all `rk-*` CSS classes are **untouched**. If a change appears to need one renamed, stop and add a row |
| D8 | **Electron**: `productName` "Run Kit" → "HexoKit", `artifactName` → `hexokit-desktop-…`, **`appId` `ai.shll.run-kit` kept** so installed apps keep their identity. `rk desktop` stays the CLI verb |
| D9 | **On-disk homes migrate once, silently**: `~/.config/run-kit/` → `~/.config/hexokit/`, `$XDG_STATE_HOME/run-kit/` → `…/hexokit/`, `runkit-*` localStorage → `hexokit-*`. Read-old-then-write-new on first run, old left in place one release, then dropped |
| D11 | **History is not renamed.** `fab/` archives, `docs/memory/` narrative, git history, old PR titles keep "run-kit". Only present-tense live surfaces change |
| D14 | **Standards are not renamed.** `shll standards`, file names, the shll repo home all stay. Content already swept (C1, X4) |
| D15 | **Every repo stays under `sahil87`; the product repo becomes `sahil87/hexokit` at R2.** Fixed 2026-09-25 by Sahil — the `hexokit` GitHub handle is not available (the account is flagged by GitHub abuse review and hidden; rename/org path blocked, tickets pending), so nothing in this plan waits for it or targets it. If the org materialises later, moving repos into it is a separate, later piece of work: a GitHub transfer after a rename keeps the redirect chain, so `sahil87/run-kit` → `sahil87/hexokit` → `hexokit/hexokit` all resolve |
| P | **Ports fold into the rebrand — without moving anyone.** Daemon default 3000 → **6123** (the 6 is the hexagon; only known tenant is Apache Flink's JobManager; not on any browser unsafe-port list) with the +1/+2 arithmetic kept (6124 Go dev backend, 6125 code-server). Machine-only ports move to a 5-digit block humans never type: e2e rig triples 21000–21299, remote tunnels 21500–21599, Playwright sentinel 21999. GUI ports unchanged. **Existing installs are pinned, not moved**: P3 adds a `port` key to config.yaml (env still wins), then C4's config migration writes the current effective port into the migrated config.yaml, so nobody's Tailscale serve, bookmark, or phone shortcut breaks; a doctor row nudges toward 6123. **Env vars are not renamed** — `RK_PORT`/`RK_HOST`/`RK_CODE_SERVER_PORT` are substrate (D2) and stay the only keys with env forms (constitution IV). **Moving is a documented config edit**: set `port: 6123` in `~/.config/hexokit/config.yaml`, restart the daemon, re-point Tailscale Serve, update bookmarks / phone shortcuts / MCP clients at `…:3000/mcp` (D17) |

Roster coupling (why the order below is strict): shll's roster `Name` /
`Formula` / `Repo` are read at runtime by `shll install`, `doctor`, and
`check-updates`. Each field flips **with** its rename in the same sitting,
never ahead of it.

---

## Open rows

### Announce gate

| # | Repo | What | Depends on | Size | PR | Status |
|---|------|------|-----------|------|----|--------|
| A1 | shll | **Cut a shll release** so the embedded `shll standards` / `shll skill` text stops naming shll.ai (X4 merged as [shll#100](https://github.com/sahil87/shll/pull/100) at 17:36 UTC; latest tag v0.1.32 was cut at 05:26 UTC and predates it). Tag = or after commit `f04e3c2b` | — | XS | [shll v0.1.33](https://github.com/sahil87/shll/releases/tag/v0.1.33) | **done** — released 2026-09-25, 5 commits past the X4 merge; verified on the installed binary: zero `shll.ai` mentions across every `shll standards` page and `shll skill shll` |
| A2 | hexokit-site | Cosmetic: footer aligned with the content column | — | XS | [hexokit-site#7](https://github.com/sahil87/hexokit-site/pull/7) | **done** — merged 2026-09-13 |
| A3 | — | **Announce hexokit.com.** No code. After A1 (A2 optional) | A1 | — | — | not started |
| P1 | run-kit | **Machine-only ports + the ports policy.** New policy package holds the daemon default, rig block, tunnel block, sentinel — exposed as a new `rk ports` verb (no such verb exists today) so `scripts/e2e-env.sh`, `test-e2e.sh`, `playwright.config.ts` read the ranges instead of hardcoding; e2e rig triples 3400–3699 → 21000–21299, Playwright fail-closed sentinel 3333 → 21999 (collapse the literal, now in 12 files, into one helper); refuse or warn when the configured daemon port lands inside a reserved block; doctor row. **Name the package `internal/portpolicy`, not `internal/ports`** — `internal/ports` already exists as the listening-TCP-port collector. The remote tunnel range constants live in `internal/remote/ports.go` (`PortRangeStart`/`End`) and should read from the policy too, **keeping their 3100–3199 values** — only C4 may move them. Nothing persists rig ports, so this is disruption-free and independent of the rebrand | — | XS–S | | not started |
| P2 | run-kit | **Host default fix.** Committed `.env` sets `RK_HOST=0.0.0.0` while the Go default is 127.0.0.1, and `just setup` copies it to `.env.local`, so every dev rig exposes the unauthenticated relay and the open `/proxy` route on all interfaces. Make the committed default `127.0.0.1` with `0.0.0.0` as a commented LAN/phone-testing example. Also reconcile portless loopback URLs: Go `present.go` proxies `http://localhost/x` as port 80 while the frontend `web-url.ts` classifies it external. Security fix — do not wait for anything | — | XS | [run-kit#1049](https://github.com/sahil87/run-kit/pull/1049) | **PR open** (draft, pipeline done) — fab change `260925-1067-host-default-loopback-fix`: `.env`, `dev.sh` fallback, and the e2e multi-rig lane all bind `127.0.0.1`; frontend adopts Go's rule (portless `http:` loopback = port 80, portless `https:` stays external). Existing gitignored `.env.local` copies keep `0.0.0.0` until edited by hand |
| P3 | run-kit | **Daemon port gets a config.yaml key (D17).** Today the port is env-only (`RK_PORT`; no registry key, no `serve` flag), so there is nowhere durable to pin an existing install and no documented way to move. Add `port` to the `internal/settings` registry, default 3000 (unchanged here), precedence code default < config.yaml < `RK_PORT` < CLI flag; `RK_CODE_SERVER_PORT` still falls back to port+2. **Amend constitution IV** (v1.14.0 → 1.15.0): port becomes a config.yaml key that also keeps its env form; `RK_PORT`/`RK_HOST`/`RK_CODE_SERVER_PORT` remain the only env forms. Also make `rk daemon start`/`restart` resolve the port from config + env at call time and pass it into the rk-daemon session explicitly (`-e`, as the log path already is) — the daemon's tmux server otherwise keeps the environment it was born with, so a changed port may not take effect on restart (unverified; the change must test it). Non-disruptive: nobody's port changes | — | S | | in progress |

### Phase 3 — the disruptive renames (Sahil's call on timing; each bundle is one sitting)

R1 and R2 are independent of each other and can be weeks apart. R0 → C4 → C5 → R1
is one sequence because the desktop release-asset prefix (R0) ships with the
formula/release bundle (R1), and C4 rides that same release.

| # | Repo(s) | Slug (suggested) | Depends on | Size | Scope | PR | Status |
|---|---------|------------------|-----------|------|-------|----|--------|
| R0 | run-kit | `hexokit-app-identity` | A3 (or Sahil's call) | M | **The app rename.** Cobra root command name `hexokit` (`run-kit` kept as hidden alias one release), **`xk` added as an alias (D16)** + shell completions under all four names (`hexokit`, `rk`, `xk`, `run-kit`); **the parked code registers three — add `xk` during the rebuild**; help-dump / upgrade strings; Electron `productName` "Run Kit" → "HexoKit", `artifactName` → `hexokit-desktop-…`, `appId` kept (D8), the userData carry-forward of `hosts.json`/`windows.json`; `rk desktop` bundle name + release-asset prefix (`internal/desktop/*`); `fab/project/config.yaml` project name | [run-kit#950](https://github.com/sahil87/run-kit/pull/950) (draft) | **parked** — code complete on branch `260911-mvuv-hexokit-brand-surfaces` (fab change `mvuv`), retargeted to `main`. **120 commits behind main as of 2026-09-25** — rebuild rather than rebase: branch fresh from main and `git diff <base> <head> -- <paths> \| git apply -3` the R0 paths, then run the full suite (never `git checkout <old-head> -- paths`; it reverted newer main changes during the C3a split) |
| C4 | run-kit | `hexokit-home-migration` | R0, P3 | M | D9: `~/.config/run-kit` → `~/.config/hexokit` (one-time move, dual-read one release); `$XDG_STATE_HOME/run-kit` → `hexokit` (cron entries + snapshots **must** move; droppable caches may cold-start); `runkit-*` localStorage → `hexokit-*` read-old/write-new. Add an e2e that seeds old keys/dirs and asserts pickup. **Port pin (rule P):** while migrating config.yaml, write the current effective daemon port into P3's `port` key (with a one-line comment: pinned during the rename so remote access kept working) so existing installs stay on 3000 and only fresh installs get the new default; doctor row nudges toward 6123. **Tunnel range:** persisted `remotes.yaml` 3100–3199 → 21500–21599 as a one-shot reassignment (lowest free) in the same load path *only if trivial*; otherwise leave the range alone and record it in the policy. Ships in the same release as R0 | | not started |
| C5 | run-kit | `hexokit-daemon-port` | C4 | S | **Daemon default 3000 → 6123** (+1/+2 kept: 6124 dev backend, 6125 code-server; code-server override semantics unchanged — an explicit code-server port still means externally managed). Nothing forces existing users off 3000 (C4 pins them). Same change updates every place that states the default: README, hexokit.com install page, `serve` help text, `justfile` comments, MCP allowed-origins docs, `docs/specs/architecture.md`, `api.md`, `rk url` prints the current one. Release notes: new installs land on :6123; existing installs keep their pinned port; how to move (config edit, restart, Tailscale Serve, bookmarks, MCP clients — rule P). Doctor row nudges pinned-at-3000 installs toward 6123. Ships in the same release as R0 + C4 | | not started |
| R1 | homebrew-tap → run-kit → shll → hexokit-site | `hexokit-formula-bundle` | R0, C4, C5 merged | M | In order, one sitting: **(a)** tap: `Formula/hexokit.rb` (installs `hexokit` + `rk` and `xk` symlinks), `formula_renames.json` adds `run-kit → hexokit` (precedent `rk → run-kit`), README banner + drop stale `ai.shll.in`; **(b)** run-kit: `.github/workflows/release.yml` writes `Formula/hexokit.rb`, `.github/formula-template.rb` name; **cut the release** (carries R0 + C4 + C5); **(c)** shll: roster `Name`+`Formula` → `hexokit`, `LegacyName` gains `run-kit`, `versions.json` row → `hexokit` (retire the S3 `envelope` carry-over), release shll; **(d)** hexokit-site: landing shows `brew install sahil87/tap/hexokit`, install-script default → `hexokit`. **Gate before (c):** `brew upgrade` on a box with the old formula follows the rename cleanly | | not started |
| R2 | run-kit → shll → hexokit-site → satellites | `hexokit-repo-bundle` | A3 (any time; independent of R1) | S | One sitting: **(a)** GitHub rename `sahil87/run-kit` → `sahil87/hexokit` (`gh auth switch --user sahil87`, switch back after; **never recreate `run-kit`** or the redirect dies); **(b)** shll roster `Repo` → `hexokit`, release; **(c)** hexokit-site slug-table source → `sahil87/hexokit`, run both Refresh crons once; **(d)** run-kit badges / `homepage` fields / formula-template URLs, sahil87 profile + the six C7 repo links. GitHub redirects web, clone, releases, and raw URLs between (a) and (d). **Target is `sahil87/hexokit`, fixed (D15)** — no org dependency, no "decide at R2" | | not started |
| X3 | run-kit | `hexokit-memory-hydrate` | R1, R2 | S | Memory + specs identity sweep for present-truth lines only (D11); competitive-landscape one-liner; `context.md`; close both plan docs (Status → Done) | | not started |

Order: (P1 ∥ P2 ∥ P3, now) · A1 → (A2) → A3 → *[Sahil's call]* → R0 → C4 → C5 → R1 · R2 (any time after A3) → X3.

---

## Risks still live

- **Silent state loss** (C4). Mitigation is in the row: dual-read one release
  plus an e2e that seeds the old locations.
- **Formula rename edge cases** (R1). `formula_renames.json` has worked once
  (`rk → run-kit`); still verify on a box with the old formula before the
  roster flips, because a broken rename strands `shll install`.
- **Electron identity** (R0). `appId` kept, `productName` changed: supported,
  but macOS may show the old name in some dialogs until relaunch. Acceptable.
- **Two names on one machine** until R1/R2 land: `brew list` and the desktop
  app say run-kit while the site says HexoKit; badges point at the old repo
  URL through GitHub's redirect. Accepted by Sahil as cosmetic.
- **Remote-access remap** (C5). A moved daemon port means every Tailscale
  serve mapping, bookmark, and phone shortcut is re-done at once. Mitigated by
  design: C4 pins existing installs to their current port, so only fresh
  installs see 6123 and existing users move on their own schedule.
- **Parked branch drift** (R0). `#950` sits behind `main`; rebase and run the
  full suite (no `| tail`) before merging — the earlier split broke once when
  a checkout reverted newer main changes.

---

## Pickup protocol

1. The rules table above is Certain; do not re-open it. Anything not covered
   goes back to the master plan's decision log.
2. A1 is a release, not a fab change. R0 is a parked PR, not a new change —
   rebuild `260911-mvuv-hexokit-brand-surfaces` onto current main by patch
   apply (see the R0 row) and force-push the same branch; keep PR #950.
3. Substrate identifiers (`rk`, `RK_*`, `@rk_*`, `rk-*`) are never renamed.
4. Update the row and the Status line here when you start or finish; when
   Phase 3 closes, add one line to the master plan's Status and mark both Done.
