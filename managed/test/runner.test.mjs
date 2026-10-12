import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runManagedNode } from "../runner.mjs";
const systemPrompt = "You are the approved engineer.";
const context = () => ({ model: "gpt-6-luna", profile: { id: "engineer", systemPrompt, digest: createHash("sha256").update(systemPrompt).digest("hex") },
  capabilities: [{ id: "scoped-read", name: "read_issue", description: "Read the assigned issue", inputSchema: { type: "object", properties: { number: { type: "integer" } }, required: ["number"], additionalProperties: false } }] });
const lease = () => ({ expiresAt: Date.now() + 60000, context: context(), instructions: "Implement the approved plan.", inputs: { settings: { model: "old-model", engineerProfile: ".agents/evil", secret: "never-prompt" }, event: { issue: 1 } }, outputs: { summary: { type: "string" } } });
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
