# Inference pricing and rate limits for CI agent runs

Research notes for choosing and budgeting the model behind an Outfitter CI
agent (issue triage, PR review). Figures collected **July 2026**; GitHub
marks all of these "subject to change without notice" — treat this file as a
snapshot with sources, not a contract.

## The two cost regimes

**1. GitHub Models included tier — $0 per run.** With `models: read` on the
workflow `GITHUB_TOKEN`, inference is free. You don't pay in dollars; you pay
in **rate limits**, and for agentic workloads the limits are the binding
constraint (see below). GitHub Actions minutes are free on public repos;
private repos pay standard runner rates (~$0.008/min Linux — a triage run is
~1 minute).

**2. GitHub Models paid usage / your own provider key.** Per-token billing,
either through GitHub Models' paid opt-in or directly against the provider
(e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` as step `env:`). Paid usage also
lifts the included-tier rate limits.

## Included-tier rate limits (the real constraint)

From [GitHub Models rate limits](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models#rate-limits),
per Copilot plan:

| Tier | Req/min | Req/day | Tokens per request | Concurrent |
| --- | --- | --- | --- | --- |
| Low (Free/Pro/Business) | 15 | 150 (Free/Pro), 300 (Business) | 8k in / 4k out | 5 |
| Low (Enterprise) | 20 | 450 | 8k in / 8k out | 8 |
| High (Free/Pro/Business) | 10 | 50 (Free/Pro), 100 (Business) | 8k in / 4k out | 2 |
| High (Enterprise) | 15 | 150 | 16k in / 8k out | 4 |

Frontier models (o-series, **gpt-5**, DeepSeek-R1, Grok) carry stricter
per-model quotas on top, and some are unavailable on the Copilot Free plan.

### What we measured in anger (July 2026, this org's plan)

- **`openai/gpt-5` cannot complete a triage run.** Every attempt 429'd
  mid-loop — including a single serial run after a 5-minute cooldown. The
  pattern was consistent: the first 1–2 requests succeed (the agent reads and
  labels the issue), then the loop's next request within seconds hits
  `429 Too many requests` before the comment is posted. An agentic loop's
  burst profile (several sequential requests, growing context) is exactly
  what the frontier-tier per-minute quota disallows.
- **`openai/gpt-5-mini` fails differently: upstream 500s.** Trivial direct
  probes (simple and tool-call) return 200 in ~2s, but three consecutive
  real runs died with `500 server_error` ~110 seconds into pi's first
  request (large system prompt + tool schemas + reasoning mode). Before a
  `reasoning: false` control could be evaluated, the model's ~50/day
  included quota was exhausted — a one-line probe 429'd while gpt-4.1-mini
  answered 200 at the same moment. Even when it worked, that quota funds at
  most ~10 agentic runs/day.
- **`openai/gpt-4.1-mini` survives the loop.** The only model tested with a
  clean end-to-end record (label + comment + validation green) on the
  included tier, and its "low" tier quota (150/day) is 3× the frontier
  models'.
- Three **concurrent** runs 429 even for mid-tier models — issue-storm
  scenarios (bulk import, bot-opened issues) will shed runs. The workflow's
  side-effect validation step turns those into loud failures rather than
  silent no-ops.

**Rule of thumb: on the included tier, pick the model by rate tier first,
capability second.** A model that 429s or 500s mid-run has negative
capability. And validate with a complete run's side effects — every failing
model here answered a trivial first probe just fine.

## Per-token prices

### GitHub Models paid usage

From [Costs for GitHub Models](https://docs.github.com/en/billing/reference/costs-for-github-models)
(per 1M tokens; multipliers are against GitHub's token-unit SKU):

| Model | Input | Cached input | Output |
| --- | --- | --- | --- |
| GPT-4.1 | $2.00 | $0.50 | $8.00 |
| GPT-4.1-mini | $0.40 | $0.10 | $1.60 |
| GPT-4o | $2.50 | $1.25 | $10.00 |
| GPT-4o-mini | $0.15 | $0.08 | $0.60 |
| DeepSeek-V3-0324 | $1.14 | — | $4.56 |
| DeepSeek-R1 | $1.35 | — | $5.40 |
| Llama-3.3-70B | $0.71 | — | $0.71 |

The gpt-5 family was **not yet listed** in GitHub's public costs table when
this was written. OpenAI-direct list prices for reference
([source](https://developers.openai.com/api/docs/pricing), July 2026):
gpt-5 $1.25 in / $10.00 out; **gpt-5-mini $0.25 in / $2.00 out**;
note OpenAI has since introduced 5.4/5.5-family successors, so re-check
before budgeting.

## What a triage run costs

Estimated token profile of one issue-triage run (measured workflow, ~4–6
model requests: system prompt + CONTRIBUTING.md ≈ 2–3k tokens resent each
request with growing tool context):

- Input: ~15–25k tokens cumulative
- Output: ~1–2k tokens

| Scenario | Cost per run | 1,000 issues/mo |
| --- | --- | --- |
| Included tier (`models: read`) | $0 | $0 (if under 150 req/day) |
| gpt-5-mini, paid | ~$0.01 | ~$10 |
| gpt-4.1-mini, GitHub paid | ~$0.01 | ~$13 |
| gpt-4.1, GitHub paid | ~$0.06 | ~$65 |
| gpt-5, paid (if it could finish) | ~$0.04 | ~$45 |

Even fully paid, a triage-class agent is cents; the reason to stay on the
included tier is key management, not money. The calculus flips for PR-review
agents reading large diffs (10× the input tokens) or high-volume repos that
blow through the daily request caps.

## Sources

- [GitHub Models rate limits](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models#rate-limits)
- [GitHub Models billing concepts](https://docs.github.com/en/billing/concepts/product-billing/github-models)
- [Costs for GitHub Models](https://docs.github.com/en/billing/reference/costs-for-github-models)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- Observed 429 behavior: ncrmro/outfitter-default-profiles runs
  [28897134611](https://github.com/ncrmro/outfitter-default-profiles/actions/runs/28897134611),
  [28897268652](https://github.com/ncrmro/outfitter-default-profiles/actions/runs/28897268652),
  [28897736743](https://github.com/ncrmro/outfitter-default-profiles/actions/runs/28897736743)
