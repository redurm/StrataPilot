#!/usr/bin/env bash
# rebase a PR branch onto the current origin/main, resolving CHANGELOG conflicts by keeping both
# sides (the changelog is append-only per PR, so a conflict there is never a real disagreement)
set -e
branch="$1"
git fetch -q origin
git checkout -q -B "tmp-$branch" "origin/$branch"
if ! git rebase origin/main >/dev/null 2>&1; then
  for f in $(git diff --name-only --diff-filter=U); do
    case "$f" in
      CHANGELOG.md) python .resolve_changelog.py "$f" ;;
      *) echo "CONFLICT in $f - needs a human"; git rebase --abort; exit 2 ;;
    esac
  done
  git add -A
  git -c core.editor=true rebase --continue >/dev/null
fi
node --check main.js
git push -q -f origin "HEAD:$branch" 2>&1 | grep -v "^remote:\|warning:" || true
echo "rebased $branch onto $(git rev-parse --short origin/main)"
