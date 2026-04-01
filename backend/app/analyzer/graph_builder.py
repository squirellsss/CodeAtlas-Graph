from __future__ import annotations

from pathlib import Path
from typing import Literal

from ..models import GraphEdge, GraphNode, GraphResponse

from .extractor import parse_python_file
from .types import FileInfo

GraphView = Literal["directory", "overview", "full", "knowledge"]


IGNORED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".venv",
    "venv",
    "env",
    "node_modules",
    "dist",
    "build",
}


def discover_python_files(root_path: Path) -> list[Path]:
    paths: list[Path] = []
    for path in root_path.rglob("*.py"):
        if not path.is_file():
            continue
        if any(part in IGNORED_DIRS for part in path.parts):
            continue
        paths.append(path)
    return paths


def analyze_repository(
    path: str,
    view: GraphView = "knowledge",
    include_external: bool = False,
    max_nodes: int = 5000,
) -> GraphResponse:
    root_path = Path(path).resolve()
    if not root_path.exists() or not root_path.is_dir():
        raise ValueError(f"Invalid directory path: {path}")

    file_infos: dict[str, FileInfo] = {}
    for file_path in discover_python_files(root_path):
        try:
            file_info = parse_python_file(root_path=root_path, file_path=file_path)
            file_infos[file_info.module] = file_info
        except SyntaxError:
            continue
        except UnicodeDecodeError:
            continue

    nodes: dict[str, GraphNode] = {}
    edges: set[tuple[str, str, str]] = set()
    weighted_edges: dict[tuple[str, str, str], int] = {}
    function_name_index: dict[tuple[str, str], str] = {}
    known_modules = set(file_infos.keys())
    all_function_ids: set[str] = set()

    all_files = sorted(info.rel_path for info in file_infos.values())

    if view == "directory":
        return _build_directory_graph(
            file_infos=file_infos,
            known_modules=known_modules,
            include_external=include_external,
            max_nodes=max_nodes,
            files=all_files,
        )

    if view == "knowledge":
        return _build_knowledge_graph(
            file_infos=file_infos,
            known_modules=known_modules,
            include_external=include_external,
            max_nodes=max_nodes,
            files=all_files,
        )

    for module, info in file_infos.items():
        nodes[info.id] = GraphNode(
            id=info.id,
            type="file",
            label=info.rel_path,
            file=info.rel_path,
        )
        if view != "full":
            continue
        for class_info in info.classes.values():
            nodes[class_info.id] = GraphNode(
                id=class_info.id,
                type="class",
                label=class_info.qualname.split(".")[-1],
                file=class_info.file_path,
                lineno=class_info.lineno,
                end_lineno=class_info.end_lineno,
                code=class_info.code,
            )
        for function in info.functions.values():
            nodes[function.id] = GraphNode(
                id=function.id,
                type="function",
                label=function.qualname.split(".")[-1],
                file=function.file_path,
                lineno=function.lineno,
                end_lineno=function.end_lineno,
                code=function.code,
            )
            function_name_index[(module, function.name)] = function.id
            all_function_ids.add(function.id)

    for module, info in file_infos.items():
        source_file_id = info.id
        for imp in info.imports:
            target_module = _resolve_module_reference(
                current_module=module,
                imported_module=imp.source_module,
                known_modules=known_modules,
            )
            if not target_module and not include_external:
                continue
            if target_module and (target_module not in known_modules) and not include_external:
                continue
            target_key = target_module or imp.source_module
            target_file_id = f"file:{target_key}"
            if target_file_id not in nodes:
                nodes[target_file_id] = GraphNode(
                    id=target_file_id,
                    type="file",
                    label=target_file_id.replace("file:", ""),
                )
            key = (source_file_id, target_file_id, "imports")
            edges.add(key)
            weighted_edges[key] = weighted_edges.get(key, 0) + 1

        if view != "full":
            continue
        for function in info.functions.values():
            for raw_target in function.calls:
                resolved_target = _resolve_call_target(
                    raw_target=raw_target,
                    current_module=module,
                    function_name_index=function_name_index,
                    all_functions=all_function_ids,
                )
                if not resolved_target:
                    continue
                if resolved_target not in nodes:
                    continue
                edges.add((function.id, resolved_target, "calls"))
                weighted_edges[(function.id, resolved_target, "calls")] = (
                    weighted_edges.get((function.id, resolved_target, "calls"), 0) + 1
                )

    if max_nodes > 0 and len(nodes) > max_nodes:
        kept_ids = _limit_nodes(nodes, edges, max_nodes=max_nodes)
        nodes = {node_id: node for node_id, node in nodes.items() if node_id in kept_ids}
        edges = {(s, t, k) for s, t, k in edges if s in kept_ids and t in kept_ids}

    return GraphResponse(
        nodes=list(nodes.values()),
        edges=[
            GraphEdge(source=s, target=t, type=kind, weight=weighted_edges.get((s, t, kind), 1))
            for s, t, kind in sorted(edges)
        ],
        files=all_files,
    )


