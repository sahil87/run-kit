# operator-digest.spec.ts

E2e coverage for the operator digest and stuck-triage surfaces (260822-rfz2 R6/R7): the two direct-fire `Operator:` palette entries with their gating and toasts, and the zero-waiting 409 failure toast.

## Shared setup

Fully mocked — no tmux server, no live backend. The sessions payload (a chat-carrying work window `@1` plus, when the test wants one, an operator window `@9` with `role: "operator"` in `_rk-operator`) rides the state-socket mock (`_state-socket-mock.ts`); BOTH operator-request endpoints are stubbed via `page.route` — `**/api/operator-request*` (server-scoped: brief-me, whats-stuck) and `**/api/windows/*/operator-request*` (window-scoped — a guard so no stray fire reaches a live backend) — **trailing `*` required on both**, because the client's `withServer` appends `?server=` (a no-star mock silently falls through to live tmux). Each spec lands on the `@1` terminal route before driving the palette or the flyout.

## Tests

### palette 'Operator: Brief me' fires the server-scoped request directly and toasts the digest wording

**Proves**: the Brief me entry needs no dialog — selecting it POSTs `{template: "brief-me", text: ""}` to the server-scoped endpoint exactly once and toasts "Sent to operator — digest will appear in the operator tab".

1. Mock the backend with an operator window and 200 stubs.
2. Land on the `@1` terminal route; open the palette filtered to `Operator:`.
3. Select `Operator: Brief me`.
4. Assert exactly one POST body `{template: "brief-me", text: ""}` and the digest-wording toast visible.

### palette 'Operator: What's stuck' fires the server-scoped request directly and toasts the triage wording

**Proves**: the What's stuck entry mirrors Brief me — direct fire of `{template: "whats-stuck", text: ""}` and the triage-wording toast.

1. Mock the backend with an operator window and 200 stubs.
2. Open the palette filtered to `Operator:`, select `Operator: What's stuck`.
3. Assert exactly one POST body `{template: "whats-stuck", text: ""}` and the "…triage will appear in the operator tab" toast.

### a zero-waiting 'What's stuck' surfaces the structured 409 as the failure toast

**Proves**: the requiresWaiting rejection's structured `error` message reaches the user as the error toast (the `throwOnError` seam), not a generic failure.

1. Mock the backend with an operator window and a 409 stub carrying "nothing is waiting on this server".
2. Select `Operator: What's stuck` from the palette.
3. Assert the POST fired and the toast carries the server's nothing-waiting message.

### neither entry is listed when the server has no operator window

**Proves**: the degrade-to-absent gate — with no `role: "operator"` window in the sessions payload, every `Operator:` palette entry is omitted (not disabled).

1. Mock the backend WITHOUT an operator window.
2. Open the palette filtered to `Operator:`.
3. Assert zero `Operator:` options.
