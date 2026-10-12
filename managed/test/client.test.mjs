import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  actionsIdentity,
  gatewayOrigin,
  validateLease,
  workflowClient,
} from "../client.mjs";

const expected = { runId: "run-1", nodeId: "triage", attemptId: "attempt-1" };
const lease = () => ({
  ...expected,
  leaseId: "lease-1",
  expiresAt: 2000,
  definitionHash: "a".repeat(64),
  instructions: "Plan the issue",
  inputs: { settings: { model: "gpt-6-luna" } },
  outputs: { plan: { type: "object" } },
});

test("claim sends identifiers only and completion uses a fresh job identity", async () => {
  const calls = [];
  let tokens = 0;
  const client = workflowClient({
    gateway: "https://gateway.example",
    now: () => 1000,
    identity: async () => `token-${++tokens}`,
    request: async (url, options) => {
      calls.push({ url, options });
      return Response.json(calls.length === 1 ? lease() : { accepted: true });
    },
  });
  const claimed = await client.claim({
    ...expected,
    userId: "forged",
    organizationId: "forged",
  });
  await client.complete(claimed, { plan: { proceed: true } });
  assert.deepEqual(JSON.parse(calls[0].options.body), expected);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    leaseId: "lease-1",
    outputs: { plan: { proceed: true } },
  });
  assert.equal(calls[0].options.headers.Authorization, "Bearer token-1");
  assert.equal(calls[1].options.headers.Authorization, "Bearer token-2");
  assert.equal(calls[1].options.redirect, "error");
});
test("wrong node, expired lease, undeclared or missing outputs fail closed", async () => {
  assert.throws(
    () => validateLease({ ...lease(), nodeId: "implement" }, expected, 1000),
    /mismatch/,
  );
  assert.throws(() => validateLease(lease(), expected, 2000), /expired/);
  let calls = 0;
  const client = workflowClient({
    gateway: "https://gateway.example",
    now: () => 1000,
    identity: async () => "token",
    request: async () => {
      calls++;
      return Response.json({});
    },
  });
  await assert.rejects(client.complete(lease(), {}), /exactly/);
  await assert.rejects(
    client.complete(lease(), { plan: {}, forged: true }),
    /exactly/,
  );
  assert.equal(calls, 0);
});
test("artifact binds bytes/run and keeps OIDC bearer off presigned storage", async () => {
  const calls = [];
  let tokens = 0;
  const bytes = Buffer.from("actual screenshot bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifact = {
    id: "artifact-1",
    runId: expected.runId,
    size: bytes.length,
    sha256,
    key: "screenshot",
    filename: "screen.png",
    contentType: "image/png",
    expiresAt: 9000,
  };
  const client = workflowClient({
    gateway: "https://gateway.example",
    now: () => 1000,
    identity: async () => `token-${++tokens}`,
    request: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1)
        return Response.json({
          artifact,
          uploadUrl: "https://storage.example/opaque?signature=secret",
          uploadExpiresAt: 1800,
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(bytes.length),
          },
        });
      return Response.json(artifact);
    },
  });
  assert.deepEqual(
    await client.upload(
      lease(),
      {
        key: "screenshot",
        filename: "screen.png",
        contentType: "image/png",
        retentionSeconds: 900,
        runId: "forged",
      },
      bytes,
    ),
    artifact,
  );
  assert.equal(JSON.parse(calls[0].options.body).runId, undefined);
  assert.equal(JSON.parse(calls[0].options.body).sha256, sha256);
  assert.deepEqual(calls[1].options.headers, {
    "Content-Type": "image/png",
    "Content-Length": String(bytes.length),
  });
  assert.equal(calls[1].options.body, bytes);
  assert.equal(calls[2].options.headers.Authorization, "Bearer token-2");
  assert.deepEqual(JSON.parse(calls[2].options.body), { leaseId: "lease-1" });
});
test("a cross-run artifact ticket is rejected before uploading bytes", async () => {
  let calls = 0;
  const client = workflowClient({
    gateway: "https://gateway.example",
    now: () => 1000,
    identity: async () => "token",
    request: async () => {
      calls++;
      return Response.json({ artifact: { id: "artifact", runId: "other" } });
    },
  });
  await assert.rejects(
    client.upload(lease(), {}, Buffer.from("x")),
    /ticket mismatch/,
  );
  assert.equal(calls, 1);
});
test("OIDC audience is fixed and identity credentials never follow redirects", async () => {
  const env = {
    ACTIONS_ID_TOKEN_REQUEST_URL:
      "https://pipelines.actions.githubusercontent.com/token?audience=wrong",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-secret",
  };
  const identity = await actionsIdentity(env, async (url, options) => {
    assert.equal(url.searchParams.get("audience"), "outfitter-inference");
    assert.equal(options.redirect, "error");
    return Response.json({ value: "job-oidc" });
  });
  assert.equal(identity, "job-oidc");
  await assert.rejects(
    actionsIdentity({
      ...env,
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://attacker.example/token",
    }),
    /Unexpected/,
  );
  assert.throws(() => gatewayOrigin("http://gateway.example"), /HTTPS/);
  assert.throws(
    () => gatewayOrigin("https://user:secret@gateway.example"),
    /HTTPS/,
  );
});
test("upstream error body is not exposed to job logs", async () => {
  const client = workflowClient({
    gateway: "https://gateway.example",
    identity: async () => "token",
    request: async () => new Response("private provider key", { status: 403 }),
  });
  await assert.rejects(
    client.claim(expected),
    (error) => error.message === "Gateway request failed (403)",
  );
});

