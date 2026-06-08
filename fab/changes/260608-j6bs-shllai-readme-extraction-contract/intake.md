# Intake: Conform repo to shll.ai README-extraction contract

**Change**: 260608-j6bs-shllai-readme-extraction-contract
**Created**: 2026-06-08
**Status**: Draft

## Origin

One-shot task: structure this repo so shll.ai's daily mechanical pull renders run-kit's
tool page cleanly. shll.ai pulls a slice of `README.md` plus the `docs/site/**` tree on a
schedule — nothing is hand-copied and nothing is pushed. The job is producer-side
conformance to the contract at
https://github.com/sahil87/shll.ai/blob/main/docs/specs/readme-extraction-contract.md
(§Producer conformance directive), Parts 1 and 2.

> Task: conform this repo to shll.ai's README-extraction contract. Read the contract and
> follow its §Producer conformance directive end-to-end. (1) Find this repo's row in the
> per-tool table. (2) Do Part 1 — restructure README.md: head order, drop GitHub-footer
> sections below the tail denylist, make all images absolute https URLs, render any mermaid
> to a committed image, write any site-escaping link as an absolute URL. (3) Do Part 2 —
> add a docs/site/**/*.md tree (install.md / workflows.md) following the four closed-set
> rules. (4) Run the Verify checklist. Ship as a single PR. Do not touch shll.ai.

**Interaction mode**: one-shot, with a single clarifying question answered.

**Per-tool table row (run-kit)**: slug `run-kit`, URL space `/tools/run-kit/`, collector
`content/run-kit/`, reserved static slugs already used = `overview`, `readme`, `commands`
(so no `docs/site/` page may be named those three). `install` and `workflows` are
explicitly allowed and belong to the tool repo.

