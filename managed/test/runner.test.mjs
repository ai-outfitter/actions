import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runManagedNode } from "../runner.mjs";
const systemPrompt = "You are the approved engineer.";
const context = () => ({ model: "gpt-6-luna", profile: { id: "engineer", systemPrompt, digest: createHash("sha256").update(systemPrompt).digest("hex") },
  capabilities: [{ id: "scoped-read", name: "read_issue", description: "Read the assigned issue", inputSchema: { type: "object", properties: { number: { type: "integer" } }, required: ["number"], additionalProperties: false } }] });
const lease = () => ({ attemptId: "attempt-1", expiresAt: Date.now() + 60000, context: context(), instructions: "Implement the approved plan.", inputs: { settings: { model: "old-model", engineerProfile: ".agents/evil", secret: "never-prompt" }, event: { issue: 1 } }, outputs: { summary: { type: "string" } } });
test("uses approved model/profile and broker capabilities; completes only validated tool output", async () => {
  const calls = [];
  await runManagedNode({ expected: { runId: "run" }, inference: {}, client: {
    claim: async (value) => { calls.push(value); return lease(); },
    invoke: async (_lease, id, args) => { calls.push({ id, args }); return { title: "task" }; },
    upload: async () => {},
    complete: async (_lease, outputs) => calls.push(outputs),
  }, harness: async ({ model, systemPrompt: profile, prompt, tools }) => {
    assert.equal(model, "gpt-6-luna"); assert.equal(profile, systemPrompt);
    assert.doesNotMatch(prompt, /old-model|never-prompt|\.agents|OIDC/);
    assert.deepEqual(tools.map((tool) => tool.name), ["read_issue", "submit_outputs"]);
    await tools[0].execute("call", { number: 1 });
    await tools[1].execute("call", { summary: "done" });
  } });
  assert.deepEqual(calls, [{ runId: "run" }, { id: "scoped-read", args: { number: 1 } }, { summary: "done" }]);
});
test("missing context, digest mismatch and duplicate capabilities fail before agent execution", async () => {
  for (const mutate of [(value) => { delete value.context; }, (value) => { value.context.profile.systemPrompt += "tampered"; },
    (value) => { value.context.capabilities.push(value.context.capabilities[0]); }]) {
    const value = lease(); mutate(value);
    await assert.rejects(runManagedNode({ client: { invoke() {}, claim: async () => value }, harness: () => assert.fail("must not execute") }));
  }
});
test("invalid arguments, missing outputs and failed harness cannot assert completion", async () => {
  for (const harness of [async () => {}, async ({ tools }) => tools[0].execute("call", { number: "wrong" }),
    async ({ tools }) => tools[1].execute("call", { unexpected: "wrong" }),
    async ({ tools }) => { await tools[1].execute("call", { summary: "done" }); throw new Error("failure after output"); }]) {
    await assert.rejects(runManagedNode({ client: { claim: async () => lease(), invoke: () => assert.fail("invalid call"), complete: () => assert.fail("must not complete") }, harness }));
  }
});
test("self-contained output schema references validate and audit omits raw file contents", async () => {
  const value = lease();
  value.outputs = { summary: { $defs: { text: { type: "object", properties: { $id: { type: "string" } }, required: ["$id"], additionalProperties: false } }, $ref: "#/$defs/text" } };
  let audit;
  await runManagedNode({ client: { claim: async () => value, invoke: async () => ({ content: "private-file-content" }),
    upload: async (_lease, _metadata, bytes) => { audit = bytes.toString(); }, complete: async () => {} },
    harness: async ({ tools }) => { await tools[0].execute("read", { number: 1 }); await tools[1].execute("submit", { summary: { $id: "preserved" } }); } });
  assert.doesNotMatch(audit, /private-file-content/);
  assert.match(audit, /sha256/);
});

test("audit keys are isolated by attempt and fit the storage key limit", async () => {
  const keys = [];
  for (const attemptId of ["a".repeat(128), "b".repeat(128)]) {
    await runManagedNode({ client: { claim: async () => ({ ...lease(), attemptId }), invoke() {},
      upload: async (_lease, metadata) => keys.push(metadata.key), complete: async () => {} },
      harness: async ({ tools }) => tools.at(-1).execute("submit", { summary: "done" }) });
  }
  assert.notEqual(keys[0], keys[1]);
  assert.ok(keys.every((key) => key.length <= 128));
});

test("audit derives checkout HEAD from Git instead of submitted evidence", async () => {
  const checkout = await mkdtemp(join(tmpdir(), "managed-head-"));
  const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    await writeFile(join(checkout, "README.md"), "proof");
    git("add", "README.md");
    git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "proof");
    const actual = git("rev-parse", "HEAD");
    let records;
    await runManagedNode({ checkout, client: { claim: async () => lease(), invoke() {},
      upload: async (_lease, _metadata, bytes) => { records = bytes.toString().trim().split("\n").map(JSON.parse); }, complete: async () => {} },
      harness: async ({ tools }) => tools.at(-1).execute("submit", { summary: "invented SHA: " + "f".repeat(40) }) });
    assert.equal(records.at(-1).type, "checkout");
    assert.equal(records.at(-1).headSha, actual);
  } finally { await rm(checkout, { recursive: true, force: true }); }
});

test("GitHub evidence retention precedes completion and failures cannot assert success", async () => {
  for (const mode of ["success", "retention-failure", "agent-failure"]) {
    const calls = [];
    const task = runManagedNode({ client: {claim: async () => lease(), invoke: async () => ({}),
      upload: () => assert.fail("No platform object storage needed"), complete: async () => calls.push("complete")},
      retainEvidence: async (_lease, evidence) => {
        assert.deepEqual(evidence.transcript, [{role:"assistant",content:"captured"}]);
        assert.equal(evidence.failed, mode === "agent-failure"); calls.push("retain");
        if (mode === "retention-failure") throw new Error("retention failed");
      },
      harness: async ({tools,onTranscript}) => {
        await tools.at(-1).execute("submit", {summary:"done"});
        onTranscript([{role:"assistant",content:"captured"}]);
        if (mode === "agent-failure") throw new Error("agent failed");
      },
    });
    if (mode === "success") { await task; assert.deepEqual(calls, ["retain","complete"]); }
    else { await assert.rejects(task); assert.deepEqual(calls, ["retain"]); }
  }
});
