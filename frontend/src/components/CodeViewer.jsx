import React from "react";

function extractDocSummary(code) {
  if (!code) return "";
  const docMatch = code.match(/^[\s\S]*?["']{3}([\s\S]*?)["']{3}/);
  if (!docMatch) return "";
  const firstLine = docMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || "";
}

function deriveDescription(selected) {
  const attrs = selected.attributes || {};
  const qualname = attrs.qualname || selected.label || selected.id;
  const code = selected.code || "";
  const signature = code
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("def ") || line.startsWith("async def ") || line.startsWith("class "));
  const summary = extractDocSummary(code);

  if (selected.type === "function" || selected.type === "method") {
    return summary || signature || `Function ${qualname}`;
  }
  if (selected.type === "class") {
    return summary || signature || `Class ${qualname}`;
  }
  if (selected.type === "file") {
    return `Python file ${selected.file || selected.label || selected.id}`;
  }
  if (selected.type === "directory") {
    return `Directory ${selected.file || selected.label || selected.id}`;
  }
  return summary || signature || qualname;
}

function buildLocationQuery(selected) {
  if (!selected.file) return "";
  if (selected.lineno && selected.end_lineno) {
    return `${selected.file}:${selected.lineno}-${selected.end_lineno}`;
  }
  if (selected.lineno) {
    return `${selected.file}:${selected.lineno}`;
  }
  return selected.file;
}

export default function CodeViewer({
  selected,
  explanation,
  explainLoading = false,
  explainError = "",
  onExplain,
  canExplain = false,
}) {
  if (!selected) {
    return <div className="empty-state">Select a node to inspect its code.</div>;
  }

  const locationQuery = buildLocationQuery(selected);
  const attrs = selected.attributes || {};
  const hasPosition = Boolean(selected.lineno);

  return (
    <div className="code-viewer">
      <div className="code-meta">
        <div><strong>ID:</strong> {selected.id}</div>
        <div><strong>Type:</strong> {selected.type}</div>
        {attrs.qualname && <div><strong>Qualified Name:</strong> {attrs.qualname}</div>}
        {selected.file && <div><strong>File:</strong> {selected.file}</div>}
        {hasPosition && (
          <div>
            <strong>Location:</strong> L{selected.lineno}
            {selected.end_lineno ? `-L${selected.end_lineno}` : ""}
          </div>
        )}
      </div>
      <div className="desc-box">
        <strong>Description:</strong> {deriveDescription(selected)}
      </div>
      <div className="location-box">
        <strong>Location Query:</strong> {locationQuery || "-"}
      </div>
      <div className="explain-actions">
        <button className="button explain-btn" onClick={onExplain} disabled={!canExplain || explainLoading}>
          {explainLoading ? "Explaining..." : "Explain this function"}
        </button>
        {!canExplain && <span className="empty-state">This node does not support LLM explanation.</span>}
      </div>
      {explainError && <div className="error-banner explain-error">{explainError}</div>}
      {explanation && (
        <div className="ai-insights">
          <div><strong>Function Purpose:</strong> {explanation.purpose}</div>
          <div><strong>Input Description:</strong> {explanation.inputs}</div>
          <div><strong>Output Description:</strong> {explanation.outputs}</div>
          <div><strong>Short Explanation:</strong> {explanation.short_explanation}</div>
          <div className="insight-meta">Cache: {explanation.cached ? "hit" : "fresh"}</div>
        </div>
      )}
      <pre className="code-block">{selected.code || "No code snippet available for this node."}</pre>
    </div>
  );
}
