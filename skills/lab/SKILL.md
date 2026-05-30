---
name: lab
description: Bootstrap minime user-home state only (no repository writes). Creates blueprint templates plus repo and org raw/wiki/schema roots under VIRTUCON_HQ.
when_to_use: First-time setup of the minime flow. Run once per machine or profile. Idempotent. Safe to re-run.
disable-model-invocation: true
allowed-tools: Bash(git remote get-url *) Bash(cp *) Bash(mkdir *) Bash(ls *) Bash(test *) Bash(cat *) Bash(printf *) Bash(perl *) Bash(cut *) Bash(echo *)
---

# Skill: lab

Bootstrap minime in plugin-only mode. The session-start hook already auto-bootstraps this state, so use this skill mainly to force or verify bootstrap.

## What gets created in user home

```
VIRTUCON_HQ/templates/blueprint.template.md
VIRTUCON_HQ/_TEMPLATE.md
VIRTUCON_HQ/<org>/raw/
VIRTUCON_HQ/<org>/wiki/index.md
VIRTUCON_HQ/<org>/wiki/log.md
VIRTUCON_HQ/<org>/schema.md
VIRTUCON_HQ/<org>/_<repo>/raw/
VIRTUCON_HQ/<org>/_<repo>/wiki/index.md
VIRTUCON_HQ/<org>/_<repo>/wiki/log.md
VIRTUCON_HQ/<org>/_<repo>/schema.md
VIRTUCON_HQ/<org>/_<repo>/blueprints/
```

If a legacy `wiki.md` already exists at the org or repo root, bootstrap copies it to `raw/legacy-wiki.md` once.

## Bootstrap

```!
set -e
PLUGIN_ROOT="${CLAUDE_SKILL_DIR}/../.."
ASSETS="$PLUGIN_ROOT/assets"
VIRTUCON_HQ="${VIRTUCON_HQ:-$HOME/.minime}"

ORIGIN=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$ORIGIN" ]; then
  ORG=""
  REPO=""
  echo "NOTE: no git remote 'origin' set. Repo-specific knowledge roots will be created on first run inside a git repo."
else
  REPO_PATH=$(printf '%s' "$ORIGIN" \
    | perl -pe 's{^https?://([^.]+)\.visualstudio\.com/.+/_git/(.+)$}{$1/$2}; s{^https?://dev\.azure\.com/([^/]+)/.+/_git/(.+)$}{$1/$2}; s{^git@ssh\.dev\.azure\.com:v3/([^/]+)/[^/]+/(.+)$}{$1/$2}; s{^.*github\.com[:/]}{}; s{^.*gitlab\.com[:/]}{}; s{^.*bitbucket\.org[:/]}{}; s{\.git$}{}')
  ORG=$(printf '%s' "$REPO_PATH" | cut -d/ -f1)
  REPO=$(printf '%s' "$REPO_PATH" | cut -d/ -f2)
  [ -z "$ORG" ] && ORG="local"
  [ -z "$REPO" ] && REPO="$ORG" && ORG="local"
fi

mkdir -p "$VIRTUCON_HQ/templates"

copy_if_missing() {
  src="$1"
  dst="$2"
  if [ -e "$dst" ]; then
    echo "skip   $dst (exists)"
  else
    cp "$src" "$dst"
    echo "wrote  $dst"
  fi
}

seed_legacy() {
  root="$1"
  if [ -f "$root/wiki.md" ] && [ ! -e "$root/raw/legacy-wiki.md" ]; then
    cp "$root/wiki.md" "$root/raw/legacy-wiki.md"
    echo "seeded $root/raw/legacy-wiki.md"
  fi
}

ensure_root() {
  root="$1"
  label="$2"
  mkdir -p "$root/raw" "$root/wiki"

  if [ ! -e "$root/schema.md" ]; then
    cat > "$root/schema.md" <<EOF_SCHEMA
# Wiki schema: $label

This root uses raw/, wiki/, and schema.md.
raw/ holds immutable source documents.
wiki/ holds index.md, log.md, and topic pages.
Do not store logs or large outputs in raw/.
EOF_SCHEMA
    echo "wrote  $root/schema.md"
  else
    echo "skip   $root/schema.md (exists)"
  fi

  if [ ! -e "$root/wiki/index.md" ]; then
    cat > "$root/wiki/index.md" <<EOF_INDEX
# Wiki index: $label

Track topic pages and their raw sources here.
EOF_INDEX
    echo "wrote  $root/wiki/index.md"
  else
    echo "skip   $root/wiki/index.md (exists)"
  fi

  if [ ! -e "$root/wiki/log.md" ]; then
    cat > "$root/wiki/log.md" <<EOF_LOG
# Wiki log: $label

Track dated ingest, query, and lint updates here.
EOF_LOG
    echo "wrote  $root/wiki/log.md"
  else
    echo "skip   $root/wiki/log.md (exists)"
  fi

  seed_legacy "$root"
}

copy_if_missing "$ASSETS/blueprint.template.md" "$VIRTUCON_HQ/templates/blueprint.template.md"
copy_if_missing "$ASSETS/.agent/wiki/_TEMPLATE.md" "$VIRTUCON_HQ/_TEMPLATE.md"

if [ -n "$ORG" ] && [ -n "$REPO" ]; then
  ensure_root "$VIRTUCON_HQ/$ORG" "$ORG"
  ensure_root "$VIRTUCON_HQ/$ORG/_$REPO" "$ORG/$REPO"
  mkdir -p "$VIRTUCON_HQ/$ORG/_$REPO/blueprints"
fi

echo

echo "Initialized plugin-only minime state in $VIRTUCON_HQ"
echo "No files were written to the working repository."
```
