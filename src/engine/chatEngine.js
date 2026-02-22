/**
 * chatEngine.js
 * ToastyMills — local-first chat response engine.
 *
 * Bridges the dictionary (#01) and thesaurus similarity engine (#02)
 * to conversational chat responses. No external API required — all
 * knowledge comes from dictionary.js and similarityEngine.js.
 *
 * Supported intent patterns:
 *   define [word]               → look up definition
 *   synonyms of [word]          → list synonyms
 *   antonyms of [word]          → list antonyms
 *   similar to [word]           → ranked similar terms
 *   connect [wordA] and [wordB] → shortest thesaurus path
 *   category [name]             → list terms in category
 *   [word]?                     → quick lookup shorthand
 */

import {
  buildThesaurusGraph,
  findSimilarities,
  getSimilarityPath,
} from "./similarityEngine";

// ─── Intent Detection ─────────────────────────────────────────────────────────

const INTENT_PATTERNS = [
  {
    id: "define",
    patterns: [
      /^define\s+(.+)$/i,
      /^what(?:'s| is) (?:a |an |the )?(.+?)\??$/i,
      /^meaning of\s+(.+)$/i,
      /^look up\s+(.+)$/i,
    ],
    extract: (m) => ({ word: m[1].trim().toLowerCase() }),
  },
  {
    id: "synonyms",
    patterns: [
      /^synonyms?(?: of| for)?\s+(.+)$/i,
      /^words? (?:like|similar to|related to)\s+(.+)$/i,
      /^what(?:'s| are) (?:the )?synonyms?(?: of| for)?\s+(.+?)\??$/i,
    ],
    extract: (m) => ({ word: m[1].trim().toLowerCase() }),
  },
  {
    id: "antonyms",
    patterns: [
      /^antonyms?(?: of| for)?\s+(.+)$/i,
      /^opposite(?:s)?(?: of| to)?\s+(.+)$/i,
      /^what(?:'s| are) (?:the )?antonyms?(?: of| for)?\s+(.+?)\??$/i,
    ],
    extract: (m) => ({ word: m[1].trim().toLowerCase() }),
  },
  {
    id: "similar",
    patterns: [
      /^similar(?:ities)?(?: to)?\s+(.+)$/i,
      /^(?:find |show )?connections?(?: to| for)?\s+(.+)$/i,
      /^related (?:words? (?:to|for) )?(.+)$/i,
    ],
    extract: (m) => ({ word: m[1].trim().toLowerCase() }),
  },
  {
    id: "connect",
    patterns: [
      /^connect\s+(.+?)\s+(?:and|to|with)\s+(.+)$/i,
      /^path(?: from)?\s+(.+?)\s+(?:to|and)\s+(.+)$/i,
      /^how (?:are|is)\s+(.+?)\s+(?:and|related to)\s+(.+?)\s*(?:connected|related|linked)\??$/i,
      /^link\s+(.+?)\s+(?:and|to)\s+(.+)$/i,
    ],
    extract: (m) => ({
      wordA: m[1].trim().toLowerCase(),
      wordB: m[2].trim().toLowerCase(),
    }),
  },
  {
    id: "category",
    patterns: [
      /^(?:list |show )?(?:all )?(\w+)\s+words?$/i,
      /^(?:what|show)(?: are)? (?:the )?(\w+)\s+(?:terms?|words?)$/i,
      /^category[:\s]+(.+)$/i,
    ],
    extract: (m) => ({ category: m[1].trim().toLowerCase() }),
  },
  {
    id: "help",
    patterns: [
      /^help$/i,
      /^(?:what can you do|commands?|how does this work)\??$/i,
    ],
    extract: () => ({}),
  },
  {
    id: "greeting",
    patterns: [/^(?:hi|hello|hey|howdy|greetings?|sup|yo)[\s!?]*$/i],
    extract: () => ({}),
  },
  {
    id: "quicklookup",
    patterns: [/^([a-z]+)\??$/i],
    extract: (m) => ({ word: m[1].trim().toLowerCase() }),
  },
];

/**
 * Detect the intent of a user's chat message.
 * @param {string} input
 * @returns {{ id: string, params: object } | null}
 */
export function detectIntent(input) {
  const cleaned = input.trim();
  for (const intent of INTENT_PATTERNS) {
    for (const pattern of intent.patterns) {
      const match = cleaned.match(pattern);
      if (match) {
        return { id: intent.id, params: intent.extract(match) };
      }
    }
  }
  return null;
}

// ─── Response Builders ────────────────────────────────────────────────────────

function termByWord(word, terms) {
  return terms.find((t) => t.word.toLowerCase() === word.toLowerCase()) || null;
}

function respondDefine(word, terms) {
  const term = termByWord(word, terms);
  if (!term) {
    return `I don't have **"${word}"** in my dictionary yet. Try searching a synonym — the dictionary has ${terms.length} terms.`;
  }
  const lines = [
    `**${term.word}** *(${term.category})*`,
    `> ${term.definition}`,
  ];
  if (term.synonyms.length) lines.push(`**Synonyms:** ${term.synonyms.join(", ")}`);
  if (term.antonyms.length) lines.push(`**Antonyms:** ${term.antonyms.join(", ")}`);
  return lines.join("\n");
}

function respondSynonyms(word, terms) {
  const term = termByWord(word, terms);
  if (!term) return `**"${word}"** isn't in my dictionary. Try a different spelling or check the Dictionary tab.`;
  if (!term.synonyms.length) return `**${term.word}** has no synonyms listed in the current dictionary.`;
  return `**Synonyms of "${term.word}":** ${term.synonyms.join(", ")}`;
}

function respondAntonyms(word, terms) {
  const term = termByWord(word, terms);
  if (!term) return `**"${word}"** isn't in my dictionary.`;
  if (!term.antonyms.length) return `**${term.word}** has no antonyms listed.`;
  return `**Antonyms of "${term.word}":** ${term.antonyms.join(", ")}`;
}

function respondSimilar(word, terms) {
  const results = findSimilarities(word, terms);
  if (!results.length) return `No similar terms found for **"${word}"**. Check the spelling or try the Dictionary tab.`;
  const top = results.slice(0, 5);
  const lines = [`**Words connected to "${word}":**`];
  top.forEach(({ term, connection, strength }) => {
    lines.push(`• **${term.word}** — ${connection} *(strength ${strength}%)*`);
  });
  return lines.join("\n");
}

function respondConnect(wordA, wordB, terms) {
  const graph = buildThesaurusGraph(terms);
  const path = getSimilarityPath(wordA, wordB, graph);
  if (!path) {
    // Try to explain partial existence
    const haA = !!termByWord(wordA, terms);
    const haB = !!termByWord(wordB, terms);
    if (!haA && !haB) return `Neither **"${wordA}"** nor **"${wordB}"** are in the dictionary.`;
    if (!haA) return `**"${wordA}"** isn't in the dictionary.`;
    if (!haB) return `**"${wordB}"** isn't in the dictionary.`;
    return `No thesaurus path connects **"${wordA}"** and **"${wordB}"** in the current dictionary. They may belong to unrelated concept clusters.`;
  }
  if (path.length === 1) return `**"${wordA}"** and **"${wordB}"** are the same word.`;
  return `**Connection path:** ${path.join(" → ")} *(${path.length - 1} step${path.length - 1 === 1 ? "" : "s"})*`;
}

function respondCategory(category, terms) {
  const matches = terms.filter((t) => t.category.toLowerCase() === category.toLowerCase());
  if (!matches.length) {
    const cats = [...new Set(terms.map((t) => t.category))].join(", ");
    return `No terms in category **"${category}"**. Available categories: *${cats}*.`;
  }
  const words = matches.map((t) => `**${t.word}**`).join(", ");
  return `**${category} terms (${matches.length}):** ${words}`;
}

function respondHelp() {
  return [
    "**ToastyMills Chat — Commands:**",
    "• `define [word]` — look up a word",
    "• `synonyms [word]` — list synonyms",
    "• `antonyms [word]` — list antonyms",
    "• `similar to [word]` — find related terms ranked by connection strength",
    "• `connect [wordA] and [wordB]` — find the shortest thesaurus path",
    "• `[category] words` — list all terms in a category (emotion, cognitive, nature, action, abstract)",
    "• Or just type a single word for a quick lookup!",
  ].join("\n");
}

function respondGreeting() {
  const greets = [
    "Hey! I'm ToastyMills 🍞🔥 — your local word-connection engine. Ask me to `define` a word, find `synonyms`, or `connect` two ideas!",
    "Hello! Ready to explore vocabulary and word connections. Try `help` to see what I can do.",
    "Hey there! Type `help` for commands, or just ask me about any word in the dictionary.",
  ];
  return greets[Math.floor(Math.random() * greets.length)];
}

function respondFallback(input, terms) {
  // Last resort: try a quick lookup treating the entire input as a word
  const word = input.trim().toLowerCase();
  const term = termByWord(word, terms);
  if (term) return respondDefine(word, terms);
  return [
    `I'm not sure how to answer that — but I'm a word engine, not a general AI!`,
    `Try: \`define [word]\`, \`synonyms [word]\`, \`connect [A] and [B]\`, or \`help\`.`,
  ].join("\n");
}

// ─── Main Reply Function ──────────────────────────────────────────────────────

/**
 * Generate a chat response based on the user's input and the dictionary.
 * @param {string} input  - raw user message
 * @param {Array}  terms  - dictionary array
 * @returns {string} response text (markdown-friendly)
 */
export function generateReply(input, terms) {
  if (!input || !input.trim()) return "Say something! Try `help` to see what I can do.";

  const intent = detectIntent(input);
  if (!intent) return respondFallback(input, terms);

  const { id, params } = intent;

  switch (id) {
    case "define":
      return respondDefine(params.word, terms);
    case "synonyms":
      return respondSynonyms(params.word, terms);
    case "antonyms":
      return respondAntonyms(params.word, terms);
    case "similar":
      return respondSimilar(params.word, terms);
    case "connect":
      return respondConnect(params.wordA, params.wordB, terms);
    case "category":
      return respondCategory(params.category, terms);
    case "help":
      return respondHelp();
    case "greeting":
      return respondGreeting();
    case "quicklookup":
      return respondDefine(params.word, terms);
    default:
      return respondFallback(input, terms);
  }
}
