const EXA_SEARCH_URL = "https://api.exa.ai/search";
const BROWSERBASE_SESSIONS_URL = "https://api.browserbase.com/v1/sessions";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

export const PROVIDER_POLICY = Object.freeze({
  "pub-discovery": Object.freeze({ provider: "exa", key: "EXA_API_KEY" }),
  "rendered-menu": Object.freeze({ provider: "browserbase", key: "BROWSERBASE_API_KEY" }),
  "plain-page": Object.freeze({ provider: "tavily", key: "TAVILY_API_KEY" }),
});

export class RefreshProviderError extends Error {
  constructor(provider, message, { status } = {}) {
    super(message);
    this.name = "RefreshProviderError";
    this.provider = provider;
    this.status = status;
  }
}

export function providerForJob(job) {
  const policy = PROVIDER_POLICY[job];
  if (!policy) throw new Error(`Unknown local refresh provider job: ${job}`);
  return policy;
}

function credentialForJob(job, environment) {
  const policy = providerForJob(job);
  const credential = environment?.[policy.key]?.trim();
  if (!credential) {
    throw new RefreshProviderError(
      policy.provider,
      `${policy.provider} unavailable: missing ${policy.key}`,
    );
  }
  return { ...policy, credential };
}

export function assertProviderCredentials(jobs, environment = process.env) {
  for (const job of jobs) credentialForJob(job, environment);
}

function refused(provider, response) {
  const suffix = response.statusText ? ` ${response.statusText}` : "";
  return new RefreshProviderError(
    provider,
    `${provider} refused request: HTTP ${response.status}${suffix}`,
    { status: response.status },
  );
}

