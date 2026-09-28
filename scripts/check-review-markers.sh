#!/usr/bin/env bash
# Fails if the diff against BASE adds lines that cite review findings
# ("Code-Review, Befund S3", "Sicherheitsreview 2026-08 …") instead of
# explaining the code as it is now. Where a rule came from belongs in the
# commit message; `git log -S` finds it. Existing lines are not checked, so
# the remaining backlog (docs/todo.md) does not block unrelated changes.
#
# Usage: scripts/check-review-markers.sh [BASE]
#   BASE defaults to the merge base with origin/main.
set -euo pipefail

BASE="${1:-$(git merge-base HEAD origin/main)}"
PATTERN='(Code|Sicherheits|Selbst)-?[Rr]eview|Security[- ][Rr]eview|Befund [A-Z]{0,2}[0-9]'

HITS=$(git diff -U0 --no-color "$BASE" HEAD -- . \
    ':(exclude)docs' \
    ':(exclude)*.md' \
    ':(exclude)scripts/check-review-markers.sh' \
  | awk -v pat="$PATTERN" '
      /^\+\+\+ / { file = substr($0, 7); next }
      /^@@/      { split($3, a, ","); line = substr(a[1], 2); next }
      /^\+/      { if (substr($0, 2) ~ pat) printf "%s:%d: %s\n", file, line, substr($0, 2); line++ }
    ')

if [ -n "$HITS" ]; then
  echo "$HITS"
  echo "::error::Neue Verweise auf Review-Befunde in Kommentaren gefunden (siehe oben). Den Kommentar so formulieren, dass er die heute gültige Regel erklärt; die Herkunft gehört in die Commit-Message."
  exit 1
fi
echo "Keine neuen Review-Verweise."
