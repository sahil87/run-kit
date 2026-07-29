# Intake: Desktop Shell Release CI

**Change**: 260729-5uae-desktop-shell-release-ci
**Created**: 2026-07-29

## Origin

One-shot invocation via `/fab-new 5uae` (backlog ID). Backlog entry:

> [5uae] 2026-07-28: Desktop shell release CI (change 2 of fab/plans/sahil/electron-desktop-shell.md): job-level tag/version outputs on release job + desktop-macos job in release.yml building ad-hoc-signed DMGs (arm64+x64) and attaching via gh release upload; verify with test tag + one workflow_dispatch run. Depends on app/desktop shell change merged.

This is change 2 of 2 from the pre-authored plan `fab/plans/sahil/electron-desktop-shell.md` (§ CI — `.github/workflows/release.yml`). Change 1 — the `app/desktop` Electron viewer shell — is merged (PR #462, commit `6d64e19e`), so the dependency is satisfied: `app/desktop/` exists with `package.json` (`compile` + `dist` scripts), `electron-builder.yml` (`identity: null`, per-arch dmg targets, `artifactName: "run-kit-desktop-${version}-${arch}.${ext}"`), committed `build/icon.png`, and `scripts/build-desktop.sh` for local Mac builds.

## Why

The desktop shell is built and mergeable locally (`just build-desktop` on a Mac), but nothing distributes it. Releases today ship only the `rk` server binaries (tar.gz per platform) plus a Homebrew tap update. Without this change, every desktop-shell release would require a manual Mac build and manual asset upload — the DMGs would drift from the release train or simply not ship.

Wiring a `desktop-macos` job into the existing `release.yml` makes the DMGs first-class release assets: every tagged release (tag-push or workflow_dispatch) automatically carries `run-kit-desktop-{version}-arm64.dmg` and `run-kit-desktop-{version}-x64.dmg`, version-stamped identically to the server binaries.

This is deliberately isolated from change 1 because it is release-train surgery whose verification is operational (cutting a tag and watching the workflow), not unit-testable.

## What Changes

Single file: `.github/workflows/release.yml`. Two edits.

### 1. Job-level outputs on the existing `release` job

The `Extract version from tag` step (`id: version`, release.yml:72–81) already resolves the tag for **both** trigger paths — tag-push (`${GITHUB_REF#refs/tags/}`) and workflow_dispatch (reads `steps.create_tag.outputs.tag`, the tag `scripts/release.sh` just created). Its outputs are currently step-local only. Promote them to job outputs so a downstream job can consume them:

```yaml
jobs:
  release:
    # ... existing config unchanged ...
    outputs:
      tag: ${{ steps.version.outputs.tag }}
      version: ${{ steps.version.outputs.version }}
```

### 2. New `desktop-macos` job

Appended after the `release` job. `needs: release` gives it the outputs and guarantees the GitHub Release exists before upload; when `release` is skipped (workflow_dispatch off main), the dependent job is skipped automatically — no extra `if:` needed. Workflow-level `permissions: contents: write` (release.yml:18–19) already covers `gh release upload`.

```yaml
  desktop-macos:
    needs: release
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
        with:
          ref: ${{ needs.release.outputs.tag }}

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 20

      - uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4
        with:
          version: 9

      - name: Install desktop dependencies
        run: cd app/desktop && pnpm install --frozen-lockfile

      - name: Compile
        run: cd app/desktop && pnpm run compile

      - name: Build DMGs (ad-hoc signed)
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: "false"
        run: |
          cd app/desktop
          pnpm exec electron-builder --mac --publish never \
            --config.extraMetadata.version="${{ needs.release.outputs.version }}"

      - name: Verify ad-hoc signature
        run: |
          for app in app/desktop/release/mac*/*.app; do
            codesign -dv "$app"
          done

      - name: Attach DMGs to release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release upload "${{ needs.release.outputs.tag }}" app/desktop/release/*.dmg --clobber
```

Load-bearing details (from the plan, verified against the current tree):

- **`ref: ${{ needs.release.outputs.tag }}` is critical**: on workflow_dispatch the tag is created *inside* the release job by `scripts/release.sh`, so `github.ref` points at pre-bump `main` — the desktop job must check out the tag it is packaging, not the triggering ref.
- **Action SHAs are the exact pins already used by the `release` job** (checkout v4, setup-node v4 @ node 20, pnpm/action-setup v4 @ pnpm 9) — matching existing style, no new actions introduced.
- **Version injection** via `--config.extraMetadata.version` (same mechanism as `scripts/build-desktop.sh`), but sourced from the release job's authoritative `version` output rather than `git describe` — a shallow CI checkout can't be trusted for tag description, and this keeps DMG version identical to the server-binary version by construction.
- **`CSC_IDENTITY_AUTO_DISCOVERY: "false"`** prevents electron-builder from hunting for signing certs on the runner; `identity: null` in `electron-builder.yml` produces the ad-hoc signature (required on arm64).
- **`codesign -dv` verify step** guards against the known electron-builder ad-hoc-regression risk (plan § Risks #3): an unsigned arm64 app is killed at launch, so a build that silently lost its ad-hoc signature must fail CI. Runs against the built `.app` bundles (the signature lives on the app, not the DMG container). <!-- assumed: verify target is the .app bundles under release/mac*/ — plan names the check but not its target -->
- **`gh release upload … --clobber`** appends assets to the release softprops already created, without touching the generated release notes. `gh` is preinstalled on GitHub-hosted macOS runners.
- **Homebrew tap step untouched** — the tap continues to reference only the server binaries.

### Out of scope

- No changes to `app/desktop/` itself, `scripts/build-desktop.sh`, the justfile, or the Homebrew tap/formula template.
- No notarization, no auto-update, no Linux/Windows desktop targets.
- No release-notes changes (Gatekeeper "Open Anyway" documentation is a release-notes concern tracked in the plan's Risks, not workflow YAML).

## Affected Memory

- `run-kit/architecture`: (modify) release pipeline section — add the `desktop-macos` job (job-level tag/version outputs on `release`, tag-ref checkout, ad-hoc DMG build + `gh release upload` attach)
- `run-kit/desktop-shell`: (modify) packaging/distribution — DMGs now ship automatically as GitHub Release assets per tagged release

## Impact

- **Files**: `.github/workflows/release.yml` only (~45 lines added, 0 removed beyond none). No Go/TS source, no tests to update — workflow YAML is outside `source_paths`/`test_paths`.
- **Systems**: GitHub Actions release train (adds one macOS runner job per release, ~5–8 min, after the existing release job); GitHub Releases gain two DMG assets per release.
- **Verification is operational** (plan chunk 4): one test-tag run + one real workflow_dispatch run:
  1. Push a test tag from this branch (tag-push runs from any ref, release.yml:28). Choose a version **lower than the latest real release** (e.g. `v0.0.1-test`) so the Homebrew tap rewrite it triggers cannot be picked up by `brew upgrade`. Confirm: desktop-macos checks out the tag, builds both DMGs, `codesign -dv` passes, assets land on the test release.
  2. Clean up immediately: delete the test release and tag (`gh release delete`, `git push --delete origin <tag>`), and revert the tap commit in `sahil87/homebrew-tap`.
  3. After merge: one real `workflow_dispatch` release to verify the created-tag checkout path end-to-end.
- **Risk**: a desktop-macos failure turns the workflow red *after* the release/tap have already published — deliberate (surface loudly, never roll back server artifacts).

## Open Questions

- Should the Homebrew tap step eventually be guarded against test/prerelease tags (e.g. skip tap update when the tag carries a suffix)? Out of scope here; the low-version test tag + immediate tap revert bounds the exposure for this change's verification.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `desktop-macos` checks out `ref: ${{ needs.release.outputs.tag }}`, not `github.ref` | Plan explicit + verified: on workflow_dispatch the tag is created inside the release job, so the triggering ref is pre-bump main | S:90 R:80 A:90 D:95 |
| 2 | Certain | Reuse the exact pinned action SHAs already in release.yml (checkout / setup-node@20 / pnpm@9) | Existing style verified at release.yml:31,49,53 — no new action versions introduced | S:85 R:90 A:95 D:90 |
| 3 | Certain | `gh release upload` authenticated via `GH_TOKEN: ${{ github.token }}`; workflow-level `permissions: contents: write` suffices | Standard gh CLI contract; permissions verified at release.yml:18–19; gh preinstalled on macOS runners | S:70 R:90 A:90 D:85 |
| 4 | Certain | Default shallow checkout on the desktop job (no `fetch-depth: 0`) | Version rides the job output — no `git describe` in CI, so no history needed | S:65 R:90 A:85 D:80 |
| 5 | Confident | Inline CI steps (frozen install → compile → electron-builder with `--config.extraMetadata.version` from the job output) rather than calling `scripts/build-desktop.sh` | The script derives version via `git describe` (unreliable on shallow checkout) and its icon check is redundant (icon is committed); plan § CI lists inline steps | S:70 R:85 A:80 D:70 |
| 6 | Confident | `codesign -dv` verifies the built `.app` bundles under `app/desktop/release/mac*/` | Plan names the check but not the target; the ad-hoc signature lives on the .app, the DMG is just the container | S:60 R:85 A:75 D:65 |
| 7 | Confident | No `continue-on-error` on desktop-macos — a failed DMG build turns the workflow red but never rolls back the already-published release/tap | `needs: release` means server artifacts + tap complete first; a loud red run beats a silently missing DMG | S:55 R:90 A:75 D:70 |
| 8 | Tentative | Test-tag verification publishes a real release **and** a Homebrew tap commit for the test version; mitigated by choosing a below-current version (brew won't upgrade down) and immediate cleanup (delete test release + tag, revert tap commit) | Plan chose test-tag verification but didn't address the tap side effect; the mitigation bounds exposure to minutes with no upgrade path to the test version | S:50 R:35 A:45 D:45 |

8 assumptions (4 certain, 3 confident, 1 tentative, 0 unresolved).
