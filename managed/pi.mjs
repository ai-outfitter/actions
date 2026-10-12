import { AuthStorage, createAgentSession, createExtensionRuntime, ModelRegistry, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

/** No persisted settings, session restoration, built-in tools or repository resource discovery. */
export async function piHarness({ model, systemPrompt, tools, inference, prompt }) {
  const auth = AuthStorage.inMemory();
  const registry = ModelRegistry.inMemory(auth);
  registry.registerProvider("outfitter-managed", {
    apiKey: "managed-oidc", baseUrl: inference.url, api: "openai-completions",
    models: [{ id: model, name: model, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 }],
  });
  // Mint for each inference call; no provider key is written to disk or put in a prompt.
  registry.getApiKeyAndHeaders = async (selected) => {
    if (selected.provider !== "outfitter-managed" || selected.id !== model) throw new Error("Unapproved model");
    return { ok: true, apiKey: await inference.identity() };
  };
  const settings = SettingsManager.inMemory({});
  const path = "managed:approved-profile";
  const extensions = { extensions: [{ path, resolvedPath: path,
    sourceInfo: { path, source: "managed", scope: "temporary", origin: "top-level" },
    handlers: new Map([["before_agent_start", [async () => ({ systemPrompt })]]]),
    tools: new Map(), messageRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map(),
  }], errors: [], runtime: createExtensionRuntime() };
  const resources = {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => { throw new Error("Managed resources are immutable"); },
    reload: async () => {},
  };
  const { session, modelFallbackMessage } = await createAgentSession({ cwd: inference.stateDirectory, agentDir: inference.stateDirectory,
    authStorage: auth, modelRegistry: registry, model: registry.find("outfitter-managed", model), settingsManager: settings,
    resourceLoader: resources, sessionManager: SessionManager.inMemory(), noTools: "builtin", tools: tools.map((tool) => tool.name), customTools: tools });
  const timer = inference.expiresAt ? setTimeout(() => { void session.abort(); }, Math.max(1, inference.expiresAt - Date.now())) : undefined;
  try {
    if (modelFallbackMessage) throw new Error("Managed model fallback is forbidden");
    await session.prompt(prompt);
    const last = session.messages.findLast((message) => message.role === "assistant");
    if (!last || ["error", "aborted"].includes(last.stopReason)) throw new Error("Managed inference failed");
  } finally { clearTimeout(timer); session.dispose(); }
}
