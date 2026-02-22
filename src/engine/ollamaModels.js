export async function fetchOllamaModels() {
  // Unified server proxies Ollama at /ollama/*
  const res = await fetch("/ollama/api/tags");
  if (!res.ok) {
    throw new Error(`Ollama tags request failed (${res.status})`);
  }
  const data = await res.json();
  const models = Array.isArray(data?.models) ? data.models : [];

  // Prefer truly local models. Ollama can list "*-cloud" entries that route to ollama.com.
  const local = [];
  const remote = [];

  for (const m of models) {
    const name = String(m?.name || m?.model || "").trim();
    if (!name) continue;
    const isRemote = Boolean(m?.remote_host) || /-cloud\b/i.test(name);
    (isRemote ? remote : local).push(name);
  }

  // If there are no local models (rare), fall back to showing remote.
  return local.length ? local : remote;
}
