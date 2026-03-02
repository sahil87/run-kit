---
name: internal-retrospect
description: "Analyze a completed session and produce a retrospective covering repetition, skill quality, context gaps, and workflow friction."
---

Review this session end-to-end and produce a retrospective covering these four areas. Be specific — cite actual moments from the conversation, not generic advice.

## 1. Scriptable Repetition
Were there manual steps repeated 2+ times that could become a script or shell alias?
- What was repeated and how many times
- Suggested script name and what it would do

## 2. Skill & Prompt Quality
Did any `/fab-*` or other skill produce output that needed significant correction, re-runs, or manual fixup?
- Which skill misfired and what went wrong (ambiguous prompt, missing context, wrong assumptions)
- Concrete suggestion: what should change in the skill prompt to prevent this

## 3. Context & Documentation Gaps
Did the agent make wrong assumptions because information was missing from `docs/memory/`, `docs/specs/`, `_preamble.md`, `CLAUDE.md`, or `constitution.md`?
- What was assumed vs. what was actually true
- Where should this knowledge live so future sessions don't re-learn it

## 4. Workflow Friction
Were there awkward stage transitions, unnecessary clarification loops, or moments where the workflow felt like it was fighting the task?
- What happened and why it was friction
- Is this a workflow design issue, a missing command, or a documentation problem

---

## Output Format

For each area, output one of:
- **Findings** with specific citations and suggested actions
- **Clean** if nothing notable was found

End with a **Suggested Actions** section listing concrete next steps, e.g.:
- `Run /meta:scriptify` to extract {X}
- `Run /meta:review {skill-file}` to fix {Y}
- `Add {Z} to docs/memory/{domain}/{name}.md`
- `Add {W} to CLAUDE.md`

If there are no findings in any area, just say "Clean session — no actions needed."
