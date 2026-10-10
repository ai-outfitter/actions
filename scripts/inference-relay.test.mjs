// Run with: node --test scripts/inference-relay.test.mjs
//
// Spawns the relay against a fake runner ID-token endpoint and a fake
// gateway, both on loopback.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const relayScript = fileURLToPath(new URL("./inference-relay.mjs", import.meta.url));

const jwt = (payload) =>
  [{ alg: "RS256", typ: "JWT" }, payload]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .concat("not-a-signature")
    .join(".");

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

// The runner's ID-token endpoint. Each mint issues a distinct token whose
// lifetime the test controls.
function fakeIdTokenEndpoint() {
  const state = { mints: 0, lifetimeSeconds: 600, fail: false, requests: [] };
  const ready = listen((req, res) => {
    state.requests.push({ url: req.url, authorization: req.headers.authorization });
    if (state.fail) return res.writeHead(500).end("boom");
    state.mints += 1;
    const value = jwt({
      sub: `mint-${state.mints}`,
      exp: Math.floor(Date.now() / 1000) + state.lifetimeSeconds,
    });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ value }));
  });
  return { state, ready };
}

// The gateway: records the bearer and echoes the request body back as a
// server-sent-event stream, one chunk at a time.
function fakeGateway() {
  const state = { requests: [] };
  const ready = listen(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    state.requests.push({
      path: req.url,
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const line of ["data: one\n\n", "data: two\n\n", "data: [DONE]\n\n"]) {
      res.write(line);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    res.end();
  });
  return { state, ready };
}

async function startRelay(env) {
  const child = spawn(process.execPath, [relayScript], {
    env: { PATH: process.env.PATH, PORT: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const port = await new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (match) resolve(Number(match[1]));
    });
    child.on("exit", (code) => reject(new Error(`relay exited ${code}`)));
  });
  return { child, url: `http://127.0.0.1:${port}` };
}

describe("inference relay", () => {
  const idp = fakeIdTokenEndpoint();
  const gateway = fakeGateway();
  let idpServer, gatewayServer, relay;

  before(async () => {
    [idpServer, gatewayServer] = await Promise.all([idp.ready, gateway.ready]);
  });

  after(() => {
    idpServer?.server.close();
    gatewayServer?.server.close();
  });

  // A fresh relay per test, so no test inherits another's cached token.
  beforeEach(async () => {
    idp.state.fail = false;
    idp.state.lifetimeSeconds = 600;
    idp.state.mints = 0;
    idp.state.requests.length = 0;
    gateway.state.requests.length = 0;
    relay = await startRelay({
      INFERENCE_GATEWAY_URL: `${gatewayServer.url}/`,
      ACTIONS_ID_TOKEN_REQUEST_URL: `${idpServer.url}/token?api-version=2.0`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-request-token",
    });
  });

  afterEach(() => relay?.child.kill());

  const complete = (body) =>
    fetch(`${relay.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer relay" },
      body,
    });

  test("GET /health answers 200", async () => {
    const response = await fetch(`${relay.url}/health`);
    assert.equal(response.status, 200);
  });

  test("forwards a streaming body and presents the minted token", async () => {
    // A chunked request body, so the relay must stream it rather than buffer
    // a fixed-length one.
    const parts = ['{"model":"m",', '"stream":true,', '"messages":[]}'];
    const body = new ReadableStream({
      async pull(controller) {
        const next = parts.shift();
        if (next === undefined) return controller.close();
        controller.enqueue(new TextEncoder().encode(next));
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    });
    const response = await fetch(`${relay.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer relay" },
      body,
      duplex: "half",
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(await response.text(), "data: one\n\ndata: two\n\ndata: [DONE]\n\n");

    const [forwarded] = gateway.state.requests;
    assert.equal(forwarded.path, "/inference/v1/chat/completions");
    assert.equal(forwarded.body, '{"model":"m","stream":true,"messages":[]}');
    assert.match(forwarded.authorization, /^Bearer [^.]+\.[^.]+\.not-a-signature$/);
    assert.notEqual(forwarded.authorization, "Bearer relay");

    // The first completion mints: audience added, the runner's own query
    // kept, the runner request token presented.
    const [mintRequest] = idp.state.requests;
    const url = new URL(mintRequest.url, "http://idp");
    assert.equal(url.searchParams.get("audience"), "outfitter-inference");
    assert.equal(url.searchParams.get("api-version"), "2.0");
    assert.equal(mintRequest.authorization, "bearer runner-request-token");
  });

  test("reuses a token until it nears expiry, then mints again", async () => {
    // A 30 s token is already inside the 60 s refresh margin: every request
    // mints a new one.
    idp.state.lifetimeSeconds = 30;
    await (await complete("{}")).text();
    await (await complete("{}")).text();
    assert.equal(idp.state.mints, 2);

    // A one-hour token is minted once and then reused.
    idp.state.lifetimeSeconds = 3600;
    await (await complete("{}")).text();
    await (await complete("{}")).text();
    await (await complete("{}")).text();
    assert.equal(idp.state.mints, 3);

    const bearers = gateway.state.requests.map((r) => r.authorization);
    assert.notEqual(bearers[0], bearers[1]);
    assert.notEqual(bearers[1], bearers[2]);
    assert.equal(bearers[2], bearers[3]);
    assert.equal(bearers[3], bearers[4]);
  });

  test("answers 503 without calling the gateway when the mint fails", async () => {
    idp.state.fail = true;
    const response = await complete("{}");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Inference identity unavailable" });
    assert.equal(gateway.state.requests.length, 0);
  });

  test("answers 503 when the cached token nears expiry and the re-mint fails", async () => {
    idp.state.lifetimeSeconds = 30;
    assert.equal((await complete("{}")).status, 200);
    idp.state.fail = true;
    const response = await complete("{}");
    assert.equal(response.status, 503);
    assert.equal(gateway.state.requests.length, 1);
  });

  test("answers 404 for anything else", async () => {
    for (const [method, path] of [
      ["GET", "/v1/chat/completions"],
      ["POST", "/v1/completions"],
      ["GET", "/nope"],
    ]) {
      const response = await fetch(`${relay.url}${path}`, { method });
      assert.equal(response.status, 404, `${method} ${path}`);
      await response.body?.cancel();
    }
  });
});

test("answers 502 when the gateway is unreachable", async () => {
  const idp = fakeIdTokenEndpoint();
  const { server: idpServer, url: idpUrl } = await idp.ready;
  // A port that was just free and is now closed.
  const closed = await listen(() => {});
  closed.server.close();
  await once(closed.server, "close");
  const relay = await startRelay({
    INFERENCE_GATEWAY_URL: closed.url,
    ACTIONS_ID_TOKEN_REQUEST_URL: `${idpUrl}/token?api-version=2.0`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-request-token",
  });
  try {
    const response = await fetch(`${relay.url}/v1/chat/completions`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(response.status, 502);
  } finally {
    relay.child.kill();
    idpServer.close();
  }
});
