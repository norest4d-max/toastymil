function enabled() {
  const v = (process.env.REACT_APP_RIG_BRIDGE_ENABLED || "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

function baseUrl() {
  return (process.env.REACT_APP_RIG_BRIDGE_URL || "http://127.0.0.1:8787").trim().replace(/\/$/, "");
}

async function postJson(path, body) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Rig bridge error (${res.status})`);
  }
  return data;
}

export function isRigBridgeEnabled() {
  return enabled();
}

export async function rigLookup(query, { engine = "define", chrome = true } = {}) {
  // Works with both legacy bridge (/lookup) and unified server (/rig/lookup)
  try {
    return await postJson("/rig/lookup", { query, engine, chrome });
  } catch {
    return postJson("/lookup", { query, engine, chrome });
  }
}

export async function rigSearchLocal(query, { limit = 5 } = {}) {
  try {
    return await postJson("/rig/search", { query, limit });
  } catch {
    return postJson("/search", { query, limit });
  }
}

export async function rigClear(scope = "learn") {
  try {
    return await postJson("/rig/clear", { scope });
  } catch {
    return postJson("/clear", { scope });
  }
}
