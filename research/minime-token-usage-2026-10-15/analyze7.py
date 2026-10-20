import json, datetime

with open("/Users/abossard/.copilot/session-state/686e2c7f-2080-462a-9020-6f391f57edb6/files/blueprint_combined.json") as f:
    combined = json.load(f)

# Reproduce the original (now() - 7 days) cutoff logic as it would have run at the time analyze3.py
# was executed. We don't have the exact wall-clock timestamp logged, so bound it from the data itself:
# find the minimal mtime that is >= cutoff among the 47-file result, and the maximal mtime just below it.
sorted_m = sorted(combined, key=lambda r: r["mtime"])
# date-only cutoff per user's check
cutoff_date_only = "2026-10-08"
recent_date_only = [r for r in combined if r["mtime"][:10] >= cutoff_date_only]
print("Date-only mtime>=2026-10-08 (midnight local, naive string compare):")
print(" count:", len(recent_date_only), " bytes:", sum(r["bytes"] for r in recent_date_only))

# Try to bound the exact timestamp cutoff that yields 47 files / 2,403,576 bytes
candidates = sorted(set(r["mtime"] for r in combined))
# find boundary between 53-file and 47-file windows: look at files with date 2026-10-08
oct8 = [r for r in combined if r["mtime"][:10] == "2026-10-08"]
oct8_sorted = sorted(oct8, key=lambda r: r["mtime"])
print("\nFiles with mtime date == 2026-10-08 (sorted by exact mtime):")
for r in oct8_sorted:
    print(" ", r["mtime"], r["bytes"], r["org_repo"]+"/"+r["name"])

print("\n=== Corrected recent cohort: mtime date-string >= '2026-10-08' (date-only cutoff) ===")
recent = [r for r in combined if r["mtime"][:10] >= "2026-10-08"]
print("count:", len(recent))
print("bytes:", sum(r["bytes"] for r in recent))
print("words:", sum(r["words"] for r in recent))
print("mean bytes/file:", sum(r["bytes"] for r in recent)/len(recent))
print("max bytes:", max(r["bytes"] for r in recent), [r["org_repo"]+"/"+r["name"] for r in recent if r["bytes"]==max(rr["bytes"] for rr in recent)])

total_bytes = sum(r["bytes"] for r in combined)
total_words = sum(r["words"] for r in combined)
print("\nshare of all-time bytes:", sum(r["bytes"] for r in recent)/total_bytes*100)
print("share of all-time words:", sum(r["words"] for r in recent)/total_words*100)
print("share of all-time count:", len(recent)/len(combined)*100)
print("all-time mean bytes/file:", total_bytes/len(combined))