async function checkedFetch(provider, url, init, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new RefreshProviderError(
      provider,
      `${provider} request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw refused(provider, response);
  return response;
}

function absoluteMarkdownLinks(markdown) {
  const links = [];
  const seen = new Set();
  for (const match of String(markdown).matchAll(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) {
    const url = match[1];
    if (!seen.has(url)) {
      seen.add(url);
      links.push(url);
    }
  }
  return links;
}

export async function discoverRefreshPages({
  query,
  includeDomains,
  numResults = 10,
  environment = process.env,
  fetchImpl = fetch,
}) {
  const { provider, credential } = credentialForJob("pub-discovery", environment);
  const response = await checkedFetch(
    provider,
    EXA_SEARCH_URL,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": credential },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults,
        ...(includeDomains?.length ? { includeDomains } : {}),
        contents: { text: { maxCharacters: 2_000 } },
      }),
    },
    fetchImpl,
  );
  const payload = await response.json();
  return (Array.isArray(payload?.results) ? payload.results : [])
    .filter((result) => typeof result?.url === "string" && result.url.startsWith("http"))
    .map((result) => ({
      url: result.url,
      title: typeof result.title === "string" ? result.title : "",
      text: typeof result.text === "string" ? result.text : "",
    }));
}

function cdpConnection(connectUrl, WebSocketImpl) {
  const socket = new WebSocketImpl(connectUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 1;

  const opened = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Browserbase CDP connection timed out")), 20_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Browserbase CDP connection failed"));
    }, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message ?? "Browserbase CDP command failed"));
      else resolve(message.result ?? {});
      return;
    }
    for (const listener of listeners) listener(message);
  });

  async function send(method, params = {}, sessionId) {
    await opened;
    const id = nextId++;
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return result;
  }

  function waitFor(method, sessionId, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        listeners.delete(onMessage);
        reject(new Error(`Browserbase timed out waiting for ${method}`));
      }, timeoutMs);
      const onMessage = (message) => {
        if (message.method !== method || (sessionId && message.sessionId !== sessionId)) return;
        clearTimeout(timeout);
        listeners.delete(onMessage);
        resolve(message.params ?? {});
      };
      listeners.add(onMessage);
    });
  }

  return { send, waitFor, close: () => socket.close() };
}

const RENDERED_PAGE_EXPRESSION = String.raw`(() => {
  const visible = (node) => {
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const blocks = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,dt,dd,tr")]
    .filter(visible)
    .map((node) => {
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return "";
      const heading = /^H([1-6])$/.exec(node.tagName);
      if (heading) return "#".repeat(Number(heading[1])) + " " + text;
      if (node.tagName === "LI") return "- " + text;
      return text;
    })
    .filter(Boolean);
  const markdown = blocks.length ? blocks.join("\n\n") : document.body.innerText;
  const links = [...new Set([...document.querySelectorAll("a[href]")]
    .map((link) => link.href)
    .filter((href) => /^https?:/.test(href)))];
  return { markdown, links };
})()`;

export async function renderBrowserbasePage(connectUrl, url, WebSocketImpl = WebSocket) {
  const cdp = cdpConnection(connectUrl, WebSocketImpl);
  try {
    const { targetInfos = [] } = await cdp.send("Target.getTargets");
    let targetId = targetInfos.find((target) => target.type === "page")?.targetId;
    if (!targetId) {
      ({ targetId } = await cdp.send("Target.createTarget", { url: "about:blank" }));
    }
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    const loaded = cdp.waitFor("Page.loadEventFired", sessionId);
    const navigation = await cdp.send("Page.navigate", { url }, sessionId);
    if (navigation.errorText) throw new Error(`page navigation failed: ${navigation.errorText}`);
    await loaded;
    await cdp.send(
      "Runtime.evaluate",
      {
        expression: "new Promise((resolve) => setTimeout(resolve, 4000))",
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    const evaluated = await cdp.send(
      "Runtime.evaluate",
      { expression: RENDERED_PAGE_EXPRESSION, returnByValue: true },
      sessionId,
    );
    if (evaluated.exceptionDetails) throw new Error("rendered page extraction failed");
    return evaluated.result?.value;
  } finally {
    cdp.close();
  }
}

async function fetchRenderedPage({ url, environment, fetchImpl, renderBrowserPage }) {
  const { provider, credential } = credentialForJob("rendered-menu", environment);
  const response = await checkedFetch(
    provider,
    BROWSERBASE_SESSIONS_URL,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-bb-api-key": credential },
      body: JSON.stringify({ timeout: 60, keepAlive: false }),
    },
    fetchImpl,
  );
  const session = await response.json();
  if (typeof session?.connectUrl !== "string" || !session.connectUrl) {
    throw new RefreshProviderError(provider, "browserbase returned no CDP connection URL");
  }
  let page;
  try {
    page = await renderBrowserPage(session.connectUrl, url);
  } catch (error) {
    throw new RefreshProviderError(
      provider,
      `browserbase page acquisition failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!page?.markdown?.trim()) {
    throw new RefreshProviderError(provider, `browserbase returned no rendered content for ${url}`);
  }
  return {
    markdown: page.markdown,
    links: Array.isArray(page.links) ? page.links : [],
  };
}

async function fetchPlainPage({ url, environment, fetchImpl }) {
  const { provider, credential } = credentialForJob("plain-page", environment);
  const response = await checkedFetch(
    provider,
    TAVILY_EXTRACT_URL,
    {
      method: "POST",
      headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      body: JSON.stringify({
        urls: [url],
        extract_depth: "advanced",
        format: "markdown",
        include_images: false,
      }),
    },
    fetchImpl,
  );
  const payload = await response.json();
  const result = Array.isArray(payload?.results) ? payload.results[0] : null;
  if (!result?.raw_content?.trim()) {
    const failed = Array.isArray(payload?.failed_results) ? payload.failed_results[0] : null;
    const reason = failed?.error || "provider returned no extractable content";
    throw new RefreshProviderError(provider, `tavily could not extract ${url}: ${reason}`);
  }
  return {
    markdown: result.raw_content,
    links: absoluteMarkdownLinks(result.raw_content),
  };
}

export async function fetchRefreshPage({
  job,
  url,
  environment = process.env,
  fetchImpl = fetch,
  renderBrowserPage = renderBrowserbasePage,
}) {
  if (job === "rendered-menu") {
    return fetchRenderedPage({ url, environment, fetchImpl, renderBrowserPage });
  }
  if (job === "plain-page") return fetchPlainPage({ url, environment, fetchImpl });
  providerForJob(job);
}
