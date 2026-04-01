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
      code: n.code || "",
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
            "background-color": "#1f6feb",
            color: "#111827",
            label: "data(label)",
            "font-size": 11,
            "text-wrap": "wrap",
            "text-max-width": 140,
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.72,
            "text-background-padding": "2px",
            "text-outline-width": 0,
            "text-overflow-wrap": "anywhere",
            "min-zoomed-font-size": 8,
            width: "mapData(degree, 0, 30, 24, 56)",
            height: "mapData(degree, 0, 30, 24, 56)",
          },
        },
        {
          selector: 'node[type = "file"][kind != "directory"]',
          style: { shape: "round-rectangle", "background-color": "#2f855a" },
        },
        {
          selector: 'node[type = "class"]',
          style: { shape: "diamond", "background-color": "#b7791f" },
        },
        {
          selector: 'node[type = "method"]',
          style: { shape: "ellipse", "background-color": "#8b5cf6" },
        },
        {
          selector: 'node[kind = "directory"]',
          style: {
            shape: "round-hexagon",
            "background-color": "#0f766e",
            "font-size": 12,
            "text-background-opacity": 0.85,
          },
        },
        {
          selector: "edge",
          style: {
            "line-color": "#93a1b0",
            "target-arrow-color": "#93a1b0",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            width: "mapData(weight, 1, 20, 1, 6)",
            opacity: 0.85,
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
          style: { opacity: 0.18 },
        },
        {
          selector: ".highlighted",
          style: { opacity: 1, "border-width": 2, "border-color": "#f97316", "z-index": 20 },
        },
      ],
      layout: { name: "preset" },
      wheelSensitivity: 0.2,
      textureOnViewport: true,
      motionBlur: false,
    });

    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      const neighbors = node.closedNeighborhood();
      cy.elements().addClass("dimmed");
      neighbors.removeClass("dimmed");
      neighbors.addClass("highlighted");
      if (onNodeSelectedRef.current) {
        onNodeSelectedRef.current(node.data());
      }
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass("dimmed highlighted");
      }
    });

    if (cy.nodes().length) {
      cy.one("layoutstop", () => {
        cy.fit(undefined, 60);
        if (onSnapshotReadyRef.current && enableSnapshot) {
          onSnapshotReadyRef.current(cy.png({ full: true, scale: 2, bg: "#ffffff" }));
        }
      });
      cy.layout({
        name: layoutName,
        animate: false,
        fit: true,
        padding: 40,
        spacingFactor: hasDirectoryNodes ? 1.3 : 1,
      }).run();
    } else if (onSnapshotReadyRef.current) {
      onSnapshotReadyRef.current("");
    }

    cyRef.current = cy;
    return () => cy.destroy();
  }, [graph, enableSnapshot]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId) return;
    const node = cy.getElementById(selectedNodeId);
    if (node.length) {
      cy.elements().removeClass("dimmed highlighted");
      const group = node.closedNeighborhood();
      cy.elements().addClass("dimmed");
      group.removeClass("dimmed");
      group.addClass("highlighted");
      cy.center(node);
    }
  }, [selectedNodeId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const query = (searchText || "").trim().toLowerCase();
    cy.elements().removeClass("dimmed highlighted");
    if (!query) return;
    const matches = cy.nodes().filter((n) => n.data("label").toLowerCase().includes(query) || n.id().toLowerCase().includes(query));
    if (matches.length) {
      cy.elements().addClass("dimmed");
      matches.removeClass("dimmed");
      matches.addClass("highlighted");
    }
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
    cy.elements().removeClass("dimmed highlighted");
    cy.fit(undefined, 60);
  }, [resetToken]);

  return <div ref={containerRef} className="graph-canvas" />;
}
