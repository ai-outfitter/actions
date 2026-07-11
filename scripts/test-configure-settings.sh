#!/usr/bin/env bash
# Test the "Configure Outfitter settings" step of action.yml against a
# temporary HOME/workspace. Extracts the step's run script from action.yml
# (so the test can't drift from the shipped action) and asserts the
# settings.yml it writes — in particular that path-kind profile-sources are
# always written as absolute paths: settings.yml lives in $HOME, so a
# relative path would be resolved against the wrong root by outfitter.
#
# Usage: scripts/test-configure-settings.sh
# Exits 0 when all cases pass, 1 with the failing case otherwise.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
action_yml="$repo_root/action.yml"

# Extract the run script of the "Configure Outfitter settings" step:
# from the step's `run: |` line, take the 8-space-indented block and dedent.
step_script="$(awk '
  /^    - name: Configure Outfitter settings$/ { in_step = 1 }
  in_step && /^      run: \|/ { in_run = 1; next }
  in_run {
    if ($0 == "") { print ""; next }
    if ($0 !~ /^        /) exit
    print substr($0, 9)
  }
' "$action_yml")"
[ -n "$step_script" ] || { echo "FAIL: could not extract step script from action.yml" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Stub `outfitter` so the sync call for remote sources is a no-op.
mkdir -p "$tmp/bin"
printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/outfitter"
chmod +x "$tmp/bin/outfitter"

failures=0

# run_step <cwd> <profile-source> [ref]
# Runs the extracted step with a fresh $HOME and the shared workspace,
# leaving the generated settings in $settings.
run_step() {
  local cwd="$1" source="$2" ref="${3:-}"
  rm -rf "$tmp/home"
  mkdir -p "$tmp/home"
  settings="$tmp/home/.outfitter/settings.yml"
  (
    cd "$cwd"
    HOME="$tmp/home" \
    PATH="$tmp/bin:$PATH" \
    GITHUB_WORKSPACE="$tmp/workspace" \
    OUTFITTER_PROFILE=test-profile \
    OUTFITTER_AGENT=pi \
    PROFILE_SOURCE="$source" \
    PROFILE_SOURCE_REF="$ref" \
    bash -euo pipefail -c "$step_script"
  )
}

assert_source_line() {
  local case_name="$1" expected="$2"
  local actual
  actual="$(grep -A1 '^profile_sources:' "$settings" | tail -n1)"
  if [ "$actual" = "$expected" ]; then
    echo "ok: $case_name"
  else
    echo "FAIL: $case_name" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    failures=$((failures + 1))
  fi
}

mkdir -p "$tmp/workspace/profiles" "$tmp/elsewhere"
workspace_real="$(cd "$tmp/workspace" && pwd -P)"

# 1. Relative path that exists in the step's cwd (the workspace) must be
#    written absolute — the original bug wrote the bare "profiles".
run_step "$tmp/workspace" "profiles"
assert_source_line "relative path, cwd == workspace" "  - path: $workspace_real/profiles"

# 2. Relative path that only exists under $GITHUB_WORKSPACE.
run_step "$tmp/elsewhere" "profiles"
assert_source_line "relative path, resolved via workspace" "  - path: $workspace_real/profiles"

# 3. Absolute path passes through (normalized).
run_step "$tmp/elsewhere" "$tmp/workspace/profiles"
assert_source_line "absolute path" "  - path: $workspace_real/profiles"

# 4. owner/repo shorthand -> github, with ref on the following line.
run_step "$tmp/workspace" "my-org/catalog" "v1.2.0"
assert_source_line "github shorthand" "  - github: my-org/catalog"
grep -q '^    ref: v1.2.0$' "$settings" || {
  echo "FAIL: github shorthand: missing ref line" >&2
  failures=$((failures + 1))
}

# 5. Git URI -> uri.
run_step "$tmp/workspace" "https://example.com/catalog.git"
assert_source_line "git uri" "  - uri: https://example.com/catalog.git"

# 6. A nonexistent bare name must fail the step.
if run_step "$tmp/workspace" "does-not-exist" 2>/dev/null; then
  echo "FAIL: nonexistent bare source should exit non-zero" >&2
  failures=$((failures + 1))
else
  echo "ok: nonexistent bare source rejected"
fi

# 7. No profile-source -> no profile_sources block.
run_step "$tmp/workspace" ""
if grep -q '^profile_sources:' "$settings"; then
  echo "FAIL: empty source should not write profile_sources" >&2
  failures=$((failures + 1))
else
  echo "ok: empty source omits profile_sources"
fi

if [ "$failures" -gt 0 ]; then
  echo "FAIL: $failures case(s) failed" >&2
  exit 1
fi
echo "OK: all configure-settings cases pass"
