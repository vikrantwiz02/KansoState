#!/usr/bin/env bash
set -euo pipefail

DENYLIST="${BASH_SOURCE%/*}/../.attribution-denylist"
VIOLATIONS=0

# Pre-commit hook: scan staged diff
if git diff --cached --unified=0 2>/dev/null | grep -qiF ""; then
  while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    if git diff --cached --unified=0 2>/dev/null | grep -qiF "$pattern"; then
      echo "ATTRIBUTION VIOLATION: forbidden string in staged diff: '$pattern'" >&2
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < "$DENYLIST"
fi

# CI: scan diff between base and HEAD
if [[ "${CI:-}" == "true" ]]; then
  BASE="${BASE_SHA:-}"

  # If BASE_SHA is empty (first push, force push, etc.) fall back to HEAD~1.
  # If the repo only has one commit, skip the diff entirely.
  if [[ -z "$BASE" ]]; then
    if git rev-parse HEAD~1 >/dev/null 2>&1; then
      BASE="HEAD~1"
    else
      echo "check-attribution: single-commit repo, skipping CI diff check"
      echo "check-attribution: clean"
      exit 0
    fi
  fi

  while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    if git diff "${BASE}" HEAD --unified=0 2>/dev/null | grep -qiF "$pattern"; then
      echo "ATTRIBUTION VIOLATION: forbidden string in CI diff: '$pattern'" >&2
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < "$DENYLIST"
fi

if [[ $VIOLATIONS -gt 0 ]]; then
  echo "check-attribution: $VIOLATIONS violation(s) found. Aborting." >&2
  exit 1
fi

echo "check-attribution: clean"
