# Intake: Compose strip Enter=insert-line policy (terminal-faithful Enter matrix)

**Change**: 260802-lj98-compose-enter-insert-line
**Created**: 2026-08-02

## Origin

Promptless create-intake dispatch synthesized from a live design conversation with the user. All numbered changes below were explicitly confirmed in that conversation (treat as decided); the two open edges the user did not decide (chat's empty-Cmd+Enter, the exact `enterKeyHint` value) are recorded as graded assumptions.

> Compose strip Enter=insert-line policy (terminal-faithful Enter matrix): plain Enter in the strip sends `text + "\n"` to the focused pane and clears the draft; Alt+Enter keeps the byte-exact raw insert; Cmd/Ctrl+Enter stays submit (`text + "\r"`) and gains empty-textarea bare-`"\r"` ("press Enter in the pane"); the chat view deliberately diverges (keeps Enter=newline); `classifyComposeEnter` gains a surface parameter; the strip's Insert button follows Enter; tooltips/enterkeyhint/tests/e2e + `.spec.md` updated.

This revises the Enter policy shipped yesterday as `260801-hsxm` (PR #508: Enter=newline on all pointers, Cmd/Ctrl+Enter=submit, Alt+Enter=raw insert, shared verbatim across both surfaces). Per-target persistent drafts shipped as `260801-cyth` (PR #509). Gap analysis: no existing mechanism covers this — it is a deliberate policy revision of hsxm's strip half, keeping hsxm's chat half.

## Why

1. **The pain point**: with the hsxm policy, plain Enter in the compose strip only accumulates lines locally. The strip overlays the visible terminal, so the terminal-native flow the audience wants is *stage lines into the agent's composer as you write them*: Claude Code treats a raw `"\n"` as newline-insert in its input box, so "Enter = transmit this line into the pane's composer" makes consecutive Enters stage sentence-per-line in the agent's input, visibly, exactly like typing into the pane itself — then one Cmd/Ctrl+Enter (or an empty-textarea Cmd/Ctrl+Enter after staging) submits. Today that stage-then-submit loop needs the obscure Alt+Enter chord for every line and offers no keyboard way to press Enter in the pane afterwards.
2. **If we don't fix it**: the strip remains a local drafting box rather than a terminal-faithful input surface; staging into the agent composer stays chord-gated (Alt+Enter) and the loop cannot be completed from the keyboard (empty submit is a no-op), so users fall back to focusing the raw terminal, losing the strip's IME/autocorrect/paste benefits.
3. **Why this approach over alternatives**: Enter=insert-line is terminal-conventional — on a plain shell pane `"\n"` executes the line, which is exactly what Enter does in a terminal (accepted, documented, not guarded). The chat lens deliberately does NOT follow: it cannot show the pane's input box, so Enter-as-insert there would make typed text visibly vanish — chat keeps Enter=newline (user-confirmed divergence, with the "two surfaces must not diverge" doc contract rewritten as a deliberate, visibility-motivated exception). Alternatives rejected in conversation: keeping one shared policy (sacrifices either the strip's terminal-faithfulness or chat's visibility safety); a preference toggle (a second policy path for a decision with one defensible default per surface).

## What Changes

### 1. Chord matrix — before → after (state transfer: full matrix)

**Before (shipped 260801-hsxm — identical on both surfaces):**

| Input | Compose strip (raw bytes over relay WS) | Chat send form (POST /chat/send) |
|---|---|---|
| Enter | local newline (textarea default) | local newline |
| Shift+Enter | local newline | local newline |
| Cmd/Ctrl+Enter | submit: `text + "\r"`; empty/whitespace-only → no-op | `onSend(text, true)`; empty → no-op |
| Alt+Enter | raw insert: `text`, NO trailing byte; empty → no-op | `onSend(text, false)`; empty → no-op |
| Insert button | raw insert (same as Alt+Enter); disabled when empty | `submit:false`; disabled when empty |
| Send button | submit; disabled when empty | submit; disabled when empty |
| `enterKeyHint` | `"enter"` | `"enter"` |
| Insert tip kbd | `Alt+Enter` | `Alt+Enter` |
| Send tip kbd | `composeSubmitKeycap()` (⌘Enter / Ctrl+Enter) | `composeSubmitKeycap()` |

**After (this change — surfaces deliberately diverge):**

| Input | Compose strip | Chat send form (**unchanged behavior**) |
|---|---|---|
| Enter | **insert line**: `ws.send(text + "\n")` + clear that target's draft; **empty textarea → full no-op** (consumed, no local newline, nothing sent) | local newline |
| Shift+Enter | local newline — now the ONLY local multi-line compose | local newline |
| Cmd/Ctrl+Enter | submit: `text + "\r"`; **empty/whitespace-only → bare `"\r"`** ("press Enter in the pane" — completes the stage-then-submit loop) | `onSend(text, true)`; empty → no-op |
| Alt+Enter | raw insert: `text`, NO trailing byte (byte-exact — for completing a partial line); empty → no-op; now **chord-only** | `onSend(text, false)`; empty → no-op |
| Insert button | **follows Enter**: insert line (`text + "\n"` + clear); disabled when empty | `submit:false`; disabled when empty |
| Send button | follows Cmd/Ctrl+Enter incl. the empty bare-`"\r"` (see Assumption 10: enabled whenever a target exists) | submit; disabled when empty |
| `enterKeyHint` | **`"send"`** (Assumption 8 — Enter now transmits) | `"enter"` |
| Insert tip kbd | **`Enter`** | `Alt+Enter` |
| Send tip kbd | `composeSubmitKeycap()` — unchanged | `composeSubmitKeycap()` — unchanged |

Semantics of `"\n"` at the pane: Claude Code treats it as newline-insert (consecutive Enters stage sentence-per-line in the agent's composer); a plain shell pane executes the line — terminal-conventional Enter, **accepted, documented in a code comment, not guarded** (user-decided; extends the existing multiline-raw-bytes caveat comment in `compose-strip.tsx` `send()`).

### 2. `app/frontend/src/lib/compose-keys.ts` — surface-parameterized classifier

- `classifyComposeEnter` gains a **required** second parameter: `surface: "strip" | "chat"` (required so both call sites must declare — a silent default would recreate the drift the shared classifier exists to prevent; Assumption 12).
- `ComposeEnterAction` gains a fourth value: `"insert-line"`.
- Precedence, first match wins:
  - both surfaces: non-Enter or IME-composing → `"default"`; meta/ctrl → `"submit"`; alt → `"insert"`; shift → `"default"`.
  - `surface === "strip"`: plain Enter → `"insert-line"`.
  - `surface === "chat"`: plain Enter → `"default"` (unchanged hsxm behavior).
- The classifier stays pure, component-free, and **text-agnostic** — empty-text handling remains at the call sites (Assumption 12).
- The file-header doc comment ("Both keydown handlers route Enter through this ONE classifier so the surfaces cannot diverge — divergence is a defect") is **rewritten**: the classifier is still the single authority for BOTH surfaces' Enter policy, but the surfaces now deliberately diverge on plain Enter, with the visibility rationale spelled out (the strip overlays the visible terminal, so staged text visibly lands in the pane's composer; the chat lens cannot show the pane's input box, so Enter-as-insert there would make typed text vanish). Same rewrite for the mirroring comments in `compose-strip.tsx` (onKeyDown + header) and `chat-view.tsx` (ChatSendForm doc + keydown comment).
- `composeSubmitKeycap()` unchanged.

### 3. `app/frontend/src/components/compose-strip.tsx` — send path

- `send(submit: boolean)` becomes mode-based (e.g. `send(mode: "submit" | "insert" | "insert-line")` — exact shape is apply's choice, payloads are not):
  - `"submit"` → `ws.send(text + "\r")`; when `text.trim() === ""` → `ws.send("\r")` (bare Enter; replaces the empty-never-sends early-return **for the submit path only**). Whitespace-only counts as empty (Assumption 11).
  - `"insert"` → `ws.send(text)` (byte-exact, no trailing byte); empty/whitespace-only → no-op (unchanged).
  - `"insert-line"` → `ws.send(text + "\n")`; empty/whitespace-only → no-op.
- Guards unchanged for all modes: `draftKey !== null`, `wsRef.readyState === WebSocket.OPEN`; a guard-blocked send still early-returns WITHOUT clearing (draft preserved).
- Clear-on-delivery unchanged for non-empty sends in every mode (clear that target's draft + revoke its preview URLs); the empty bare-`"\r"` has nothing meaningful to clear (a whitespace-only draft may be cleared — Assumption 11).
- `onKeyDown`: `"default"` → fall through (unchanged); any other action → `preventDefault()` + `stopPropagation()` + `send(action)`. An `"insert-line"` on an empty textarea is therefore a **full no-op**: the keydown is consumed (no local newline appears) and nothing is sent — this is the user-decided "Empty textarea + Enter = no-op".
- Buttons: Insert button → `send("insert-line")`, still `disabled={!canSend}` (empty follows Enter's no-op); Send button → `send("submit")`, enabled whenever a target exists (`hasTarget`) so the button mirrors the chord's empty bare-`"\r"` (Assumption 10 — the current shared `canSend` splits into per-button conditions).
- Tooltips: Insert tip becomes `label` reflecting insert-line semantics (exact copy apply's choice, e.g. "Insert line") with `kbd="Enter"`; a discoverability note for the chord-only raw insert (Alt+Enter) SHOULD survive somewhere in the Insert button's tip or title (Assumption 13). Send tip unchanged (`composeSubmitKeycap()`).
- `enterKeyHint="send"` with the "truthful hint" comment updated (Assumption 8).
- Escape-blurs, readline layer (`handleReadlineKey` runs before Enter classification), focus contract, drafts store, uploads: all untouched.

### 4. `app/frontend/src/components/chat-view.tsx` — signature-only + docs

- `ChatSendForm`'s keydown passes `surface: "chat"` to the classifier. **Behavior is unchanged**: Enter/Shift+Enter local newline, Cmd/Ctrl+Enter submit, Alt+Enter `submit:false`, empty never sends (see Assumption 9 — chat's empty-Cmd+Enter deliberately does NOT gain a bare-Enter path), `enterKeyHint="enter"`, tips unchanged.
- Doc comments rewritten per §2 (deliberate divergence, visibility rationale).

### 5. Untouched

- `app/frontend/src/lib/readline-keys.ts` (the readline editing layer) — untouched.
- The chat-send backend path (`POST /api/windows/{id}/chat/send`, probe machinery) — untouched (frontend-only change).
- The keybinding registry, bottom bar, board twin wiring — untouched (ComposeStrip is one shared component; both footer mounts inherit).

### 6. Tests (same commit as the code, per constitution Test Companion Docs)

- `app/frontend/src/lib/compose-keys.test.ts` — rewrite the `classifyComposeEnter` matrix, now surface-parameterized: full chord matrix per surface (plain Enter → `"insert-line"` on strip / `"default"` on chat; Shift+Enter default on both; meta/ctrl submit on both; alt insert on both; IME + non-Enter default on both; precedence meta/ctrl > alt > shift/plain). `composeSubmitKeycap` tests unchanged.
- `app/frontend/src/components/compose-strip.test.tsx` — update/add: plain Enter sends `text + "\n"` and clears the target's draft; empty-Enter is a full no-op (nothing sent, keydown consumed, no draft change); empty (and whitespace-only) Cmd/Ctrl+Enter sends bare `"\r"`; Alt+Enter still raw (no trailing byte); Insert button now sends `text + "\n"` (rename/retarget the existing raw-insert button test); Send button enabled-on-empty behavior per Assumption 10; `enterkeyhint` assertion flips to `"send"`; guard-blocked and draft-preservation tests updated where payloads changed.
- `app/frontend/src/components/chat-view.test.tsx` — policy unchanged, but verify against the new classifier signature (the existing "plain Enter does NOT submit", Shift+Enter, empty-no-op, Alt+Enter tests keep passing; update comments that claim the two surfaces share one policy).
- `app/frontend/tests/e2e/compose-strip.spec.ts` **and its sibling `compose-strip.spec.md` in the same commit**: rework the "Enter inserts a newline; Cmd/Ctrl+Enter sends text + carriage return; Escape blurs" flow (Enter now transmits `text + "\n"`) and the "Insert stages text without committing" flow (Insert button now insert-line; Alt+Enter is the raw-insert chord); add the stage-then-submit loop (Enter staging → empty Cmd/Ctrl+Enter bare `"\r"`).
- `app/frontend/tests/e2e/chat-view.spec.ts` / `.spec.md` — chat policy unchanged; check for stale comments/prose asserting the surfaces share one Enter policy and update the `.spec.md` prose if its rationale text mentions the shared policy (behavioral assertions should keep passing).
- Run via `just` recipes only (`just test-frontend`, `just test-e2e` / `just pw test compose-strip`) — never direct playwright/pnpm (project testing rules).

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Docked Compose Strip send-semantics block + the "Enter composes, Cmd/Ctrl+Enter sends — one pointer-independent policy" Design Decision — the strip's Enter matrix changes to insert-line, empty-Cmd+Enter bare-`"\r"`, `enterKeyHint="send"`, Insert-button-follows-Enter; the "shared so the two surfaces cannot diverge" claim becomes "one classifier, deliberately divergent per surface (visibility-motivated)".
- `run-kit/chat`: (modify) § Send-form input box requirement + description — chat is now documented as the deliberately diverging surface (keeps Enter=newline / Cmd+Ctrl+Enter=submit / Alt+Enter=insert), with the visibility rationale; classifier signature now surface-parameterized.

## Impact

- Frontend only: `app/frontend/src/lib/compose-keys.ts`, `app/frontend/src/components/compose-strip.tsx`, `app/frontend/src/components/chat-view.tsx`, their unit tests (`compose-keys.test.ts`, `compose-strip.test.tsx`, `chat-view.test.tsx`), `app/frontend/tests/e2e/compose-strip.spec.ts` + `compose-strip.spec.md` (and a prose check on `chat-view.spec.ts`/`.spec.md`).
- No backend, no API, no keybinding-registry changes. `lib/readline-keys.ts` untouched.
- Behavioral risk surface: users who learned yesterday's Enter=newline strip behavior (shipped <2 days ago in #508) get Enter=transmit — low migration cost given the policy's age; on plain shell panes Enter now executes the line (terminal-conventional, user-accepted).

## Open Questions

- Should the chat lens's empty-Cmd+Enter also "press Enter in the pane" (would need its POST /chat/send path or a new backend bare-Enter affordance — the path is gated differently: novelty echo probe + submit flag)? Not discussed in the design conversation; assumed OUT of scope for this frontend-only change (Assumption 9). Revisit post-ship if the stage-then-submit loop is wanted in the chat lens.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Plain Enter in the strip = insert line: `ws.send(text + "\n")` + clear that target's draft; empty textarea + Enter = full no-op (consumed, nothing sent, no local newline) | Discussed — user explicitly decided, including the empty no-op | S:95 R:70 A:85 D:90 |
| 2 | Certain | Alt+Enter keeps the byte-exact raw insert (no trailing byte) and becomes chord-only; the Insert button follows Enter (insert line, `+ "\n"`) | Discussed — user explicitly decided (raw insert kept for completing a partial line in the agent's input) | S:95 R:80 A:85 D:90 |
| 3 | Certain | Shift+Enter stays a local newline — now the only local multi-line compose in the strip | Discussed — user explicitly decided | S:95 R:85 A:90 D:95 |
| 4 | Certain | Cmd/Ctrl+Enter stays submit (`text + "\r"`) AND on an empty textarea sends bare `"\r"` (replaces the empty-never-sends early return for the submit path only) | Discussed — user explicitly decided (completes the stage-then-submit loop) | S:95 R:75 A:85 D:90 |
| 5 | Certain | Chat view deliberately diverges (keeps Enter=newline / Cmd+Ctrl+Enter=submit / Alt+Enter=insert); `classifyComposeEnter` gains a surface parameter ("strip" or "chat"); the "two surfaces must not diverge" doc comments in compose-keys.ts, compose-strip.tsx, chat-view.tsx are rewritten as a deliberate visibility-motivated exception | Discussed — user confirmed the divergence and the implementation direction (chat cannot show the pane's input box, so Enter-as-insert would make typed text vanish) | S:95 R:70 A:85 D:85 |
| 6 | Certain | On a plain shell pane the transmitted `"\n"` executes the line — terminal-conventional Enter: accepted, documented in a code comment, not guarded | Discussed — user explicitly accepted; extends the existing multiline raw-bytes caveat comment | S:90 R:75 A:85 D:85 |
| 7 | Certain | Strip Insert tip kbd becomes `Enter`; Send keeps `composeSubmitKeycap()` (⌘Enter / Ctrl+Enter); chat's hints/tips unchanged | Discussed — user explicitly decided | S:95 R:90 A:90 D:90 |
| 8 | Confident | Strip `enterKeyHint` becomes `"send"` | User asked for a truthful hint and named "send" as closest (Enter now transmits to the pane and clears the draft — the mobile action-key semantics of "send"); trivially reversible one-attribute change | S:70 R:95 A:75 D:70 |
| 9 | Confident | Chat's empty-Cmd+Enter stays a no-op — no bare-Enter-in-pane via POST /chat/send in this change | Explicitly NOT discussed (user flagged it). Excluded: the change is constrained frontend-only and chat send is probe-gated server-side (a bare Enter there is a backend feature); the same visibility rationale that motivates chat's divergence argues against a blind Enter into an invisible pane; trivially addable later. Surfaced in Open Questions as a post-ship follow-up | S:30 R:88 A:70 D:60 |
| 10 | Confident | The strip's Send button mirrors its chord including the empty case: enabled whenever a target exists, and an empty click sends bare `"\r"` (Insert stays disabled on empty, following Enter's no-op) | The tip advertises the Cmd/Ctrl+Enter chord, so button and chord diverging on empty would be a lying affordance; an accidental empty Send equals a terminal Enter tap (low harm); easily reverted | S:45 R:90 A:65 D:55 |
| 11 | Confident | Whitespace-only text under Cmd/Ctrl+Enter is treated as empty: bare `"\r"` is sent (whitespace discarded, draft cleared); whitespace-only Enter / Alt+Enter remain no-ops | `text.trim() === ""` is the existing emptiness test; transmitting stray spaces + `"\r"` has no user value and `"\r"` matches the user's "press Enter in the pane" intent | S:40 R:90 A:70 D:55 |
| 12 | Confident | Classifier shape: `surface` is a required second parameter (no default); `ComposeEnterAction` gains `"insert-line"`, returned only for surface `"strip"` plain Enter; the classifier stays text-agnostic (empty handling at call sites) | A required param forces both call sites to declare their surface (a default would recreate silent drift); a distinct action keeps `"insert"` byte-exact raw vs `"insert-line"` `+ "\n"` unambiguous; text-emptiness already lives at the call sites today | S:55 R:85 A:80 D:65 |
| 13 | Confident | Insert button tooltip label copy changes to reflect insert-line semantics (e.g. "Insert line"), with the Alt+Enter raw-insert chord still discoverable via the button's tip/title text; exact wording is apply's choice | Cosmetic copy, fully reversible; the kbd chip (`Enter`) is user-decided (row 7), only the label wording is open | S:40 R:95 A:60 D:45 |

13 assumptions (7 certain, 6 confident, 0 tentative, 0 unresolved).
