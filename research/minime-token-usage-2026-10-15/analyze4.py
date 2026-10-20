import json, re, statistics

with open("/Users/abossard/.copilot/session-state/686e2c7f-2080-462a-9020-6f391f57edb6/files/blueprint_combined.json") as f:
    combined = json.load(f)

total_chars = sum(r["chars"] for r in combined)
total_words = sum(r["words"] for r in combined)
print("Total chars:", total_chars, "Total words:", total_words)
print("EST tokens (chars/4):", round(total_chars/4))
print("EST tokens (words*1.3):", round(total_words*1.3))
print("Mean per-file EST tokens (chars/4):", round(total_chars/4/len(combined)))
print("Median file EST tokens (chars/4), from median bytes~24889/4:", round(24889/4))

# correction-cycle & archive-size analysis on full text for a sample of docs incl largest + a few mid-size
import os
sample_paths = [r["path"] for r in sorted(combined, key=lambda r:-r["bytes"])[:6]]
sample_paths += [r["path"] for r in combined if "recording-vc-action-support" in r["path"]]
sample_paths += [r["path"] for r in combined if 24700 < r["bytes"] < 25100][:3]

corr_re = re.compile(r'^### Correction\b', re.M)
archive_table_re = re.compile(r'^## Criteria archive\n(.*?)(?=^## )', re.S | re.M)
active_crit_re = re.compile(r'^- \[[ x]\] `C\d+-\d+`', re.M)

print("\n=== Per-file correction-cycle / archive growth signals ===")
for p in sample_paths:
    with open(p, errors='replace') as f:
        text = f.read()
    n_corrections = len(corr_re.findall(text))
    m = archive_table_re.search(text)
    archive_block = m.group(1) if m else ""
    archive_rows = len(re.findall(r'^\| `?C\d+', archive_block, re.M)) or len(re.findall(r'^\|\s*C\d+', archive_block, re.M))
    archive_bytes = len(archive_block.encode('utf-8'))
    active_rows = len(active_crit_re.findall(text))
    total_bytes = len(text.encode('utf-8'))
    pct_archive = archive_bytes/total_bytes*100 if total_bytes else 0
    print(f"{os.path.basename(p):65s} total={total_bytes:>7}B corrections={n_corrections:>2} archive_rows~{archive_rows:>3} archive_bytes={archive_bytes:>7}B ({pct_archive:4.1f}%) active_checkboxes={active_rows}")
