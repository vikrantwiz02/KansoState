#!/usr/bin/env bash
set -euo pipefail

DENYLIST="${BASH_SOURCE%/*}/../.attribution-denylist"
VIOLATIONS=0

while IFS= read -r pattern; do
  # skip blank lines and comments
  [[ -z "$pattern" || "$pattern" == \#* ]] && continue

  if git diff --cached --unified=0 2>/dev/null | grep -qiF "$pattern"; then
    echo "ATTRIBUTION VIOLATION: forbidden string found in staged diff: '$pattern'" >&2
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < "$DENYLIST"

# also scan full diff if called from CI (no staged diff available)
if [[ "${CI:-}" == "true" ]]; then
  BASE="${BASE_SHA:-HEAD^}"
  while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    if git diff "${BASE}" HEAD --unified=0 2>/dev/null | grep -qiF "$pattern"; then
      echo "ATTRIBUTION VIOLATION: forbidden string found in CI diff: '$pattern'" >&2
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < "$DENYLIST"
fi

if [[ $VIOLATIONS -gt 0 ]]; then
  echo "check-attribution: $VIOLATIONS violation(s) found. Aborting." >&2
  exit 1
fi

echo "check-attribution: clean"
