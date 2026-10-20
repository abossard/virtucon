import json, statistics, datetime

with open("/Users/abossard/.copilot/session-state/686e2c7f-2080-462a-9020-6f391f57edb6/files/blueprint_measurements.json") as f:
    data = json.load(f)

bf = data["blueprint_files"]
other = data["other_top_files"]

# Reclassify: other .md files that are clearly blueprint-shaped docs (not .txt manifests)
other_md = [r for r in other if r["name"].endswith(".md")]
other_nonmd = [r for r in other if not r["name"].endswith(".md")]
print("Other .md (non-conforming name) count:", len(other_md), "bytes:", sum(r["bytes"] for r in other_md))
print("Other non-.md (manifests etc, excluded) count:", len(other_nonmd), [r["name"] for r in other_nonmd])

def wc(path):
    with open(path, errors='replace') as f:
        text = f.read()
    return len(text.split()), text.count("\n")+1, len(text)

for r in other_md:
    w,l,c = wc(r["path"])
    r["words"]=w; r["lines"]=l; r["chars"]=c

combined = bf + other_md  # all files we classify as "blueprint documents" (conforming + non-conforming naming)
combined.sort(key=lambda r: r["bytes"])

def pct(lst, p):
    k = (len(lst)-1) * p
    f = int(k)
    c = min(f+1, len(lst)-1)
    if f == c: return lst[f]
    return lst[f] + (lst[c]-lst[f])*(k-f)

sizes = [r["bytes"] for r in combined]
words = [r["words"] for r in combined]
lines = [r["lines"] for r in combined]

print("\n=== COMBINED BLUEPRINT DOCUMENT CORPUS ===")
print("count:", len(combined))
print("total bytes:", sum(sizes), " total words:", sum(words), " total lines:", sum(lines))
print("mean bytes:", statistics.mean(sizes), "median bytes:", statistics.median(sizes))
print("p90 bytes:", pct(sizes,0.90), "p99 bytes:", pct(sizes,0.99), "max bytes:", max(sizes))
print("mean words:", statistics.mean(words), "median words:", statistics.median(words))
print("max words:", max(words))

# histogram buckets by KB
buckets = [0,2,5,10,20,50,100,200,99999]
labels = ["0-2KB","2-5KB","5-10KB","10-20KB","20-50KB","50-100KB","100-200KB","200KB+"]
counts = [0]*len(labels)
for s in sizes:
    kb = s/1024
    for i in range(len(buckets)-1):
        if buckets[i] <= kb < buckets[i+1]:
            counts[i]+=1
            break
for l,c in zip(labels,counts):
    print(f"  {l}: {c}")

# Top 15 largest
print("\n=== TOP 15 LARGEST ===")
for r in sorted(combined, key=lambda r:-r["bytes"])[:15]:
    print(f"  {r['bytes']:>8} bytes  {r['words']:>6} words  {r['lines']:>5} lines  {r['org_repo']}/{r['name']}  mtime={r['mtime'][:10]}")

# median/typical examples (3 around median)
med_idx = len(combined)//2
print("\n=== MEDIAN-ADJACENT (typical) ===")
for r in combined[med_idx-1:med_idx+2]:
    print(f"  {r['bytes']:>8} bytes  {r['words']:>6} words  {r['lines']:>5} lines  {r['org_repo']}/{r['name']}  mtime={r['mtime'][:10]}")

# smallest 5
print("\n=== SMALLEST 5 ===")
for r in combined[:5]:
    print(f"  {r['bytes']:>8} bytes  {r['words']:>6} words  {r['org_repo']}/{r['name']}")

# date distribution
dates = [r["mtime"][:10] for r in combined]
import collections
by_date = collections.Counter(dates)
all_dates_sorted = sorted(by_date.items())
print("\n=== earliest date, latest date ===")
print(all_dates_sorted[0], all_dates_sorted[-1])

# last 7 days vs all
now = datetime.datetime.now()
cutoff = now - datetime.timedelta(days=7)
recent = [r for r in combined if datetime.datetime.fromisoformat(r["mtime"]) >= cutoff]
print(f"\n=== RECENT 7 DAYS (mtime >= {cutoff.date()}) vs ALL ===")
print("recent count:", len(recent), "  all count:", len(combined))
print("recent bytes:", sum(r['bytes'] for r in recent), "  all bytes:", sum(sizes))
print("recent words:", sum(r['words'] for r in recent), "  all words:", sum(words))
if recent:
    print("recent mean bytes:", statistics.mean([r['bytes'] for r in recent]))
    print("recent max bytes:", max(r['bytes'] for r in recent), [r['org_repo']+'/'+r['name'] for r in recent if r['bytes']==max(r['bytes'] for r in recent)])

# per-repo totals top 10
by_repo = collections.defaultdict(lambda: {"count":0,"bytes":0})
for r in combined:
    by_repo[r["org_repo"]]["count"] += 1
    by_repo[r["org_repo"]]["bytes"] += r["bytes"]
print("\n=== TOP 10 REPOS BY TOTAL BLUEPRINT BYTES ===")
for repo, v in sorted(by_repo.items(), key=lambda kv: -kv[1]["bytes"])[:10]:
    print(f"  {repo}: {v['count']} files, {v['bytes']} bytes")

with open("/Users/abossard/.copilot/session-state/686e2c7f-2080-462a-9020-6f391f57edb6/files/blueprint_combined.json","w") as f:
    json.dump(combined, f, indent=2)
