# operator-compose.spec.ts

E2e coverage for the operator compose surface (260822-wyn3 R6): the two palette verbs, the shared dialog, the per-verb toasts, the structured-failure toast, and the no-operator gating.

## Shared setup

Fully mocked — no tmux server, no live backend. The sessions payload (a work window `@1` plus, when the test wants one, an operator window `@9` with `role: "operator"` in `_rk-operator`) rides the state-socket mock (`_state-socket-mock.ts`); `POST /api/operator-request` is stubbed via `page.route("**/api/operator-request*", …)` — **trailing `*` required**, because the client's `withServer` appends `?server=`. Each spec lands on the `@1` terminal route before driving the palette.

## Tests

### palette 'Operator: Spawn task…' opens the dialog pre-selected to spawn; Enter submits the body and toasts the spawn wording

**Proves**: the palette verb opens the compose dialog with the spawn mode active and the input focused, and submitting POSTs `{template: "spawn-task", text}` to the server-scoped endpoint, closing the dialog and toasting "Sent to operator — it will spawn the agent".

1. Mock the backend with an operator window and a 200 operator-request stub.
2. Open the palette, filter to `Operator:`, select `Operator: Spawn task…`.
3. Assert the dialog shows with the "Spawn task" segment `aria-pressed` and the input focused.
4. Type "fix the flaky test", press Enter.
5. Assert exactly one POST body `{template: "spawn-task", text: "fix the flaky test"}`, the dialog closed, and the spawn-wording toast visible.

### palette 'Operator: Find discussion…' opens the dialog pre-selected to find; Enter submits the query and toasts the find wording

**Proves**: the find verb mirrors the spawn verb — pre-selected find mode, `{template: "find-discussion", text}` POST, and the "…answer appears in the operator tab" toast.

1. Mock the backend with an operator window and a 200 operator-request stub.
2. Open the palette, filter to `Operator:`, select `Operator: Find discussion…`.
3. Assert the "Find discussion" segment is `aria-pressed`.
4. Type "where did we discuss the fence length", press Enter.
5. Assert the POST body `{template: "find-discussion", text: …}` and the find-wording toast.

### a structured backend 409 surfaces as the failure toast

**Proves**: the busy-operator 409's structured `error` message reaches the user as the error toast (the `throwOnError` seam), not a generic failure.

1. Mock the backend with an operator window and a 409 stub carrying the busy message.
2. Open the dialog via `Operator: Spawn task…`, type a task, press Enter.
3. Assert the POST fired and the toast carries the server's "operator is busy (active) …" message.

### neither palette entry is listed when the server has no operator window

**Proves**: the degrade-to-absent gate — with no `role: "operator"` window in the sessions payload, both `Operator:` palette entries are omitted (not disabled).

1. Mock the backend WITHOUT an operator window.
2. Open the palette, filter to `Operator:`.
3. Assert zero `Operator:` options.
