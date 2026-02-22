const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_NUM_PREDICT = 512;

function getEnv(key, fallback = "") {
  // CRA only exposes REACT_APP_* vars.
  return (process.env[key] || fallback).trim();
}

export function isOllamaEnabled() {
  const v = getEnv("REACT_APP_OLLAMA_ENABLED", "1").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function getOllamaConfig() {
  const baseUrl = getEnv("REACT_APP_OLLAMA_BASE_URL", DEFAULT_BASE_URL);
  const model = getEnv("REACT_APP_OLLAMA_MODEL", "llama3.2");
  const numPredictRaw = getEnv("REACT_APP_OLLAMA_NUM_PREDICT", "");
  const numPredict = Number.isFinite(Number(numPredictRaw)) ? Number(numPredictRaw) : undefined;
  return { baseUrl, model, numPredict };
}

export function isOllamaRemote(baseUrl) {
  const b = String(baseUrl || DEFAULT_BASE_URL).trim().toLowerCase();
  // Treat anything not explicitly localhost as remote.
  return !(b.startsWith("http://localhost") || b.startsWith("http://127.0.0.1") || b.startsWith("https://localhost") || b.startsWith("https://127.0.0.1"));
}

/**
 * Calls Ollama's /api/generate endpoint.
 * - If baseUrl is localhost default, we prefer CRA dev proxy by using a relative URL.
 * - If baseUrl is changed (remote), we call it directly.
 */
export async function ollamaGenerate(
  prompt,
  {
    baseUrl,
    model,
    numPredict,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = getOllamaConfig()
) {
  const normalizedBase = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  // Always prefer same-origin proxy for local Ollama to avoid browser CORS issues.
  const isLocalBase =
    normalizedBase.toLowerCase().startsWith("http://localhost") ||
    normalizedBase.toLowerCase().startsWith("http://127.0.0.1") ||
    normalizedBase.toLowerCase().startsWith("https://localhost") ||
    normalizedBase.toLowerCase().startsWith("https://127.0.0.1");
  const useDevProxy = isLocalBase;
  const url = useDevProxy ? "/ollama/api/generate" : `${normalizedBase}/api/generate`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          num_predict: Number.isFinite(Number(numPredict))
            ? Number(numPredict)
            : DEFAULT_NUM_PREDICT,
        },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`Ollama request timed out after ${Math.round((Number(timeoutMs) || DEFAULT_TIMEOUT_MS) / 1000)}s.`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  async function parseErrorBody(response) {
    const ct = (response.headers.get("content-type") || "").toLowerCase();
    const text = await response.text().catch(() => "");
    if (!text) return "";

    // Standard Ollama errors: application/json {"error":"..."}
    if (ct.includes("application/json")) {
      try {
        const obj = JSON.parse(text);
        if (obj && typeof obj.error === "string") return obj.error;
      } catch {
        // fall back to raw text
      }
    }

    // Streaming-style errors: application/x-ndjson with {"error":"..."}
    if (ct.includes("application/x-ndjson") || text.includes("\n")) {
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj && typeof obj.error === "string") return obj.error;
        } catch {
          // ignore
        }
      }
    }

    return text;
  }

  if (!res.ok) {
    const errMsg = await parseErrorBody(res);
    throw new Error(`Ollama request failed (${res.status}). ${errMsg}`.trim());
  }

  // Even with stream=false, keep this tolerant in case a proxy returns ndjson.
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/x-ndjson")) {
    const text = await res.text();
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let out = "";
    for (const line of lines) {
      const obj = JSON.parse(line);
      if (obj && typeof obj.error === "string") throw new Error(obj.error);
      if (obj && typeof obj.response === "string") out += obj.response;
      if (obj && obj.done) break;
    }
    return String(out || "").trim();
  }

  const data = await res.json();
  if (data && typeof data.error === "string") {
    throw new Error(data.error);
  }
  return String(data?.response || "").trim();
}
