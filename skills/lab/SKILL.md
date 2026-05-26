---
name: lab
description: Bootstrap minime user-home state only (no repository writes). Creates blueprint template and wiki files under VIRTUCON_HQ (defaults to $HOME/.minime) for plugin-only operation.
when_to_use: First-time setup of the minime flow. Run once per machine/profile. Idempotent. Safe to re-run.
disable-model-invocation: true
allowed-tools: Bash(git remote get-url *) Bash(cp *) Bash(mkdir *) Bash(ls *) Bash(test *) Bash(sed *) Bash(cat *)
---

# Skill: lab

Bootstrap minime in plugin-only mode. The session-start hook now auto-bootstraps on every session, so this skill is rarely needed manually. Use it to force a re-bootstrap or verify state.

## What gets created in user home

```
VIRTUCON_HQ/templates/blueprint.template.md   (per-task EARS blueprint template)
VIRTUCON_HQ/_TEMPLATE.md                 (wiki entry template)
VIRTUCON_HQ/<org>/wiki.md                (org-level wiki)
VIRTUCON_HQ/<org>/_<repo>/wiki.md        (repo wiki)
VIRTUCON_HQ/<org>/_<repo>/blueprints/    (persisted living blueprints)
```

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
  echo "NOTE: no git remote 'origin' set. Repo-specific wiki will be created on first run inside a git repo."
else
  REPO_PATH=$(echo "$ORIGIN" \
    | sed -E 's#^https?://([^.]+)\.visualstudio\.com/.+/_git/(.+)$#\1/\2#; s#^https?://dev\.azure\.com/([^/]+)/.+/_git/(.+)$#\1/\2#; s#^git@ssh\.dev\.azure\.com:v3/([^/]+)/[^/]+/(.+)$#\1/\2#; s#^.*github\.com[:/]##; s#^.*gitlab\.com[:/]##; s#^.*bitbucket\.org[:/]##; s#\.git$##')
  ORG=$(echo "$REPO_PATH" | cut -d/ -f1)
  REPO=$(echo "$REPO_PATH" | cut -d/ -f2)
  [ -z "$ORG" ] && ORG="local"
  [ -z "$REPO" ] && REPO="$ORG" && ORG="local"
  echo "Org: $ORG  Repo: $REPO  (from $ORIGIN)"
fi

mkdir -p "$VIRTUCON_HQ/templates"

copy_if_missing() {
  src="$1"; dst="$2"
  if [ -e "$dst" ]; then
    echo "skip   $dst (exists)"
  else
    cp "$src" "$dst"
    echo "wrote  $dst"
  fi
}

copy_if_missing "$ASSETS/blueprint.template.md"         "$VIRTUCON_HQ/templates/blueprint.template.md"
copy_if_missing "$ASSETS/.agent/wiki/_TEMPLATE.md" "$VIRTUCON_HQ/_TEMPLATE.md"

if [ -n "$ORG" ] && [ -n "$REPO" ]; then
  mkdir -p "$VIRTUCON_HQ/$ORG/_$REPO/blueprints"

  REPO_WIKI="$VIRTUCON_HQ/$ORG/_$REPO/wiki.md"
  ORG_WIKI="$VIRTUCON_HQ/$ORG/wiki.md"

  if [ ! -e "$REPO_WIKI" ]; then
    cp "$ASSETS/.agent/wiki/_TEMPLATE.md" "$REPO_WIKI"
    echo "wrote  $REPO_WIKI"
  else
    echo "skip   $REPO_WIKI (exists)"
  fi

  if [ ! -e "$ORG_WIKI" ]; then
    cat > "$ORG_WIKI" <<EOF
# Org wiki: $ORG

Shared cross-repo lessons for org "$ORG".
Use the same entry structure as _TEMPLATE.md.
EOF
    echo "wrote  $ORG_WIKI"
  else
    echo "skip   $ORG_WIKI (exists)"
  fi
fi

echo
echo "Initialized plugin-only minime state in $VIRTUCON_HQ"
echo "No files were written to the working repository."
```
