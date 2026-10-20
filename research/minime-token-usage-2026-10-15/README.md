# Minime token-usage research handoff

Research completed **2026-10-15**. Exported **2026-10-16** without rerunning the analysis or changing the source artifacts. This folder contains findings and provenance, not an implementation.

## Read first

- [minime-flow-source-evidence.md](minime-flow-source-evidence.md): final corrected source audit, citations, corpus methodology, document examples, and limitations. Its opening scope statement applies to that source-only audit, not the separate session-usage measurements below.
- [minime-token-measurements.json](minime-token-measurements.json): verified session costs, token counts, sample details, observed pricing, and caveats.
- [blueprint_combined.json](blueprint_combined.json): final 682-document corpus measurements.
- [blueprint_measurements.json](blueprint_measurements.json): initial measurements, retained for provenance. Use the final combined corpus and corrected audit for conclusions.
- Provenance scripts, copied unchanged and **not executed during export**: [analyze.py](analyze.py), [analyze2.py](analyze2.py), [analyze3.py](analyze3.py), [analyze4.py](analyze4.py), [analyze5.py](analyze5.py), [analyze6.py](analyze6.py), [analyze7.py](analyze7.py).

## Completed findings

| Measure | Finding |
| --- | --- |
| Blueprint corpus | 682 documents across 79 repository blueprint directories, totaling 27.1 MB (27,132,321 bytes). |
| Document size | Median 24.9 KB (about 6.2k estimated tokens), P90 about 83 KB, maximum 887 KB (about 222k estimated tokens). |
| Four bounded inspections | 96-176 AIU per run, median 136 AIU; 16-46 calls and 174-235k noncached input tokens per run. Parent coordination and separately launched reviewers are additional. |
| Caching across those four runs | About 95% of input tokens were cache reads. Cost was approximately 39% cache writes, 32% output, and 29% cache reads. Cached input is not free, and input-token share is not cost share. |
| One multi-day reused inspector | 673 calls, maximum request context about 818k input tokens, and 11,648 AIU. This was an extended correction/verification conversation, not a representative single inspection. |
| Higher-tier premium in that reused session | About 45% of recorded AIU was the premium relative to pricing the same tokens at observed base-tier rates. This is a pricing counterfactual, not guaranteed achievable savings from rotating inspectors. |
| Inline evidence | Evidence sections occupied about 25% of one near-median document and 8-42% of the five largest documents. Those sections are not all removable logs. |

**Units:** document-token sizes are `chars / 4` approximations, not measured tokenizer counts. Session-usage token counts are measured through internal `session_store_sql` local `assistant_usage_events`. AIU is `sum(total_nano_aiu) / 1e9`, **not dollars**. Cloud `session_usage.cost` is a different aggregate and is not equivalent to these AIU figures. Noncached input is input minus cache-read tokens, not necessarily unique text.

## Priorities

1. Enforce a bounded inspector lifetime per revision, avoiding multi-day inspector reuse.
2. Externalize proof/history and prune accepted inline evidence while retaining reachable proof references and substantive requirements.
3. Make the selective read packet explicit: goal, constraints, active correction, affected archived requirements, and current diff.
4. Coalesce handoffs and redundant review without removing deliberately requested independent review.
5. Shrink the template last. Template size alone is not established as the dominant cost.

## Contract corrections and limits

- The current contract already asks for fresh, bounded verification. The long-lived inspector example does not establish that this reuse is required by the contract.
- "Read the blueprint" does not mandate reading every byte. The identified gap is an explicit selective-read protocol, not a prohibition on partial reads.
- Archive "move" is a lifecycle transition, not designed permanent duplication. Evidence accumulation can reflect lifecycle drift; it is not proof that permanent mirroring is intended.
- Some users explicitly requested the strongest or opposing-model reviewers. Not all separate review is redundant.
- The session sample is purposive and small, not a random sample or a measure of all Minime work. Parent integration work can be useful; its whole cost cannot be labeled avoidable overhead.
- No controlled baseline exists for the same tasks without Minime. These observations do not establish causal overhead or guaranteed savings.

## Provenance

- Original artifact directory: `/Users/abossard/.copilot/session-state/686e2c7f-2080-462a-9020-6f391f57edb6/files/`.
- Source audit: local installed Minime plugin and persisted blueprint documents under `VIRTUCON_HQ=/Users/abossard/.minime`. Exact source paths, line citations, snapshot/version details, and limits are preserved in the bundled audit.
- Usage measurements: recorded local session usage and turns for the sample period **2026-10-08 through 2026-10-15**, as documented in the measurements JSON.
- All 11 bundled source artifacts are byte-for-byte copies. Original absolute paths inside them remain evidence references; they were not rewritten and need not exist to read this handoff.
