const KEY = "toastyMills.chatSessions.v1";

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
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultTitle() {
  return "New chat";
}

function defaultSettings() {
  return {
    // 'standard' | 'extended' | null
    thinkingEffort: "standard",
  };
}

function normalizeChat(chat, welcomeMessages) {
  const createdAt = typeof chat?.createdAt === "string" && chat.createdAt ? chat.createdAt : nowIso();
  const updatedAt = typeof chat?.updatedAt === "string" && chat.updatedAt ? chat.updatedAt : createdAt;
  return {
    id: typeof chat?.id === "string" && chat.id ? chat.id : makeId(),
    title: typeof chat?.title === "string" && chat.title ? chat.title : defaultTitle(),
    createdAt,
    updatedAt,
    messages: Array.isArray(chat?.messages) ? chat.messages : Array.isArray(welcomeMessages) ? welcomeMessages : [],
    settings: {
      ...defaultSettings(),
      ...(chat?.settings && typeof chat.settings === "object" ? chat.settings : {}),
    },
  };
}

export function loadChatSessions(welcomeMessages) {
  const raw = localStorage.getItem(KEY);
  const parsed = safeParse(raw || "{}", {});
  const rawChats = Array.isArray(parsed.chats) ? parsed.chats : [];
  const activeId = typeof parsed.activeId === "string" ? parsed.activeId : "";
  const chats = rawChats.map((c) => normalizeChat(c, welcomeMessages));

  // If empty, create one.
  if (!chats.length) {
    const id = makeId();
    const createdAt = nowIso();
    const first = {
      id,
      title: defaultTitle(),
      createdAt,
      updatedAt: createdAt,
      messages: Array.isArray(welcomeMessages) ? welcomeMessages : [],
      settings: defaultSettings(),
    };
    const state = { activeId: id, chats: [first] };
    localStorage.setItem(KEY, JSON.stringify(state));
    return state;
  }

  // Ensure active exists
  const exists = chats.some((c) => c.id === activeId);
  const state = {
    activeId: exists ? activeId : chats[0].id,
    chats,
  };

  // Persist normalized structure (adds missing settings, fixes shapes).
  localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}

export function saveChatSessions(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function createChat(state, welcomeMessages) {
  const id = makeId();
  const t = nowIso();
  const chat = {
    id,
    title: defaultTitle(),
    createdAt: t,
    updatedAt: t,
    messages: Array.isArray(welcomeMessages) ? welcomeMessages : [],
    settings: defaultSettings(),
  };

  const next = {
    activeId: id,
    chats: [chat, ...(state?.chats || [])],
  };
  saveChatSessions(next);
  return next;
}

export function deleteChat(state, chatId, welcomeMessages) {
  const chats = (state?.chats || []).filter((c) => c.id !== chatId);

  if (!chats.length) {
    return loadChatSessions(welcomeMessages);
  }

  const activeId = state?.activeId === chatId ? chats[0].id : state?.activeId;
  const next = {
    activeId: chats.some((c) => c.id === activeId) ? activeId : chats[0].id,
    chats,
  };
  saveChatSessions(next);
  return next;
}

export function setActiveChat(state, chatId) {
  if (!(state?.chats || []).some((c) => c.id === chatId)) return state;
  const next = { ...state, activeId: chatId };
  saveChatSessions(next);
  return next;
}

export function updateChatMessages(state, chatId, messages) {
  const chats = (state?.chats || []).map((c) => {
    if (c.id !== chatId) return c;

    // Title from first user message
    let title = c.title;
    const firstUser = (messages || []).find((m) => m.role === "user" && m.text);
    if (firstUser && (title === defaultTitle() || !title)) {
      title = String(firstUser.text).trim().slice(0, 42);
    }

    return {
      ...c,
      title,
      updatedAt: nowIso(),
      messages: Array.isArray(messages) ? messages : [],
    };
  });

  const next = { ...state, chats };
  saveChatSessions(next);
  return next;
}

export function updateChatSettings(state, chatId, patch) {
  const chats = (state?.chats || []).map((c) => {
    if (c.id !== chatId) return c;
    const nextSettings = {
      ...defaultSettings(),
      ...(c?.settings && typeof c.settings === "object" ? c.settings : {}),
      ...(patch && typeof patch === "object" ? patch : {}),
    };

    // Normalize allowed values.
    if (nextSettings.thinkingEffort !== "extended" && nextSettings.thinkingEffort !== "standard") {
      nextSettings.thinkingEffort = null;
    }

    return {
      ...c,
      updatedAt: nowIso(),
      settings: nextSettings,
    };
  });

  const next = { ...state, chats };
  saveChatSessions(next);
  return next;
}

