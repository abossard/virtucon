# Minime flow — token-usage impact of blueprints (source evidence)

Scope: local instruction files (plugin + VIRTUCON_HQ) and persisted blueprint documents only.
No session histories, token-usage events, or databases were read (out of bounded scope by design).
`VIRTUCON_HQ = /Users/abossard/.minime`. Plugin source = `/Users/abossard/.copilot/installed-plugins/virtucon/minime`.

## 0. Root question — which exact current instructions lack a bounded-read protocol vs. which already bound to delta

This section separates the **current contract text** (plugin v0.2.29b, `.claude-plugin/plugin.json`, installed Oct 7 2026 — no local version history exists to compare against earlier wording; see Limitations) into (A) instructions whose entry point names "the blueprint"/"the applied document" without specifying a bounded or partial-read scope, and (B) instructions that already bound work to active criteria / the current delta. **Important correction to an earlier draft of this analysis:** none of the (A) instructions explicitly require ingesting every byte of the file's history, and none explicitly prohibits a selective/section-scoped read. What is established is only the *absence* of a stated bounded-read mechanism for most of them — a contract gap, not a mandate. Whether an actual implementation reads the whole file or a scoped portion depends on tool-level behavior this investigation did not and could not observe (no telemetry was read). Separately, §4 evaluates one persisted document against this *current* text and shows where an **observed older run** diverges from it.

**(A) Current instructions whose entry read has no stated bounded-read scope (full read is a likely default, not an explicit requirement):**

| # | Exact instruction | Source | What is established | What is not established |
|---|---|---|---|---|
| A1 | "Dispatch each phase through a fresh native task… Explicit dispatch establishes the fresh context." | `assets/ORCHESTRATION.md:7` | No carried conversation between phases; the persisted file is the only stated recovery path. | That the file must be read in full — the instruction says nothing about read granularity. |
| A2 | "The persisted blueprint is the sole cross-phase state bus." | `assets/ORCHESTRATION.md:11` | No smaller/partial-state channel is named. | That partial/selective reads of that one file are prohibited — the sentence is about channel count, not read scope. |
| A3 | "Read the new file back before continuing." | `skills/blueprint/SKILL.md:19` | A reread is explicitly instructed immediately after the blueprint phase writes the file. | Whether this reread covers the whole document or only the just-written sections. |
| A4 | "Read the persisted blueprint before changing anything." | `skills/replicate/SKILL.md:13` | A read is explicitly instructed at the start of every replicate dispatch. | Any stated scope limit — the instruction neither restricts the read to the active correction nor forbids doing so. |
| A5 | "Read Constraints / non-negotiables and Out of scope again after compaction, when switching criteria, and when entering a new work area." | `skills/replicate/SKILL.md:15` | A repeated, **section-scoped** reread of two named sections, triggered per criterion switch and per new work area — evidence the contract *can* and does specify partial reads elsewhere. | That this scales to a full-document reread; it names exactly two sections, not the whole file. |
| A6 | `context: fork` (frontmatter) + "Read the blueprint and supplied task boundary." | `skills/inspect/SKILL.md:4`, `:20` | Inspect runs in a fresh fork with no retained prior context; a read of "the blueprint" is instructed. | Whether "the blueprint" here means the complete persisted file or the scoped excerpt referenced by `ORCHESTRATION.md:71` (B1) as "current-task delta, active criteria, and affected accepted requirements" — the wording is compatible with either. |
| A7 | "Tick a criterion as soon as its proof passes. Put shortened raw output immediately below it…" | `skills/replicate/SKILL.md:38` | Proof is recorded inline next to the active-criterion checkbox as work completes. | That this record is meant to persist unchanged after the criterion is later archived (see the archive-"move" discussion below). |

**Correction queue reconciliation (conditional, not universal):** `assets/ORCHESTRATION.md:52` ("Reads the applied document, proposed correction, and available base version") is a step inside the **Correction queue contract**, which applies specifically when a user applies a correction through that formal draft-vs-applied mechanism while a worker is active ("stop dispatching successors and let active workers reach their boundary"). The word "available" in "available base version" itself signals this is conditional on a base version existing, not a claim that every user correction — including ordinary conversational corrections outside that formal queue — triggers a three-document read.

**Archive "move" is a lifecycle transition, not designed permanent duplication:** `assets/ORCHESTRATION.md:65` ("After fresh inspection accepts a criterion, move its ID, requirement, and proof reference to the criteria archive. Keep raw evidence reachable") describes the active record being *moved*, which implies the Active-criteria copy is no longer current afterward — this is a short-lived-active → archived transition, not two permanent simultaneous copies by design. "Keep raw evidence reachable" is compatible with the active-section's inline copy being removed and only a hash/path reference remaining, matching the template's own cleanup note ("remove its active record and its inline raw evidence" — `/Users/abossard/.minime/templates/blueprint.template.md:45-46`). The real, verifiable gap is that this cleanup note is an **authoring-only HTML comment**, stripped from the living document at the very first handoff (`skills/blueprint/SKILL.md` step 7: "Remove authoring comments, placeholders, and teaching scaffolding"), so no standing instruction in `ORCHESTRATION.md` or any `SKILL.md` re-states "delete the active copy once archived" for an agent reading the file in a later phase. Whether the transition is completed cleanly in practice is therefore unconfirmed by the contract text — this is a **plausible mechanism for drift**, not a confirmed design of permanent mirroring.

