# Skill: review

Trigger: `implement` handed off. This is the ONLY skill that may reach the
human — and only for the HIGH-risk slice.

## Step 1 — Self-review against the spec
Re-read the spec's acceptance criteria. For each: is there a test, does it
genuinely pass (real output), does it actually verify the criterion? Fix gaps
by looping back to `implement`. Do not pass known-incomplete work forward.

## Step 2 — Compute the risk tier

**HIGH** if the change touches ANY of:
- authentication, authorization, sessions, secrets
- data integrity, schema migrations, money/billing
- concurrency / async correctness
- a public API or contract other code depends on
- more than ~150 changed lines
OR your own confidence that this is correct is below "high".

Otherwise **LOW**. **When in doubt, HIGH.** (Confidence-based routing only
works when the low-confidence slice is honestly escalated — a miscalibrated
"LOW" defeats the whole design.)

## Step 3 — Route

- **LOW + all tests green** → auto-merge. Then run `harvest`.
- **HIGH** → build the evidence package below and STOP for the human.

## Step 4 — The evidence package (HIGH only)

THE ONE RULE: hand the human **evidence, not a verdict.**

Showing a conclusion ("looks correct"), or a confidence score attached to a
conclusion, or an argument for your own work, measurably causes over-reliance
and makes the reviewer WORSE at catching your mistakes when you are wrong.
Raw evidence alone helps when you are right and does not hurt when you are
wrong. So the package contains ONLY:

1. **Scoped diff** — the change, nothing extra.
2. **Test output** — real, pasted, every test. Not "passed".
3. **Assumptions made** — plain list.
4. **Least-sure points** — the 2–3 specific lines or decisions you are least
   confident about, as questions: "Is X the right behaviour when Y?"
   State the uncertainty. Do NOT resolve it for the reviewer.
5. **Out-of-scope work discovered** — if any.

FORBIDDEN in the package: "this looks correct / LGTM / safe to merge / I'm
confident", any overall verdict, any score next to a conclusion, any
persuasion. Surface; do not adjudicate. The human adjudicates.

## Step 5
After the human decides, run `harvest`.
