const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export async function fetchGraph(path, options = {}) {
  const {
    view = "knowledge",
    maxNodes = 3000,
    includeExternal = false,
  } = options;
  const url = new URL("/analyze", API_BASE);
  if (path) {
    url.searchParams.set("path", path);
  }
  url.searchParams.set("view", view);
  url.searchParams.set("max_nodes", String(maxNodes));
  url.searchParams.set("include_external", includeExternal ? "true" : "false");
  const response = await fetch(url.toString());
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

export async function explainFunction(node, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 25000);
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL("/explain", API_BASE);
  let response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        node_id: node.id,
        node_type: node.type,
        code: node.code || "",
        file: node.file || null,
        lineno: node.lineno || null,
        end_lineno: node.end_lineno || null,
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchMeta() {
  const url = new URL("/meta", API_BASE);
  const response = await fetch(url.toString());
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}