def _resolve_call_target(
    raw_target: str,
    current_module: str,
    function_name_index: dict[tuple[str, str], str],
    all_functions: set[str],
) -> str | None:
    if raw_target in all_functions:
        return raw_target
    if ":" in raw_target and raw_target in all_functions:
        return raw_target
    if ":" in raw_target:
        _, short_name = raw_target.split(":", 1)
        terminal = short_name.split(".")[-1]
        return function_name_index.get((current_module, terminal))
    parts = raw_target.split(".")
    if len(parts) >= 2:
        module = ".".join(parts[:-1])
        name = parts[-1]
        local = function_name_index.get((module, name))
        if local:
            return local
        return None
    return function_name_index.get((current_module, raw_target))


def _resolve_module_reference(current_module: str, imported_module: str, known_modules) -> str | None:
    if not imported_module:
        return None
    if imported_module in known_modules:
        return imported_module
    if imported_module.startswith("."):
        level = len(imported_module) - len(imported_module.lstrip("."))
        base = imported_module.lstrip(".")
        current_parts = current_module.split(".")
        if level > len(current_parts):
            return base or None
        prefix = current_parts[: len(current_parts) - level]
        resolved = ".".join([*prefix, base] if base else prefix)
        return resolved if resolved else None
    return imported_module


def _limit_nodes(
    nodes: dict[str, GraphNode],
    edges: set[tuple[str, str, str]],
    max_nodes: int,
) -> set[str]:
    degrees: dict[str, int] = {node_id: 0 for node_id in nodes.keys()}
    for source, target, _ in edges:
        if source in degrees:
            degrees[source] += 1
        if target in degrees:
            degrees[target] += 1

    # Keep files first to preserve high-level structure, then highest-degree nodes.
    file_nodes = [node_id for node_id, node in nodes.items() if node.type == "file"]
    other_nodes = [node_id for node_id in nodes.keys() if node_id not in file_nodes]
    other_nodes.sort(key=lambda node_id: (degrees.get(node_id, 0), node_id), reverse=True)

    kept: list[str] = []
    for node_id in file_nodes + other_nodes:
        if len(kept) >= max_nodes:
            break
        kept.append(node_id)
    return set(kept)


def _build_directory_graph(
    file_infos: dict[str, FileInfo],
    known_modules: set[str],
    include_external: bool,
    max_nodes: int,
    files: list[str],
) -> GraphResponse:
    nodes: dict[str, GraphNode] = {}
    edges: dict[tuple[str, str, str], int] = {}

    module_to_dir: dict[str, str] = {}
    for module, info in file_infos.items():
        parent = Path(info.rel_path).parent.as_posix()
        if parent == ".":
            parent = "(root)"
        module_to_dir[module] = parent

    dir_file_counts: dict[str, int] = {}
    for directory in module_to_dir.values():
        dir_file_counts[directory] = dir_file_counts.get(directory, 0) + 1

    for directory, count in dir_file_counts.items():
        node_id = f"dir:{directory}"
        nodes[node_id] = GraphNode(
            id=node_id,
            type="file",
            label=f"{directory} ({count})",
            file=directory,
        )

    for module, info in file_infos.items():
        source_dir = module_to_dir[module]
        source_id = f"dir:{source_dir}"
        for imp in info.imports:
            target_module = _resolve_module_reference(
                current_module=module,
                imported_module=imp.source_module,
                known_modules=known_modules,
            )
            if target_module and target_module in module_to_dir:
                target_dir = module_to_dir[target_module]
                target_id = f"dir:{target_dir}"
            else:
                if not include_external:
                    continue
                external_name = (target_module or imp.source_module or "external").split(".")[0] or "external"
                target_id = f"dir:external/{external_name}"
                if target_id not in nodes:
                    nodes[target_id] = GraphNode(
                        id=target_id,
                        type="file",
                        label=target_id.replace("dir:", ""),
                        file=target_id.replace("dir:", ""),
                    )
            key = (source_id, target_id, "imports")
            edges[key] = edges.get(key, 0) + 1

    if max_nodes > 0 and len(nodes) > max_nodes:
        flat_edges = set(edges.keys())
        kept_ids = _limit_nodes(nodes, flat_edges, max_nodes=max_nodes)
        nodes = {node_id: node for node_id, node in nodes.items() if node_id in kept_ids}
        edges = {
            key: weight
            for key, weight in edges.items()
            if key[0] in kept_ids and key[1] in kept_ids
        }

    return GraphResponse(
        nodes=list(nodes.values()),
        edges=[
            GraphEdge(source=s, target=t, type=kind, weight=weight)
            for (s, t, kind), weight in sorted(edges.items())
        ],
        files=files,
    )


