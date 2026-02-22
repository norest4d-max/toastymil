# ToastyMills 🍞🔥

**ToastyMills** is a local-first React chat UI powered by **local Ollama** (GPU if your Ollama install uses it).

## Branch note (read this before changing defaults)

- `main` is kept for compatibility (some forks/PRs may target it).
- `clean-main` is a clean-history branch that points at the same code without the extra history-merge commit.

If GitHub warns that changing the default branch “may affect pull requests”, that’s normal: it mostly impacts which branch new PRs target by default.
To avoid disruption, either keep `main` as the default, or switch the default to `clean-main` and retarget any open PRs if needed.

It includes:
- Chat sessions (left sidebar)
- Prompt Library (ready-to-use prompts + add/edit)
- Thinking effort (Standard / Extended / Off) per chat

---

## 🖥️ Installation — Get It Running on Your Device

### Step 1 — Install the prerequisites

You need **Node.js** (which includes `npm`) and **Git** installed once on your machine.

| Tool | Download |
|---|---|
| Node.js (LTS) | https://nodejs.org — click **"LTS"** and run the installer |
| Git | https://git-scm.com/downloads |

> **On Windows?** Use **WSL (Windows Subsystem for Linux)** — it's the smoothest experience.
> Open **PowerShell as Administrator** and run:
> ```powershell
> wsl --install
> ```
> Restart your PC when prompted. Then open the **Ubuntu** app from the Start menu and continue with the Linux steps below.
> Node.js inside WSL: paste this into the Ubuntu terminal:
> ```bash
> curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
> sudo apt-get install -y nodejs
> ```

> **Windows (no WSL) note:** if PowerShell says `npm.ps1 cannot be loaded because running scripts is disabled`, you can either:
> - run `Set-ExecutionPolicy -Scope Process Bypass` (only affects the current terminal), or
> - run commands via `npm.cmd` instead of `npm`.

> **Ollama (local) note:** if you enable Ollama calls from the browser, you may need to allow the dev server origin.
> Start Ollama with an origin allow-list (example for CRA):
> - allow `http://localhost:3000`
> - keep Ollama on `http://localhost:11434`

---

## Local run (Ollama “brain”, self-hosted)

This repo supports a **local-only** pairing where:
- the UI is served from your machine
- Ollama runs locally (GPU if your Ollama install uses it)
- no API keys are required

### Rule 1: never commit secrets

Never put API keys/tokens/passwords into the git repo.

Use local-only config files outside the repo when needed.

This repo’s `.gitignore` already ignores common secret files (like `.env*`).

If you add local config folders or local data stores, keep them untracked (examples):
- `local_config/`
- `rig/data/` (logs / stores)

### Run the app

Development (recommended):

```bash
npm install
npm start
```

Production build:

```bash
npm run build
```

### Ollama (self-hosted on your device)

1) Install Ollama for your OS
2) Start Ollama locally (the UI calls it via the unified server proxy at `/ollama/*`)

Quick check:

```bash
curl http://127.0.0.1:11434/api/tags
```

If that responds, the app can use your local Ollama as its internal “brain”.

### “Claude-style” writing (but local)

This project uses Ollama as a **local chat brain**:
- ask questions normally (no special commands needed)
- the app retrieves local snippets (optional) and adds dictionary context
- Ollama produces a single best answer (it internally drafts alternatives)

Model/style switching:
- `model mistral:latest`
- `style claude` / `style neutral`

Thinking effort:
- Use the Thinking pill in the UI (Standard / Extended)
- Or type: `thinking standard`, `thinking extended`, `thinking off`

Important: keep Ollama on `localhost` if you want everything to stay on-device.

### Local config (no private info in repo)

If you want to toggle features (Ollama on/off, bridge on/off), keep config outside the repo:
- `D:/toastyMills/local_config/env.cmd`

Template:
- `D:/toastyMills/local_config/env.example.cmd`

Nothing in the repo requires passwords/tokens; keep any secrets in `env.cmd` only.

---

### Step 2 — Download the repo

Open your terminal (**WSL / Ubuntu** on Windows, **Terminal** on Mac, **bash** on Linux) and run:

```bash
git clone https://github.com/norest4d-max/toastyMills.git
```

Then move into the project folder:

```bash
cd toastyMills
```

---

### Step 3 — Install dependencies

```bash
npm install
```

