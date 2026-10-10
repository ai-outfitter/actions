// The inference relay: the agent calls it on loopback with a placeholder API
// key, and it forwards chat completions to the Outfitter inference gateway
// with the job's GitHub Actions OIDC ID token as the bearer. The token is
// minted from the runner's ID-token endpoint, held in this process only, and
// never written to the environment the agent sees.
//
// Node 20+, no dependencies. Started in the background by action.yml.

import { createServer } from "node:http";
import { Readable } from "node:stream";

const gatewayUrl = process.env.INFERENCE_GATEWAY_URL?.replace(/\/+$/, "");
if (!gatewayUrl) throw new Error("INFERENCE_GATEWAY_URL must be configured");
const target = `${gatewayUrl}/inference/v1/chat/completions`;
const audience = process.env.INFERENCE_TOKEN_AUDIENCE || "outfitter-inference";
// Refresh this long before the token expires so a request in flight never
// reaches the gateway with a token that lapses on the way.
const refreshMarginMs = 60_000;

const json = (res, status, value) =>
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));

// The JWT's own `exp`, read without verifying: the gateway verifies, the
// relay only needs to know when to mint a fresh one.
function expiresAt(jwt) {
  try {
    const { exp } = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function mint() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error("ID-token request environment is not set");
  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);
  const response = await fetch(url, {
    headers: { Authorization: `bearer ${requestToken}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`ID-token endpoint returned ${response.status}`);
  const { value } = await response.json();
  if (typeof value !== "string" || !value) throw new Error("ID-token endpoint returned no token");
  return { value, expiresAt: expiresAt(value) };
}

let cached;
let minting;
// One mint in flight at a time: concurrent requests share it.
async function token() {
  if (cached && cached.expiresAt - Date.now() > refreshMarginMs) return cached.value;
  minting ??= mint()
    .then((fresh) => (cached = fresh))
    .finally(() => (minting = undefined));
  try {
    return (await minting).value;
  } catch (error) {
    // Status codes and messages only; never the request token or a response body.
    console.error(`inference-relay: ${error.message}`);
    return undefined;
  }
}

async function relay(req, res) {
  const bearer = await token();
  if (!bearer) {
    req.resume();
    return json(res, 503, { error: "Inference identity unavailable" });
  }
  // A client that goes away cancels the upstream request and its generation.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  let upstream;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": req.headers["content-type"] || "application/json",
        ...(req.headers.accept ? { Accept: req.headers.accept } : {}),
      },
      body: Readable.toWeb(req),
      duplex: "half",
      redirect: "manual",
      signal: abort.signal,
    });
  } catch {
    if (!res.headersSent && !abort.signal.aborted)
      json(res, 502, { error: "Inference gateway unavailable" });
    return;
  }
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/json",
    "Cache-Control": "no-store",
  });
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body)
    .on("error", () => res.destroy())
    .pipe(res);
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://relay");
  if (req.method === "GET" && pathname === "/health") return json(res, 200, { status: "ok" });
  if (req.method === "POST" && pathname === "/v1/chat/completions")
    return relay(req, res).catch(() => {
      if (!res.headersSent) json(res, 502, { error: "Inference gateway unavailable" });
      else res.destroy();
    });
  req.resume();
  json(res, 404, { error: "Not found" });
});
// Loopback only: the relay is reachable from this runner and no one else.
server.listen(Number(process.env.PORT || 4141), "127.0.0.1", () => {
  console.log(`inference-relay: listening on 127.0.0.1:${server.address().port}`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
