import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { detectIntent, generateReply } from "../engine/chatEngine";
import { getOllamaConfig, isOllamaEnabled, isOllamaRemote, ollamaGenerate } from "../engine/ollamaClient";
import { loadLearnedTerms, logUnknownQuestion } from "../engine/learningStore";
import { detectGrammarIssues, suggestCorrection } from "../engine/grammarEngine";
import { isRigBridgeEnabled, rigClear, rigLookup, rigSearchLocal } from "../engine/rigBridgeClient";
import { connectIdeas } from "../engine/ideaConnector";
import { assessRisk } from "../engine/riskEngine";
import { getBrainConfig, setBrainConfig } from "../engine/brainStore";
import { fetchOllamaModels } from "../engine/ollamaModels";
import { llmRouteToCommand } from "../engine/llmRouter";
import { deletePrompt, loadPrompts, upsertPrompt } from "../engine/promptLibrary";
import {
  createChat,
  deleteChat,
  loadChatSessions,
  setActiveChat,
  updateChatMessages,
  updateChatSettings,
} from "../engine/chatSessions";
import styles from "./ToastyChat.module.css";

const CAN_AUTO_LEARN = (() => {
  const v = (process.env.REACT_APP_AUTO_LEARN || "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
})();

const HUMOR_MODE = (() => {
  const v = (process.env.REACT_APP_HUMOR_MODE || "1").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
})();

const AUTO_LOOKUP_DEFINE = (() => {
  const v = (process.env.REACT_APP_AUTO_LOOKUP_DEFINE || "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
})();

function initialsFrom(title) {
  const t = String(title || "").trim();
  if (!t) return "P";
  const words = t.split(/\s+/).filter(Boolean);
  const a = (words[0] || "")[0] || "P";
  const b = (words[1] || "")[0] || (words[0] || "")[1] || "";
  return (a + b).toUpperCase();
}

const WELCOME_MESSAGES = [
  {
    id: "sys-1",
    role: "system",
    text: "ToastyMills local Ollama chat is active. Runs on your device — no API keys.",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  },
  {
    id: "bot-1",
    role: "assistant",
    text: "Hey! I'm ToastyMills 🍞🔥 — local chat powered by your Ollama model.\n\nYou can type naturally (no special commands required).",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  },
];

/**
 * Render plain text with **bold** markdown as <strong> elements.
 */
function RichText({ text }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : part
      )}
    </>
  );
}

function Message({ msg }) {
  return (
    <div className={`${styles.message} ${styles[msg.role]}`}>
      <div className={styles.bubble}>
        {msg.text.split("\n").map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            <RichText text={line} />
          </span>
        ))}
      </div>
      {msg.time && <span className={styles.meta}>{msg.time}</span>}
    </div>
  );
}