If you're on Windows without WSL and hit the `npm.ps1` policy error, use:

```bash
npm.cmd install
```

This downloads everything the app needs (takes ~30 seconds the first time).

---

### Step 4 — Launch the app

```bash
npm start
```

Windows (no WSL) alternative:

```bash
npm.cmd start
```

Your browser will open automatically at **http://localhost:3000** 🎉

If it doesn't open on its own, just paste `http://localhost:3000` into your browser.

---

### Quick-reference (all four commands in order)

```bash
git clone https://github.com/norest4d-max/toastyMills.git
cd toastyMills
npm install
npm start
```

---

### Other useful commands

```bash
npm run build    # create an optimised production build in /build
npm test         # run the test suite
```

---

## How to Use

### 🔥 Chat Tab

The Chat tab is a local AI chat interface powered entirely by the dictionary and thesaurus — no internet or API key needed.

**Available commands:**

| Command | Example | What it does |
|---|---|---|
| `define [word]` | `define ephemeral` | Full definition, category, synonyms & antonyms |
| `synonyms [word]` | `synonyms melancholy` | Lists all synonyms |
| `antonyms [word]` | `antonyms resilience` | Lists all antonyms |
| `similar to [word]` | `similar to luminous` | Finds related terms ranked by connection strength |
| `connect [A] and [B]` | `connect joy and sorrow` | Shortest thesaurus path between two words |
| `[category] words` | `emotion words` | All terms in a category |
| `help` | `help` | Show all commands |
| `[word]` | `tenacity` | Quick single-word lookup |

**Quick action buttons** below the header let you fire common queries with one click.

---

### 📖 Dictionary Tab

- Type in the search box to filter by word, definition, category, or synonyms
- Each card shows: **word**, category badge, definition, synonym chips (blue), antonym chips (red)
- Categories: `abstract` · `emotion` · `nature` · `action` · `cognitive`

---

### 🧠 Similarity Game Tab

1. A mystery word is chosen from the dictionary
2. You start with one hint (category)
3. Type a guess and press **Guess** — the engine scores your answer 0–100:
   - **100** exact match
   - **85** direct synonym
   - **60–75** shared synonyms (transitive connection)
   - **35** antonym
   - **10–50** graph-distance score (BFS path)
4. A new hint unlocks after each incorrect guess (synonym count → first letter → partial definition)
5. After 5 guesses or a correct answer, the word is revealed and a new challenge starts

---

## Project Structure

```
src/
├── data/
│   └── dictionary.js          # #01 — 33 term objects: word, definition, category, synonyms, antonyms
├── engine/
│   ├── similarityEngine.js    # #02 — thesaurus graph, BFS path, scoring, challenge generation
│   └── chatEngine.js          # Intent detection + reply generation for the Chat tab
├── components/
│   ├── ToastyChat.js          # Chat UI (local-first, no API)
│   ├── ToastyChat.module.css
│   ├── DictionaryBrowser.js   # Dictionary browse & search UI
│   ├── DictionaryBrowser.module.css
│   ├── SimilarityGame.js      # Guessing game UI
│   └── SimilarityGame.module.css
├── App.js                     # Three-tab navigation
└── App.css                    # Global dark theme
```

---

## Engine API Reference

### `similarityEngine.js`

| Function | Description |
|---|---|
| `buildThesaurusGraph(terms)` | Bidirectional adjacency list from synonym relationships |
| `findSimilarities(word, terms)` | Returns `[{ term, connection, strength }]` sorted by strength |
| `getSimilarityPath(wordA, wordB, graph)` | BFS shortest semantic path, or `null` |
| `scoreGuess(guessWord, targetWord, terms)` | Returns `{ score: 0-100, feedback, connections }` |
| `generateChallenge(terms)` | Returns `{ targetWord, hints[], maxGuesses: 5 }` |

### `chatEngine.js`

| Function | Description |
|---|---|
| `detectIntent(input)` | Returns `{ id, params }` or `null` — matches 8 intent patterns via regex |
| `generateReply(input, terms)` | Full pipeline: intent detection → engine call → formatted reply |

---

## Tech Stack

- **React 19** — functional components, hooks (`useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`)
- **Create React App** — zero-config build tooling
- **CSS Modules** — scoped component styles, dark red/toast theme
- **Pure JS** — all NLP/similarity logic is local, zero external API calls

