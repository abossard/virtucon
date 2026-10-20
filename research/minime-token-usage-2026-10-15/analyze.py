import os, json, re, datetime

ROOT = "/Users/abossard/.minime"
out = {"canonical_dirs": [], "files": [], "non_blueprint_files": [], "dirs_with_subdirs": []}

canonical_dirs = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    # identify canonical blueprints dirs: path like ROOT/<org>/_<repo>/blueprints with no further "blueprints" ancestor
    rel = os.path.relpath(dirpath, ROOT)
    parts = rel.split(os.sep)
    if len(parts) == 3 and parts[2] == "blueprints" and parts[1].startswith("_"):
        canonical_dirs.append(dirpath)

canonical_dirs.sort()
print("Canonical blueprint dirs:", len(canonical_dirs))

blueprint_re = re.compile(r'^\d{4}-\d{2}-\d{2}-.+\.blueprint\.md$')

all_files = []
subdir_names = set()
for d in canonical_dirs:
    for sub in sorted(os.listdir(d)):
        full = os.path.join(d, sub)
        if os.path.isdir(full):
            subdir_names.add(sub)

print("Subdir names found inside blueprints dirs:", subdir_names)
