#!/usr/bin/env bash
# Validate that a triage agent actually did its job on an issue: applied
# exactly one triage label and posted at least one comment. Wraps the GitHub
# CLI; needs GH_TOKEN with issues: read.
#
# Usage:
#   validate-triage.sh --repo owner/repo --issue N [options]
#
# Options:
#   --repo <owner/repo>     Repository (required)
#   --issue <number>        Issue number (required)
#   --labels <a,b,c>        Allowed triage labels (default: fix,feature,idea)
#   --expect-label <name>   Assert this exact label was applied (for tests)
#   --author <login>        Assert the comment author (default: github-actions)
#   --allow-unlabeled       Pass when no triage label but a comment exists
#                           (the agent's "unclear, ask a human" path)
#
# Exits 0 when the post-conditions hold, 1 with a reason otherwise. A green
# agent run is not proof of work — a model can exit successfully having done
# nothing; this script checks the side effects.
set -euo pipefail

repo="" issue="" expect_label="" author="github-actions"
allowed="fix,feature,idea" allow_unlabeled=false

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --issue) issue="$2"; shift 2 ;;
    --labels) allowed="$2"; shift 2 ;;
    --expect-label) expect_label="$2"; shift 2 ;;
    --author) author="$2"; shift 2 ;;
    --allow-unlabeled) allow_unlabeled=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$repo" ] || [ -z "$issue" ]; then
  echo "usage: validate-triage.sh --repo owner/repo --issue N" >&2
  exit 2
fi

fail() { echo "FAIL: $*" >&2; exit 1; }

data=$(gh issue view "$issue" --repo "$repo" --json labels,comments) ||
  fail "could not read issue #$issue in $repo"

# Triage labels present on the issue, one per line.
triage_labels=$(printf '%s' "$data" | jq -r --arg allowed "$allowed" '
  ($allowed | split(",")) as $ok
  | [.labels[].name | select(. as $l | $ok | index($l))] | .[]')
label_count=$(printf '%s' "$triage_labels" | grep -c . || true)

# Comments from the expected author with non-empty bodies.
comment_count=$(printf '%s' "$data" | jq -r --arg author "$author" '
  [.comments[] | select(.author.login == $author and (.body | length > 0))]
  | length')

echo "issue #$issue in $repo: triage labels [$(printf '%s' "$triage_labels" | paste -sd, -)], $comment_count comment(s) by $author"

[ "$comment_count" -ge 1 ] || fail "no comment by $author on issue #$issue"

if [ -n "$expect_label" ]; then
  [ "$label_count" -eq 1 ] || fail "expected exactly one triage label, found $label_count"
  [ "$triage_labels" = "$expect_label" ] || fail "expected label '$expect_label', found '$triage_labels'"
elif [ "$label_count" -eq 0 ]; then
  $allow_unlabeled || fail "no triage label applied (pass --allow-unlabeled to accept the unclear-issue path)"
elif [ "$label_count" -gt 1 ]; then
  fail "more than one triage label applied: $(printf '%s' "$triage_labels" | paste -sd, -)"
fi

echo "OK: triage post-conditions hold for issue #$issue"
