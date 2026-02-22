import { buildThesaurusGraph, findSimilarities, getSimilarityPath } from "./similarityEngine";

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","so","to","of","in","on","for","with","as","at","by","from",
  "is","are","was","were","be","been","being","do","does","did","can","could","should","would","will","won't","dont","don't",
  "i","you","we","they","he","she","it","me","my","your","our","their","this","that","these","those",
]);

function normalize(text) {
  return String(text || "").toLowerCase();
}

function extractKeywords(text, max = 6) {
  const t = normalize(text);
  const words = t.match(/[a-z0-9']{2,}/g) || [];
  const cleaned = words
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w && !STOPWORDS.has(w));

  // naive frequency
  const freq = new Map();
  for (const w of cleaned) freq.set(w, (freq.get(w) || 0) + 1);

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

export function connectIdeas(input, terms) {
  const keywords = extractKeywords(input, 6);
  if (!keywords.length) return [];

  const graph = buildThesaurusGraph(terms);
  const suggestions = [];

  for (const kw of keywords) {
    const sims = findSimilarities(kw, terms).slice(0, 3);
    for (const s of sims) {
      suggestions.push({
        keyword: kw,
        word: s.term.word,
        connection: s.connection,
        strength: s.strength,
      });
    }
  }

  // Try a couple short paths between keyword pairs if they exist in graph
  const paths = [];
  for (let i = 0; i < Math.min(3, keywords.length); i++) {
    for (let j = i + 1; j < Math.min(3, keywords.length); j++) {
      const a = keywords[i];
      const b = keywords[j];
      const p = getSimilarityPath(a, b, graph);
      if (p && p.length > 1 && p.length <= 5) {
        paths.push({ a, b, path: p });
      }
    }
  }

  const top = suggestions
    .sort((x, y) => y.strength - x.strength)
    .slice(0, 8);

  return {
    keywords,
    suggestions: top,
    paths: paths.slice(0, 3),
  };
}
