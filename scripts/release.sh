#!/usr/bin/env bash
set -euo pipefail

# Cut a new release. Bumps version in package.json, runs tests, commits,
# tags, and pushes. The Release workflow on GitHub builds the binaries,
# creates the GitHub release, and updates the homebrew-tap formula.
#
# Usage:
#   ./scripts/release.sh                # patch bump
#   ./scripts/release.sh patch|minor|major
#   ./scripts/release.sh 1.8.0          # explicit version
#   ./scripts/release.sh --dry-run [bump]

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
BUMP="patch"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    patch|minor|major) BUMP="$arg" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$arg" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}

CURRENT="$(bun --print "require('./package.json').version")"

if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEXT="$BUMP"
else
  IFS=. read -r MAJ MIN PAT <<<"$CURRENT"
  case "$BUMP" in
    major) NEXT="$((MAJ + 1)).0.0" ;;
    minor) NEXT="${MAJ}.$((MIN + 1)).0" ;;
    patch) NEXT="${MAJ}.${MIN}.$((PAT + 1))" ;;
  esac
fi

TAG="v${NEXT}"

echo "current : ${CURRENT}"
echo "next    : ${NEXT}  (${TAG})"

fail() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "WARN: $*" >&2
  else
    echo "$*" >&2
    exit 1
  fi
}

if git rev-parse "$TAG" >/dev/null 2>&1; then
  fail "tag $TAG already exists"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  fail "must release from main (currently on $BRANCH)"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  fail "working tree is dirty — commit or stash first"
fi

run git pull --ff-only

echo "running tests..."
run bun test

# Update package.json version in place. Match the line so we don't disturb other "version" keys.
if [[ $DRY_RUN -eq 0 ]]; then
  bun --print "
    const fs = require('fs');
    const p = require('./package.json');
    p.version = '${NEXT}';
    fs.writeFileSync('./package.json', JSON.stringify(p, null, 2) + '\n');
    'wrote package.json'
  " >/dev/null
fi
echo "bumped package.json -> ${NEXT}"

run git add package.json
run git commit -m "chore: bump version to ${NEXT}"
run git tag -a "$TAG" -m "Release ${TAG}"
run git push origin main
run git push origin "$TAG"

echo
echo "pushed ${TAG}. The Release workflow will build binaries, create the GitHub release, and update homebrew-tap."
if command -v gh >/dev/null 2>&1 && [[ $DRY_RUN -eq 0 ]]; then
  echo "watch with: gh run watch"
fi
