---
name: init-orchestration
description: Bootstrap minime user-home state only (no repository writes). Creates task template and wiki files under MINIME_HOME (defaults to $HOME/.minime) for plugin-only operation.
when_to_use: First-time setup of the minime flow. Run once per machine/profile. Idempotent — safe to re-run.
disable-model-invocation: true
allowed-tools: Bash(git remote get-url *) Bash(cp *) Bash(mkdir *) Bash(ls *) Bash(test *) Bash(sed *) Bash(cat *)
---

# Skill: init-orchestration

Bootstrap minime in plugin-only mode.

Run this once after installing the plugin. It initializes state under
`MINIME_HOME` (defaults to `$HOME/.minime`). It does **not** create, modify, or stage files in the
current working repository.

## What gets created in user home

```
MINIME_HOME/templates/task.template.md   (per-task EARS task brief template)
MINIME_HOME/_TEMPLATE.md                 (wiki entry template)
MINIME_HOME/<org>/wiki.md                (org-level wiki)
MINIME_HOME/<org>/_<repo>/wiki.md        (repo wiki, created for current repo when detectable)
MINIME_HOME/<org>/_<repo>/tasks/         (persisted living task briefs)
```

## Bootstrap

```!
set -e
PLUGIN_ROOT="${CLAUDE_SKILL_DIR}/../.."
ASSETS="$PLUGIN_ROOT/assets"
MINIME_HOME="${MINIME_HOME:-$HOME/.minime}"

ORIGIN=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$ORIGIN" ]; then
  ORG=""
  REPO=""
  echo "NOTE: no git remote 'origin' set. Repo-specific wiki will be created on first run inside a git repo."
else
  REPO_PATH=$(echo "$ORIGIN" \
    | sed -E 's#^.*github\.com[:/]##; s#^.*gitlab\.com[:/]##; s#^.*bitbucket\.org[:/]##; s#\.git$##')
  ORG=$(echo "$REPO_PATH" | cut -d/ -f1)
  REPO=$(echo "$REPO_PATH" | cut -d/ -f2)
  [ -z "$ORG" ] && ORG="local"
  [ -z "$REPO" ] && REPO="$ORG" && ORG="local"
  echo "Org: $ORG  Repo: $REPO  (from $ORIGIN)"
fi

mkdir -p "$MINIME_HOME/templates"

copy_if_missing() {
  src="$1"; dst="$2"
  if [ -e "$dst" ]; then
    echo "skip   $dst (exists)"
  else
    cp "$src" "$dst"
    echo "wrote  $dst"
  fi
}

copy_if_missing "$ASSETS/task.template.md"         "$MINIME_HOME/templates/task.template.md"
copy_if_missing "$ASSETS/.agent/wiki/_TEMPLATE.md" "$MINIME_HOME/_TEMPLATE.md"

if [ -n "$ORG" ] && [ -n "$REPO" ]; then
  mkdir -p "$MINIME_HOME/$ORG/_$REPO/tasks"

  REPO_WIKI="$MINIME_HOME/$ORG/_$REPO/wiki.md"
  ORG_WIKI="$MINIME_HOME/$ORG/wiki.md"

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
echo "Initialized plugin-only minime state in $MINIME_HOME"
echo "No files were written to the working repository."
```

## After running

1. Create `task.md` from `MINIME_HOME/templates/task.template.md` (or your own format with EARS-style criteria).
2. Start the workflow with `/minime:plan`.
