import React, { useEffect, useMemo, useState } from "react";

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

  if (selected.type === "function" || selected.type === "method") return summary || signature || `Function ${qualname}`;
  if (selected.type === "class") return summary || signature || `Class ${qualname}`;
  if (selected.type === "file") return `Python file ${selected.file || selected.label || selected.id}`;
  if (selected.type === "directory") return `Directory ${selected.file || selected.label || selected.id}`;
  return summary || signature || qualname;
}

function buildLocationQuery(selected) {
  if (!selected.file) return "";
  if (selected.lineno && selected.end_lineno) return `${selected.file}:${selected.lineno}-${selected.end_lineno}`;
  if (selected.lineno) return `${selected.file}:${selected.lineno}`;
  return selected.file;
}

function bfsPath(sourceId, targetId, edges) {
  if (!sourceId || !targetId || sourceId === targetId) return [];
  const adjacency = new Map();
  const addAdj = (from, to, type, dir) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, type, dir });
  };
  edges.forEach((e) => {
    addAdj(e.source, e.target, e.type, "->");
    addAdj(e.target, e.source, e.type, "<-");
  });

  const queue = [sourceId];
  const prev = new Map();
  const seen = new Set([sourceId]);
  while (queue.length) {
    const current = queue.shift();
    if (current === targetId) break;
    const nexts = adjacency.get(current) || [];
    for (const edge of nexts) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      prev.set(edge.to, { node: current, edge });
      queue.push(edge.to);
    }
  }
  if (!prev.has(targetId)) return [];
  const path = [];
  let cur = targetId;
  while (cur !== sourceId) {
    const step = prev.get(cur);
    path.push({ from: step.node, to: cur, type: step.edge.type, dir: step.edge.dir });
    cur = step.node;
  }
  path.reverse();
  return path;
}

export default function CodeViewer({
  selected,
  explanation,
  explainLoading = false,
  explainError = "",
  onExplain,
  canExplain = false,
  warnings = [],
  graphNodes = [],
  graphEdges = [],
  snapshot = "",
}) {
  const [tab, setTab] = useState("overview");
  const [targetNodeId, setTargetNodeId] = useState("");

  useEffect(() => {
    setTargetNodeId("");
    if (selected && (selected.type === "function" || selected.type === "method" || selected.type === "class")) {
      setTab("explain");
      return;
    }
    setTab("overview");
  }, [selected?.id]);

  const selectedId = selected?.id || "";
  const locationQuery = selected ? buildLocationQuery(selected) : "";
  const attrs = selected?.attributes || {};
  const candidateTargets = useMemo(
    () => graphNodes.filter((n) => n.id !== selectedId).slice(0, 400),
    [graphNodes, selectedId]
  );
  const path = useMemo(
    () => bfsPath(selectedId, targetNodeId, graphEdges),
    [selectedId, targetNodeId, graphEdges]
  );

  if (!selected) return <div className="empty-state">Select a node to inspect its code.</div>;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "explain", label: "Explain" },
    { id: "why", label: "Why Connected" },
    { id: "warnings", label: `Warnings (${warnings.length})` },
    { id: "code", label: "Code" },
  ];

  return (
    <div className="code-viewer">
      <div className="viewer-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`viewer-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          {snapshot && <img className="snapshot-image" src={snapshot} alt="Graph Snapshot" />}
          <div className="code-meta">
            <div><strong>ID:</strong> {selected.id}</div>
            <div><strong>Type:</strong> {selected.type}</div>
            {attrs.qualname && <div><strong>Qualified Name:</strong> {attrs.qualname}</div>}
            {selected.file && <div><strong>File:</strong> {selected.file}</div>}
            {selected.lineno && (
              <div>
                <strong>Location:</strong> L{selected.lineno}
                {selected.end_lineno ? `-L${selected.end_lineno}` : ""}
              </div>
            )}
          </div>
          <div className="desc-box"><strong>Description:</strong> {deriveDescription(selected)}</div>
          <div className="location-box"><strong>Location Query:</strong> {locationQuery || "-"}</div>
        </>
      )}

      {tab === "explain" && (
        <>
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
              <div><strong>Side Effects:</strong> {explanation.side_effects}</div>
              <div><strong>Potential Risks:</strong> {explanation.risks}</div>
              <div><strong>Short Explanation:</strong> {explanation.short_explanation}</div>
              <div className="insight-meta">Cache: {explanation.cached ? "hit" : "fresh"}</div>
            </div>
          )}
        </>
      )}

      {tab === "why" && (
        <div className="why-panel">
          <label className="scope-text">Target node</label>
          <select className="input" value={targetNodeId} onChange={(e) => setTargetNodeId(e.target.value)}>
            <option value="">Select target...</option>
            {candidateTargets.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label || n.id}
              </option>
            ))}
          </select>
          {!targetNodeId && <div className="empty-state">Pick a target node to explain the connection path.</div>}
          {targetNodeId && !path.length && (
            <div className="empty-state">No connection path found in current filtered graph.</div>
          )}
          {path.length > 0 && (
            <ol className="why-path">
              {path.map((step, idx) => (
                <li key={`${step.from}-${step.to}-${idx}`}>
                  <code>{step.from}</code> {step.dir} <code>{step.to}</code> via <strong>{step.type}</strong>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === "warnings" && (
        warnings.length ? (
          <ul className="warnings-list">
            {warnings.slice(0, 80).map((warn, idx) => (
              <li key={`${warn.file}-${warn.kind}-${idx}`} className="warning-item">
                <div className="warning-file">{warn.file}</div>
                <div className="warning-meta">
                  {warn.kind}
                  {warn.lineno ? ` @L${warn.lineno}` : ""}
                </div>
                <div className="warning-message">{warn.message}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">No parser warnings.</div>
        )
      )}

      {tab === "code" && (
        <pre className="code-block">{selected.code || "No code snippet available for this node."}</pre>
      )}
    </div>
  );
}
