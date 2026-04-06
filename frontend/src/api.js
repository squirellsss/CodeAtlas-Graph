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

export async function explainFunction(node) {
  const url = new URL("/explain", API_BASE);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      node_id: node.id,
      node_type: node.type,
      code: node.code || "",
      file: node.file || null,
      lineno: node.lineno || null,
      end_lineno: node.end_lineno || null,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Request failed: ${response.status}`);
  }
  return response.json();
}
