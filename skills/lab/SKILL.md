---
name: lab
description: Bootstrap minime user-home state only (no repository writes). Creates blueprint templates plus global raw/wiki/schema roots and repo blueprint dirs under VIRTUCON_HQ.
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
VIRTUCON_HQ/raw/<org>/<repo>/
VIRTUCON_HQ/wiki/index.md
VIRTUCON_HQ/wiki/log.md
VIRTUCON_HQ/wiki/orgs/<org>/<repo>/
VIRTUCON_HQ/wiki/patterns/
VIRTUCON_HQ/schema.md
VIRTUCON_HQ/<org>/_<repo>/blueprints/
```

If a legacy `wiki.md` already exists at the repo root, bootstrap copies it to `raw/<org>/<repo>/legacy-wiki.md` once.

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
  repo_root="$1"
  repo_raw="$2"
  if [ -f "$repo_root/wiki.md" ] && [ ! -e "$repo_raw/legacy-wiki.md" ]; then
    cp "$repo_root/wiki.md" "$repo_raw/legacy-wiki.md"
    echo "seeded $repo_raw/legacy-wiki.md"
  fi
}

ensure_global_root() {
  mkdir -p "$VIRTUCON_HQ/raw" "$VIRTUCON_HQ/wiki/orgs" "$VIRTUCON_HQ/wiki/patterns"

  if [ ! -e "$VIRTUCON_HQ/schema.md" ]; then
    cat > "$VIRTUCON_HQ/schema.md" <<EOF_SCHEMA
# Wiki schema: global

This root uses raw/, wiki/, and schema.md.
raw/ holds immutable source documents under raw/<org>/<repo>/.
wiki/ holds index.md, log.md, repo pages in wiki/orgs/<org>/<repo>/, and shared patterns in wiki/patterns/.
Do not store logs or large outputs in raw/.
EOF_SCHEMA
    echo "wrote  $VIRTUCON_HQ/schema.md"
  else
    echo "skip   $VIRTUCON_HQ/schema.md (exists)"
  fi

  if [ ! -e "$VIRTUCON_HQ/wiki/index.md" ]; then
    cat > "$VIRTUCON_HQ/wiki/index.md" <<EOF_INDEX
# Wiki index: global

Track topic pages and their raw sources here.
EOF_INDEX
    echo "wrote  $VIRTUCON_HQ/wiki/index.md"
  else
    echo "skip   $VIRTUCON_HQ/wiki/index.md (exists)"
  fi

  if [ ! -e "$VIRTUCON_HQ/wiki/log.md" ]; then
    cat > "$VIRTUCON_HQ/wiki/log.md" <<EOF_LOG
# Wiki log: global

Track dated ingest, query, and lint updates here.
EOF_LOG
    echo "wrote  $VIRTUCON_HQ/wiki/log.md"
  else
    echo "skip   $VIRTUCON_HQ/wiki/log.md (exists)"
  fi
}

copy_if_missing "$ASSETS/blueprint.template.md" "$VIRTUCON_HQ/templates/blueprint.template.md"
copy_if_missing "$ASSETS/.agent/wiki/_TEMPLATE.md" "$VIRTUCON_HQ/_TEMPLATE.md"
ensure_global_root

if [ -n "$ORG" ] && [ -n "$REPO" ]; then
  repo_root="$VIRTUCON_HQ/$ORG/_$REPO"
  repo_raw="$VIRTUCON_HQ/raw/$ORG/$REPO"
  repo_wiki="$VIRTUCON_HQ/wiki/orgs/$ORG/$REPO"
  mkdir -p "$repo_root/blueprints" "$repo_raw" "$repo_wiki"
  seed_legacy "$repo_root" "$repo_raw"
fi

echo

echo "Initialized plugin-only minime state in $VIRTUCON_HQ"
echo "No files were written to the working repository."
```
