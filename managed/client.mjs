import { createHash, randomUUID } from "node:crypto";

const identifier = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message) => {
  throw new Error(message);
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function gatewayOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    fail("A trusted HTTPS gateway is required");
  return url.href.replace(/\/$/, "");
}
async function json(response, pending = false) {
  if (!response.ok && !pending) fail(`Gateway request failed (${response.status})`);
  // Do not log response bodies: they can contain upstream credentials or private data.
  const reader = response.body?.getReader();
  if (!reader) fail("Missing response");
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) fail("Response exceeds limit");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
/** Mint afresh for each privileged request; this function never returns runner request credentials. */
export async function actionsIdentity(env = process.env, request = fetch) {
  const raw = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!raw || !token) fail("Actions id-token: write is required");
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".actions.githubusercontent.com") ||
    url.username ||
    url.password ||
    url.hash
  )
    fail("Unexpected Actions identity endpoint");
  url.searchParams.set("audience", "outfitter-inference");
  const body = await json(
    await request(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    }),
  );
  if (typeof body.value !== "string" || !body.value)
    fail("Missing Actions identity");
  return body.value;
}
export function validateLease(lease, expected, now = Date.now()) {
  if (
    !object(lease) ||
    !identifier(lease.leaseId) ||
    !Number.isSafeInteger(lease.expiresAt) ||
    lease.expiresAt <= now ||
    !/^[a-f0-9]{64}$/.test(lease.definitionHash) ||
    typeof lease.instructions !== "string" ||
    !lease.instructions.trim() ||
    !object(lease.inputs) ||
    !object(lease.outputs) ||
    Object.values(lease.outputs).some((schema) => !object(schema))
  )
    fail("Invalid or expired node lease");
  for (const key of ["runId", "nodeId", "attemptId"]) {
    if (!identifier(expected[key]) || lease[key] !== expected[key])
      fail("Node lease identity mismatch");
  }
  return lease;
}
function artifactMatches(artifact, lease, requested) {
  return (
    object(artifact) &&
    artifact.runId === lease.runId &&
    ["sha256", "size", "key", "filename", "contentType"].every(
      (key) => artifact[key] === requested[key],
    )
  );
}
function uploadDestination(ticket, lease, body, timestamp) {
  if (
    !object(ticket) ||
    !object(ticket.artifact) ||
    !identifier(ticket.artifact.id) ||
    !artifactMatches(ticket.artifact, lease, body) ||
    !Number.isSafeInteger(ticket.uploadExpiresAt) ||
    ticket.uploadExpiresAt <= timestamp
  )
    fail("Artifact ticket mismatch");
  const url = new URL(ticket.uploadUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    fail("Invalid artifact upload URL");
  if (
    ticket.headers?.["Content-Type"] !== body.contentType ||
    ticket.headers?.["Content-Length"] !== String(body.size)
  )
    fail("Artifact header mismatch");
  return url;
}
export function workflowClient({
  gateway,
  identity = actionsIdentity,
  request = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const base = gatewayOrigin(gateway);
  async function post(path, value, read = true, signal) {
    const token = await identity();
    signal?.throwIfAborted();
    const response = await request(`${base}${path}`, {
      method: "POST",
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    });
    if (read === "claim" && response.status === 425) {
      const body = await json(response, true);
      if (body?.error?.code === "dispatch_receipt_pending") return null;
      fail("Gateway request failed (425)");
    }
    if (read) return json(response);
    if (!response.ok) fail(`Gateway request failed (${response.status})`);
    await response.body?.cancel();
  }
  function active(lease) {
    validateLease(lease, lease, now());
  }
  return {
    async claim(expected) {
      for (const key of ["runId", "nodeId", "attemptId"])
        if (!identifier(expected[key])) fail("Invalid node identity");
      const body = {
        runId: expected.runId,
        nodeId: expected.nodeId,
        attemptId: expected.attemptId,
      };
      const deadline = now() + 60000;
      const signal = AbortSignal.timeout(60000);
      const claim = async () => {
        while (now() < deadline) {
          signal.throwIfAborted();
          const result = await post("/workflow/v1/nodes/claim", body, "claim", signal);
          if (now() >= deadline) break;
          if (result !== null) return validateLease(result, body, now());
          await sleep(Math.min(1000, deadline - now()));
        }
        fail("Dispatch receipt did not arrive within 60 seconds");
      };
      // Bound token minting and response reads as well as the gateway fetch.
      return Promise.race([
        claim(),
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
      ]);
    },
    async invoke(lease, capabilityId, args) {
      active(lease);
      if (!identifier(capabilityId) || !object(args)) fail("Invalid capability call");
      const response = await post("/workflow/v1/nodes/tools", {
        leaseId: lease.leaseId, invocationId: randomUUID(), capabilityId, arguments: args,
      });
      if (!object(response) || !Object.hasOwn(response, "result")) fail("Missing capability result");
      return response.result;
    },
    async complete(lease, outputs) {
      active(lease);
      if (
        !object(outputs) ||
        Object.keys(outputs).some(
          (key) => !Object.hasOwn(lease.outputs, key),
        ) ||
        Object.keys(lease.outputs).some((key) => !Object.hasOwn(outputs, key))
      )
        fail("Completion must contain exactly the declared output slots");
      // The platform validates schemas, lease, binding, signed job identity and idempotency.
      await post(
        "/workflow/v1/nodes/complete",
        { leaseId: lease.leaseId, outputs },
        false,
      );
    },
    async upload(lease, metadata, bytes) {
      active(lease);
      if (
        !Buffer.isBuffer(bytes) ||
        !bytes.length ||
        bytes.length > 10 * 1024 * 1024
      )
        fail("Artifact must be 1 byte to 10 MiB");
      const body = {
        leaseId: lease.leaseId,
        key: metadata.key,
        filename: metadata.filename,
        contentType: metadata.contentType,
        retentionSeconds: metadata.retentionSeconds,
        size: bytes.length,
        sha256: digest(bytes),
      };
      const ticket = await post("/workflow/v1/artifacts", body);
      const url = uploadDestination(ticket, lease, body, now());
      // A presigned storage URL receives bytes and storage headers, never the OIDC bearer.
      const uploaded = await request(url, {
        method: "PUT",
        body: bytes,
        redirect: "error",
        signal: AbortSignal.timeout(60000),
        headers: {
          "Content-Type": body.contentType,
          "Content-Length": String(body.size),
        },
      });
      if (!uploaded.ok) fail(`Artifact upload failed (${uploaded.status})`);
      await uploaded.body?.cancel();
      active(lease);
      const artifact = await post(
        `/workflow/v1/artifacts/${encodeURIComponent(ticket.artifact.id)}/complete`,
        { leaseId: lease.leaseId },
      );
      if (
        artifact?.id !== ticket.artifact.id ||
        !artifactMatches(artifact, lease, body)
      )
        fail("Artifact receipt mismatch");
      return artifact;
    },
  };
}
