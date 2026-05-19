---
description: Bootstrap minime user-home state only (no repository writes). Creates task template and wiki files under $HOME/.minime for plugin-only operation.
when_to_use: First-time setup of the minime flow. Run once per machine/profile. Idempotent — safe to re-run.
disable-model-invocation: true
allowed-tools: Bash(git remote get-url *) Bash(cp *) Bash(mkdir *) Bash(ls *) Bash(test *) Bash(sed *) Bash(cat *)
---

# Skill: init-orchestration

Bootstrap minime in plugin-only mode.

Run this once after installing the plugin. It initializes state under
`$HOME/.minime` only. It does **not** create, modify, or stage files in the
current working repository.

## What gets created in user home

```
$HOME/.minime/templates/task.template.md   (per-task EARS task brief template)
$HOME/.minime/tasks/                       (persisted living task briefs, organized by repo)
$HOME/.minime/wiki/_TEMPLATE.md            (wiki entry template)
$HOME/.minime/wiki/repos/<org>__<repo>.md  (repo wiki, created for current repo when detectable)
$HOME/.minime/wiki/orgs/<org>.md           (org-level wiki)
```

## Bootstrap

```!
set -e
PLUGIN_ROOT="${CLAUDE_SKILL_DIR}/../.."
ASSETS="$PLUGIN_ROOT/assets"
WIKI_HOME="${MINIME_WIKI_HOME:-$HOME/.minime/wiki}"
MINIME_HOME="${MINIME_HOME:-$HOME/.minime}"

ORIGIN=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$ORIGIN" ]; then
  SLUG=""
  echo "NOTE: no git remote 'origin' set. Repo-specific wiki will be created on first run inside a git repo."
else
  SLUG=$(echo "$ORIGIN" \
    | sed -E 's#^.*github\.com[:/]##; s#^.*gitlab\.com[:/]##; s#^.*bitbucket\.org[:/]##; s#\.git$##' \
    | sed -E 's#/#__#g')
  echo "Repo slug: $SLUG  (from $ORIGIN)"
fi

mkdir -p "$MINIME_HOME/templates"
mkdir -p "$MINIME_HOME/tasks"
mkdir -p "$WIKI_HOME/repos" "$WIKI_HOME/orgs"

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
copy_if_missing "$ASSETS/.agent/wiki/_TEMPLATE.md" "$WIKI_HOME/_TEMPLATE.md"

if [ -n "$SLUG" ]; then
  REPO_WIKI="$WIKI_HOME/repos/$SLUG.md"
  ORG="${SLUG%%__*}"
  [ "$ORG" = "$SLUG" ] && ORG="local"
  ORG_WIKI="$WIKI_HOME/orgs/$ORG.md"

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
Use the same entry structure as .agent/wiki/_TEMPLATE.md.
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

1. Create `task.md` from `$HOME/.minime/templates/task.template.md` (or your own format with EARS-style criteria).
2. Start the workflow with `/minime:plan`.