**Decision from conversation**: docs/site/ strategy = **Migrate wiki → docs/site/**. Move
`docs/wiki/riff.md` content into `docs/site/workflows.md`, author `docs/site/install.md`
(folding in Homebrew install + Tailscale HTTPS), and rewrite the README's two escaping
links to point at `docs/site/*`. (User chose this over "new docs/site, keep wiki" and
"minimal: links only".)

## Why

1. **Problem.** shll.ai renders the run-kit landing page by mechanically extracting a slice
   of `README.md` and the `docs/site/**` tree. The current README has three traits that the
   pull will mangle: a **relative logo image** (`assets/logo.svg`) that shll.ai will render
   broken (it vendors zero image binaries), two **site-escaping relative links**
   (`docs/wiki/riff.md`, `docs/wiki/tailscale.md`) that 404 on the site, and a
   **`## Contributing` footer** that sits below the contract's tail denylist and will be
   cut anyway — but is cleaner to remove from the canonical README intent.
2. **Consequence if unfixed.** The published tool page shows a broken logo and two dead
   "see the guide" links, and offers no `docs/site/` depth pages — the landing page reads
   as half-finished next to sibling tools (idea, hop, fab-kit, wt) that conform.
3. **Approach over alternatives.** Follow the contract verbatim rather than guessing: the
   contract is the single source of truth for head order, tail cutoff, image/link rules,
   and the docs/site closed-set rules. Migrating the existing `docs/wiki/` content into
   `docs/site/` (rather than authoring net-new) reuses already-curated prose and gives the
   richest page depth with one source of truth.

## What Changes

### Part 1 — README.md restructuring

- **Absolute logo image.** Line 1's `<img src="assets/logo.svg">` becomes an absolute
  `https://raw.githubusercontent.com/sahil87/run-kit/main/assets/logo.svg` URL. Head order
  (`# H1` → `>` toolkit blockquote → badge run → prose) is **already correct** and is
  preserved.
- **Tail denylist.** Remove the `## Contributing` section (the only section at/below the
  denylist: `Contributing|Development|Building|License|Acknowledgements`, case-insensitive).
  `## Architecture` is NOT on the denylist and stays. The `just dev`/`just setup` developer
  content currently under Contributing moves into `docs/site/install.md` (a "Development"
  subsection) so it isn't lost — it just leaves the pulled README slice.
- **Site-escaping relative links → docs/site links.** Rewrite `[riff guide](docs/wiki/riff.md)`
  → `[riff guide](docs/site/workflows.md)` and `[Tailscale guide](docs/wiki/tailscale.md)`
  → `[Tailscale guide](docs/site/install.md)`. The contract auto-rewrites `docs/site/<path>.md`
  links to `/tools/run-kit/<path>` on the site, and they resolve to the real file on GitHub.
- **No mermaid / no gh-mode tricks.** README already has neither — the ASCII "mental model"
  block is plain text (kept), and there are no `#gh-dark-mode-only`/`#gh-light-mode-only`
  fragments. No action needed; verified during Verify.
- **External links already absolute.** `https://github.com/sahil87/wt`,
  `https://github.com/sahil87/fab-kit`, the shll/Tailscale admin links, and the
  `user-attachments` screenshots are already absolute `https://…`. No action.

### Part 2 — docs/site/ tree

- **`docs/site/install.md`** (reserved slug allowed) — install + access guide. Sections:
  Homebrew install (`brew install sahil87/tap/rk`), upgrade (`rk update`), prerequisites /
  `rk doctor`, Development (Node 20+/pnpm/Go 1.22+/`just setup`/`just dev`/`just prod` — the
  migrated Contributing content), and **Tailscale HTTPS** (full content migrated from
  `docs/wiki/tailscale.md`, including custom hostname + Funnel).
- **`docs/site/workflows.md`** (reserved slug allowed) — the `rk riff` deep-dive, migrated
  from `docs/wiki/riff.md`: pane array model, layouts table, presets, parallel `--count`,
  wt passthrough, exit codes, common patterns.
- **Closed-set conformance.** All images in both pages absolute `https://…`; every external
  link absolute; every intra-site link relative-within-`docs/site/`; no `..` escape; no page
  named `overview`/`readme`/`commands`.
- **`docs/wiki/` retained.** The two wiki files stay in place (not deleted) so any existing
  external/GitHub references keep working; `docs/site/` becomes the shll.ai-facing copy.

### Verify (pre-PR)

Run the contract's checklist: head order correct with no frontmatter/HTML-comment above the
H1; no relative image anywhere (README + docs/site); README links point into `docs/site/`
or are absolute; no gh-mode fragments; no reserved-slug page names; optional local extractor
self-check if `extract-readme-cli.mjs` is reachable.

## Affected Memory

<!-- This change is docs/README structuring only — no spec-level product behavior changes.
     No memory files are created, modified, or removed. -->

- None — documentation/README restructuring only; no product behavior changes.

## Impact

- `README.md` — head image absolutized, two links repointed, `## Contributing` removed.
- `docs/site/install.md` (new), `docs/site/workflows.md` (new).
- `docs/wiki/riff.md`, `docs/wiki/tailscale.md` — unchanged (source for migration).
- No code, API, or dependency changes. No `app/backend/`, `app/frontend/` touch.
- Out of scope: the shll.ai repo (it pulls automatically); `help/run-kit.json` generation
  (already emitted at build time per commit afe/230); deleting `docs/wiki/`.

## Open Questions

- None blocking. The one strategic choice (docs/site migration approach) was resolved in
  conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | run-kit's per-tool row: slug `run-kit`, reserved page names `overview`/`readme`/`commands`, `install`+`workflows` allowed | Read directly from the contract's per-tool table | S:98 R:90 A:95 D:95 |
| 2 | Certain | Tail cutoff removes `## Contributing` only; `## Architecture` stays | Contract denylist is explicit (Contributing/Development/Building/License/Acknowledgements); Architecture not listed | S:95 R:80 A:95 D:90 |
| 3 | Certain | Head order already conforms (`#`→`>`→badges→prose); only the logo `src` must be absolutized | Verified against current README.md and §1/§3 | S:95 R:85 A:95 D:90 |
| 4 | Confident | Absolute logo URL = `raw.githubusercontent.com/sahil87/run-kit/main/assets/logo.svg` | Standard raw-content form for a committed repo asset; `main` is the default branch | S:80 R:75 A:80 D:75 |
| 5 | Confident | docs/site strategy = migrate `docs/wiki/*` into `install.md`/`workflows.md`, rewrite README links to `docs/site/*` | Chosen by user in conversation over two alternatives | S:90 R:65 A:85 D:80 |
| 6 | Confident | Migrated Contributing/`just` dev content lands in `docs/site/install.md` under a Development section (so it survives the tail cut) | Preserves real content while honoring the tail denylist; install page is the natural home | S:75 R:70 A:80 D:70 |
| 7 | Confident | Keep `docs/wiki/` in place (don't delete) after migration | Avoids breaking any existing GitHub/external references; deletion is out of scope and separately reversible | S:70 R:75 A:75 D:75 |
| 8 | Certain | No mermaid render needed; no gh-mode fragments to strip | Grepped README — neither present | S:98 R:90 A:98 D:95 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
