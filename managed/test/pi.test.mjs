import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { piHarness } from "../pi.mjs";

test("real Pi session uses only pinned prompt/model/tools and fresh gateway identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "managed-pi-test-"));
  await mkdir(join(directory, ".pi"));
  await writeFile(join(directory, "AGENTS.md"), "LOCAL_CONTEXT_MUST_NOT_LOAD");
  await writeFile(join(directory, ".pi", "settings.json"), JSON.stringify({ defaultModel: "wrong-model" }));
  let calls = 0;
  let tokens = 0;
  let submitted;
  let transcript;
  const observed = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    calls++;
    observed.push({ body, authorization: request.headers.authorization });
    const delta = calls === 1 ? { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "submit_outputs", arguments: '{"summary":"done"}' } }] } : { role: "assistant", content: "Completed." };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: calls === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await piHarness({ onTranscript: (messages) => { transcript = messages; }, model: "gpt-6-luna", systemPrompt: "README.md", prompt: "Complete task",
      inference: { url: `http://127.0.0.1:${server.address().port}/v1`, stateDirectory: directory, identity: async () => `fresh-${++tokens}` },
      tools: [{ name: "submit_outputs", label: "Submit", description: "Submit outputs", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
        execute: async (_id, args) => { submitted = args; return { content: [{ type: "text", text: "Saved" }], details: {} }; } }] });
    for (const [index, { body, authorization }] of observed.entries()) {
      assert.equal(body.model, "gpt-6-luna");
      assert.equal(authorization, `Bearer fresh-${index + 1}`);
      assert.equal(body.messages[0].content, "README.md");
      assert.doesNotMatch(JSON.stringify(body), /LOCAL_CONTEXT_MUST_NOT_LOAD|wrong-model|Run an \[Outfitter/);
      assert.deepEqual(body.tools.map((tool) => tool.function.name), ["submit_outputs"]);
    }
    assert.ok(transcript.some((message) => message.role === "toolResult"));
    assert.ok(transcript.some((message) => message.role === "assistant"));
    assert.doesNotMatch(JSON.stringify(transcript), /fresh-1|fresh-2/);
    assert.deepEqual(submitted, { summary: "done" });
    assert.equal(calls, 2);
    assert.equal(tokens, calls);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
