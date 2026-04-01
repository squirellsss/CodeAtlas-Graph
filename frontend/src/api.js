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
