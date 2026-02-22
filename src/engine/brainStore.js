const KEY = "toastyMills.brainConfig.v1";

function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const DEFAULTS = {
  provider: "ollama", // fixed: ollama-only
  model: "mistral:latest",
  style: "claude", // 'claude' | 'neutral'
};

export function getBrainConfig() {
  const raw = localStorage.getItem(KEY);
  const cfg = safeParse(raw || "{}", {});
  return {
    provider: DEFAULTS.provider,
    model: typeof cfg.model === "string" && cfg.model.trim() ? cfg.model.trim() : DEFAULTS.model,
    style: cfg.style === "neutral" ? "neutral" : DEFAULTS.style,
  };
}

export function setBrainConfig(patch) {
  const prev = getBrainConfig();
  const next = { ...prev, ...(patch || {}) };
  // Provider is intentionally locked to Ollama.
  next.provider = DEFAULTS.provider;
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
