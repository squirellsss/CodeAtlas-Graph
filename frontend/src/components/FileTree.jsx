import React, { useEffect, useMemo, useState } from "react";

function makeDir(name) {
  return { name, type: "dir", children: new Map(), path: "", fileCount: 0 };
}

function makeFile(name, path) {
  return { name, type: "file", path };
}

function addFile(root, filePath) {
  const parts = filePath.split("/").filter(Boolean);
  let current = root;
  current.fileCount += 1;
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    if (isLast) {
      if (!current.children.has(part)) {
        current.children.set(part, makeFile(part, filePath));
      }
      return;
    }
    if (!current.children.has(part)) {
      current.children.set(part, makeDir(part));
    }
    current = current.children.get(part);
    current.path = parts.slice(0, index + 1).join("/");
    current.fileCount += 1;
  });
}

function sortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function TreeNode({ node, level, expanded, toggleExpand, onSelectFile, selectedFile }) {
  if (node.type === "file") {
    return (
      <li>
        <button
          className={`tree-item tree-file ${selectedFile === node.path ? "active" : ""}`}
          style={{ paddingLeft: `${10 + level * 14}px` }}
          onClick={() => onSelectFile(node.path)}
          title={node.path}
        >
          <span className="tree-icon">PY</span>
          <span className="tree-name">{node.name}</span>
        </button>
      </li>
    );
  }

  const key = node.path || node.name;
  const isExpanded = expanded.has(key);
  const children = sortNodes(node.children.values());

  return (
    <li>
      <button
        className="tree-item tree-dir"
        style={{ paddingLeft: `${10 + level * 14}px` }}
        onClick={() => toggleExpand(key)}
        title={node.path || node.name}
      >
        <span className="tree-arrow">{isExpanded ? "-" : "+"}</span>
        <span className="tree-icon">DIR</span>
        <span className="tree-name">{node.name}</span>
        <span className="tree-count">{node.fileCount}</span>
      </button>
      {isExpanded && (
        <ul className="tree-list">
          {children.map((child) => (
            <TreeNode
              key={`${child.type}:${child.path || child.name}`}
              node={child}
              level={level + 1}
              expanded={expanded}
              toggleExpand={toggleExpand}
              onSelectFile={onSelectFile}
              selectedFile={selectedFile}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function FileTree({ filePaths, onSelectFile, selectedFile }) {
  const root = useMemo(() => {
    const top = makeDir("root");
    (filePaths || []).forEach((filePath) => {
      if (filePath) addFile(top, filePath);
    });
    return top;
  }, [filePaths]);

  const initialExpanded = useMemo(() => {
    const set = new Set();
    root.children.forEach((child) => {
      if (child.type === "dir") set.add(child.path || child.name);
    });
    return set;
  }, [root]);
  const [expanded, setExpanded] = useState(initialExpanded);

  useEffect(() => {
    setExpanded(initialExpanded);
  }, [initialExpanded]);

  const sortedRootChildren = sortNodes(root.children.values());
  if (!sortedRootChildren.length) {
    return <div className="empty-state">File tree will appear here after analysis.</div>;
  }

  function toggleExpand(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <ul className="tree-list">
      {sortedRootChildren.map((node) => (
        <TreeNode
          key={`${node.type}:${node.path || node.name}`}
          node={node}
          level={0}
          expanded={expanded}
          toggleExpand={toggleExpand}
          onSelectFile={onSelectFile}
          selectedFile={selectedFile}
        />
      ))}
    </ul>
  );
}
