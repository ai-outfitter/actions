# Agentic workflow design pattern

The scalable pattern for `ai-outfitter/actions` is **few profiles, many skills,
and exact trigger context passed into the prompt**.

It is tempting to create a new Outfitter profile every time a repository gets a
new automation: one profile for issue triage, one for scheduled KPI reports, one
for deployment review, one for failed-deploy investigation, one for release
notes, and so on. That is clear for the first few workflows, but it does not
scale. Most of those runs are not different agent identities. They are the same
agent seeing different GitHub trigger facts.

Use profiles for stable identity and policy:

- shared operating rules
- repository or organization conventions
- safety and prompt-injection posture
- permissions and write boundaries
- common tools and skills

Use skills for task-specific capability:

- issue or PR triage
- scheduled reports
- commit or path review
- release notes
- deployment smoke tests
- persona review
- failed-deploy investigation
- Slack or issue summary posting

Use the workflow prompt to pass exact trigger data from GitHub Actions into the
agent run:

- event name and action
- schedule string
- ref, branch, and SHA
- push `before` / `after` range
- issue or PR number
- label name
- deployment status and environment URL
- release tag
- report period or other explicit operator intent

The profile's system prompt can then inspect that structured `trigger_context`
and activate the relevant skill or behavior.

## Why this stays DRY

The GitHub Actions job should be thin trigger plumbing. It owns:

- `on:` triggers
- checkout
- least-privilege `permissions:`
- secrets
- the `ai-outfitter/actions` invocation
- a compact prompt payload with GitHub context

The Outfitter profile should own the agent's shared behavior. A new workflow
should usually add either:

- a new skill under the same profile, or
- a new trigger condition for an existing skill.

That keeps new agentic workflows from creating a matching explosion of profiles,
prompt variants, and near-duplicate GitHub Actions jobs.

## Progressive disclosure is the point of skills

Skills make this pattern more effective than a giant system prompt with every
possible workflow path loaded up front.

The profile can carry the shared contract and a short activation rule:

> If `trigger_context.event_name` is `issues`, `event_action` is `labeled`, and
> `issue_label` is `idea`, use the idea-triage skill.

Only after that match does the agent need the idea-triage instructions. A KPI
report run should not spend context on deployment review rules. A failed
deployment investigation should not load weekly report instructions. A persona
review should not start with issue-triage checklists.

That progressive disclosure keeps each run focused:

- fewer irrelevant instructions in context
- less policy drift across profile variants
- less chance that unrelated workflow guidance competes with the active task
- easier review, because shared policy lives in one profile and specific
  behavior lives in named skills

In short: profiles define the agent, skills define capabilities, and trigger
context tells the agent which capability to open.

## Keep untrusted content out of the initial prompt

The `trigger_context` block should contain routing metadata, not attacker-
controlled content. Do not interpolate issue bodies, PR descriptions, comments,
or deployment logs directly into `prompt:`.

Instead, pass stable identifiers:

- issue number
- PR number
- commit SHA
- deployment ID or environment URL
- release tag

Then instruct the skill to fetch the full content with `gh` and treat it as
untrusted data. This preserves the useful routing signal without turning
attacker-controlled text into part of the launch prompt.

## Example activation rules

A single profile might describe activation rules like this in its system prompt:

```text
You will receive a trigger_context block in the user prompt. Treat it as
routing metadata.

Use the idea-triage skill when:
- event_name is issues
- event_action is labeled
- issue_label is idea

Use the KPI report skill when:
- event_name is schedule
- report_kind is kpi_activity

Use the deployment-review skill when:
- event_name is deployment_status
- deployment_status is success
- environment_url is present

Use the failed-deploy-investigation skill when:
- event_name is deployment_status
- deployment_status is failure

If no rule matches, stop and report that the trigger context does not match a
supported agentic workflow.
```

Those rules can live in the profile's prompt. The detailed instructions can live
in skills so they are loaded only when relevant.

## Workflow implications

Prefer this shape:

1. Keep one durable profile for a class of related repository automation.
2. Add skills for specific capabilities.
3. Pass a normalized `trigger_context` block in the workflow prompt.
4. Let the profile activate the relevant skill from that context.

Avoid this shape:

1. One profile per trigger.
2. One prompt per trigger.
3. One largely duplicated workflow per agent behavior.
4. Shared safety policy copied across every variant.

The first shape scales with capabilities. The second shape scales with
duplication.
