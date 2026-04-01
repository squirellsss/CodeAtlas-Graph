import React, { useMemo, useState } from "react";
import { fetchGraph } from "./api";
import FileTree from "./components/FileTree";
import GraphView from "./components/GraphView";
import CodeViewer from "./components/CodeViewer";

const DEFAULT_PATH = ".";

export default function App() {
  const [repoPath, setRepoPath] = useState(DEFAULT_PATH);
  const [viewMode, setViewMode] = useState("knowledge");
  const [maxNodes, setMaxNodes] = useState(1800);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [searchText, setSearchText] = useState("");
  const [scopeDir, setScopeDir] = useState("");
  const [edgeTypeFilter, setEdgeTypeFilter] = useState({
    calls: true,
    imports: true,
    defines: true,
    contains: true,
  });
  const [snapshot, setSnapshot] = useState("");
  const [resetToken, setResetToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const filePaths = useMemo(() => graph.files || [], [graph.files]);

  async function onAnalyze() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchGraph(repoPath, { view: viewMode, maxNodes, includeExternal: false });
      setGraph(data);
      setSelectedNode(null);
      setSelectedFile("");
      setScopeDir("");
      if (!data.nodes.length) {
        setError("Analysis finished but no Python nodes were found. Make sure the path contains .py files.");
      }
    } catch (err) {
      setError(err.message || "Failed to analyze repository.");
    } finally {
      setLoading(false);
    }
  }

  function onSelectFile(filePath) {
    const node = graph.nodes.find(
      (n) => n.file === filePath && n.type === "file" && String(n.id).startsWith("file:")
    );
    if (node) {
      setSelectedFile(filePath);
      setSelectedNode(node);
      return;
    }
    setSelectedFile(filePath);
  }

  function onSelectNode(node) {
    setSelectedNode(node);
    if (node.file) {
      setSelectedFile(node.file);
    }
    if (String(node.id).startsWith("dir:")) {
      const dirValue = String(node.id).replace("dir:", "");
      setScopeDir(dirValue === "(root)" ? "" : dirValue);
    }
  }

  const filteredGraph = useMemo(() => {
    const activeTypes = new Set(
      Object.entries(edgeTypeFilter)
        .filter(([, enabled]) => enabled)
        .map(([type]) => type)
    );
    let edges = graph.edges.filter((e) => activeTypes.has(e.type));
    let nodes = graph.nodes;

    if (scopeDir) {
      const scopedNodeIds = new Set(
        nodes
          .filter((n) => {
            if (String(n.id).startsWith("dir:")) {
              const dir = String(n.id).replace("dir:", "");
              return dir === scopeDir || dir.startsWith(`${scopeDir}/`);
            }
            if (!n.file) return false;
            return n.file === scopeDir || n.file.startsWith(`${scopeDir}/`);
          })
          .map((n) => n.id)
      );
      edges = edges.filter((e) => scopedNodeIds.has(e.source) && scopedNodeIds.has(e.target));
      const edgeNodeIds = new Set(edges.flatMap((e) => [e.source, e.target]));
      nodes = nodes.filter((n) => edgeNodeIds.has(n.id) || scopedNodeIds.has(n.id));
    } else {
      const edgeNodeIds = new Set(edges.flatMap((e) => [e.source, e.target]));
      nodes = nodes.filter((n) => edgeNodeIds.has(n.id) || String(n.id).startsWith("dir:"));
    }

    return { nodes, edges, files: graph.files || [] };
  }, [graph, edgeTypeFilter, scopeDir]);

  function toggleEdgeType(type) {
    setEdgeTypeFilter((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  const summaryItems = [
    { label: "Mode", value: viewMode },
    { label: "Files", value: filePaths.length },
    { label: "Nodes", value: `${filteredGraph.nodes.length}/${graph.nodes.length}` },
    { label: "Edges", value: `${filteredGraph.edges.length}/${graph.edges.length}` },
    { label: "Selected", value: selectedNode?.label || "-" },
  ];

  return (
    <div className="app-shell">
      <header className="toolbar">
        <input
          className="input path-input"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="Repository path (e.g. D:/files/project)"
        />
        <button className="button" onClick={onAnalyze} disabled={loading}>
          {loading ? "Analyzing..." : "Analyze"}
        </button>
        <button className="button secondary" onClick={() => setResetToken((v) => v + 1)}>
          Reset View
        </button>
        <select
          className="input"
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value)}
          title="Graph level"
        >
          <option value="knowledge">Knowledge Graph</option>
          <option value="directory">Directory (grouped)</option>
          <option value="overview">Overview (files only)</option>
          <option value="full">Full (functions and calls)</option>
        </select>
        <input
          className="input"
          type="number"
          min={200}
          max={50000}
          step={200}
          value={maxNodes}
          onChange={(e) => setMaxNodes(Number(e.target.value) || 3000)}
          title="Max rendered nodes"
        />
        <input
          className="input search-input"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search node by name"
        />
      </header>

      {error && <div className="error-banner">{error}</div>}
      <div className="filter-row">
        <label className="chip">
          <input type="checkbox" checked={edgeTypeFilter.calls} onChange={() => toggleEdgeType("calls")} />
          calls
        </label>
        <label className="chip">
          <input type="checkbox" checked={edgeTypeFilter.imports} onChange={() => toggleEdgeType("imports")} />
          imports
        </label>
        <label className="chip">
          <input type="checkbox" checked={edgeTypeFilter.defines} onChange={() => toggleEdgeType("defines")} />
          defines
        </label>
        <label className="chip">
          <input type="checkbox" checked={edgeTypeFilter.contains} onChange={() => toggleEdgeType("contains")} />
          contains
        </label>
        <button className="button secondary" onClick={() => setScopeDir("")} disabled={!scopeDir}>
          Clear Scope
        </button>
        <span className="scope-text">Scope: {scopeDir || "Global"}</span>
      </div>
      <div className="stats-banner">
        {summaryItems.map((item) => (
          <div className="stat-card" key={item.label}>
            <span className="stat-label">{item.label}</span>
            <span className="stat-value">{item.value}</span>
          </div>
        ))}
      </div>

      <main className="layout">
        <aside className="panel panel-left">
          <h3>File Tree</h3>
          <FileTree filePaths={filePaths} onSelectFile={onSelectFile} selectedFile={selectedFile} />
        </aside>
        <section className="panel panel-center">
          <h3>Graph</h3>
          <div className="graph-legend">
            <span className="legend-title">Node Type</span>
            <span className="legend-item directory">Directory</span>
            <span className="legend-item file">File</span>
            <span className="legend-item class">Class</span>
            <span className="legend-item method">Method</span>
            <span className="legend-title">Edge</span>
            <span className="legend-line calls">calls</span>
            <span className="legend-line imports">imports</span>
            <span className="legend-line defines">defines</span>
            <span className="legend-line contains">contains</span>
          </div>
          {!graph.nodes.length && !loading && (
            <div className="graph-empty">
              Click Analyze to generate the repository graph.
            </div>
          )}
          <GraphView
            graph={filteredGraph}
            selectedNodeId={selectedNode?.id}
            searchText={searchText}
            onNodeSelected={onSelectNode}
            onSnapshotReady={setSnapshot}
            enableSnapshot={filteredGraph.nodes.length <= 2500}
            resetToken={resetToken}
          />
        </section>
        <aside className="panel panel-right">
          <h3>Code Viewer</h3>
          <div className="guide-box">
            <div className="guide-title">How to read this graph</div>
            <div className="guide-text">Click a node to focus on its local neighborhood.</div>
            <div className="guide-text">Use search to highlight matching nodes by name.</div>
            <div className="guide-text">Click blank area to clear focus and return to overview.</div>
          </div>
          <div className="snapshot-wrap">
            <div className="snapshot-head">
              <span>Graph Snapshot</span>
              <a
                className={`snapshot-download ${snapshot ? "" : "disabled"}`}
                href={snapshot || "#"}
                download="graph.png"
                onClick={(e) => !snapshot && e.preventDefault()}
              >
                Download PNG
              </a>
            </div>
            {snapshot ? (
              <img className="snapshot-image" src={snapshot} alt="Graph Snapshot" />
            ) : (
              <div className="empty-state">
                {filteredGraph.nodes.length > 2500
                  ? "Snapshot is disabled for very large graphs to keep UI responsive."
                  : "A graph snapshot will appear after analysis."}
              </div>
            )}
          </div>
          <CodeViewer selected={selectedNode} />
        </aside>
      </main>
    </div>
  );
}
