# Corrections Wiki — <org>/<repo>

Repo URL: <url>   (this file is keyed to it; one wiki per repo)

Per-repo engineering knowledge distilled from past tasks and human
corrections. Read by `plan` (relevance-scored, citation-verified before use),
written by `harvest`. Shared by Claude and Copilot — commit it to the repo.

Rules: every entry cites live code · entries are general rules, not task logs ·
no secrets or customer data · consolidate when it grows past ~20 entries.

---

## Entries

<!-- newest first. copy the block below per entry. -->

### <short rule name>
- **Rule:** <the generalised lesson, one or two sentences>
- **Trigger:** <when this applies — used for relevance scoring>
- **Evidence:** <code citation: path:line or symbol — re-verified before trust>
- **Origin:** <human-correction | failed-approach | observation>
- **Date:** <YYYY-MM-DD>

---

### EXAMPLE — Money is integer minor units
- **Rule:** All monetary values are integer minor units (cents). Never use
  floats for money; never divide before formatting at the boundary.
- **Trigger:** Any task touching prices, billing, totals, or currency.
- **Evidence:** `src/billing/money.py:44` (`Money` value object)
- **Origin:** human-correction (reviewer rejected a float subtotal)
- **Date:** 2026-05-19
