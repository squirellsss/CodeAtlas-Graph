import React, { useEffect, useRef } from "react";
import cytoscape from "cytoscape";

function toCytoscapeElements(graph) {
  const degree = {};
  graph.edges.forEach((e) => {
    degree[e.source] = (degree[e.source] || 0) + 1;
    degree[e.target] = (degree[e.target] || 0) + 1;
  });

  function shortLabel(raw) {
    const value = String(raw || "");
    if (value.length <= 42) return value;
    return `${value.slice(0, 39)}...`;
  }

  const nodes = graph.nodes.map((n) => ({
    data: {
      id: n.id,
      label: shortLabel(n.label || n.id),
      type: n.type,
      kind: n.type === "directory" || n.id.startsWith("dir:") ? "directory" : n.type,
      degree: degree[n.id] || 0,
      file: n.file || "",
      lineno: n.lineno || null,
      end_lineno: n.end_lineno || null,
      code: n.code || "",
      attributes: n.attributes || {},
    },
  }));
  const edges = graph.edges.map((e, idx) => ({
    data: {
      id: `${e.type}-${idx}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: e.type,
      weight: e.weight || 1,
    },
  }));
  return [...nodes, ...edges];
}

export default function GraphView({
  graph,
  selectedNodeId,
  searchText,
  onNodeSelected,
  onSnapshotReady,
  enableSnapshot = true,
  resetToken = 0,
}) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const onNodeSelectedRef = useRef(onNodeSelected);
  const onSnapshotReadyRef = useRef(onSnapshotReady);
  const selectionNodeIdRef = useRef("");
  const searchQueryRef = useRef("");

  function applyFocus(cy, centerNode) {
    const selectedId = selectionNodeIdRef.current;
    const query = searchQueryRef.current;
    cy.elements().removeClass("dimmed highlighted selected matched");

    if (selectedId) {
      const selected = cy.getElementById(selectedId);
      if (selected.length) {
        const neighborhood = selected.closedNeighborhood();
        cy.elements().addClass("dimmed");
        neighborhood.removeClass("dimmed");
        neighborhood.addClass("highlighted");
        selected.addClass("selected");
        if (centerNode) cy.animate({ center: { eles: selected } }, { duration: 220 });
      }
    }

    if (query) {
      const matches = cy
        .nodes()
        .filter((n) => n.data("label").toLowerCase().includes(query) || n.id().toLowerCase().includes(query));
      if (matches.length) {
        if (!selectedId) cy.elements().addClass("dimmed");
        matches.removeClass("dimmed");
        matches.addClass("matched");
        matches.connectedEdges().removeClass("dimmed");
      }
    }
  }

  useEffect(() => {
    onNodeSelectedRef.current = onNodeSelected;
  }, [onNodeSelected]);

  useEffect(() => {
    onSnapshotReadyRef.current = onSnapshotReady;
  }, [onSnapshotReady]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const nodeCount = graph?.nodes?.length || 0;
    const hasDirectoryNodes = graph?.nodes?.some((n) => n.id.startsWith("dir:"));
    const layoutName = hasDirectoryNodes ? "concentric" : nodeCount > 220 ? "breadthfirst" : "cose";

    const cy = cytoscape({
      container: containerRef.current,
      elements: toCytoscapeElements(graph),
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#3b82f6",
            color: "#0f172a",
            label: "data(label)",
            "font-size": 11.5,
            "font-weight": 600,
            "text-wrap": "wrap",
            "text-max-width": 140,
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.84,
            "text-background-padding": "3px",
            "text-outline-width": 0,
            "text-overflow-wrap": "anywhere",
            "min-zoomed-font-size": 8,
            "border-width": 1.5,
            "border-color": "#bfdbfe",
            width: "mapData(degree, 0, 30, 24, 56)",
            height: "mapData(degree, 0, 30, 24, 56)",
          },
        },
        {
          selector: 'node[type = "file"][kind != "directory"]',
          style: { shape: "round-rectangle", "background-color": "#0f766e", "border-color": "#99f6e4" },
        },
        {
          selector: 'node[type = "class"]',
          style: { shape: "diamond", "background-color": "#b45309", "border-color": "#fde68a" },
        },
        {
          selector: 'node[type = "method"]',
          style: { shape: "ellipse", "background-color": "#7c3aed", "border-color": "#ddd6fe" },
        },
        {
          selector: 'node[kind = "directory"]',
          style: {
            shape: "round-hexagon",
            "background-color": "#0369a1",
            "font-size": 12,
            "font-weight": 700,
            "text-background-opacity": 0.85,
            "border-color": "#7dd3fc",
          },
        },
        {
          selector: "edge",
          style: {
            "line-color": "#94a3b8",
            "target-arrow-color": "#94a3b8",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            width: "mapData(weight, 1, 20, 1.2, 6.5)",
            opacity: 0.72,
            "arrow-scale": 0.9,
          },
        },
        {
          selector: 'edge[type = "imports"]',
          style: {
            "line-style": "dashed",
            "line-color": "#6b7280",
            "target-arrow-color": "#6b7280",
          },
        },
        {
          selector: 'edge[type = "defines"]',
          style: {
            "line-style": "solid",
            "line-color": "#475569",
            "target-arrow-color": "#475569",
          },
        },
        {
          selector: 'edge[type = "contains"]',
          style: {
            "line-style": "dotted",
            "line-color": "#64748b",
            "target-arrow-color": "#64748b",
          },
        },
        {
          selector: ".dimmed",
          style: { opacity: 0.12 },
        },
        {
          selector: ".highlighted",
          style: { opacity: 1, "z-index": 20 },
        },
        {
          selector: ".selected",
          style: {
            "border-width": 4,
            "border-color": "#f97316",
            "overlay-color": "#fb923c",
            "overlay-opacity": 0.12,
            "overlay-padding": 8,
            "z-index": 30,
          },
        },
        {
          selector: ".matched",
          style: {
            "border-width": 3,
            "border-color": "#f59e0b",
            "text-background-color": "#fffbeb",
            "text-background-opacity": 0.95,
          },
        },
      ],
      layout: { name: "preset" },
      wheelSensitivity: 0.2,
      textureOnViewport: true,
      motionBlur: false,
    });

    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      selectionNodeIdRef.current = node.id();
      applyFocus(cy, false);
      if (onNodeSelectedRef.current) {
        onNodeSelectedRef.current(node.data());
      }
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        selectionNodeIdRef.current = "";
        applyFocus(cy, false);
      }
    });

    if (cy.nodes().length) {
      cy.one("layoutstop", () => {
        cy.fit(undefined, 60);
        applyFocus(cy, false);
        if (onSnapshotReadyRef.current && enableSnapshot) {
          onSnapshotReadyRef.current(cy.png({ full: true, scale: 2, bg: "#ffffff" }));
        }
      });
      cy.layout({
        name: layoutName,
        animate: false,
        fit: true,
        padding: 52,
        spacingFactor: hasDirectoryNodes ? 1.55 : 1.15,
      }).run();
    } else if (onSnapshotReadyRef.current) {
      onSnapshotReadyRef.current("");
    }

    cyRef.current = cy;
    return () => cy.destroy();
  }, [graph, enableSnapshot]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    selectionNodeIdRef.current = selectedNodeId || "";
    applyFocus(cy, true);
  }, [selectedNodeId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    searchQueryRef.current = (searchText || "").trim().toLowerCase();
    applyFocus(cy, false);
  }, [searchText]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !onSnapshotReadyRef.current) return;
    if (!graph?.nodes?.length) {
      onSnapshotReadyRef.current("");
      return;
    }
    if (!enableSnapshot) {
      onSnapshotReadyRef.current("");
      return;
    }
    onSnapshotReadyRef.current(cy.png({ full: true, scale: 2, bg: "#ffffff" }));
  }, [graph, enableSnapshot]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !cy.nodes().length) return;
    selectionNodeIdRef.current = "";
    searchQueryRef.current = "";
    cy.elements().removeClass("dimmed highlighted selected matched");
    cy.fit(undefined, 60);
  }, [resetToken]);

  return <div ref={containerRef} className="graph-canvas" />;
}
