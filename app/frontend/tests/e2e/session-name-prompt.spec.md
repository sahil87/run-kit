# session-name-prompt.spec.ts

Covers the save-as-style session name prompt behind the palette's
`Session: Create` action (one flow, two entry points — the `create-session`
chord resolves through the same palette body, but the chord is browser-reserved
in a non-shell host, so e2e exercises the palette entry point).

## Shared setup

- `beforeAll` seeds one detached session (`e2e-prompt-<ts>`) on the isolated
  `rk-test-e2e` tmux server so the `/$server` route has stable content.
- `afterAll` kills the seed session plus (best-effort) the sessions the tests
  create: the prefill-accepted `session` and the typed `e2e_named_<ts>`.
- `openPrompt` helper: ⌘K → fill `Session: Create` → click the option matched
  by an anchored regex (`/^Session: Create( —|$)/` — the accessible name is
  `label — description`, and the anchor keeps prefix-sharing siblings out) →
  assert the `New session` dialog is visible and return its name input.

## Tests

### Escape cancels — prompt closes, nothing is created

**Proves**: Escape closes the prompt without creating a session — the cancel
path is a true no-op.

Steps:
1. Go to `/$server` (ready-gated).
2. Open the prompt via the palette; read the prefilled value and assert it
   matches the no-current-window fallback shape `session(-N)`.
3. Press Escape; assert the dialog unmounts.
4. Assert via `tmux has-session` on the isolated server that no session with
   the prefilled name exists.

### Enter accepts the prefilled default — today's behavior plus one keystroke

**Proves**: the prompt opens pre-filled with the auto-derived name instant
create would have used, and a bare Enter creates exactly that session.

Steps:
1. Go to `/$server`; open the prompt via the palette.
2. Assert the input is prefilled with the derived fallback name (`session(-N)`
   — no current window on the density route).
3. Press Enter in the input; assert the dialog closes.
4. Assert the session tile for the prefilled name appears on the density view
   (SSE-driven, 10s timeout).

### typing overrides the default — the typed name is created

**Proves**: the prefill is select-all'd on open, so typing replaces it in one
gesture and Enter creates the typed name instead.

Steps:
1. Go to `/$server`; open the prompt via the palette.
2. Type a unique name (`e2e_named_<ts>`) — no manual clearing — and assert the
   input value equals exactly the typed name (selection replaced).
3. Press Enter; assert the dialog closes.
4. Assert the session tile for the typed name appears.