**(B) Current instructions that already bound scope to active criteria / the delta:**

| # | Exact instruction | Source | Bound enforced |
|---|---|---|---|
| B1 | "Give inspect the current-task delta, active criteria, and any accepted requirements affected by it." | `assets/ORCHESTRATION.md:71` | Bounds the *verification* payload the owner hands inspect — not necessarily the archive read (see A6). |
| B2 | "The inspector evaluates only that scope." | `assets/ORCHESTRATION.md:73` | Explicit scope lock for the evaluation itself. |
| B3 | "If the task boundary is absent or ambiguous, return `blocked`… Do not expand it into a branch-wide or repository-wide review." | `skills/inspect/SKILL.md:24` | Anti-scope-creep guard on inspect. |
| B4 | "Complete one bounded pass and return its findings." | `skills/inspect/SKILL.md:45` | Bounds inspect to one pass per dispatch; no automatic re-pass loop. |
| B5 | "Keep only the current correction's new, failed, or invalidated criteria active, with a reference to its verbatim source." | `assets/ORCHESTRATION.md:63` | Bounds the **Active criteria** section itself to the live delta — history is meant to live only in the archive, not stay active. |
| B6 | "Recheck accepted requirements when behavior or boundaries change… Limit rechecks to affected requirements." | `assets/ORCHESTRATION.md:67` | Bounds *re-verification* of already-accepted work to what the current change actually touches. |
| B7 | "Work on its active correction and any accepted requirements affected by the change." | `skills/replicate/SKILL.md:13` (second sentence) | Bounds replicate's *work*, stated right after instruction A4's unscoped read. |
| B8 | "Read the persisted blueprint's decisions, review discoveries, and verbatim feedback." | `skills/extract/SKILL.md:13` | Extract's entry instruction explicitly names three specific kinds of content (decisions, review discoveries, feedback), not "the whole document" — the most clearly scoped of all the phase-entry reads. |

**The gap this exposes, stated as a hypothesis, not an established cost:** (B1–B8) bound *what must be verified, recorded, or worked on* to the active criteria and affected requirements. (A1, A2, A4, A6) are silent on read granularity — they neither mandate nor forbid a bounded read of the persisted file. Given that most general-purpose coding-agent tooling defaults a "read this file" instruction to returning the file's full current content (absent a deliberate line-range or grep-scoped request), a **likely default consequence** is that each phase dispatch ingests whatever the file currently contains, including accumulated archive/evidence sections — but this is an inference about typical tool behavior, not a textual requirement, and nothing in the contract would be violated by an agent choosing a scoped read instead. The concrete, verifiable gap is narrower than "mandatory whole-file reads": **no instruction specifies a bounded-read protocol for the blueprint/replicate/inspect entry points**, and the one instruction that would prevent accumulation from mattering even under a full-read default — removing an active record's inline evidence once archived — exists only as a template authoring comment that doesn't survive into the living document.

## 1. Flow contract — what gets read, how often, by whom

Sources: `assets/ORCHESTRATION.md`, `agents/dr-evil.md`, `agents/frau.md`, `skills/{blueprint,replicate,inspect,extract}/SKILL.md` (all under the plugin root above).

| Phase | Agent/skill | Context | Entry instruction |
|---|---|---|---|
| blueprint | general-purpose, `skills/blueprint/SKILL.md` | fresh (orchestration rule) | "Read the new file back before continuing." — `skills/blueprint/SKILL.md:19` |
| replicate | general-purpose, `skills/replicate/SKILL.md` | fresh | "Read the persisted blueprint before changing anything." — `skills/replicate/SKILL.md:13`; "Read Constraints / non-negotiables and Out of scope again after compaction, when switching criteria, and when entering a new work area." — `skills/replicate/SKILL.md:15` |
| inspect | `minime:frau`, `skills/inspect/SKILL.md`, `context: fork` (frontmatter, `skills/inspect/SKILL.md:4`) | always fresh fork | "Read the blueprint and supplied task boundary." — `skills/inspect/SKILL.md:20` |
| extract | general-purpose, `skills/extract/SKILL.md` | fresh, dispatched once at terminal boundary | "Read the persisted blueprint's decisions, review discoveries, and verbatim feedback." — `skills/extract/SKILL.md:13` |

Orchestration rules relevant to re-reads (`assets/ORCHESTRATION.md`) — see §0 for the corrected, hedged reading of each:
- "Dispatch each phase through a fresh native task… Explicit dispatch establishes the fresh context." (line 7) — each phase has **no prior conversation**, so the persisted blueprint is the only stated recovery path; the instruction does not itself specify whether recovery means a full or a scoped read.
- "The persisted blueprint is the sole cross-phase state bus." (line 11) — there is no smaller/partial state *channel* named, but this does not state that reads of that channel must be full rather than selective.
- Correction queue contract: "Reads the applied document, proposed correction, and available base version." (line 52) — this step applies when a correction goes through the formal correction-queue mechanism (user draft vs. applied document, with an active worker in flight); it is conditional on that path being invoked and on a base version being "available," not a claim that every user correction triggers it.
- "Dispatch it at most once" for extract (line 77) — the one phase explicitly bounded to a single invocation; blueprint/replicate/inspect have no such cap and can loop.

