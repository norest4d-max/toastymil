/**
 * Builds an adjacency list from synonyms across all dictionary terms.
 * @param {Array} terms - array of dictionary term objects
 * @returns {Object} adjacency list { word: [similar1, similar2, ...] }
 */
export function buildThesaurusGraph(terms) {
  const graph = {};

  terms.forEach((term) => {
    const word = String(term.word || "").trim().toLowerCase();
    if (!word) return;
    if (!graph[word]) graph[word] = new Set();

    (term.synonyms || []).forEach((syn) => {
      const synWord = String(syn || "").trim().toLowerCase();
      if (!synWord) return;
      graph[word].add(synWord);
      if (!graph[synWord]) graph[synWord] = new Set();
      graph[synWord].add(word);
    });
  });

  // Convert Sets to arrays
  const result = {};
  Object.keys(graph).forEach((key) => {
    result[key] = Array.from(graph[key]);
  });
  return result;
}

/**
 * Finds all dictionary terms similar to the given word.
 * @param {string} word
 * @param {Array} terms
 * @returns {Array} [{ term, connection, strength }]
 */
export function findSimilarities(word, terms) {
  const lowerWord = String(word || "").trim().toLowerCase();
  const results = [];

  const sourceTerm = terms.find((t) => String(t.word || "").trim().toLowerCase() === lowerWord);
  const sourceSyns = sourceTerm ? (sourceTerm.synonyms || []).map((s) => String(s || "").trim().toLowerCase()) : [];

  if (!lowerWord) return results;

  terms.forEach((term) => {
    const termWord = String(term.word || "").trim().toLowerCase();
    if (!termWord) return;
    if (termWord === lowerWord) return;

    const lowerSynonyms = (term.synonyms || []).map((s) => String(s || "").trim().toLowerCase());
    const lowerAntonyms = (term.antonyms || []).map((a) => String(a || "").trim().toLowerCase());

    // Direct synonym match
    if (lowerSynonyms.includes(lowerWord)) {
      results.push({ term, connection: "synonym", strength: 90 });
      return;
    }

    // Antonym match
    if (lowerAntonyms.includes(lowerWord)) {
      results.push({ term, connection: "antonym", strength: 40 });
      return;
    }

    // Shared synonyms (transitive)
    if (sourceTerm) {
      const sharedSyns = sourceSyns.filter((s) => lowerSynonyms.includes(s));
      if (sharedSyns.length > 0) {
        results.push({
          term,
          connection: `shared synonym: ${sharedSyns[0]}`,
          strength: 60 + Math.min(sharedSyns.length * 5, 20),
        });
        return;
      }

      // Same category
      if (term.category === sourceTerm.category) {
        results.push({ term, connection: "same category", strength: 30 });
      }
    }
  });

  return results.sort((a, b) => b.strength - a.strength);
}

/**
 * BFS shortest path between two words in the thesaurus graph.
 * @param {string} wordA
 * @param {string} wordB
 * @param {Object} graph
 * @returns {Array|null} path array or null if no path
 */
export function getSimilarityPath(wordA, wordB, graph) {
  const a = String(wordA || "").trim().toLowerCase();
  const b = String(wordB || "").trim().toLowerCase();
  if (!a || !b) return null;
  if (a === b) return [a];
  if (!graph[a] || !graph[b]) return null;

  const queue = [[a]];
  const visited = new Set([a]);

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const neighbors = graph[current] || [];

    for (const neighbor of neighbors) {
      if (neighbor === b) return [...path, b];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null;
}

/**
 * Scores a guess against the target word.
 * @param {string} guessWord
 * @param {string} targetWord
 * @param {Array} terms
 * @returns {{ score: number, feedback: string, connections: Array }}
 */
export function scoreGuess(guessWord, targetWord, terms) {
  const guess = String(guessWord || "").trim().toLowerCase();
  const target = String(targetWord || "").trim().toLowerCase();

  if (guess === target) {
    return { score: 100, feedback: "Exact match! You got it!", connections: [] };
  }

  const targetTerm = terms.find((t) => String(t.word || "").trim().toLowerCase() === target);
  if (!targetTerm) {
    return { score: 0, feedback: "Target word not found in dictionary.", connections: [] };
  }

  const guessTerm = terms.find((t) => String(t.word || "").trim().toLowerCase() === guess);
  const connections = [];
  let score = 0;

  // Check direct synonym/antonym relationship
  const targetSyns = (targetTerm.synonyms || []).map((s) => String(s || "").trim().toLowerCase());
  const targetAnts = (targetTerm.antonyms || []).map((a) => String(a || "").trim().toLowerCase());

  if (targetSyns.includes(guess)) {
    score = 85;
    connections.push({ type: "synonym", words: [guess, target] });
  } else if (targetAnts.includes(guess)) {
    score = 35;
    connections.push({ type: "antonym", words: [guess, target] });
  } else if (guessTerm) {
    const guessSyns = (guessTerm.synonyms || []).map((s) => String(s || "").trim().toLowerCase());
    const guessAnts = (guessTerm.antonyms || []).map((a) => String(a || "").trim().toLowerCase());

    if (guessSyns.includes(target)) {
      score = 85;
      connections.push({ type: "synonym", words: [guess, target] });
    } else if (guessAnts.includes(target)) {
      score = 35;
      connections.push({ type: "antonym", words: [guess, target] });
    } else {
      // Shared synonyms
      const shared = targetSyns.filter((s) => guessSyns.includes(s));
      if (shared.length > 0) {
        score = 50 + Math.min(shared.length * 8, 25);
        connections.push({ type: "shared synonym", words: shared });
      } else if (guessTerm.category === targetTerm.category) {
        score = 20;
        connections.push({ type: "same category", words: [guessTerm.category] });
      }
    }
  }

  // Build graph and find path
  const graph = buildThesaurusGraph(terms);
  const path = getSimilarityPath(guess, target, graph);
  if (path) {
    connections.push({ type: "path", words: path });
    if (score === 0) {
      // Partial credit for being in the graph neighborhood
      score = Math.max(10, 70 - (path.length - 2) * 15);
    }
  }

  let feedback;
  if (score >= 80) feedback = "Very close! Strong connection found.";
  else if (score >= 60) feedback = "Good guess! Related through shared concepts.";
  else if (score >= 40) feedback = "Somewhat related — keep trying!";
  else if (score >= 20) feedback = "Loosely connected. Think more closely.";
  else feedback = "No clear connection found. Try a synonym or related concept.";

  return { score, feedback, connections };
}

/**
 * Generates a random challenge from the dictionary.
 * @param {Array} terms
 * @returns {{ targetWord: string, hints: Array, maxGuesses: number }}
 */
export function generateChallenge(terms) {
  const idx = Math.floor(Math.random() * terms.length);
  const target = terms[idx];

  const hints = [
    `Category: ${target.category}`,
    `It has ${target.synonyms.length} known synonyms`,
    `First letter: "${target.word[0].toUpperCase()}"`,
    `Definition hint: ${target.definition.split(" ").slice(0, 5).join(" ")}...`,
  ];

  return {
    targetWord: target.word,
    hints,
    maxGuesses: 5,
  };
}
