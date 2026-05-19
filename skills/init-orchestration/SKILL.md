---
description: Bootstrap the minime orchestration files into the current repository. Copies ORCHESTRATION.md, spec.template.md, CLAUDE.md, .github/copilot-instructions.md, the wiki template (renamed to <org>__<repo>.md), and the research references. Stages the new files; does not commit.
when_to_use: First-time setup of the minime flow in a repository. Run once per repo. Idempotent — safe to re-run.
disable-model-invocation: true
allowed-tools: Bash(git remote get-url *) Bash(git add *) Bash(git status) Bash(cp *) Bash(mkdir *) Bash(ls *) Bash(test *) Bash(sed *)
---

# Skill: init-orchestration

Bootstrap the minime flow into the current repository.

Run this once after installing the plugin. It copies the per-repo asset files into the repo root, derives the per-repo wiki filename from `git remote get-url origin`, and stages everything. It does **not** commit — review the diff and commit yourself.

## What gets created in the target repo

```
ORCHESTRATION.md                       (workflow overview)
spec.template.md                       (per-task spec template)
CLAUDE.md                              (one-line pointer for Claude Code)
.github/copilot-instructions.md        (one-line pointer for Copilot)
.agent/wiki/_TEMPLATE.md               (wiki entry template)
.agent/wiki/<org>__<repo>.md           (your corrections wiki, empty)
.agent/research/REFERENCES.md          (empirical basis for the flow)
```

## Bootstrap

```!
set -e
PLUGIN_ROOT="${CLAUDE_SKILL_DIR}/../.."
ASSETS="$PLUGIN_ROOT/assets"

if [ ! -d .git ]; then
  echo "ERROR: not a git repository. cd to your repo root first." >&2
  exit 1
fi

ORIGIN=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$ORIGIN" ]; then
  SLUG="local__$(basename "$PWD")"
  echo "NOTE: no git remote 'origin' set. Using slug '$SLUG'. Rename .agent/wiki/$SLUG.md later if you add a remote."
else
  SLUG=$(echo "$ORIGIN" \
    | sed -E 's#^.*github\.com[:/]##; s#^.*gitlab\.com[:/]##; s#^.*bitbucket\.org[:/]##; s#\.git$##' \
    | sed -E 's#/#__#g')
  echo "Repo slug: $SLUG  (from $ORIGIN)"
fi

mkdir -p .agent/wiki .agent/research .github

copy_if_missing() {
  src="$1"; dst="$2"
  if [ -e "$dst" ]; then
    echo "skip   $dst (exists)"
  else
    cp "$src" "$dst"
    echo "wrote  $dst"
  fi
}

copy_if_missing "$ASSETS/ORCHESTRATION.md"                  "ORCHESTRATION.md"
copy_if_missing "$ASSETS/spec.template.md"                  "spec.template.md"
copy_if_missing "$ASSETS/CLAUDE.md"                         "CLAUDE.md"
copy_if_missing "$ASSETS/.github/copilot-instructions.md"   ".github/copilot-instructions.md"
copy_if_missing "$ASSETS/.agent/wiki/_TEMPLATE.md"          ".agent/wiki/_TEMPLATE.md"
copy_if_missing "$ASSETS/.agent/research/REFERENCES.md"     ".agent/research/REFERENCES.md"
copy_if_missing "$ASSETS/.agent/wiki/_TEMPLATE.md"          ".agent/wiki/$SLUG.md"

git add ORCHESTRATION.md spec.template.md CLAUDE.md \
        .github/copilot-instructions.md \
        .agent/wiki/_TEMPLATE.md ".agent/wiki/$SLUG.md" \
        .agent/research/REFERENCES.md 2>/dev/null || true

echo
echo "Staged. Review with: git diff --cached"
echo "Then commit with:   git commit -m 'Adopt minime agent orchestration'"
```

## After running

1. Review `git diff --cached`, then commit when satisfied.
2. Open `ORCHESTRATION.md` for a one-page overview of the flow.
3. For your first task: copy `spec.template.md` to `spec.md`, fill it in, then invoke `/minime:plan`.
