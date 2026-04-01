import React from "react";

export default function CodeViewer({ selected }) {
  if (!selected) {
    return <div className="empty-state">Select a node to inspect its code.</div>;
  }

  return (
    <div className="code-viewer">
      <div className="code-meta">
        <div><strong>ID:</strong> {selected.id}</div>
        <div><strong>Type:</strong> {selected.type}</div>
        {selected.file && <div><strong>File:</strong> {selected.file}</div>}
      </div>
      <pre className="code-block">{selected.code || "No code snippet available for this node."}</pre>
    </div>
  );
}
