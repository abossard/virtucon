import os, json, re, datetime, subprocess

ROOT = "/Users/abossard/.minime"
blueprint_re = re.compile(r'^\d{4}-\d{2}-\d{2}-.+\.blueprint\.md$')

canonical_dirs = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    rel = os.path.relpath(dirpath, ROOT)
    parts = rel.split(os.sep)
    if len(parts) == 3 and parts[2] == "blueprints" and parts[1].startswith("_"):
        canonical_dirs.append(dirpath)
canonical_dirs.sort()

blueprint_files = []   # classified as real task blueprints
other_top_files = []   # other files directly inside blueprints/ not matching naming convention
evidence_tree = []     # files inside evidence/scratch/.drafts/*.evidence subdirs

for d in canonical_dirs:
    org_repo = os.path.relpath(d, ROOT).rsplit("/blueprints",1)[0]
    for entry in sorted(os.listdir(d)):
        full = os.path.join(d, entry)
        if os.path.isfile(full):
            st = os.stat(full)
            rec = {
                "org_repo": org_repo,
                "path": full,
                "name": entry,
                "bytes": st.st_size,
                "mtime": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(),
            }
            if blueprint_re.match(entry):
                blueprint_files.append(rec)
            else:
                other_top_files.append(rec)
        elif os.path.isdir(full):
            # walk subtree, record aggregate + per-file
            for dp, dns, fns in os.walk(full):
                for fn in fns:
                    fp = os.path.join(dp, fn)
                    try:
                        st = os.stat(fp)
                    except OSError:
                        continue
                    evidence_tree.append({
                        "org_repo": org_repo,
                        "subdir": entry,
                        "path": fp,
                        "bytes": st.st_size,
                        "mtime": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(),
                    })

print("=== Classification summary ===")
print("Canonical blueprint dirs:", len(canonical_dirs))
print("Blueprint docs (matching <date>-<slug>.blueprint.md):", len(blueprint_files))
print("Other top-level files in blueprints/ (non-conforming name):", len(other_top_files))
for r in other_top_files:
    print("  OTHER:", r["path"], r["bytes"], "bytes")
print("Evidence/scratch/.drafts subtree files:", len(evidence_tree))
print("Evidence/scratch total bytes:", sum(e["bytes"] for e in evidence_tree))

# word/line counts for blueprint docs
def wc(path):
    with open(path, 'r', errors='replace') as f:
        text = f.read()
    words = len(text.split())
    lines = text.count("\n") + (0 if text.endswith("\n") or text=="" else 1)
    return words, lines, len(text)

for r in blueprint_files:
    words, lines, chars = wc(r["path"])
    r["words"] = words
    r["lines"] = lines
    r["chars"] = chars

with open("/Users/abossard/.copilot/session-state/686e2c7f-2080-462a-9020-6f391f57edb6/files/blueprint_measurements.json", "w") as f:
    json.dump({
        "canonical_dirs": canonical_dirs,
        "blueprint_files": blueprint_files,
        "other_top_files": other_top_files,
        "evidence_tree_summary": {
            "count": len(evidence_tree),
            "total_bytes": sum(e["bytes"] for e in evidence_tree),
            "by_org_repo": {}
        },
        "evidence_tree_files": evidence_tree,
    }, f, indent=2)

print("Wrote JSON artifact.")
print("Total blueprint bytes:", sum(r["bytes"] for r in blueprint_files))
print("Total blueprint words:", sum(r["words"] for r in blueprint_files))
print("Total blueprint lines:", sum(r["lines"] for r in blueprint_files))
