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

**Status (2026-09-12)**: announce gate open pending one shll release. Phase 3
not started; R0's code exists on a parked draft PR.

---

## Rules that bind every row here (from the master decision log)

| # | Rule |
|---|------|
| D2 | **Binary stays `rk`.** `hexokit` replaces `run-kit` as the long command name; `rk` is the alias. Every `RK_*` env var, `@rk_*` tmux option, `rk-*` socket/session name, the Go module path `rk`, `rk-code-bridge` and its `rk.*` settings keys, and all `rk-*` CSS classes are **untouched**. If a change appears to need one renamed, stop and add a row |
| D8 | **Electron**: `productName` "Run Kit" → "HexoKit", `artifactName` → `hexokit-desktop-…`, **`appId` `ai.shll.run-kit` kept** so installed apps keep their identity. `rk desktop` stays the CLI verb |
| D9 | **On-disk homes migrate once, silently**: `~/.config/run-kit/` → `~/.config/hexokit/`, `$XDG_STATE_HOME/run-kit/` → `…/hexokit/`, `runkit-*` localStorage → `hexokit-*`. Read-old-then-write-new on first run, old left in place one release, then dropped |
| D11 | **History is not renamed.** `fab/` archives, `docs/memory/` narrative, git history, old PR titles keep "run-kit". Only present-tense live surfaces change |
| D14 | **Standards are not renamed.** `shll standards`, file names, the shll repo home all stay. Content already swept (C1, X4) |
| D15 | **Repo owner stays `sahil87`** for now. The `hexokit` GitHub account is reserved; the move to it (org conversion first) needs GitHub approvals and is out of scope here. R2's target is `sahil87/hexokit` unless the org exists by then — decide at R2 |

Roster coupling (why the order below is strict): shll's roster `Name` /
`Formula` / `Repo` are read at runtime by `shll install`, `doctor`, and
`check-updates`. Each field flips **with** its rename in the same sitting,
never ahead of it.

---

## Open rows

### Announce gate

| # | Repo | What | Depends on | Size | PR | Status |
|---|------|------|-----------|------|----|--------|
| A1 | shll | **Cut a shll release** so the embedded `shll standards` / `shll skill` text stops naming shll.ai (X4 merged as [shll#100](https://github.com/sahil87/shll/pull/100) at 17:36 UTC; latest tag v0.1.32 was cut at 05:26 UTC and predates it). Tag = or after commit `f04e3c2b` | — | XS | — | not started |
| A2 | hexokit-site | Cosmetic: footer aligned with the content column | — | XS | [hexokit-site#7](https://github.com/sahil87/hexokit-site/pull/7) | PR open |
| A3 | — | **Announce hexokit.com.** No code. After A1 (A2 optional) | A1 | — | — | not started |

### Phase 3 — the disruptive renames (Sahil's call on timing; each bundle is one sitting)

R1 and R2 are independent of each other and can be weeks apart. R0 → C4 → R1
is one sequence because the desktop release-asset prefix (R0) ships with the
formula/release bundle (R1), and C4 rides that same release.

| # | Repo(s) | Slug (suggested) | Depends on | Size | Scope | PR | Status |
|---|---------|------------------|-----------|------|-------|----|--------|
| R0 | run-kit | `hexokit-app-identity` | A3 (or Sahil's call) | M | **The app rename.** Cobra root command name `hexokit` (`run-kit` kept as hidden alias one release) + shell completions under all three names; help-dump / upgrade strings; Electron `productName` "Run Kit" → "HexoKit", `artifactName` → `hexokit-desktop-…`, `appId` kept (D8), the userData carry-forward of `hosts.json`/`windows.json`; `rk desktop` bundle name + release-asset prefix (`internal/desktop/*`); `fab/project/config.yaml` project name | [run-kit#950](https://github.com/sahil87/run-kit/pull/950) (draft) | **parked** — code complete on branch `260911-mvuv-hexokit-brand-surfaces` (fab change `mvuv`), retargeted to `main`; rebase before merging, re-run the full suite |
| C4 | run-kit | `hexokit-home-migration` | R0 | M | D9: `~/.config/run-kit` → `~/.config/hexokit` (one-time move, dual-read one release); `$XDG_STATE_HOME/run-kit` → `hexokit` (cron entries + snapshots **must** move; droppable caches may cold-start); `runkit-*` localStorage → `hexokit-*` read-old/write-new. Add an e2e that seeds old keys/dirs and asserts pickup. Ships in the same release as R0 | | not started |
| R1 | homebrew-tap → run-kit → shll → hexokit-site | `hexokit-formula-bundle` | R0, C4 merged | M | In order, one sitting: **(a)** tap: `Formula/hexokit.rb` (installs `hexokit` + `rk` symlink), `formula_renames.json` adds `run-kit → hexokit` (precedent `rk → run-kit`), README banner + drop stale `ai.shll.in`; **(b)** run-kit: `.github/workflows/release.yml` writes `Formula/hexokit.rb`, `.github/formula-template.rb` name; **cut the release** (carries R0 + C4); **(c)** shll: roster `Name`+`Formula` → `hexokit`, `LegacyName` gains `run-kit`, `versions.json` row → `hexokit` (retire the S3 `envelope` carry-over), release shll; **(d)** hexokit-site: landing shows `brew install sahil87/tap/hexokit`, install-script default → `hexokit`. **Gate before (c):** `brew upgrade` on a box with the old formula follows the rename cleanly | | not started |
| R2 | run-kit → shll → hexokit-site → satellites | `hexokit-repo-bundle` | A3 (any time; independent of R1) | S | One sitting: **(a)** GitHub rename `sahil87/run-kit` → `sahil87/hexokit` (`gh auth switch --user sahil87`, switch back after; **never recreate `run-kit`** or the redirect dies); **(b)** shll roster `Repo` → `hexokit`, release; **(c)** hexokit-site slug-table source → `sahil87/hexokit`, run both Refresh crons once; **(d)** run-kit badges / `homepage` fields / formula-template URLs, sahil87 profile + the six C7 repo links. GitHub redirects web, clone, releases, and raw URLs between (a) and (d). Owner per D15 | | not started |
| X3 | run-kit | `hexokit-memory-hydrate` | R1, R2 | S | Memory + specs identity sweep for present-truth lines only (D11); competitive-landscape one-liner; `context.md`; close both plan docs (Status → Done) | | not started |

Order: A1 → (A2) → A3 → *[Sahil's call]* → R0 → C4 → R1 · R2 (any time after A3) → X3.

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
- **Parked branch drift** (R0). `#950` sits behind `main`; rebase and run the
  full suite (no `| tail`) before merging — the earlier split broke once when
  a checkout reverted newer main changes.

---

## Pickup protocol

1. The rules table above is Certain; do not re-open it. Anything not covered
   goes back to the master plan's decision log.
2. A1 is a release, not a fab change. R0 is a parked PR, not a new change —
   rebase `260911-mvuv-hexokit-brand-surfaces`, do not recreate it.
3. Substrate identifiers (`rk`, `RK_*`, `@rk_*`, `rk-*`) are never renamed.
4. Update the row and the Status line here when you start or finish; when
   Phase 3 closes, add one line to the master plan's Status and mark both Done.
