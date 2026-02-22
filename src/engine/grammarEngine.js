const WORD_RE = /[a-z0-9']{2,}/gi;

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(text) {
  const t = String(text || "");
  const out = [];
  const matches = t.matchAll(WORD_RE);
  for (const m of matches) out.push(String(m[0]).toLowerCase());
  return out;
}

export function detectGrammarIssues(text) {
  // Local-only heuristics (NOT a full grammar checker)
  const original = String(text || "");
  const t = normalizeText(original);
  const issues = [];

  if (!t) {
    return {
      quality: 0,
      brokenLikely: true,
      issues: [{ kind: "empty", message: "Empty input" }],
    };
  }

  if (/\s{2,}/.test(original)) {
    issues.push({ kind: "spacing", message: "Multiple consecutive spaces" });
  }

  if (/[!?.,]{3,}/.test(t)) {
    issues.push({ kind: "punctuation", message: "Repeated punctuation (e.g. '!!!' or '...')" });
  }

  if (t.length >= 20 && /[a-z]/.test(t[0]) && t[0] === t[0].toLowerCase()) {
    issues.push({ kind: "capitalization", message: "Sentence starts with a lowercase letter" });
  }

  if (/\bi\b/.test(t)) {
    issues.push({ kind: "capitalization", message: "Standalone 'i' should usually be capitalized ('I')" });
  }

  if (t.length >= 40 && !/[.!?]$/.test(t)) {
    issues.push({ kind: "punctuation", message: "No sentence-ending punctuation" });
  }

  if (/\b(\w+)\s+\1\b/i.test(t)) {
    issues.push({ kind: "repetition", message: "Repeated word (e.g. 'the the')" });
  }

  const alpha = Array.from(t).filter((ch) => /[A-Za-z]/.test(ch)).length;
  const alphaRatio = alpha / Math.max(1, t.length);
  if (alphaRatio < 0.55) {
    issues.push({ kind: "noise", message: "Low alphabetic character ratio (may be fragmented/garbled)" });
  }

  const toks = tokenize(t);
  const short = toks.filter((tok) => tok.length <= 2).length;
  if (toks.length >= 8 && short / Math.max(1, toks.length) > 0.45) {
    issues.push({ kind: "fragmented", message: "High ratio of very short tokens" });
  }

  let quality = 100;
  quality -= 8 * issues.filter((i) => ["spacing", "punctuation", "capitalization"].includes(i.kind)).length;
  quality -= 10 * issues.filter((i) => ["noise", "fragmented"].includes(i.kind)).length;
  quality -= 6 * issues.filter((i) => i.kind === "repetition").length;
  quality = Math.max(0, Math.min(100, quality));

  const brokenLikely = quality < 70 || issues.some((i) => ["noise", "fragmented"].includes(i.kind));

  return {
    quality,
    brokenLikely,
    stats: {
      length: t.length,
      tokens: toks.length,
      uniqueTokens: new Set(toks).size,
      alphaRatio: Number(alphaRatio.toFixed(3)),
    },
    issues,
  };
}

export function suggestCorrection(text) {
  // Very small set of safe, deterministic edits.
  let s = normalizeText(text);
  if (!s) return "";

  // Capitalize standalone i
  s = s.replace(/\bi\b/g, "I");

  // Capitalize first character if it's a letter
  if (/^[a-z]/.test(s)) {
    s = s[0].toUpperCase() + s.slice(1);
  }

  // Add terminal punctuation for longer sentences
  if (s.length >= 40 && !/[.!?]$/.test(s)) {
    s = s + ".";
  }

  return s;
}
