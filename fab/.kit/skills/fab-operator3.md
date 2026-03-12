---
name: fab-operator3
description: "Multi-agent coordination with proactive monitoring and auto-nudge — extends operator2 with question detection and answer confidence for agents waiting on user input."
---

# /fab-operator3

> Read `fab/.kit/skills/_preamble.md` first, then read `fab/.kit/skills/fab-operator2.md`. Operator3 inherits ALL of operator2's behavior — monitoring, enrollment, `/loop` ticks, all use cases (UC1–UC8), confirmation model, pre-send validation, context discipline, and configuration. Then return here for the additional operator3 behavior defined below.

---

## Purpose

Extends operator2 with **auto-nudge** capability: detects when monitored agents are waiting for user input (via terminal content heuristic) and either auto-answers routine questions or escalates judgment calls to the user. This is NOT lifecycle enforcement — the operator is acting as a proxy for the user on routine operational questions, not advancing stages or making pipeline decisions.

**Key difference from operator2**: Where operator2's stuck detection is advisory-only (report and wait), operator3 adds input-waiting detection that actively resolves blocks for routine questions.

**Launcher**: Start via `fab/.kit/scripts/fab-operator3.sh` — creates a singleton tmux tab named `operator` and invokes `/fab-operator3` in a new Claude session.

---

## Question Detection (Terminal Heuristic)

During each monitoring tick, for each monitored agent that is **idle** (per the pane-map Agent column):

1. **Capture terminal output**: `tmux capture-pane -t <pane> -p -l 10` — capture the last ~10 lines of the agent's terminal
2. **Scan for question indicators** — match against the following patterns:
   - Lines ending with `?`
   - `[Y/n]`, `[y/N]`, `(y/n)`, `(yes/no)` patterns
   - `Allow?`, `Approve?`, `Confirm?`, `Proceed?` keywords
   - Claude Code permission prompts (tool approval patterns)
   - `Do you want to...`, `Should I...`, `Would you like...` phrasing
3. **No match** → treat as normal idle behavior (operator2 stuck detection applies)
4. **Match found** → proceed to [Answer Confidence Model](#answer-confidence-model)

The heuristic is intentionally broad — false positives are handled by the confidence model (escalate when unsure), not by tightening detection.

**Bottom-most indicator rule**: When multiple question indicators appear in the captured output, evaluate the most recent (bottom-most) indicator. This is consistent with standard terminal interaction patterns where the latest prompt is the active one.

**Idle-only guard**: Question detection runs ONLY for agents that are idle in the pane map. Active agents are assumed to be working — do not capture or scan their terminal.

---

## Answer Confidence Model

When a question is detected, classify it into one of two tiers:

### Auto-Answer Tier

One obvious right answer given the pipeline context. Send the answer via `tmux send-keys` and report the action.

Examples:
- Permission/approval prompts → approve (e.g., "Allow this tool call? [Y/n]" → `y`)
- "Should I commit before rebasing?" → yes
- "Proceed with the changes?" → yes
- "Continue?" → yes
- Simple operational confirmations where saying "no" would stall the pipeline

**Action**: `tmux send-keys -t <pane> "<answer>" Enter`
**Report**: `"{change}: auto-answered '{summary of question}' → {answer}"`

### Escalate Tier

Multiple valid paths, judgment required. Report to the user without sending any answer.

Examples:
- Questions involving tradeoffs or architecture decisions
- Questions involving destructive or irreversible actions ("Should I delete these files?")
- Questions offering multiple approaches ("Which approach: A or B?")
- Questions about failing tests ("Tests are failing, should I fix or skip?")

**Action**: Do NOT send any answer
**Report**: `"{change}: waiting for input — '{summary of question}'. Please respond."`

### Classification Heuristic

If the question is a binary yes/no where "yes" continues the work and "no" stalls it, AND the question does NOT involve destructive or branching choices → **auto-answer**. Everything else → **escalate**.

### No Nudge Budget

There is no cooldown or retry limit on auto-answers. Each question is evaluated independently on its own merits by the confidence model. The PR review step (human and/or Copilot review before merge) serves as the safety net against compounding bad auto-answers.

---

## Updated Monitoring Tick

The monitoring tick gains a new step between existing detection steps. The full tick order is:

1. **Stage advance detection** *(inherited from operator2)*
2. **Pipeline completion detection** *(inherited from operator2)*
3. **Review failure detection** *(inherited from operator2)*
4. **Pane death detection** *(inherited from operator2)*
5. **Input-waiting detection** *(new)* — for each idle agent in the monitored set:
   - Capture last ~10 lines via `tmux capture-pane -t <pane> -p -l 10`
   - Scan for question indicators
   - If question detected:
     - Auto-answer tier: send the answer via `tmux send-keys`, report `"{change}: auto-answered '{summary}' → {answer}"`
     - Escalate tier: report `"{change}: waiting for input — '{summary}'. Please respond."`
   - Mark the agent as input-waiting (for step 6 exclusion)
6. **Stuck detection** *(inherited from operator2, modified)* — only for agents NOT detected as input-waiting in step 5

**Key invariant**: Input-waiting detection runs BEFORE stuck detection. An agent waiting for input is not "stuck" — it's blocked on user input. Stuck detection only flags agents that are idle without a visible question.

---

## Key Properties

| Property | Value |
|----------|-------|
| Inherits from | `/fab-operator2` (all behavior) |
| New behavior | Question detection, answer confidence model, input-waiting tick step |
| Requires active change? | No |
| Runs preflight? | No |
| Read-only? | No — sends auto-answers to agents via `tmux send-keys` |
| Idempotent? | Yes — state is re-derived before every action |
| Advances stage? | No |
| Outputs `Next:` line? | No — ends with ready signal |
| Loads change artifacts? | No — coordination context only |
| Requires tmux? | Yes — required for monitoring/auto-nudge; status-only mode works without tmux |
| Uses `/loop`? | Yes — inherited from operator2 |