test("same bytes in another artifact slot cannot satisfy an upload ticket", async () => {
  const bytes = Buffer.from("same bytes");
  let calls = 0;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const client = workflowClient({
    gateway: "https://gateway.example",
    now: () => 1000,
    identity: async () => "token",
    request: async () => {
      calls++;
      return Response.json({
        artifact: {
          id: "artifact",
          runId: expected.runId,
          sha256,
          size: bytes.length,
          key: "wrong-slot",
          filename: "wrong.png",
          contentType: "image/png",
        },
        uploadExpiresAt: 1800,
      });
    },
  });
  await assert.rejects(
    client.upload(
      lease(),
      { key: "requested", filename: "expected.png", contentType: "image/png" },
      bytes,
    ),
    /ticket mismatch/,
  );
  assert.equal(calls, 1);
});

test("claim waits only for the exact pending receipt response with fresh identity", async () => {
  let clock = 1000;
  let tokens = 0;
  const calls = [];
  const client = workflowClient({
    gateway: "https://gateway.example", now: () => clock,
    sleep: async (ms) => { clock += ms; },
    identity: async () => `token-${++tokens}`,
    request: async (_, options) => {
      calls.push(options);
      return calls.length === 1
        ? Response.json({ error: { code: "dispatch_receipt_pending" } }, { status: 425 })
        : Response.json({ ...lease(), expiresAt: 90000 });
    },
  });
  await client.claim(expected);
  assert.equal(tokens, 2);
  assert.equal(clock, 2000);
  assert.deepEqual(calls.map((call) => JSON.parse(call.body)), [expected, expected]);
  assert.deepEqual(calls.map((call) => call.headers.Authorization), ["Bearer token-1", "Bearer token-2"]);
});

test("pending claim has a 60 second deadline and never retries other responses", async () => {
  for (const [status, code] of [[403, "dispatch_receipt_pending"], [409, "dispatch_receipt_pending"], [425, "unknown"]]) {
    let calls = 0;
    const client = workflowClient({ gateway: "https://gateway.example", identity: async () => "token",
      request: async () => { calls++; return Response.json({ error: { code } }, { status }); } });
    await assert.rejects(client.claim(expected));
    assert.equal(calls, 1);
  }
  let clock = 0;
  let calls = 0;
  const client = workflowClient({ gateway: "https://gateway.example", identity: async () => "token",
    now: () => clock, sleep: async (ms) => { clock += ms; },
    request: async () => { calls++; return Response.json({ error: { code: "dispatch_receipt_pending" } }, { status: 425 }); } });
  await assert.rejects(client.claim(expected), /60 seconds/);
  assert.equal(clock, 60000);
  assert.equal(calls, 60);
});

test("capability call uses active lease and fresh OIDC without caller identity", async () => {
  let calls = 0;
  const invocationIds = new Set();
  const client = workflowClient({ gateway: "https://gateway.example", now: () => 1000, identity: async () => "fresh-job",
    request: async (url, options) => {
      calls++;
      assert.equal(url, "https://gateway.example/workflow/v1/nodes/tools");
      assert.equal(options.headers.Authorization, "Bearer fresh-job");
      const { invocationId, ...body } = JSON.parse(options.body);
      assert.match(invocationId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      assert.ok(!invocationIds.has(invocationId));
      invocationIds.add(invocationId);
      assert.deepEqual(body, { leaseId: "lease-1", capabilityId: "read-issue", arguments: { number: 1 } });
      return Response.json({ result: { title: "issue" } });
    } });
  assert.deepEqual(await client.invoke(lease(), "read-issue", { number: 1 }), { title: "issue" });
  await client.invoke(lease(), "read-issue", { number: 1 });
  await assert.rejects(client.invoke({ ...lease(), expiresAt: 999 }, "read-issue", {}));
  assert.equal(calls, 2);
});