**What can be concretely established, vs. what cannot:** the blueprint phase explicitly rereads its own just-written file once (`skills/blueprint/SKILL.md:19`); replicate and inspect each begin with an instruction to read the persisted blueprint (`skills/replicate/SKILL.md:13`, `skills/inspect/SKILL.md:20`) with no stated scope limit — not "the whole file," but not "only the delta" either. Extract's entry instruction (`skills/extract/SKILL.md:13`) explicitly names specific content — "decisions, review discoveries, and verbatim feedback" — so it should **not** be counted as an established full-document read alongside the other three; locating that named content in an unstructured document may in practice touch most of it, but that is an implementation detail, not a textual requirement. So the defensible count of phase-entry instructions that are *silent on read scope* (and therefore could default to a full read, without that being mandated) is three — blueprint's self-check reread, replicate's entry read, and inspect's entry read — not an established "≥4 full reads." Replicate additionally names two specific sections (Constraints / non-negotiables, Out of scope) that must be reread "after compaction, when switching criteria, and when entering a new work area" (`skills/replicate/SKILL.md:15`) — this is a real, repeated reread, but it is section-scoped by name, not a repeated whole-file reread. Each correction cycle that goes through the formal queue mechanism (observed 0–43 per document in this corpus, see §3) adds at least one more read of that scope via the correction queue contract. The document is also observed to grow across many (not all) sampled files via append-style archive/evidence sections (§3–4); **if** an implementation defaults to reading the whole file at each of the three silent-scope entry points, the per-dispatch read cost would scale with however much the file has grown by that point — this is presented as a plausible, likely consequence of the missing bounded-read protocol (§0), not a measured or textually mandated outcome.

### Fixed instruction overhead per phase dispatch (not blueprint content)

| File | Bytes | Words | Lines |
|---|---:|---:|---:|
| `assets/ORCHESTRATION.md` | 10,483 | 1,444 | 178 |
| `skills/blueprint/SKILL.md` | 4,742 | 626 | 78 |
| `skills/replicate/SKILL.md` | 2,993 | 409 | 53 |
| `skills/inspect/SKILL.md` | 5,754 | 780 | 85 |
| `skills/extract/SKILL.md` | 2,184 | 303 | 48 |
| `agents/dr-evil.md` | 1,538 | 220 | 35 |
| `agents/frau.md` | 589 | 85 | 17 |
| `assets/blueprint.template.md` (bundled) | 1,864 | 257 | 71 |
| **Sum (one read of each)** | **30,147** | **4,124** | **565** |

Every skill opens with "Read the [shared workflow](../../assets/ORCHESTRATION.md) on entry." As an **upper-bound illustrative scenario** (not an established or measured figure — the contract does not state how many times `ORCHESTRATION.md` is actually re-read per cycle, and provider-side caching was out of scope for this investigation), if it were read once per dr-evil turn **and** once per phase dispatch (4 phases), that would be up to 5× per cycle ≈ 52,415 B just for that one file, before any blueprint content or code is read. Estimated tokens under that hypothetical (chars/4, labeled estimate — see §5): ORCHESTRATION.md alone ≈ 2,621 tokens/read × up to 5 reads/cycle ≈ **13,000 tokens**, presented strictly as an upper-bound scenario, not a measured or mandated cost.

## 2. Blueprint template shape and baseline overhead

Two template variants exist and differ materially:

- HQ template actually in use: `/Users/abossard/.minime/templates/blueprint.template.md` — 4,508 B / 619 words / 131 lines. Sections include `Goal`, `Active criteria` (EARS format), `Criteria archive`, `Plan summary`, `Constraints / non-negotiables`, `Out of scope`, `User's original request`, `Decisions made`, `Relevant verified wiki entries`, `Research resolved`, `Discovered skills and agents`, `Evidence collected`, `Test strategy critique`, `Self-challenge`, `Handoff`, `Discovered during review`, `User feedback`.
- Bundled plugin default: `assets/blueprint.template.md` — 1,864 B / 257 words / 71 lines, a leaner subset (no `Relevant verified wiki entries`, `Research resolved`, `Discovered skills and agents`, `Test strategy critique`, `Self-challenge`, `Discovered during review`).

The HQ template is **2.4× larger** than the bundled default. `blueprint/SKILL.md:15` says the bundled template "owns the required document shape" and tells the agent to "normalize an older or reordered HQ template" in the living document, which implies the two have drifted — but it also means the **current contract's stated intent is to normalize toward the smaller bundled shape**, not the larger HQ one. Whether every (or most) blueprints actually carry the larger HQ-only sections was **not verified corpus-wide** in this analysis; it was checked on one representative file (§4's typical-file section table), which does contain the HQ-only headings (`Relevant verified wiki entries`, `Research resolved`, `Discovered domain-specific skills and agents`, `Test strategy critique`, `Self-challenge`, `Discovered during review`). That single observation is consistent with the HQ shape being used in practice for at least that document, but it is not established as true for all 682 files, and it does not establish that "every blueprint pays" the larger baseline — only that at least one sampled one did. `schema.md` and `_TEMPLATE.md` (wiki topic template) are separate, smaller contracts (4,106 B and 619 B) not part of blueprint overhead.

