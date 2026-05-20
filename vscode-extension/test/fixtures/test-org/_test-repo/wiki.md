# test-org/test-repo -- Corrections Wiki

---

### Always use parameterized queries
- **Rule:** Never concatenate user input into SQL strings. Use parameterized queries for all database access.
- **Trigger:** Any task touching database queries or ORM usage.
- **Evidence:** `src/db/queries.ts:22` (parameterized query helper)
- **Origin:** human-correction
- **ValueScore:** 8
- **Confidence:** high
- **Status:** active
- **LastVerified:** 2026-05-01

---

### Cache API responses for 5 minutes
- **Rule:** All external API responses should be cached with a 5-minute TTL to reduce latency and rate limit usage.
- **Trigger:** Adding or modifying external API calls.
- **Evidence:** `src/cache/apiCache.ts:15` (cache wrapper)
- **Origin:** observation
- **ValueScore:** 5
- **Confidence:** medium
- **Status:** active
- **LastVerified:** 2026-04-20
