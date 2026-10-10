# Inference through the Outfitter gateway

With `inference: outfitter` (the action's default), a workflow runs its agent
without any model-provider secret. The job proves who it is with its GitHub
Actions OIDC identity, and the Outfitter inference gateway authorizes and
meters the run against the Outfitter organization connected to the
repository's owner.

## Setup

1. Give the job `permissions: id-token: write`. Without it the runner exposes
   no ID-token endpoint and the action fails before the agent starts.
2. Set `inference-gateway` to your Outfitter deployment's workspace gateway
   URL (the origin only; the action appends `/inference/v1/chat/completions`).
3. Add an `outfitter` provider to the catalog's `models.json`, pointing at the
   relay, and select its models from the agent with `model: outfitter/<id>`:

   ```json
   {
     "providers": {
       "outfitter": {
         "baseUrl": "http://127.0.0.1:4141/v1",
         "api": "openai-completions",
         "apiKey": "$OUTFITTER_INFERENCE_TOKEN",
         "models": [{ "id": "GLM-5.3-Flash-EXL3" }]
       }
     }
   }
   ```

4. Remove provider keys from the step's `env:`. They are not needed.

## How it works

The "Start inference relay" step runs `scripts/inference-relay.mjs` (Node,
no dependencies) in the background on `127.0.0.1:4141`, waits for its
`/health` endpoint, and exports:

| Variable | Value |
| --- | --- |
| `OUTFITTER_INFERENCE_TOKEN` | `relay`, a placeholder API key for the provider entry |
| `OUTFITTER_INFERENCE_BASE_URL` | `http://127.0.0.1:4141/v1` |
| `INFERENCE_RELAY_PID` | The relay's process ID, used to stop it after the run |

For each `POST /v1/chat/completions` the relay:

1. Mints an ID token from the runner's endpoint
   (`ACTIONS_ID_TOKEN_REQUEST_URL`) with audience `outfitter-inference`, or
   reuses its cached token while that token has more than 60 seconds left.
   GitHub issues these tokens with a lifetime of a few minutes, so long runs
   re-mint as they go.
2. Forwards the request to `<inference-gateway>/inference/v1/chat/completions`
   with `Authorization: Bearer <ID token>`, replacing the placeholder key.
3. Streams the response back unchanged. If the agent disconnects, the
   upstream request is cancelled.

Any other path answers 404. The relay listens on loopback only and never logs
tokens. The ID token is held in the relay's memory, and the agent step runs
with `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`
withheld, so a prompt-injected agent can neither read the token nor mint one of
its own for this or any other audience. It can still spend inference through
the relay for the length of the job, as it could with a provider key.

The final "Stop inference relay" step runs even when the agent fails, and
stops the relay.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `this job cannot request an ID token` | The job lacks `permissions: id-token: write`. A job-level `permissions:` block replaces the workflow-level one, so add it where the job's permissions are declared. |
| `the relay did not become healthy` | The relay could not start. The step prints its log; port 4141 being taken on a self-hosted runner is the usual cause. |
| The agent gets 503 `Inference identity unavailable` | The relay could not mint an ID token. The relay log (`$RUNNER_TEMP/inference-relay.log`) shows the endpoint's status code. |
| The agent gets 502 `Inference gateway unavailable` | The gateway URL is unreachable from the runner. |
| The agent gets 401 or 403 | The gateway rejected the identity, for example because the repository's owner is not connected to an Outfitter organization, or the repository is outside that connection's allowlist. |

To use provider keys instead, omit `inference-gateway` (or set `inference: none`)
and pass the keys through the step's `env:`.
