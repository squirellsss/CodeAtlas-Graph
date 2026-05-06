import React, { useEffect, useMemo, useRef, useState } from "react";
import { explainAll, explainFunction, fetchGraph, fetchMeta } from "./api";
import FileTree from "./components/FileTree";
import GraphView from "./components/GraphView";
import CodeViewer from "./components/CodeViewer";
import ErrorBoundary from "./components/ErrorBoundary";

const DEFAULT_PATH = ".";
const MIN_LEFT = 220;
const MAX_LEFT = 440;
const MIN_RIGHT = 300;
const MAX_RIGHT = 620;

export default function App() {
  const [repoPath, setRepoPath] = useState(DEFAULT_PATH);
  const [viewMode, setViewMode] = useState("knowledge");
  const [maxNodes, setMaxNodes] = useState(1800);
  const [graph, setGraph] = useState({ nodes: [], edges: [], warnings: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [searchText, setSearchText] = useState("");
  const [scopeDir, setScopeDir] = useState("");
  const [edgeTypeFilter, setEdgeTypeFilter] = useState({ calls: true, imports: true, defines: true, contains: true });
  const [snapshot, setSnapshot] = useState("");
  const [resetToken, setResetToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [explainCache, setExplainCache] = useState({});
  const [explainLoadingKey, setExplainLoadingKey] = useState("");
  const [explainError, setExplainError] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [warningFilter, setWarningFilter] = useState("critical");
  const [warningsExpanded, setWarningsExpanded] = useState(true);
  const [bulkExplainLoading, setBulkExplainLoading] = useState(false);
  const [bulkExplainResult, setBulkExplainResult] = useState(null);
  const [bulkExplainError, setBulkExplainError] = useState("");

  const [leftWidth, setLeftWidth] = useState(292);
  const [rightWidth, setRightWidth] = useState(384);
  const [collapseLeft, setCollapseLeft] = useState(false);
  const [collapseRight, setCollapseRight] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");

  const explainAbortRef = useRef(null);
  const autoExplainTimerRef = useRef(null);
  const commandInputRef = useRef(null);
  const shellRef = useRef(null);

  const filePaths = useMemo(() => graph.files || [], [graph.files]);
  const parseWarnings = useMemo(() => graph.warnings || [], [graph.warnings]);

  const displayedWarnings = useMemo(() => {
    if (warningFilter === "all") return parseWarnings;
    if (warningFilter === "unresolved_call") return parseWarnings.filter((w) => w.kind === "unresolved_call");
    return parseWarnings.filter((w) => w.kind !== "unresolved_call" || w.confidence === "high");
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
      setBulkExplainResult(null);
      setBulkExplainError("");
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
    const node = graph.nodes.find((n) => n.file === filePath && n.type === "file" && String(n.id).startsWith("file:"));
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
    if (node.file) setSelectedFile(node.file);
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
    if (!node || !node.code) return false;
    return node.type === "function" || node.type === "method" || node.type === "class";
  }

  async function triggerExplain(node, options = {}) {
    const { auto = false, signal } = options;
    if (!canExplain(node)) return;
    const key = makeExplainKey(node);
    if (explainCache[key] || explainLoadingKey === key) return;
    setExplainError("");
    setExplainLoadingKey(key);
    try {
      const result = await explainFunction(node, { signal, timeoutMs: 22000 });
      setExplainCache((prev) => ({ ...prev, [key]: result }));
    } catch (err) {
      if (err?.name === "AbortError") return;
      setExplainError(auto ? "Auto explain timed out/failed. Click 'Explain this function' to retry." : (err.message || "Failed to explain function."));
    } finally {
      setExplainLoadingKey((current) => (current === key ? "" : current));
    }
  }

  const filteredGraph = useMemo(() => {
    const activeTypes = new Set(Object.entries(edgeTypeFilter).filter(([, enabled]) => enabled).map(([type]) => type));
    let edges = graph.edges.filter((e) => activeTypes.has(e.type));
    let nodes = graph.nodes;

    if (scopeDir) {
      const scopedNodeIds = new Set(nodes.filter((n) => {
        if (String(n.id).startsWith("dir:")) {
          const dir = String(n.id).replace("dir:", "");
          return dir === scopeDir || dir.startsWith(`${scopeDir}/`);
        }
        if (!n.file) return false;
        return n.file === scopeDir || n.file.startsWith(`${scopeDir}/`);
      }).map((n) => n.id));
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
    return () => cancelInflightExplain();
  }, [selectedNode]); // eslint-disable-line react-hooks/exhaustive-deps

  function onExplainClick() {
    cancelInflightExplain();
    if (!selectedNode) return;
    const controller = new AbortController();
    explainAbortRef.current = controller;
    void triggerExplain(selectedNode, { auto: false, signal: controller.signal });
  }

  async function onExplainAll() {
    setBulkExplainLoading(true);
    setBulkExplainError("");
    setBulkExplainResult(null);
    try {
      const result = await explainAll({ path: repoPath, view: viewMode, maxNodes, includeExternal: false });
      setBulkExplainResult(result);
    } catch (err) {
      setBulkExplainError(err.message || "Failed to explain all nodes.");
    } finally {
      setBulkExplainLoading(false);
    }
  }

  function triggerResize(side, event) {
    if (!shellRef.current) return;
    const startX = event.clientX;
    const start = side === "left" ? leftWidth : rightWidth;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      if (side === "left") {
        const next = Math.max(MIN_LEFT, Math.min(MAX_LEFT, start + dx));
        setLeftWidth(next);
      } else {
        const next = Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, start - dx));
        setRightWidth(next);
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => () => cancelInflightExplain(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let mounted = true;
    fetchMeta().then((meta) => {
      if (!mounted) return;
      setWorkspaceRoot(meta.workspace_root || "");
    }).catch(() => {
      if (!mounted) return;
      setWorkspaceRoot("");
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        setTimeout(() => commandInputRef.current?.focus(), 10);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        onExplainClick();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        setResetToken((v) => v + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const commandMatches = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    if (!q) return filteredGraph.nodes.slice(0, 28);
    return filteredGraph.nodes.filter((n) => String(n.label || n.id).toLowerCase().includes(q)).slice(0, 28);
  }, [commandQuery, filteredGraph.nodes]);

  function pickCommandNode(node) {
    setSelectedNode(node);
    if (node.file) setSelectedFile(node.file);
    setCommandOpen(false);
    setCommandQuery("");
    setSearchText(String(node.label || node.id));
  }

  const gridColumns = `${collapseLeft ? 56 : leftWidth}px 8px minmax(540px, 1fr) 8px ${collapseRight ? 56 : rightWidth}px`;

  return (
    <div className="app-shell" ref={shellRef}>
      <header className="toolbar">
        <div className="brand-block">
          <div className="brand-title">CodeAtlas Graph</div>
          <div className="brand-sub">AI Graph Workbench</div>
        </div>
        <div className="toolbar-controls">
          <input className="input path-input" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="Project path" />
          <input className="input search-input" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search nodes or press Ctrl/Cmd+K" />
          <select className="input slim" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
            <option value="knowledge">Knowledge</option>
            <option value="directory">Directory</option>
            <option value="overview">Overview</option>
            <option value="full">Full</option>
          </select>
          <select className="input slim" value={maxNodes} onChange={(e) => setMaxNodes(Number(e.target.value) || 3000)}>
            <option value={1200}>1200</option>
            <option value={1800}>1800</option>
            <option value={3200}>3200</option>
            <option value={5000}>5000</option>
          </select>
          <button className="button" onClick={onAnalyze} disabled={loading}>{loading ? "Analyzing..." : "Analyze"}</button>
          <button className="button secondary" onClick={() => setResetToken((v) => v + 1)}>Reset</button>
          <button className="button secondary" onClick={onExplainAll} disabled={bulkExplainLoading || loading}>{bulkExplainLoading ? "Explaining..." : "Explain All"}</button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="stats-grid">
        {summaryItems.map((item) => (
          <article className="stat-card" key={item.label}>
            <span className="stat-label">{item.label}</span>
            <span className="stat-value">{item.value}</span>
          </article>
        ))}
      </section>

      <main className="layout" style={{ gridTemplateColumns: gridColumns }}>
        <aside className={`panel panel-left ${collapseLeft ? "collapsed" : ""}`}>
          <div className="panel-head"><h3>Project Explorer</h3><button className="icon-btn" onClick={() => setCollapseLeft((v) => !v)}>{collapseLeft ? ">" : "<"}</button></div>
          {!collapseLeft && (
            <>
              <div className="filter-row">
                <label className="chip"><input type="checkbox" checked={edgeTypeFilter.calls} onChange={() => toggleEdgeType("calls")} />calls</label>
                <label className="chip"><input type="checkbox" checked={edgeTypeFilter.imports} onChange={() => toggleEdgeType("imports")} />imports</label>
                <label className="chip"><input type="checkbox" checked={edgeTypeFilter.defines} onChange={() => toggleEdgeType("defines")} />defines</label>
                <label className="chip"><input type="checkbox" checked={edgeTypeFilter.contains} onChange={() => toggleEdgeType("contains")} />contains</label>
              </div>
              <FileTree filePaths={filePaths} onSelectFile={onSelectFile} selectedFile={selectedFile} />
              <div className="warnings-panel">
                <div className="warnings-head-row">
                  <div className="warnings-head">Warnings ({displayedWarnings.length})</div>
                  <div className="warnings-controls">
                    <select className="input warning-filter" value={warningFilter} onChange={(e) => setWarningFilter(e.target.value)}>
                      <option value="critical">critical</option>
                      <option value="all">all</option>
                      <option value="unresolved_call">unresolved</option>
                    </select>
                    <button className="icon-btn" onClick={() => setWarningsExpanded((v) => !v)}>{warningsExpanded ? "-" : "+"}</button>
                  </div>
                </div>
                {warningsExpanded && (
                  displayedWarnings.length ? (
                    <ul className="warnings-list">
                      {displayedWarnings.slice(0, 40).map((warn, idx) => (
                        <li key={`${warn.file}-${warn.kind}-${idx}`} className="warning-item">
                          <div className="warning-file">{warn.file}</div>
                          <div className="warning-meta">{warn.kind}{warn.confidence ? ` ¡¤ ${warn.confidence}` : ""}{warn.origin ? ` ¡¤ ${warn.origin}` : ""}{warn.lineno ? ` @L${warn.lineno}` : ""}</div>
                          <div className="warning-message">{warn.message}</div>
                        </li>
                      ))}
                    </ul>
                  ) : <div className="empty-state">No parser warnings.</div>
                )}
              </div>
              {workspaceRoot && <div className="scope-text">Workspace: {workspaceRoot}</div>}
              {bulkExplainResult && <div className="scope-text">ExplainAll: {bulkExplainResult.explained_count} explained, {bulkExplainResult.cached_count} cached.</div>}
              {bulkExplainError && <div className="error-banner explain-error">{bulkExplainError}</div>}
            </>
          )}
        </aside>

        <div className="splitter" onMouseDown={(e) => triggerResize("left", e)} />

        <section className="panel panel-center">
          <div className="panel-head">
            <h3>Graph Workspace</h3>
            <div className="tool-row">
              <button className="icon-btn" onClick={() => setResetToken((v) => v + 1)} title="Fit graph">Fit</button>
              <button className="icon-btn" onClick={() => setScopeDir("")} disabled={!scopeDir} title="Clear scope">Scope</button>
            </div>
          </div>
          {loading && <div className="skeleton" />}
          {!graph.nodes.length && !loading && <div className="graph-empty">Run Analyze to build graph.</div>}
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

        <div className="splitter" onMouseDown={(e) => triggerResize("right", e)} />

        <aside className={`panel panel-right ${collapseRight ? "collapsed" : ""}`}>
          <div className="panel-head"><h3>Inspector</h3><button className="icon-btn" onClick={() => setCollapseRight((v) => !v)}>{collapseRight ? "<" : ">"}</button></div>
          {!collapseRight && (
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
          )}
        </aside>
      </main>

      {commandOpen && (
        <div className="command-overlay" onClick={() => setCommandOpen(false)}>
          <div className="command-palette" onClick={(e) => e.stopPropagation()}>
            <input ref={commandInputRef} className="input command-input" value={commandQuery} onChange={(e) => setCommandQuery(e.target.value)} placeholder="Jump to symbol..." />
            <div className="command-list">
              {commandMatches.map((node) => (
                <button key={node.id} className="command-item" onClick={() => pickCommandNode(node)}>
                  <span>{node.label || node.id}</span>
                  <span className="scope-text">{node.type}</span>
                </button>
              ))}
              {!commandMatches.length && <div className="empty-state">No matches.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
