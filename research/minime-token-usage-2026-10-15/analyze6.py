import json, collections, datetime
with open("/Users/abossard/.copilot/session-state/686e2c7f-2080-462a-9020-6f391f57edb6/files/blueprint_combined.json") as f:
    combined = json.load(f)

by_week = collections.Counter()
bytes_by_week = collections.Counter()
for r in combined:
    d = datetime.date.fromisoformat(r["mtime"][:10])
    wk = d.isocalendar()[:2]
    by_week[wk]+=1
    bytes_by_week[wk]+=r["bytes"]

for wk in sorted(by_week):
    print(wk, "count=",by_week[wk], "bytes=",bytes_by_week[wk])