def _build_knowledge_graph(
    file_infos: dict[str, FileInfo],
    known_modules: set[str],
    include_external: bool,
    max_nodes: int,
    files: list[str],
) -> GraphResponse:
    nodes: dict[str, GraphNode] = {}
    edges: dict[tuple[str, str, str], int] = {}
    function_name_index: dict[tuple[str, str], str] = {}
    all_function_ids: set[str] = set()

    # Build directory hierarchy first: dir:(root) -> dir:a -> dir:a/b ...
    nodes["dir:(root)"] = GraphNode(
        id="dir:(root)",
        type="directory",
        label="(root)",
        file="(root)",
    )

    def ensure_dir_chain(rel_file: str) -> str:
        parent = Path(rel_file).parent.as_posix()
        if parent in ("", "."):
            return "dir:(root)"
        current = "dir:(root)"
        partial = ""
        for part in parent.split("/"):
            partial = f"{partial}/{part}" if partial else part
            next_id = f"dir:{partial}"
            if next_id not in nodes:
                nodes[next_id] = GraphNode(
                    id=next_id,
                    type="directory",
                    label=part,
                    file=partial,
                    attributes={"path": partial},
                )
            edge_key = (current, next_id, "contains")
            edges[edge_key] = 1
            current = next_id
        return current

    for module, info in file_infos.items():
        parent_dir_id = ensure_dir_chain(info.rel_path)
        file_node_id = info.id
        nodes[file_node_id] = GraphNode(
            id=file_node_id,
            type="file",
            label=info.rel_path,
            file=info.rel_path,
            attributes={"module": module},
        )
        edges[(parent_dir_id, file_node_id, "contains")] = 1

        for class_info in info.classes.values():
            nodes[class_info.id] = GraphNode(
                id=class_info.id,
                type="class",
                label=class_info.qualname.split(".")[-1],
                file=class_info.file_path,
                lineno=class_info.lineno,
                end_lineno=class_info.end_lineno,
                code=class_info.code,
                attributes={"module": module, "qualname": class_info.qualname},
            )
            edges[(file_node_id, class_info.id, "defines")] = 1

        for function in info.functions.values():
            node_type = "method" if function.class_name else "function"
            nodes[function.id] = GraphNode(
                id=function.id,
                type=node_type,
                label=function.qualname.split(".")[-1],
                file=function.file_path,
                lineno=function.lineno,
                end_lineno=function.end_lineno,
                code=function.code,
                attributes={
                    "module": module,
                    "qualname": function.qualname,
                    "class_name": function.class_name,
                    "nested_under": function.nested_under,
                },
            )
            all_function_ids.add(function.id)
            function_name_index[(module, function.name)] = function.id

            if function.class_name:
                class_node_id = f"{module}:{function.class_name}"
                if class_node_id in nodes:
                    edges[(class_node_id, function.id, "contains")] = 1
                else:
                    edges[(file_node_id, function.id, "defines")] = 1
            else:
                edges[(file_node_id, function.id, "defines")] = 1

    for module, info in file_infos.items():
        source_file_id = info.id
        for imp in info.imports:
            target_module = _resolve_module_reference(
                current_module=module,
                imported_module=imp.source_module,
                known_modules=known_modules,
            )
            if not target_module and not include_external:
                continue
            if target_module and target_module not in known_modules and not include_external:
                continue
            target_key = target_module or imp.source_module
            target_file_id = f"file:{target_key}"
            if target_file_id not in nodes:
                nodes[target_file_id] = GraphNode(
                    id=target_file_id,
                    type="file",
                    label=target_key,
                    attributes={"external": True},
                )
            key = (source_file_id, target_file_id, "imports")
            edges[key] = edges.get(key, 0) + 1

        for function in info.functions.values():
            for raw_target in function.calls:
                resolved_target = _resolve_call_target(
                    raw_target=raw_target,
                    current_module=module,
                    function_name_index=function_name_index,
                    all_functions=all_function_ids,
                )
                if not resolved_target or resolved_target not in nodes:
                    continue
                key = (function.id, resolved_target, "calls")
                edges[key] = edges.get(key, 0) + 1

    edge_set = set(edges.keys())
    if max_nodes > 0 and len(nodes) > max_nodes:
        kept_ids = _limit_nodes(nodes, edge_set, max_nodes=max_nodes)
        nodes = {node_id: node for node_id, node in nodes.items() if node_id in kept_ids}
        edges = {k: w for k, w in edges.items() if k[0] in kept_ids and k[1] in kept_ids}

    return GraphResponse(
        nodes=list(nodes.values()),
        edges=[
            GraphEdge(source=s, target=t, type=kind, weight=weight)
            for (s, t, kind), weight in sorted(edges.items())
        ],
        files=files,
    )
