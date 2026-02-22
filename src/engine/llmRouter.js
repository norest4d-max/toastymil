import { ollamaGenerate } from "./ollamaClient";

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeWordLike(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqSorted(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map(String).map((s) => s.trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b)
  );
}

function pickVocabularySnapshot(terms, maxWords = 120) {
  const words = uniqSorted((Array.isArray(terms) ? terms : []).map((t) => normalizeWordLike(t?.word)).filter(Boolean));
  const categories = uniqSorted((Array.isArray(terms) ? terms : []).map((t) => normalizeWordLike(t?.category)).filter(Boolean));
  return {
    words: words.slice(0, Math.max(1, maxWords)),
    categories: categories.slice(0, 60),
  };
}

/**
 * Use Ollama to map arbitrary user phrasing → a canonical ToastyMills command.
 * Returns { command, confidence, reason } where command is either a string or null.
 */
export async function llmRouteToCommand(userText, terms, { model, baseUrl } = {}) {
  const input = String(userText || "").trim();
  if (!input) return { command: null, confidence: 0, reason: "empty" };

  const vocab = pickVocabularySnapshot(terms);

  const prompt = [
    "You are a message router for a local vocabulary app.",
    "Goal: infer which command the user intended, even if phrased casually or with broken English.",
    "Return STRICT JSON only (no markdown, no extra keys).",
    "Schema:",
    '{"command":string|null,"confidence":number,"reason":string}',
    "Where command must be ONE of:",
    "- 'define <word>'",
    "- 'synonyms <word>'",
    "- 'antonyms <word>'",
    "- 'similar to <word>'",
    "- 'connect <wordA> and <wordB>'",
    "- 'category <category>'",
    "- 'help'",
    "- 'greeting'",
    "Rules:",
    "- If unclear or it looks like general conversation (not a dictionary/thesaurus request), set command=null.",
    "- Prefer words that exist in the provided vocabulary when possible.",
    "- confidence is 0..1.",
    "Vocabulary words (subset):",
    vocab.words.join(", ") || "(none)",
    "Vocabulary categories:",
    vocab.categories.join(", ") || "(none)",
    "Examples:",
    "User: 'what does ephemeral mean' -> {command:'define ephemeral',...}",
    "User: 'words like melancholy' -> {command:'synonyms melancholy',...}",
    "User: 'opposite of calm' -> {command:'antonyms calm',...}",
    "User: 'how is joy linked with sorrow' -> {command:'connect joy and sorrow',...}",
    "User: 'emotion words' -> {command:'category emotion',...}",
    "User: 'hi' -> {command:'greeting',...}",
    "User: 'tell me a joke' -> {command:null,...}",
    "",
    "User:",
    input,
  ].join("\n");

  const raw = await ollamaGenerate(prompt, { model, baseUrl, numPredict: 220 });
  const obj = safeJsonParse(raw);
  if (!obj || typeof obj !== "object") {
    return { command: null, confidence: 0, reason: "invalid_json" };
  }

  const command = typeof obj.command === "string" ? obj.command.trim() : null;
  const confidence = Number.isFinite(Number(obj.confidence)) ? Math.max(0, Math.min(1, Number(obj.confidence))) : 0;
  const reason = typeof obj.reason === "string" ? obj.reason : "";

  if (!command) return { command: null, confidence, reason };

  // Enforce an allow-list so the model can't invent commands.
  const ok =
    /^(define|synonyms|antonyms|category)\s+.+/i.test(command) ||
    /^similar\s+to\s+.+/i.test(command) ||
    /^connect\s+.+\s+and\s+.+/i.test(command) ||
    /^help$/i.test(command) ||
    /^greeting$/i.test(command);

  return ok ? { command, confidence, reason } : { command: null, confidence: 0, reason: "disallowed" };
}