Measured on that one representative near-median file (`abossard/_az-cli-prs/blueprints/2026-06-16-dual-register-under-monitor-namespace.blueprint.md`, 24,792 B total — see full section table in §4), the ~11 template-required sections beyond `Goal`/`Active criteria`/`Evidence collected` sum to **≈7.3 KB (~30%)** of that file. This set mixes substantive planning content — `Decisions made` (1,425 B), `Out of scope` (1,173 B), `Constraints / non-negotiables` (703 B) — with smaller, more narrowly-scoped bookkeeping sections — `Self-challenge`, `Research resolved`, `Test strategy critique`, `Relevant verified wiki entries`, `Discovered domain-specific skills and agents`, `Handoff`, `Discovered during review`, `User feedback` (each under 1.1 KB, several holding "None." or one line). The ~30% figure measures the structural section count the template requires in this one sample; it is not a claim that this content is unnecessary, duplicated, or removable — most of it is exactly what the blueprint skill asks the author to record (constraints, decisions, scope).

## 3. Blueprint corpus size distribution

Method: walked every directory matching `<org>/_<repo>/blueprints` directly under `VIRTUCON_HQ` (79 canonical directories found via `find . -mindepth 3 -maxdepth 3 -type d -iname blueprints`, confirmed by path-depth check — one deeper match at depth 10 was an `evidence/` fixture nested inside `_virtucon`'s own blueprints dir and was excluded as evidence, not a blueprint). Classification rule:

- **Included as "blueprint document"**: files directly in a canonical `blueprints/` directory, either matching the naming convention `YYYY-MM-DD-<slug>.blueprint.md` (614 files) **or** other `.md` files in the same directory that were spot-checked and confirmed to carry the same `# Blueprint: …` / `## Goal` / `## Active criteria` / `## Criteria archive` structure (68 files, e.g. `abossard/_qlcplus/blueprints/recording-vc-action-support.md`, verified at lines 1–40: `# Blueprint: recording-vc-action-support`, `## Goal`, `## Active criteria`, `## Criteria archive`). Combined corpus: **682 files**.
- **Excluded**: 4 `.txt` "manifest" files (e.g. `abossard/_mcp/blueprints/2026-08-04-graphedit-c4-manifest.txt`) — not blueprint-shaped documents; and every file inside `evidence/`, `scratch/`, `.drafts/`, or `<slug>.evidence/` subdirectories under a blueprints folder — these are raw-proof/log artifacts the skill contract explicitly treats as separate from the living document (the HQ template's archive-row format at `/Users/abossard/.minime/templates/blueprint.template.md:43-48` stores only a path/hash reference to them, not their content).
- The global `VIRTUCON_HQ/templates/`, `raw/`, `wiki/`, `schema.md`, `_TEMPLATE.md` are HQ-shared contract/knowledge files, not blueprints, and are excluded from the distribution (counted separately in §1–2).

### Corpus-wide stats (682 files, all available history, 2026‑05‑20 → 2026‑10‑15)

| Metric | Value |
|---|---:|
| Count | 682 |
| Total bytes | 27,132,321 (~25.9 MB) |
| Total words | 3,345,112 |
| Total lines | 219,766 |
| Mean size | 39,783 B / 4,905 words |
| Median size | 24,889 B / 3,124 words |
| P90 size (linear-interpolated order statistic) | ~83,392 B |
| P99 size (linear-interpolated order statistic) | ~297,869 B |
| Max size | 886,775 B / 114,406 words / 9,399 lines |
| Min size | 1,225 B / 192 words |

P90/P99 use linear interpolation between order statistics on the sorted 682-file bytes array (the same convention as `numpy.percentile(..., method="linear")` / Excel `PERCENTILE.INC`), not nearest-rank; values are rounded to the nearest byte for display.

Size histogram (682 files):

| Bucket | Count |
|---|---:|
| 0–2 KB | 5 |
| 2–5 KB | 38 |
| 5–10 KB | 86 |
| 10–20 KB | 152 |
| 20–50 KB | 264 |
| 50–100 KB | 95 |
| 100–200 KB | 32 |
| 200 KB+ | 10 |

The distribution is strongly right-skewed (mean 1.6× the median): most blueprints cluster 10–50 KB, but a heavy tail of 42 files exceeds 100 KB and 10 exceed 200 KB.

### Recent cohort (mtime date ≥ 2026-10-08) vs all-time

Cutoff definition, stated exactly for reproducibility: each file's stored ISO mtime string, first 10 characters (`YYYY-MM-DD`), compared as a string `>= "2026-10-08"`. This is a **date-only cutoff in whatever timezone the filesystem mtime and `blueprint_combined.json`'s `datetime.fromtimestamp()` call used** (the host's local zone; not independently confirmed against a named zone such as UTC or CEST) — it is not a precise rolling "last 7 days from query time" window. An earlier draft of this report used a non-reproducible `datetime.now() − 7 days` cutoff computed at analysis time (giving 47 files / 2,403,576 B); that figure is replaced below with the reproducible date-only cutoff, which independently verifies to 53 files / 2,872,757 B / mean 54,203 B/file.

| | Recent (mtime date ≥ 2026-10-08) | All-time | Recent share |
|---|---:|---:|---:|
| Count | 53 | 682 | 7.8% |
| Bytes | 2,872,757 | 27,132,321 | 10.6% |
| Words | 342,929 | 3,345,112 | 10.3% |
| Mean bytes/file | 54,203 | 39,783 | — |

The recent-cohort mean file size (54,203 B) is **36% larger** than the all-time mean (39,783 B). This is a cross-sectional comparison of two mtime groupings, not a measurement of any file's growth over time — see the weekly-cohort caveat immediately below for why this should not be read as a demonstrated inflation trend.

### Weekly cohorts by mtime (cross-sectional snapshot, not per-file growth)

Grouping file mtimes into ISO weeks gives a cross-sectional snapshot of which files were *last modified* in a given week — it does **not** measure any single file's size over time, and does not by itself establish growth, historical causality, or a flow-wide inflation trend. A file's mtime reflects only its most recent edit (e.g., its latest correction), so an old file touched once late in the series appears entirely in that late week's cohort. Weeks also differ in which repos/task types were active (a task-mix confound): `abossard/_qlcplus`'s naturally large recording-session blueprints (§3 top-repo table, 107 files averaging ~44.8 KB) are concentrated in several of the later weeks shown below, which would raise those weeks' average regardless of any per-task growth.

Selected early vs. late ISO weeks of 2026 (full table generated, abbreviated here):

| ISO week | Files | Total bytes | Avg bytes/file-touched-that-week |
|---|---:|---:|---:|
| 21 (earliest) | 48 | 282,108 | 5,877 |
| 29 | 25 | 1,146,731 | 45,869 |
| 30 | 66 | 3,091,340 | 46,838 |
| 33 | 43 | 2,791,184 | 64,911 |
| 41 | 35 | 2,088,722 | 59,678 |
| 42 (latest full week) | 33 | 1,652,048 | 50,062 |

Average bytes/file-touched varies roughly 6–11× across these cohorts (week 21: 5,877 B; week 33: 64,911 B). Several explanations are consistent with this variation and cannot be distinguished from mtime data alone: genuine per-task growth over a task's correction history, a shift in which repos/task types were active that week, or small-sample effects in weeks with fewer files. **No causal growth trend or flow-wide inflation rate is established by this measurement** — it is reported only as a descriptive cross-sectional observation.

### Top 10 repos by total blueprint bytes

| Repo | Files | Total bytes |
|---|---:|---:|
| `abossard/_qlcplus` | 107 | 4,797,555 |
| `abossard/_ahm-diagrammo` | 27 | 2,495,259 |
| `msazure/_AHM-Health-Intelligence-Platform` | 56 | 2,223,077 |
| `abossard/_ahm-model-demo` | 19 | 1,712,561 |
| `msazure/_AHM-CloudHealth-Portal` | 28 | 1,113,313 |
| `abossard/_mcp` | 16 | 819,302 |
| `abossard/_virtucon` | 35 | 758,128 |
| `abossard/_well-architected-pr` | 24 | 751,888 |
| `abossard/_rgds-rocknix-setup` | 4 | 722,610 |
| `One/_AHM-CloudHealth-Portal` | 33 | 696,667 |

`abossard/_qlcplus` alone holds 17.7% of all blueprint bytes in 107 files — it is both the most prolific and (per file) a heavy repo (several individual files 100–225 KB, see §4).

### Top 15 largest blueprint documents

| Bytes | Words | Lines | File | mtime |
|---:|---:|---:|---|---|
| 886,775 | 114,406 | 9,399 | `abossard/_ahm-diagrammo/blueprints/2026-07-26-native-drawio-canvas-rebuild.blueprint.md` | 2026-08-13 |
| 680,914 | 80,217 | 2,549 | `abossard/_rgds-rocknix-setup/blueprints/2026-07-26-xcom2-switch-console.blueprint.md` | 2026-08-01 |
| 621,081 | 76,123 | 5,110 | `abossard/_ahm-model-demo/blueprints/2026-09-08-topology-node-edge-redesign.blueprint.md` | 2026-09-09 |
| 364,789 | 43,894 | 1,423 | `RocheIConnect/_infraautomation/blueprints/2026-08-25-iedge-architecture.blueprint.md` | 2026-08-27 |
| 344,345 | 38,847 | 2,191 | `abossard/_can-i-haz-houze/blueprints/2026-09-16-aspire-health-model.blueprint.md` | 2026-09-16 |
| 337,473 | 38,625 | 1,939 | `abossard/_mcp/blueprints/2026-07-24-health-model-query-facilities.blueprint.md` | 2026-07-28 |
| 307,769 | 38,791 | 2,144 | `abossard/_ahm-diagrammo/blueprints/2026-07-24-order-parent-edge-entries.blueprint.md` | 2026-07-27 |
| 295,547 | 37,598 | 3,137 | `hashicorp/_terraform-provider-azurerm/blueprints/2026-07-29-cloudhealth-azurerm-ga-prep.blueprint.md` | 2026-08-11 |
| 247,511 | 30,386 | 2,410 | `abossard/_stop-slop/blueprints/2026-10-09-personal-slopometer-canvas.blueprint.md` | 2026-10-10 |
| 225,365 | 24,597 | 1,116 | `abossard/_qlcplus/blueprints/recording-vc-action-support.md` | 2026-10-08 |

### Typical (median-adjacent) blueprints

| Bytes | Words | Lines | File |
|---:|---:|---:|---|
| 24,792 | 3,219 | 184 | `abossard/_az-cli-prs/blueprints/2026-06-16-dual-register-under-monitor-namespace.blueprint.md` |
| 24,986 | 2,922 | 158 | `abossard/_awesome-foundry-nextgen/blueprints/2026-06-27-agent-health-model.blueprint.md` |
| 25,014 | 3,126 | 184 | `abossard/_az-login-switcher/blueprints/2026-07-20-login-browser-selection.blueprint.md` |

## 4. Section-level anatomy — where the bytes go

### Typical file (24,792 B, `_az-cli-prs/2026-06-16-dual-register-under-monitor-namespace.blueprint.md`)

| Section | Bytes | Share |
|---|---:|---:|
| `## Acceptance criteria` | 7,023 | 28.3% |
| `## Evidence collected` | 6,266 | 25.3% |
| `## Plan summary` | 2,529 | 10.2% |
| `## Decisions made` | 1,425 | 5.7% |
| `## Out of scope` | 1,173 | 4.7% |
| `## Self-challenge` | 1,063 | 4.3% |
| `## Research resolved` | 1,021 | 4.1% |
| `## Test strategy critique` | 942 | 3.8% |
| `## Constraints / non-negotiables` | 703 | 2.8% |
| `## Relevant verified wiki entries` | 674 | 2.7% |
| `## User feedback` | 273 | 1.1% |
| `## Goal` | 369 | 1.5% |
| `## Discovered domain-specific skills and agents` | 241 | 1.0% |
| `## User's original request` | 235 | 0.9% |
| `## Handoff` | 180 | 0.7% |
| `## Discovered during review` | 59 | 0.2% |

At typical size, `Acceptance criteria` + `Evidence collected` together account for **53.6%** of the file; the remaining 11 sections the template requires account for **~30%**. These remaining sections mix substantive planning content — `Decisions made` (1,425 B), `Out of scope` (1,173 B), `Constraints / non-negotiables` (703 B) — with smaller, more narrowly-scoped bookkeeping sections — `Self-challenge`, `Research resolved`, `Test strategy critique`, `Relevant verified wiki entries`, `Discovered domain-specific skills and agents`, `Handoff`, `Discovered during review`, `User feedback` (each under 1.1 KB). The ~30% figure measures the template's required section count on this one sample; it is not a claim that this content is unnecessary or removable — `Decisions made`, `Out of scope`, and `Constraints` in particular are substantive planning content the blueprint skill explicitly asks the author to record (§2 discusses which part of this is template-driven vs. task-driven).

### Largest 5 files — where the size comes from

| File | Total B | Evidence collected | Kept-verbatim/superseded blocks | Fresh-inspection findings (inline logs) | Criteria archive |
|---|---:|---:|---:|---:|---:|
| `2026-07-26-native-drawio-canvas-rebuild.blueprint.md` | 886,775 | 170,565 (19.2%) | 149,850 (16.9%) | 53,242 (6.0%) | 0 (0.0%, never archived) |
| `2026-07-26-xcom2-switch-console.blueprint.md` | 680,914 | 55,226 (8.1%) | 5,272 (0.8%) | 0 | 21,992 (3.2%) |
| `2026-09-08-topology-node-edge-redesign.blueprint.md` | 621,081 | 258,201 (41.6%) | 0 | 0 | 111,738 (18.0%) |
| `2026-08-25-iedge-architecture.blueprint.md` (RocheIConnect) | 364,789 | 50,651 (13.9%) | 0 | 0 | 20,241 (5.5%) |
| `2026-09-16-aspire-health-model.blueprint.md` | 344,345 | 104,740 (30.4%) | 0 | 0 | 9 (~0%) |

**`Evidence collected` is the single largest measured contributor to the largest files' byte totals** — 8–42% of file bytes across all 5 largest documents. This figure is a **byte-count by section heading only**: the span between each file's `## Evidence collected` heading and the next `##` heading was measured, but the content within was not independently sampled at scale in this analysis (one file's `Evidence collected` section was not read in full as part of this investigation; the characterization of its likely contents is inferred from the section's own template definition — "Commands, observed results, and proof references. Link larger artifacts." — not confirmed by direct inspection). Whether this content is substantially raw/duplicative log output, or the structured proof references and linked artifacts the template calls for, is **not established here**; it is reported as the largest measured byte contributor, not as confirmed overhead or confirmed raw-log duplication. This is nonetheless a consistent pattern across all 5 sampled large files (not isolated to one), so it is a reasonable target for direct content sampling in any follow-up investigation.

**Un-pruned "kept verbatim, not archived" superseded criteria blocks** are a severe but isolated pattern: only the single largest file (`2026-07-26-native-drawio-canvas-rebuild.blueprint.md`, last touched 2026-08-13) contains this phrase (confirmed via `grep -rl "kept verbatim, not archived"` across the entire corpus — 1 of 682 files hit). In that file, headings at lines 1146, 1568, 1955, 2315 are literally titled `### Superseded records — correction C-20 (…; kept verbatim, not archived)` etc. Evaluated against the **current contract text** (§0), this is in tension with rule B5 ("Keep only the current correction's new, failed, or invalidated criteria active") and the archive-move instruction's framing ("move its ID, requirement, and proof reference to the criteria archive" — a transition, not a parallel copy): under the current wording's apparent intent, superseded criteria would move to the archive rather than being retained verbatim as still-labeled-active sections. When this pruning discipline is skipped, each correction cycle appends a near-duplicate ~30–51 KB block instead of replacing it: the file's 4 superseded blocks (149,850 B combined) are each roughly the same size as its *current* active-criteria block (33,864 B) — i.e. **≈4.4× duplicated criteria-block content** retained as history. Because no instruction specifies a bounded-read protocol for the phase-entry reads (§0), a reasonable expectation is that a fresh-context phase dispatch against this specific file would, by default, still ingest this duplicated content — but that is the same plausible-not-measured inference as the rest of §0, not a confirmed read count.

*Current contract vs. observed older run:* this file predates the installed plugin snapshot analyzed here (all plugin files share one Oct 7 2026 install timestamp, so no local diff exists between whatever contract wording was active in Jul–Aug 2026 and the current text). What can be established is only the **mismatch**, not its cause: the document's own section titles ("kept verbatim, not archived") show the run that produced it made a deliberate choice to retain history that the *current* archive/lifecycle rules (B5 and the template's authoring comment at `/Users/abossard/.minime/templates/blueprint.template.md:45-46`) would place in the archive instead. Whether an earlier contract revision explicitly permitted this, or the run simply didn't follow the (then-current) rule, cannot be determined without version history — none was found locally (no `CHANGELOG.md`, no `.git` in the installed plugin copy). No other file in the 682-document corpus exhibits this pattern, so it is not representative of how the flow behaves under the current instructions as routinely exercised elsewhere in this corpus.

"Fresh-inspection findings" inline logs (per-correction inspection output embedded in the document, headings like `### Fresh-inspection findings F1–F5 (2026-07-26 12:44, minime:frau, risk tier HIGH)`) are likewise concentrated in that one file — `grep -rl "Fresh-inspection findings"` across the corpus returns exactly 1 file, containing 10 such sections totaling 53,242 B (6.0% of the file).

**Observations, scoped as hypotheses/gaps rather than confirmed costs:**
1. **Consistent pattern, content not independently audited**: "Evidence collected" is the largest single section by byte count in 5/5 sampled large files (8–42% of their bytes) and ~25% even at median size. Whether this represents removable duplication or necessary proof content was not established (see caveat above) — it is flagged as the top candidate for a follow-up content audit, not as confirmed overhead.
2. **Severe but isolated, and contract-inconsistent**: one document (1 of 682) keeps ~4.4× duplicated historical criteria blocks "verbatim, not archived," inflating it to 886 KB — a pattern the current contract's archive/lifecycle wording does not call for and that no other sampled file exhibits.
3. **Template-required section count**: ~30% of one typical-size sample's bytes fall under sections the template requires beyond Goal/Active criteria/Evidence collected (§4); whether this reflects the larger HQ template's shape specifically was confirmed only for that one file, and the current contract text directs normalizing toward the smaller bundled shape (§2) — so the 30%/2.4× figures should be read as what was observed in the sampled files, not as an established cost for every blueprint.

## 5. Token estimates (explicitly labeled — no tokenizer installed)

No tokenizer library was available locally: `tiktoken` (Python) and a Node `tiktoken` package were both absent, and per scope constraints nothing was installed. All token figures below are **estimates** using two generic heuristics, reported side by side so the spread between them is visible. **These two numbers are not a statistical confidence interval or a formal bound on the true token count** — both are rough rule-of-thumb approximations for English/markdown text, neither calibrated against this corpus using an actual tokenizer, and the true count under any specific model's tokenizer could fall outside the range they happen to bracket:

- Heuristic A: chars ÷ 4 (common approximation for English/markdown with BPE tokenizers)
- Heuristic B: words × 1.3

| Scope | Chars | Words | Est. tokens (A: chars/4) | Est. tokens (B: words×1.3) |
|---|---:|---:|---:|---:|
| Whole corpus (682 files) | 27,054,818 | 3,345,112 | ~6,763,704 | ~4,348,646 |
| Mean per file | 39,670 | 4,905 | ~9,917 | ~6,377 |
| Median file | ~24,889 | 3,124 | ~6,222 | ~4,061 |
| Largest file | 886,775 | 114,406 | ~221,694 | ~148,728 |
| Core flow-contract (read once each) | 30,147 | 4,124 | ~7,537 | ~5,361 |

These are corpus-at-rest figures (total bytes/words currently stored), **not** measured token consumption — they give two independent rough approximations of what a single full read of a given document or the instruction set would cost in tokens, under each stated heuristic, not a bound in any statistical sense. Actual consumption depends on how many times each file is read per task (§0–1, where this is scoped as a plausible-not-measured default rather than an established count) and on provider-side caching/compaction behavior, which this investigation deliberately excluded.

## 6. Non-blueprint storage under the same directories (context, not a token cost)

Several canonical `blueprints/` directories contain `evidence/`, `scratch/`, or `.drafts/` subdirectories holding large non-text artifacts — e.g. `abossard/_azure-sdk-for-rust/blueprints/evidence/azure-monitor-cloudhealth-2026-11-01/` contains a full Python toolchain capture (`.py`, `.pyc`, `.so`, `uv`/`slopometer-cache` wheel/package caches, binary wheels). Corpus-wide: **28,495 files, ~849.6 MB**, across the `evidence`/`scratch`/`.drafts`/`<slug>.evidence` subdirectories of the 79 canonical blueprint directories. This is disk, not token, overhead by design — the blueprint contract only stores a path + SHA‑256 hash reference to such artifacts ("Hash artifact bytes with SHA-256… Hash the exact compact raw proof bytes before removing them" — `/Users/abossard/.minime/templates/blueprint.template.md:45-48`), so it should not be read back in full during normal phase dispatch. It is reported here only to distinguish it from the blueprint-document token cost measured in §3–5, and because it shows evidence capture sometimes sweeps in entire dependency/build trees rather than the specific proof artifact.

## 7. Limitations

- No tokenizer was installed or available; all token figures are **rough heuristic estimates** (§5), not a statistical bound and not measurements.
- This investigation did not read session histories, session-store databases, or token-usage telemetry, per the bounded scope — so the number of *actual* phase dispatches, corrections, or re-reads per real task could not be verified against ground truth. §0–1's read-count discussion is scoped accordingly: it identifies which instructions specify (or omit) a bounded-read protocol, and presents full-file-read consequences as a **plausible likely-default outcome of that omission**, not a confirmed or measured read count.
- The correction-queue three-document read (`assets/ORCHESTRATION.md:52`) is conditional on a correction going through that specific formal mechanism with an active worker in flight, not a claim that it fires for every user correction.
- The archive "move" instruction (`assets/ORCHESTRATION.md:65`) is read here as describing a lifecycle transition (active → archived), not a confirmed design of permanent duplicate storage; whether the active copy is actually removed after archiving is not confirmed by any standing (non-authoring-comment) instruction found in this analysis.
- "Evidence collected" byte totals in §3–4 are **section-heading byte spans only**; the content inside was not independently read/sampled at scale, so claims about it being raw/duplicative log output vs. necessary structured proof are explicitly not established — only the byte totals and the pattern's consistency across the 5 largest sampled files are established.
- The HQ-template-vs-bundled-template section-presence comparison (§2, §4) was verified on **one** representative file, not corpus-wide; whether most/all 682 documents carry the larger HQ-only sections is not established.
- "Evidence collected"/"archive" byte breakdowns in §3–4 use regex section-matching against `##`/`###` Markdown headings; headings that don't follow the exact conventions used elsewhere in the corpus could be missed or misattributed. Spot-checked against 5 of the 10 largest files and one median file; not exhaustively verified across all 682 documents.
- Classification of the 68 non-`.blueprint.md`-named files as blueprint documents was done by spot-checking structure (1 file read in full) and corroborated by directory co-location and template-matching headings; a small number could be stale drafts or reports rather than genuine task blueprints.
- One transient scratch file was created and immediately deleted inside `VIRTUCON_HQ` during directory-depth probing (a `find` output redirect used to test write permission before the no-tmp-file constraint was fully internalized). It was removed in the same command sequence; no net content change remains, but it is disclosed here per the "do not change minime files" constraint.
- The recent-cohort cutoff (§3) is a **date-only** string comparison on stored mtime (`mtime[:10] >= "2026-10-08"`) in the host's local timezone (not independently confirmed as a named zone), not a precise rolling 7-day-from-query-time window; an earlier draft of this report used the latter (non-reproducible) definition and has been corrected to the reproducible date-only figures shown.
- Weekly mtime cohorts (§3) are explicitly labeled cross-sectional snapshots, confounded by task-mix (which repos were active which week) and by the fact that a file's mtime reflects only its latest edit — they do not establish per-file growth, causality, or a flow-wide inflation rate. The table covers ISO weeks with at least one file; weeks with zero activity are omitted rather than shown as zero, so the printed sequence has small gaps (e.g., week 24, 36 absent in the full data).

## Artifacts

- This file: `/Users/abossard/.copilot/session-state/686e2c7f-2080-462a-9020-6f391f57edb6/files/minime-flow-source-evidence.md`
- Raw per-file measurements (JSON): `/Users/abossard/.copilot/session-state/686e2c7f-2080-462a-9020-6f391f57edb6/files/blueprint_measurements.json` (classification pass) and `blueprint_combined.json` (final 682-file corpus with bytes/words/lines/chars/mtime per file)
