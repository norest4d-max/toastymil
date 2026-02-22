const KEY = "toastyMills.prompts.v1";

function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizePrompt(p) {
  const title = clampText(p?.title, 48) || "Untitled";
  const description = clampText(p?.description, 120);
  const text = String(p?.text || "").trim();
  const avatarText = clampText(p?.avatarText, 3).toUpperCase();
  const avatarImage = typeof p?.avatarImage === "string" ? p.avatarImage : "";
  const level = p?.level === "intermediate" ? "intermediate" : "basic";

  return {
    id: typeof p?.id === "string" && p.id ? p.id : makeId(),
    title,
    description,
    text,
    level,
    avatarText: avatarText || title.slice(0, 2).toUpperCase(),
    avatarImage,
    createdAt: typeof p?.createdAt === "string" && p.createdAt ? p.createdAt : nowIso(),
    updatedAt: nowIso(),
  };
}

function defaultPrompts() {
  return [
    {
      title: "Help",
      description: "Show what this chat can do",
      text: "help",
      level: "basic",
      avatarText: "?",
    },
    {
      title: "Define a word",
      description: "Get a crisp definition + examples",
      text: "What does ephemeral mean? Give a simple definition and 2 example sentences.",
      level: "basic",
      avatarText: "Df",
    },
    {
      title: "Synonyms",
      description: "List alternatives and when to use them",
      text: "Give me synonyms for melancholy. Group them by tone (formal/neutral/poetic) and include short usage notes.",
      level: "basic",
      avatarText: "Sy",
    },
    {
      title: "Connect words",
      description: "Explain the relationship between two ideas",
      text: "How are joy and sorrow connected? Explain in 3 bullets and give 1 short metaphor.",
      level: "basic",
      avatarText: "Cn",
    },
    {
      title: "Emotion words",
      description: "Generate a mini vocabulary set",
      text: "List 12 emotion words. For each: definition (1 line) + 1 synonym.",
      level: "basic",
      avatarText: "Em",
    },
    {
      title: "Similar to…",
      description: "Find close words + nuance",
      text: "Give me 8 words similar to luminous, and explain the nuance difference in 1 phrase each.",
      level: "basic",
      avatarText: "~",
    },
    {
      title: "Triage an error",
      description: "IT-style fast diagnosis + next steps",
      text:
        "You are a senior IT engineer.\n" +
        "I will paste an error message and context.\n" +
        "Return: (1) 3 most likely causes ranked, (2) commands/checks to confirm each, (3) safest quick fix, (4) long-term fix.\n" +
        "Ask ONLY 1 clarifying question if needed.",
      level: "intermediate",
      avatarText: "IT",
    },
    {
      title: "PowerShell helper",
      description: "Write/repair a PowerShell script",
      text:
        "Write a PowerShell script for Windows 11 that does the following (I will specify).\n" +
        "Constraints: safe defaults, clear output, idempotent if possible.\n" +
        "Also explain how to run it and how to undo changes.",
      level: "intermediate",
      avatarText: "PS",
    },
    {
      title: "Security checklist",
      description: "Hardening steps for a local app",
      text:
        "Give me a practical security checklist for a local-only app on Windows.\n" +
        "Include: network exposure, secrets handling, logging/PII, updates, firewall rules, and least privilege.",
      level: "intermediate",
      avatarText: "Sec",
    },
  ].map(normalizePrompt);
}

export function loadPrompts() {
  const raw = localStorage.getItem(KEY);
  const parsed = safeParse(raw || "{}", {});
  const list = Array.isArray(parsed?.prompts) ? parsed.prompts : [];

  if (!list.length) {
    const next = { prompts: defaultPrompts() };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next.prompts;
  }

  // Ensure the stored list is normalized.
  const normalized = list.map(normalizePrompt);
  localStorage.setItem(KEY, JSON.stringify({ prompts: normalized }));
  return normalized;
}

export function savePrompts(prompts) {
  const normalized = (Array.isArray(prompts) ? prompts : []).map(normalizePrompt);
  localStorage.setItem(KEY, JSON.stringify({ prompts: normalized }));
  return normalized;
}

export function upsertPrompt(prompt) {
  const existing = loadPrompts();
  const nextItem = normalizePrompt(prompt);
  const idx = existing.findIndex((p) => p.id === nextItem.id);
  const next = [...existing];
  if (idx >= 0) next[idx] = { ...next[idx], ...nextItem, updatedAt: nowIso() };
  else next.unshift(nextItem);
  return savePrompts(next);
}

export function deletePrompt(promptId) {
  const existing = loadPrompts();
  const next = existing.filter((p) => p.id !== promptId);
  return savePrompts(next.length ? next : defaultPrompts());
}
