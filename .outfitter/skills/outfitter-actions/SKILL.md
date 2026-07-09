---
name: outfitter-actions
description: Apply the ai-outfitter/actions design pattern of few profiles, many skills, structured trigger context, and progressive disclosure.
---

# Outfitter Actions

Use this skill when designing, reviewing, or extending GitHub Actions workflows
that launch agents through `ai-outfitter/actions`.

## Design pattern

The scalable pattern is:

1. Keep profiles few and stable.
2. Put task-specific behavior in skills.
3. Pass exact GitHub trigger data into the prompt as `trigger_context`.
4. Let the profile's system prompt activate the relevant skill.
5. Fetch untrusted issue, PR, deployment, or page content only after a skill is
   selected.

## Why

Profiles are identity and policy:

- shared operating rules
- project or organization conventions
- safety and prompt-injection posture
- common tools
- write boundaries

Skills are capability:

- issue planning
- implementation handoff
- KPI reports
- deployment review
- failed-deploy triage
- Slack/report summaries

GitHub Actions are trigger plumbing:

- `on:` events
- checkout
- least-privilege `permissions:`
- secrets
- a single `ai-outfitter/actions` invocation
- a compact `trigger_context` payload

## Progressive disclosure

Skills matter because they keep the active run small. The profile should carry
the shared contract and short activation rules. A selected skill should carry
the detailed workflow instructions.

Progressive disclosure is not only context management. It is also the mechanism
that lets one Outfitter profile and one reusable GitHub Actions workflow be
defined once, then route internally to many different skills and situations.
The workflow can stay generic: pass `trigger_context`, call the same profile,
and let the profile choose whether this run is issue planning, implementation,
KPI reporting, deployment review, or something added later.

Do not load every possible workflow path into the system prompt up front. A KPI
report run does not need deployment review instructions. A failed deployment
investigation does not need issue-planning rules. An issue planning run does
not need weekly report mechanics.

## Trigger context guidance

Prefer stable metadata in the initial prompt:

- `repository`
- `workflow`
- `run_id`
- `event_name`
- `event_action`
- `schedule`
- `ref_name`
- `sha`
- `issue_number`
- `issue_labels`
- `assignee`
- `deployment_status`
- `environment_url`
- explicit behavior hints such as `report_kind`

Avoid interpolating untrusted bodies into the launch prompt:

- issue body
- PR body
- comments
- deployment logs
- fetched page content

Pass identifiers, then fetch full content with tools after the skill activates.
