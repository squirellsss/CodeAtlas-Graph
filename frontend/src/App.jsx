import React, { useEffect, useMemo, useRef, useState } from "react";
import { explainFunction, fetchGraph, fetchMeta } from "./api";
import FileTree from "./components/FileTree";
import GraphView from "./components/GraphView";
import CodeViewer from "./components/CodeViewer";
import ErrorBoundary from "./components/ErrorBoundary";

const DEFAULT_PATH = ".";

export default function App() {
  const [repoPath, setRepoPath] = useState(DEFAULT_PATH);
  const [viewMode, setViewMode] = useState("knowledge");
  const [maxNodes, setMaxNodes] = useState(1800);
  const [graph, setGraph] = useState({ nodes: [], edges: [], warnings: [] });
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
  const [explainCache, setExplainCache] = useState({});
  const [explainLoadingKey, setExplainLoadingKey] = useState("");
  const [explainError, setExplainError] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [warningFilter, setWarningFilter] = useState("critical");
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const explainAbortRef = useRef(null);
  const autoExplainTimerRef = useRef(null);

  const filePaths = useMemo(() => graph.files || [], [graph.files]);
  const parseWarnings = useMemo(() => graph.warnings || [], [graph.warnings]);
  const displayedWarnings = useMemo(() => {
    if (warningFilter === "all") return parseWarnings;
    if (warningFilter === "unresolved_call") {
      return parseWarnings.filter((w) => w.kind === "unresolved_call");
    }
    return parseWarnings.filter((w) => w.kind !== "unresolved_call");
  }, [parseWarnings, warningFilter]);

  function cancelInflightExplain() {
    if (autoExplainTimerRef.current) {
      clearTimeout(autoExplainTimerRef.current);
      autoExplainTimerRef.current = null;
    }
    if (explainAbortRef.current) {
      explainAbortRef.current.abort();
      explainAbortRef.current = null;
    }
  }

  async function onAnalyze() {
    setLoading(true);
    setError("");
    cancelInflightExplain();
    try {
      const data = await fetchGraph(repoPath, { view: viewMode, maxNodes, includeExternal: false });
      setGraph(data);
      setSelectedNode(null);
      setSelectedFile("");
      setScopeDir("");
      setExplainCache({});
      setExplainError("");
      setExplainLoadingKey("");
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
    if (!node) {
      setSelectedNode(null);
      setSelectedFile("");
      setExplainError("");
      setExplainLoadingKey("");
      cancelInflightExplain();
      return;
    }
    setSelectedNode(node);
    setExplainError("");
    if (node.file) {
      setSelectedFile(node.file);
    }
    if (String(node.id).startsWith("dir:")) {
      const dirValue = String(node.id).replace("dir:", "");
      setScopeDir(dirValue === "(root)" ? "" : dirValue);
    }
  }

  function makeExplainKey(node) {
    if (!node) return "";
    return [node.id, node.file || "", node.lineno || "", node.end_lineno || "", (node.code || "").length].join("|");
  }

  function canExplain(node) {
    if (!node) return false;
    if (!node.code) return false;
    return node.type === "function" || node.type === "method" || node.type === "class";
  }

  async function triggerExplain(node, options = {}) {
    const { auto = false, signal } = options;
    if (!canExplain(node)) return;
    const key = makeExplainKey(node);
    if (explainCache[key]) return;
    if (explainLoadingKey === key) return;
    setExplainError("");
    setExplainLoadingKey(key);
    try {
      const result = await explainFunction(node, { signal, timeoutMs: 22000 });
      setExplainCache((prev) => ({ ...prev, [key]: result }));
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (auto) {
        setExplainError("Auto explain timed out/failed. Click 'Explain this function' to retry.");
      } else {
        setExplainError(err.message || "Failed to explain function.");
      }
    } finally {
      setExplainLoadingKey((current) => (current === key ? "" : current));
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
    { label: "Warnings", value: `${displayedWarnings.length}/${parseWarnings.length}` },
  ];
  const selectedExplainKey = makeExplainKey(selectedNode);
  const selectedExplanation = selectedExplainKey ? explainCache[selectedExplainKey] : null;
  const selectedExplainLoading = selectedExplainKey && explainLoadingKey === selectedExplainKey;

  useEffect(() => {
    cancelInflightExplain();
    if (!selectedNode || !canExplain(selectedNode)) return undefined;
    const key = makeExplainKey(selectedNode);
    if (explainCache[key]) return undefined;
    const controller = new AbortController();
    explainAbortRef.current = controller;
    autoExplainTimerRef.current = setTimeout(() => {
      void triggerExplain(selectedNode, { auto: true, signal: controller.signal });
    }, 650);
    return () => {
      cancelInflightExplain();
    };
  }, [selectedNode]); // eslint-disable-line react-hooks/exhaustive-deps

  function onExplainClick() {
    cancelInflightExplain();
    if (!selectedNode) return;
    const controller = new AbortController();
    explainAbortRef.current = controller;
    void triggerExplain(selectedNode, { auto: false, signal: controller.signal });
  }

  useEffect(() => () => cancelInflightExplain(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let mounted = true;
    fetchMeta()
      .then((meta) => {
        if (!mounted) return;
        setWorkspaceRoot(meta.workspace_root || "");
      })
      .catch(() => {
        if (!mounted) return;
        setWorkspaceRoot("");
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="toolbar">
        <input
          className="input path-input"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="Repository path (relative to workspace root)"
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
        {workspaceRoot && <span className="scope-text">Workspace: {workspaceRoot}</span>}
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
          <div className="warnings-panel">
            <div className="warnings-head-row">
              <div className="warnings-head">Parse Warnings ({displayedWarnings.length})</div>
              <div className="warnings-controls">
                <select
                  className="input warning-filter"
                  value={warningFilter}
                  onChange={(e) => setWarningFilter(e.target.value)}
                  title="Warning filter"
                >
                  <option value="critical">critical only</option>
                  <option value="all">all</option>
                  <option value="unresolved_call">unresolved_call</option>
                </select>
                <button
                  className="button secondary warning-toggle"
                  onClick={() => setWarningsExpanded((v) => !v)}
                >
                  {warningsExpanded ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            {!warningsExpanded ? (
              <div className="empty-state">Warnings panel is collapsed.</div>
            ) : !displayedWarnings.length ? (
              <div className="empty-state">No parser warnings.</div>
            ) : (
              <>
                <div className="warning-help">Showing first 30 warnings in selected filter.</div>
              <ul className="warnings-list">
                {displayedWarnings.slice(0, 30).map((warn, idx) => (
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
              </>
            )}
          </div>
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
          <h3>Inspector</h3>
          <ErrorBoundary>
            <CodeViewer
              selected={selectedNode}
              explanation={selectedExplanation}
              explainLoading={Boolean(selectedExplainLoading)}
              explainError={explainError}
              onExplain={onExplainClick}
              canExplain={canExplain(selectedNode)}
              warnings={displayedWarnings}
              graphNodes={filteredGraph.nodes}
              graphEdges={filteredGraph.edges}
              snapshot={snapshot}
            />
          </ErrorBoundary>
        </aside>
      </main>
    </div>
  );
}