function ToastyChat({ terms, onLearnTerm, onClearLearned }) {
  const [sessionState, setSessionState] = useState(() => loadChatSessions(WELCOME_MESSAGES));
  const activeChat = sessionState.chats.find((c) => c.id === sessionState.activeId) || sessionState.chats[0];
  const [messages, setMessages] = useState(activeChat.messages || WELCOME_MESSAGES);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const thinkingRef = useRef(null);

  const [brainCfg, setBrainCfg] = useState(() => getBrainConfig());
  const [ollamaModels, setOllamaModels] = useState([]);
  const [ollamaModelsStatus, setOllamaModelsStatus] = useState("idle");

  const [prompts, setPrompts] = useState(() => loadPrompts());
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  const [thinkingEffort, setThinkingEffort] = useState(() => {
    const v = activeChat?.settings?.thinkingEffort;
    return v === "extended" ? "extended" : v === null ? null : "standard";
  });
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);

  const [genStatus, setGenStatus] = useState(() => ({
    active: false,
    startedAt: 0,
    percent: 0,
    elapsedMs: 0,
  }));

  const MAX_MESSAGES = 250;

  function openNewPrompt() {
    setEditingPrompt({
      title: "",
      description: "",
      text: "",
      level: "basic",
      avatarText: "",
      avatarImage: "",
    });
    setShowPromptEditor(true);
  }

  function openEditPrompt(p) {
    setEditingPrompt({ ...p });
    setShowPromptEditor(true);
  }

  function closePromptEditor() {
    setShowPromptEditor(false);
    setEditingPrompt(null);
  }

  async function onPickAvatarFile(file) {
    if (!file) return;
    if (!/^image\//i.test(file.type)) return;

    const reader = new FileReader();
    const dataUrl = await new Promise((resolve) => {
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });

    if (!dataUrl) return;
    setEditingPrompt((prev) => (prev ? { ...prev, avatarImage: dataUrl } : prev));
  }

  function savePromptDraft() {
    const p = editingPrompt;
    if (!p) return;
    const title = String(p.title || "").trim();
    const text = String(p.text || "").trim();
    if (!title || !text) return;

    const avatarText = String(p.avatarText || "").trim() || initialsFrom(title);
    const next = upsertPrompt({ ...p, title, text, avatarText });
    setPrompts(next);
    closePromptEditor();
  }

  function removePromptDraft() {
    const p = editingPrompt;
    if (!p?.id) return;
    const next = deletePrompt(p.id);
    setPrompts(next);
    closePromptEditor();
  }

  function handlePromptUse(p) {
    const text = String(p?.text || "").trim();
    if (!text) return;
    setInput(text);
    queueMicrotask(() => inputRef.current?.focus());
  }

  useEffect(() => {
    // Keep local state in sync with localStorage-backed config.
    setBrainCfg(getBrainConfig());
  }, []);

  useEffect(() => {
    // When active chat changes, load its messages.
    const current = sessionState.chats.find((c) => c.id === sessionState.activeId);
    const nextMessages = current?.messages || WELCOME_MESSAGES;
    setMessages((prev) => (prev === nextMessages ? prev : nextMessages));

    const eff = current?.settings?.thinkingEffort;
    setThinkingEffort(eff === "extended" ? "extended" : eff === null ? null : "standard");
    setThinkingMenuOpen(false);
  }, [sessionState.activeId, sessionState.chats]);

  useEffect(() => {
    if (!thinkingMenuOpen) return;

    function onDocDown(e) {
      const node = thinkingRef.current;
      if (!node) return;
      if (node.contains(e.target)) return;
      setThinkingMenuOpen(false);
    }

    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [thinkingMenuOpen]);

  useEffect(() => {
    if (!genStatus.active) return;

    const startedAt = genStatus.startedAt || Date.now();
    const id = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const t = elapsedMs / 1000;
      // Indeterminate-but-informative progress: rise to 90% and wait for completion.
      const rise = Math.min(0.9, 1 - Math.exp(-t / 2.4));
      const wobble = 0.015 * Math.sin(t * 2.2);
      const percent = Math.max(1, Math.min(90, Math.floor((rise + wobble) * 100)));
      setGenStatus((prev) => (prev.active ? { ...prev, percent, elapsedMs } : prev));
    }, 160);

    return () => clearInterval(id);
  }, [genStatus.active, genStatus.startedAt]);

  function startGenerating() {
    setGenStatus({ active: true, startedAt: Date.now(), percent: 1, elapsedMs: 0 });
  }

  function stopGenerating() {
    setGenStatus((prev) => ({ ...prev, active: false, percent: 0, elapsedMs: 0 }));
  }

  function persistThinking(nextEffort) {
    setThinkingEffort(nextEffort);
    setSessionState((prev) => {
      if (!prev?.activeId) return prev;
      return updateChatSettings(prev, prev.activeId, { thinkingEffort: nextEffort });
    });
  }

  function applyThinkingCommand(text, time) {
    const t = String(text || "").trim();
    if (!t) return { handled: false };

    const m = t.match(/^(?:thinking\s*)?(standard|normal|extended|off|disable)\s*$/i);
    if (m) {
      const v = m[1].toLowerCase();
      const next = v === "extended" ? "extended" : v === "standard" || v === "normal" ? "standard" : null;
      persistThinking(next);
      const label = next === "extended" ? "Extended" : next === "standard" ? "Standard" : "Off";
      return { handled: true, reply: `Thinking effort: **${label}**.`, time };
    }

    // If disabled and user starts the message with these keywords, auto-enable.
    if (thinkingEffort === null && /^extended\b/i.test(t)) {
      persistThinking("extended");
      return { handled: true, reply: "Thinking enabled: **Extended**.", time };
    }
    if (thinkingEffort === null && /^thinking\b/i.test(t)) {
      persistThinking("standard");
      return { handled: true, reply: "Thinking enabled: **Standard**.", time };
    }

    return { handled: false };
  }

  useEffect(() => {
    // Persist message updates for the active chat.
    setSessionState((prev) => {
      if (!prev?.activeId) return prev;
      return updateChatMessages(prev, prev.activeId, messages);
    });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setOllamaModelsStatus("loading");
      try {
        const names = await fetchOllamaModels();
        if (cancelled) return;
        setOllamaModels(names);
        setOllamaModelsStatus("ready");

        // If current model isn't installed, preselect the first available one.
        const current = getBrainConfig();
        if (current.provider === "ollama" && names.length && !names.includes(current.model)) {
          const next = setBrainConfig({ model: names[0], provider: "ollama" });
          setBrainCfg(next);
        }
      } catch {
        if (cancelled) return;
        setOllamaModels([]);
        setOllamaModelsStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const showOllamaUnavailableHint = ollamaModelsStatus === "error" || !ollamaModels.length;

  const modelOptions = useMemo(() => {
    const unique = Array.from(new Set(ollamaModels));
    unique.sort((a, b) => a.localeCompare(b));
    return unique;
  }, [ollamaModels]);

  function newChat() {
    const next = createChat(sessionState, WELCOME_MESSAGES);
    setSessionState(next);
    setMessages(next.chats.find((c) => c.id === next.activeId)?.messages || WELCOME_MESSAGES);
  }

  function pickChat(id) {
    const next = setActiveChat(sessionState, id);
    setSessionState(next);
  }

  function removeChat(id) {
    const next = deleteChat(sessionState, id, WELCOME_MESSAGES);
    setSessionState(next);
    setMessages(next.chats.find((c) => c.id === next.activeId)?.messages || WELCOME_MESSAGES);
  }

  function updateBrain(patch) {
    const next = setBrainConfig(patch);
    setBrainCfg(next);
  }

  function applyBrainCommand(text, time) {
    const trimmed = String(text || "").trim();

    if (/^brain\s+help\s*$/i.test(trimmed)) {
      return {
        handled: true,
        reply:
          "Brain commands:\n" +
          "• `model <name>` — switch Ollama model (ex: `mistral:latest`)\n" +
          "• `style claude|neutral` — switch writing style",
        time,
      };
    }

    const mModel = trimmed.match(/^model\s+(.+)$/i);
    if (mModel) {
      const name = mModel[1].trim();
      const next = setBrainConfig({ model: name, provider: "ollama" });
      setBrainCfg(next);
      return { handled: true, reply: `Model set to **${next.model}**.`, time };
    }

    const mStyle = trimmed.match(/^style\s+(claude|neutral)\s*$/i);
    if (mStyle) {
      const style = mStyle[1].toLowerCase();
      const next = setBrainConfig({ style });
      setBrainCfg(next);
      return { handled: true, reply: `Style set to **${next.style}**.`, time };
    }

    return { handled: false };
  }

  function parseLearnCommand(text) {
    // Supported:
    // 1) learn word | category | definition | synonyms (comma) | antonyms (comma)
    // 2) learn json <object|array>
    const trimmed = String(text || "").trim();
    if (!/^learn\b/i.test(trimmed)) return null;

    const rest = trimmed.replace(/^learn\s*/i, "");
    if (!rest) return { kind: "help" };

    if (/^json\b/i.test(rest)) {
      const jsonText = rest.replace(/^json\s*/i, "");
      return { kind: "json", jsonText };
    }

    const parts = rest.split("|").map((p) => p.trim());
    const [word, category, definition, synonyms, antonyms] = parts;
    if (!word || !definition) return { kind: "help" };

    const splitList = (s) =>
      String(s || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

    return {
      kind: "term",
      term: {
        word,
        category: category || "misc",
        definition,
        synonyms: splitList(synonyms),
        antonyms: splitList(antonyms),
      },
    };
  }

  function handleExportLearned(time) {
    const learned = loadLearnedTerms();
    const blob = new Blob([JSON.stringify(learned, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `toastyMills-learned-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setMessages((prev) => [
      ...prev,
      {
        id: `b-${Date.now() + 8}`,
        role: "assistant",
        text: `Exported ${learned.length} learned term${learned.length === 1 ? "" : "s"} to a JSON download.`,
        time,
      },
    ]);
  }

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(
    async (text) => {
      const trimmed = (text || input).trim();
      if (!trimmed) return;

      const risk = assessRisk(trimmed);

      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const userMsg = {
        id: `u-${Date.now()}`,
        role: "user",
        text: trimmed,
        time,
      };

      setMessages((prev) => [...prev, userMsg]);
      setMessages((prev) => (prev.length > MAX_MESSAGES ? prev.slice(-MAX_MESSAGES) : prev));
      setInput("");

      try {
        {
          const thinkCmd = applyThinkingCommand(trimmed, time);
          if (thinkCmd.handled) {
            setMessages((prev) => [
              ...prev,
              { id: `b-${Date.now() + 40}`, role: "assistant", text: thinkCmd.reply, time },
            ]);
            return;
          }
        }

        {
          const brainCmd = applyBrainCommand(trimmed, time);
          if (brainCmd.handled) {
            setMessages((prev) => [
              ...prev,
              { id: `b-${Date.now() + 41}`, role: "assistant", text: brainCmd.reply, time },
            ]);
            return;
          }
        }

        if (/^clear\s+chat\s*$/i.test(trimmed)) {
          setMessages(WELCOME_MESSAGES);
          setMessages((prev) => [...prev, { id: `b-${Date.now() + 20}`, role: "assistant", text: "Chat cleared.", time }]);
          return;
        }

        if (/^clear\s+learned\s*$/i.test(trimmed)) {
          if (typeof onClearLearned === "function") onClearLearned();
          setMessages((prev) => [
            ...prev,
            { id: `b-${Date.now() + 21}`, role: "assistant", text: "Cleared learned terms on this machine.", time },
          ]);
          return;
        }

        if (/^bridge\s+help\s*$/i.test(trimmed)) {
          setMessages((prev) => [
            ...prev,
            {
              id: `b-${Date.now() + 10}`,
              role: "assistant",
              text:
                "Rig bridge commands (requires REACT_APP_RIG_BRIDGE_ENABLED=1 + bridge server running):\n" +
                "• lookup <text>\n" +
                "• search local <text>\n" +
                "• clear local logs",
              time,
            },
          ]);
          return;
        }

        if (isRigBridgeEnabled()) {
          const mLookup = trimmed.match(/^lookup\s+(.+)$/i);
          if (mLookup) {
            const query = mLookup[1].trim();
            const r = await rigLookup(query, { engine: "define", chrome: true });
            setMessages((prev) => [
              ...prev,
              {
                id: `b-${Date.now() + 11}`,
                role: "assistant",
                text: `Opened browser lookup for: **${query}**\n${r.url || ""}`.trim(),
                time,
              },
            ]);
            return;
          }

          const mSearch = trimmed.match(/^search\s+local\s+(.+)$/i);
          if (mSearch) {
            const query = mSearch[1].trim();
            const r = await rigSearchLocal(query, { limit: 5 });
            const rows = (r.results || []).slice(0, 5);
            const text = rows.length
              ? [
                  `Local matches for **${query}**:`,
                  ...rows.map((x) => `• ${x.path}${x.snippet ? `\n  ${x.snippet}` : ""}`),
                ].join("\n")
              : `No local matches for **${query}**.`;
            setMessages((prev) => [
              ...prev,
              { id: `b-${Date.now() + 12}`, role: "assistant", text, time },
            ]);
            return;
          }

          if (/^clear\s+local\s+logs\s*$/i.test(trimmed)) {
            await rigClear("learn");
            setMessages((prev) => [
              ...prev,
              { id: `b-${Date.now() + 13}`, role: "assistant", text: "Cleared local rig logs.", time },
            ]);
            return;
          }
        }

        if (/^export\s+learned\s*$/i.test(trimmed)) {
          handleExportLearned(time);
          return;
        }

        // Local learning command (no Ollama required)
        const learn = parseLearnCommand(trimmed);
        if (learn) {
          if (learn.kind === "help") {
            setMessages((prev) => [
              ...prev,
              {
                id: `b-${Date.now() + 1}`,
                role: "assistant",
                text:
                  "Learning commands:\n" +
                  "• learn word | category | definition | synonyms,comma | antonyms,comma\n" +
                  "• learn json { ...term }  (or an array of terms)",
                time,
              },
            ]);
            return;
          }

          if (learn.kind === "json") {
            let parsed;
            try {
              parsed = JSON.parse(learn.jsonText);
            } catch {
              throw new Error("Invalid JSON. Try: learn json {\"word\":\"...\",\"definition\":\"...\"}");
            }

            const items = Array.isArray(parsed) ? parsed : [parsed];
            const add = typeof onLearnTerm === "function" ? onLearnTerm : null;
            if (!add) throw new Error("Learning is not wired (missing onLearnTerm).");

            let count = 0;
            for (const item of items) {
              add(item);
              count += 1;
            }

            setMessages((prev) => [
              ...prev,
              {
                id: `b-${Date.now() + 2}`,
                role: "assistant",
                text: `Learned ${count} term${count === 1 ? "" : "s"} locally.`,
                time,
              },
            ]);
            return;
          }

          if (learn.kind === "term") {
            const add = typeof onLearnTerm === "function" ? onLearnTerm : null;
            if (!add) throw new Error("Learning is not wired (missing onLearnTerm).");
            add(learn.term);
            setMessages((prev) => [
              ...prev,
              {
                id: `b-${Date.now() + 2}`,
                role: "assistant",
                text: `Learned **${String(learn.term.word).trim()}** locally.`,
                time,
              },
            ]);
            return;
          }
        }

        let intent = detectIntent(trimmed);

        // If we didn't detect a command, try an Ollama router that converts
        // free-form text into one of our supported commands.
        if (!intent && isOllamaEnabled()) {
          const { baseUrl } = getOllamaConfig();
          const remote = isOllamaRemote(baseUrl);
          if (!(remote && risk.level === "high")) {
            try {
              const brain = getBrainConfig();
              const routed = await llmRouteToCommand(risk.redactedText, terms, { model: brain.model, baseUrl });
              if (routed?.command && (routed.confidence ?? 0) >= 0.55) {
                intent = detectIntent(routed.command);
                if (intent) {
                  const replyText = generateReply(routed.command, terms);
                  setMessages((prev) => {
                    const botMsg = {
                      id: `b-${Date.now() + 4}`,
                      role: "assistant",
                      text: replyText,
                      time,
                    };
                    const next = [...prev, botMsg];
                    return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
                  });
                  return;
                }
              }
            } catch {
              // best-effort; fall through
            }
          }
        }

        // If the user isn't using a command, run lightweight English heuristics.
        if (!intent) {
          const analysis = detectGrammarIssues(trimmed);
          if (analysis.brokenLikely) {
            const suggestion = suggestCorrection(trimmed);
            const lines = [
              `English check: ${analysis.quality}/100`,
              analysis.issues.slice(0, 3).map((i) => `• ${i.message}`).join("\n"),
            ].filter(Boolean);
            if (suggestion && suggestion !== trimmed) {
              lines.push(`Suggestion: ${suggestion}`);
            }
            setMessages((prev) => [
              ...prev,
              {
                id: `g-${Date.now() + 5}`,
                role: "system",
                text: lines.join("\n"),
                time,
              },
            ]);
          }
        }

        // Keep the original local-first behavior for supported commands.
        if (intent) {
          // If the user is trying to define a word we don't have, optionally learn it.
          if (intent.id === "define") {
            const w = String(intent.params?.word || "").trim().toLowerCase();
            const exists = terms.some((t) => String(t.word || "").trim().toLowerCase() === w);
            if (!exists) {
              logUnknownQuestion(trimmed);

              // Optional: open a browser lookup automatically via local rig bridge.
              if (AUTO_LOOKUP_DEFINE && isRigBridgeEnabled()) {
                try {
                  await rigLookup(`meaning of ${w}`, { engine: "define", chrome: true });
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `b-${Date.now() + 22}`,
                      role: "assistant",
                      text: `Opened a browser lookup for **${w}** (local rig bridge).`,
                      time,
                    },
                  ]);
                } catch {
                  // silent: lookup is best-effort
                }
              }

              if (CAN_AUTO_LEARN && isOllamaEnabled()) {
                const thinkingMsg = {
                  id: `t-${Date.now() + 2}`,
                  role: "assistant",
                  text: "Learning…",
                  time,
                };
                setMessages((prev) => [...prev, thinkingMsg]);

                const prompt = [
                  "Create ONE new dictionary entry as STRICT JSON (no markdown, no extra text).",
                  "Schema:",
                  "{\"word\":string,\"definition\":string,\"category\":string,\"synonyms\":string[],\"antonyms\":string[]}",
                  "Rules:",
                  "- Use lowercase for word/synonyms/antonyms.",
                  "- Keep definition short (1-2 sentences).",
                  "- If unsure, set category to 'misc' and leave lists empty.",
                  "",
                  `WORD: ${w}`,
                ].join("\n");

                const json = await ollamaGenerate(prompt);
                const term = JSON.parse(json);
                if (typeof onLearnTerm === "function") onLearnTerm(term);

                setMessages((prev) => prev.filter((m) => m.id !== thinkingMsg.id));
              }
            }
          }

          const replyText = generateReply(trimmed, terms);
          const botMsg = {
            id: `b-${Date.now() + 1}`,
            role: "assistant",
            text: replyText,
            time,
          };
          setMessages((prev) => {
            const next = [...prev, botMsg];
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
          });
          return;
        }

        const brain = getBrainConfig();

        // Optional: if Ollama is enabled and selected, use it for non-command inputs.
        if (brain.provider === "ollama" && isOllamaEnabled()) {
          if (/-cloud\b/i.test(brain.model)) {
            setMessages((prev) => [
              ...prev,
              {
                id: `b-${Date.now() + 31}`,
                role: "assistant",
                text: "Selected model looks cloud-backed (ends with '-cloud'). For local-only usage, pick a non-cloud model from the dropdown.",
                time,
              },
            ]);
            return;
          }

          const { baseUrl } = getOllamaConfig();
          const remote = isOllamaRemote(baseUrl);

          // Hard safety: never send high-risk text to remote endpoints.
          if (remote && risk.level === "high") {
            setMessages((prev) => [
              ...prev,
              {
                id: `b-${Date.now() + 30}`,
                role: "assistant",
                text: `Blocked sending to remote model (sensitive content detected: ${risk.reasons.join(", ") || "high risk"}).\nTip: run Ollama on localhost, or remove/redact secrets.`,
                time,
              },
            ]);
            return;
          }

          const thinkingMsg = {
            id: `t-${Date.now() + 2}`,
            role: "assistant",
            text: "💭 Thinking…",
            time,
          };
          setMessages((prev) => [...prev, thinkingMsg]);
          startGenerating();

          const context = terms
            .map((t) => `${t.word}: ${t.definition} (synonyms: ${t.synonyms.join(", ")}; antonyms: ${t.antonyms.join(", ")})`)
            .join("\n");

          // Optional local retrieval (RAG) from your machine via the rig bridge.
          let localSnippets = "";
          if (isRigBridgeEnabled()) {
            try {
              const r = await rigSearchLocal(trimmed, { limit: 5 });
              const rows = (r.results || []).slice(0, 5);
              if (rows.length) {
                localSnippets = rows
                  .map((x) => `- ${x.path}\n  ${String(x.snippet || "").trim()}`.trim())
                  .join("\n");
              }
            } catch {
              // keep silent; bridge is optional
            }
          }

          // Lightweight idea-connection hints from the built-in thesaurus graph.
          const connected = connectIdeas(trimmed, terms);
          const connectionsText = connected && connected.suggestions && connected.suggestions.length
            ? connected.suggestions
                .slice(0, 6)
                .map((s) => `- ${s.word} (${s.connection}, ${s.strength}%)`)
                .join("\n")
            : "";

          const styleLine = brain.style === "claude"
            ? "Tone: helpful, precise, calm. Prefer short paragraphs and bullet points when useful."
            : "Tone: concise and neutral.";

          const effortLine =
            thinkingEffort === "extended"
              ? "Reasoning effort: EXTENDED. Spend extra effort to be correct. Check edge cases. Output only the final answer."
              : thinkingEffort === "standard"
              ? "Reasoning effort: STANDARD. Be correct and clear. Output only the final answer."
              : "Reasoning effort: OFF. Keep it short and direct. Output only the final answer.";

          const prompt = [
            "You are ToastyMills, a local-first vocabulary assistant.",
            "Write in clear, correct English.",
            "If the user message is fragmented, propose a corrected version before answering (1 line).",
            "Use ONLY the provided context for factual claims.",
            "If you do not have enough evidence, say what you can infer and what you cannot.",
            "If the user request is ambiguous, ask ONE short clarifying question and stop.",
            styleLine,
            effortLine,
            HUMOR_MODE ? "If the user is joking, reply lightly (no sarcasm), but stay helpful." : "",
            "Internally draft 2 alternative answers, then output ONLY the best final answer.",
            risk.level !== "low" ? `Privacy: the user message may contain personal info; treat placeholders like [REDACTED_*] as redacted.` : "",
            "",
            "REFERENCE CONTEXT:",
            context,
            localSnippets ? "\nLOCAL FILE SNIPPETS (system-only):\n" + localSnippets : "",
            connectionsText ? "\nIDEA CONNECTIONS (thesaurus graph):\n" + connectionsText : "",
            "",
            "USER:",
            risk.redactedText,
          ].filter(Boolean).join("\n");

          let reply;
          try {
            const numPredict = thinkingEffort === "extended" ? 1400 : thinkingEffort === "standard" ? 850 : 450;
            reply = await ollamaGenerate(prompt, { model: brain.model, baseUrl, numPredict });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const modelRelated = /model/i.test(msg) && /(not found|pull|unknown)/i.test(msg);
            if (!modelRelated) throw e;

            const fallbacks = ["mistral:latest", "qwen2.5-coder:7b"].filter((m) => m !== brain.model && !/-cloud\b/i.test(m));
            let recovered = false;
            for (const m of fallbacks) {
              try {
                const numPredict = thinkingEffort === "extended" ? 1400 : thinkingEffort === "standard" ? 850 : 450;
                reply = await ollamaGenerate(prompt, { model: m, baseUrl, numPredict });
                setBrainConfig({ provider: "ollama", model: m });
                recovered = true;
                break;
              } catch {
                // try next
              }
            }
            if (!recovered) throw e;
          }
          const botMsg = {
            id: `b-${Date.now() + 3}`,
            role: "assistant",
            text: reply || "(No response)",
            time,
          };

          setMessages((prev) => {
            const next = prev.filter((m) => m.id !== thinkingMsg.id).concat(botMsg);
            return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
          });
          stopGenerating();
          return;
        }

        // Default local-only fallback.
        if (risk.level !== "high") {
          logUnknownQuestion(trimmed);
        }
        const replyText = generateReply(trimmed, terms);
        const botMsg = {
          id: `b-${Date.now() + 1}`,
          role: "assistant",
          text: replyText,
          time,
        };
        setMessages((prev) => {
          const next = [...prev, botMsg];
          return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stopGenerating();

        // Keep failures seamless: avoid scary error dumps for optional components.
        const isOllamaError = /Ollama request failed|fetch failed|Failed to fetch|ECONNREFUSED|ETIMEDOUT/i.test(msg);
        if (isOllamaError) {
          const modelHint = /model/i.test(msg)
            ? "Tip: your selected model may not be installed. Try `model mistral:latest` (or run `ollama list`)."
            : "Tip: make sure Ollama is running locally on http://localhost:11434.";

          setMessages((prev) => [
            ...prev.filter((m) => m.role !== "assistant" || m.text !== "💭 Thinking…"),
            {
              id: `e-${Date.now() + 9}`,
              role: "assistant",
              text: `Ollama couldn’t answer — falling back to the local helper.\n${modelHint}`,
              time,
            },
          ]);
          return;
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now() + 9}`,
            role: "assistant",
            text: `Error: ${msg}`,
            time,
          },
        ]);
      }
    },
    [input, terms, onLearnTerm, onClearLearned]
  );

  function handleSubmit(e) {
    e.preventDefault();
    void send();
  }

  function handleComposerKeyDown(e) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className={styles.shell}>
      {/* Left chats list */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarTitle}>Chats</div>
          <button className={styles.sidebarNewBtn} type="button" onClick={newChat}>
            +
          </button>
        </div>

        <div className={styles.chatList}>
          {sessionState.chats
            .slice()
            .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
            .map((c) => (
              <div
                key={c.id}
                className={`${styles.chatRow}${c.id === sessionState.activeId ? ` ${styles.chatRowActive}` : ""}`}
              >
                <button
                  type="button"
                  className={styles.chatPick}
                  onClick={() => pickChat(c.id)}
                  title={c.title}
                >
                  {c.title || "New chat"}
                </button>
                <button
                  type="button"
                  className={styles.chatDelete}
                  onClick={() => removeChat(c.id)}
                  aria-label="Delete chat"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
        </div>
      </aside>

      {/* Main chat */}
      <div className={styles.container}>
      {/* Controls (local-only) */}
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <label className={styles.label}>Model</label>
          <select
            className={styles.select}
            value={brainCfg.model}
            onChange={(e) => updateBrain({ model: e.target.value, provider: "ollama" })}
            aria-label="Ollama model"
            disabled={ollamaModelsStatus === "loading"}
          >
            {modelOptions.length ? (
              modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))
            ) : (
              <option value={brainCfg.model}>
                {ollamaModelsStatus === "loading" ? "Loading…" : brainCfg.model}
              </option>
            )}
          </select>
        </div>

        <div className={styles.controlGroup}>
          <label className={styles.label}>Style</label>
          <select
            className={styles.select}
            value={brainCfg.style}
            onChange={(e) => updateBrain({ style: e.target.value })}
            aria-label="Writing style"
          >
            <option value="claude">Claude-like</option>
            <option value="neutral">Neutral</option>
          </select>
        </div>

        <button className={styles.newChatBtn} type="button" onClick={newChat}>
          New chat
        </button>
      </div>

      {showOllamaUnavailableHint && (
        <div className={styles.controlsHint}>
          Ollama models not detected. Ensure Ollama is running locally (localhost:11434).
        </div>
      )}

      {/* Message thread */}
      <div className={styles.messages}>
        {messages.map((msg) => (
          <Message key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Prompt library */}
      <div className={styles.promptBar}>
        <div className={styles.promptHeaderRow}>
          <div className={styles.promptHeader}>Prompts</div>
          <button className={styles.promptAddBtn} type="button" onClick={openNewPrompt}>
            + Add
          </button>
        </div>

        <div className={styles.promptGrid}>
          {prompts
            .slice()
            .sort(
              (a, b) =>
                String(a.level || "").localeCompare(String(b.level || "")) ||
                String(a.title || "").localeCompare(String(b.title || ""))
            )
            .map((p) => (
              <div key={p.id} className={styles.promptCard}>
                <button type="button" className={styles.promptUse} onClick={() => handlePromptUse(p)} title={p.text}>
                  <div className={styles.promptAvatar}>
                    {p.avatarImage ? (
                      <img className={styles.promptAvatarImg} src={p.avatarImage} alt="" />
                    ) : (
                      <span>{String(p.avatarText || initialsFrom(p.title)).slice(0, 3).toUpperCase()}</span>
                    )}
                  </div>
                  <div className={styles.promptMeta}>
                    <div className={styles.promptTitleRow}>
                      <span className={styles.promptTitle}>{p.title}</span>
                      <span className={styles.promptLevel}>{p.level === "intermediate" ? "Intermediate" : "Basic"}</span>
                    </div>
                    <div className={styles.promptDesc}>{p.description || ""}</div>
                  </div>
                </button>

                <button
                  type="button"
                  className={styles.promptEditBtn}
                  onClick={() => openEditPrompt(p)}
                  aria-label="Edit prompt"
                  title="Edit"
                >
                  ✎
                </button>
              </div>
            ))}
        </div>

        {showPromptEditor && editingPrompt && (
          <div className={styles.promptEditor}>
            <div className={styles.editorRow}>
              <label className={styles.editorLabel}>Title</label>
              <input
                className={styles.editorInput}
                value={editingPrompt.title || ""}
                onChange={(e) => setEditingPrompt((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="e.g. Triage an error"
              />
            </div>
            <div className={styles.editorRow}>
              <label className={styles.editorLabel}>Description</label>
              <input
                className={styles.editorInput}
                value={editingPrompt.description || ""}
                onChange={(e) => setEditingPrompt((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="1 line: what it does"
              />
            </div>
            <div className={styles.editorRow}>
              <label className={styles.editorLabel}>Level</label>
              <select
                className={styles.editorInput}
                value={editingPrompt.level || "basic"}
                onChange={(e) => setEditingPrompt((prev) => ({ ...prev, level: e.target.value }))}
              >
                <option value="basic">Basic</option>
                <option value="intermediate">Intermediate</option>
              </select>
            </div>
            <div className={styles.editorRow}>
              <label className={styles.editorLabel}>Avatar</label>
              <div className={styles.editorAvatarRow}>
                <input
                  className={styles.editorInput}
                  value={editingPrompt.avatarText || ""}
                  onChange={(e) => setEditingPrompt((prev) => ({ ...prev, avatarText: e.target.value }))}
                  placeholder="Initials (optional)"
                />
                <input
                  className={styles.editorFile}
                  type="file"
                  accept="image/*"
                  onChange={(e) => onPickAvatarFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
            <div className={styles.editorRow}>
              <label className={styles.editorLabel}>Prompt</label>
              <textarea
                className={styles.editorTextarea}
                value={editingPrompt.text || ""}
                onChange={(e) => setEditingPrompt((prev) => ({ ...prev, text: e.target.value }))}
                placeholder="What should it say / ask?"
              />
            </div>
            <div className={styles.editorActions}>
              <button className={styles.editorBtnPrimary} type="button" onClick={savePromptDraft}>
                Save
              </button>
              <button className={styles.editorBtn} type="button" onClick={closePromptEditor}>
                Cancel
              </button>
              {editingPrompt.id && (
                <button className={styles.editorBtnDanger} type="button" onClick={removePromptDraft}>
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <form onSubmit={handleSubmit} className={styles.inputBar}>
        {genStatus.active && (
          <div className={styles.genStatus} aria-live="polite">
            <div className={styles.genStatusLine}>
              <span className={styles.genStatusText}>
                Processing <span className={styles.genStatusPct}>{genStatus.percent}%</span>
              </span>
              <span className={styles.genStatusMeta}>
                {Math.max(0, genStatus.elapsedMs / 1000).toFixed(1)}s • {thinkingEffort === "extended" ? "Extended" : thinkingEffort === "standard" ? "Standard" : "Off"}
              </span>
            </div>
            <div className={styles.genBarOuter}>
              <div className={styles.genBarInner} style={{ width: `${genStatus.percent}%` }} />
            </div>
          </div>
        )}

        <div className={styles.composerTools} ref={thinkingRef}>
          {thinkingEffort ? (
            <div className={styles.thinkingPillWrap}>
              <button
                type="button"
                className={styles.thinkingX}
                onClick={() => {
                  persistThinking(null);
                  setThinkingMenuOpen(false);
                }}
                aria-label="Disable thinking"
                title="Disable thinking"
              >
                ×
              </button>
              <button
                type="button"
                className={styles.thinkingPill}
                onClick={() => setThinkingMenuOpen((v) => !v)}
                aria-expanded={thinkingMenuOpen ? "true" : "false"}
                aria-haspopup="menu"
              >
                <span className={styles.thinkingLabel}>Thinking</span>
                <span className={styles.thinkingChevron}>▾</span>
              </button>

              {thinkingMenuOpen && (
                <div className={styles.thinkingMenu} role="menu">
                  <div className={styles.thinkingMenuTitle}>Thinking effort</div>
                  <div className={styles.thinkingMenuHelp}>
                    Standard = normal answers. Extended = more thorough / more compute.
                  </div>
                  <button
                    type="button"
                    className={styles.thinkingMenuItem}
                    onClick={() => {
                      persistThinking("standard");
                      setThinkingMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    <span>Standard</span>
                    {thinkingEffort === "standard" && <span className={styles.thinkingCheck}>✓</span>}
                  </button>
                  <button
                    type="button"
                    className={styles.thinkingMenuItem}
                    onClick={() => {
                      persistThinking("extended");
                      setThinkingMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    <span>Extended</span>
                    {thinkingEffort === "extended" && <span className={styles.thinkingCheck}>✓</span>}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className={styles.thinkingAdd}
              onClick={() => persistThinking("standard")}
              title="Enable thinking"
            >
              + Thinking
            </button>
          )}
        </div>

        <div className={styles.composerRow}>
          <textarea
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask anything"
            aria-label="Chat input"
            autoFocus
            ref={inputRef}
          />
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={!input.trim()}
          >
            Send 🔥
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}

export default ToastyChat;
