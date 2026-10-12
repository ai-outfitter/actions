import { createHash } from "node:crypto";
import Ajv from "ajv";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { workspaceExecutor } from "./workspace.mjs";

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 1024) => typeof value === "string" && value.length > 0 && value.length <= max;
const ajv = () => new Ajv({ strict: false, allErrors: false, validateFormats: false });
const evidence = (value) => { const bytes = Buffer.from(JSON.stringify(value)); return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; };
function slotSchema(schema, prefix) {
  if (!object(schema)) return schema;
  const result = structuredClone(schema);
  delete result.$id;
  if (typeof result.$ref === "string" && (result.$ref === "#" || result.$ref.startsWith("#/"))) result.$ref = prefix + result.$ref.slice(1);
  for (const key of ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"])
    if (object(result[key])) result[key] = Object.fromEntries(Object.entries(result[key]).map(([name, value]) => [name, slotSchema(value, prefix)]));
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"])
    if (Array.isArray(result[key])) result[key] = result[key].map((value) => slotSchema(value, prefix));
  for (const key of ["items", "contains", "additionalProperties", "propertyNames", "if", "then", "else", "not", "unevaluatedProperties", "unevaluatedItems", "contentSchema"])
    if (key in result) result[key] = Array.isArray(result[key]) ? result[key].map((value) => slotSchema(value, prefix)) : slotSchema(result[key], prefix);
  return result;
}
export function approvedContext(lease) {
  const context = lease.context;
  if (!object(context) || !object(context.profile) || !text(context.profile.id) ||
      !text(context.profile.systemPrompt, 100000) || !/^[a-f0-9]{64}$/.test(context.profile.digest) ||
      createHash("sha256").update(context.profile.systemPrompt).digest("hex") !== context.profile.digest ||
      !text(context.model, 200) || !/^[A-Za-z0-9][A-Za-z0-9._/:-]*$/.test(context.model) ||
      !Array.isArray(context.capabilities) || context.capabilities.length > 100 ||
      !text(lease.instructions, 100000) || !object(lease.inputs) || !object(lease.outputs))
    throw new Error("Invalid approved node context");
  const names = new Set(["submit_outputs"]);
  const ids = new Set();
  for (const capability of context.capabilities) {
    if (!object(capability) || !text(capability.id) || !text(capability.description, 10000) ||
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(capability.name) || names.has(capability.name) || ids.has(capability.id) ||
        !object(capability.inputSchema)) throw new Error("Invalid approved capability");
    if (capability.execution !== undefined && !["broker", "workspace"].includes(capability.execution)) throw new Error("Invalid capability execution");
    if (capability.execution === "workspace" && !["read", "write", "shell", "test"].includes(capability.operation)) throw new Error("Invalid workspace capability");
    ajv().compile(capability.inputSchema);
    names.add(capability.name); ids.add(capability.id);
  }
  return context;
}

/** Only a trusted adapter can supply a claimed lease; never accept a context file from the checkout. */
export async function runManagedNode({ client, expected, harness, inference, checkout, retainEvidence, now = Date.now }) {
  if (typeof client.invoke !== "function") throw new Error("Managed capability transport is unavailable");
  const lease = await client.claim(expected);
  const context = approvedContext(lease);
  const workspace = context.capabilities.some((capability) => capability.execution === "workspace")
    ? await workspaceExecutor(checkout, lease, now) : null;
  const audit = [];
  const properties = Object.fromEntries(Object.entries(lease.outputs).map(([name, schema]) => [name,
    slotSchema(schema, `#/properties/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`)]));
  const outputSchema = { type: "object", properties, required: Object.keys(lease.outputs), additionalProperties: false };
  const validateOutputs = ajv().compile(outputSchema);
  let submitted;
  const tools = context.capabilities.map((capability) => {
    const validate = ajv().compile(capability.inputSchema);
    return { name: capability.name, label: capability.name, description: capability.description,
      parameters: capability.inputSchema, executionMode: "sequential",
      async execute(_id, args) {
        if (submitted) throw new Error("Node outputs already submitted");
        if (!validate(args)) throw new Error("Invalid capability arguments");
        if (lease.expiresAt <= now()) throw new Error("Expired node lease");
        if (audit.length >= 1000) throw new Error("Node operation audit limit reached");
        let result;
        try {
          result = capability.execution === "workspace" ? await workspace(capability.operation, args) : await client.invoke(lease, capability.id, args);
          audit.push({ capabilityId: capability.id, arguments: evidence(args), result: evidence(result), timestamp: now() });
        } catch {
          audit.push({ capabilityId: capability.id, arguments: evidence(args), error: "Capability failed", timestamp: now() });
          throw new Error("Capability failed");
        }
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
      } };
  });
  tools.push({ name: "submit_outputs", label: "Submit node outputs", description: "Submit the completed work as the declared output fields.",
    parameters: outputSchema, executionMode: "sequential",
    async execute(_id, value) {
      if (submitted || !validateOutputs(value)) throw new Error("Invalid or duplicate node outputs");
      submitted = structuredClone(value);
      return { content: [{ type: "text", text: "Outputs recorded." }], details: {} };
    } });
  // Runtime settings and identity details are configuration, never instructions to the model.
  const { settings: _settings, engineerBinding: _engineer, reviewerBinding: _reviewer, ...inputs } = lease.inputs;
  let transcript = [];
  let executionError;
  try { await harness({ model: context.model, systemPrompt: context.profile.systemPrompt, tools, inference: { ...inference, expiresAt: lease.expiresAt },
    onTranscript: (messages) => { transcript = messages; },
    prompt: `${lease.instructions}\n\nTask inputs:\n${JSON.stringify(inputs)}\n\nUse submit_outputs when the work is complete.` });
  } catch (error) { executionError = error; }
  if (!submitted) executionError ??= new Error("Agent did not submit valid node outputs");
  if (lease.expiresAt <= now()) executionError ??= new Error("Expired node lease");
  if (checkout) {
    const { stdout } = await exec("git", ["-C", checkout, "rev-parse", "--verify", "HEAD"], { timeout: 5000, maxBuffer: 1024 });
    const headSha = stdout.trim();
    if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error("Invalid checkout HEAD");
    audit.push({ type: "checkout", headSha, timestamp: now() });
  }
  if (retainEvidence) {
    await retainEvidence(lease, { audit, transcript, model: context.model, profileDigest: context.profile.digest, failed: Boolean(executionError) });
  } else await client.upload(lease, { key: `execution-audit-${createHash("sha256").update(lease.attemptId).digest("hex")}`, filename: "execution-audit.jsonl", contentType: "application/x-ndjson", retentionSeconds: 604800 },
    Buffer.from(audit.map((entry) => JSON.stringify(entry)).join("\n") + "\n"));
  if (executionError) throw executionError;
  if (lease.expiresAt <= now()) throw new Error("Expired node lease");
  await client.complete(lease, submitted);
  return { accepted: true };
}
