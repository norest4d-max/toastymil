const STORAGE_KEY = "toastyMills.learnedTerms.v1";
const UNKNOWN_KEY = "toastyMills.unknownQuestions.v1";

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeWord(word) {
  return String(word || "").trim().toLowerCase();
}

export function loadLearnedTerms() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const list = safeJsonParse(raw || "[]", []);
  return Array.isArray(list) ? list : [];
}

export function saveLearnedTerms(terms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(terms));
}

export function clearLearnedTerms() {
  saveLearnedTerms([]);
}

export function upsertLearnedTerm(term) {
  const next = {
    word: normalizeWord(term?.word),
    definition: String(term?.definition || "").trim(),
    category: String(term?.category || "misc").trim().toLowerCase(),
    synonyms: Array.isArray(term?.synonyms) ? term.synonyms.map((s) => normalizeWord(s)).filter(Boolean) : [],
    antonyms: Array.isArray(term?.antonyms) ? term.antonyms.map((a) => normalizeWord(a)).filter(Boolean) : [],
    learnedAt: new Date().toISOString(),
  };

  if (!next.word || !next.definition) {
    throw new Error("Learned term must include at least { word, definition }.");
  }

  const existing = loadLearnedTerms();
  const idx = existing.findIndex((t) => normalizeWord(t.word) === next.word);
  if (idx >= 0) existing[idx] = { ...existing[idx], ...next };
  else existing.unshift(next);

  saveLearnedTerms(existing);
  return next;
}

export function logUnknownQuestion(input) {
  const entry = {
    text: String(input || "").trim(),
    time: new Date().toISOString(),
  };

  const raw = localStorage.getItem(UNKNOWN_KEY);
  const list = safeJsonParse(raw || "[]", []);
  const next = Array.isArray(list) ? list : [];
  next.unshift(entry);

  // keep it bounded
  if (next.length > 200) next.length = 200;
  localStorage.setItem(UNKNOWN_KEY, JSON.stringify(next));
}

export function clearUnknownQuestions() {
  localStorage.setItem(UNKNOWN_KEY, JSON.stringify([]));
}

export function mergeTerms(baseTerms, learnedTerms) {
  const byWord = new Map();

  (Array.isArray(baseTerms) ? baseTerms : []).forEach((t) => {
    const key = normalizeWord(t?.word);
    if (!key) return;
    byWord.set(key, {
      ...t,
      word: key,
      synonyms: Array.isArray(t.synonyms) ? t.synonyms.map((s) => normalizeWord(s)).filter(Boolean) : [],
      antonyms: Array.isArray(t.antonyms) ? t.antonyms.map((a) => normalizeWord(a)).filter(Boolean) : [],
      category: String(t.category || "misc").trim().toLowerCase(),
      definition: String(t.definition || "").trim(),
    });
  });

  (Array.isArray(learnedTerms) ? learnedTerms : []).forEach((t) => {
    const key = normalizeWord(t?.word);
    if (!key) return;
    byWord.set(key, {
      ...t,
      word: key,
      synonyms: Array.isArray(t.synonyms) ? t.synonyms.map((s) => normalizeWord(s)).filter(Boolean) : [],
      antonyms: Array.isArray(t.antonyms) ? t.antonyms.map((a) => normalizeWord(a)).filter(Boolean) : [],
      category: String(t.category || "misc").trim().toLowerCase(),
      definition: String(t.definition || "").trim(),
    });
  });

  return Array.from(byWord.values());
}
