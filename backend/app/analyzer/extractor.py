from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

from .types import ClassInfo, FileInfo, FunctionInfo, ImportRef


@dataclass
class Scope:
    qualname: str
    node_id: str | None
    kind: str
    import_aliases: dict[str, str]
    class_name: str | None = None


class ModuleVisitor(ast.NodeVisitor):
    def __init__(self, root_path: Path, file_path: Path, source: str, file_info: FileInfo):
        self.root_path = root_path
        self.file_path = file_path
        self.source = source
        self.file_info = file_info
        self.scope_stack: list[Scope] = [
            Scope(qualname=file_info.module, node_id=None, kind="module", import_aliases={})
        ]

    def visit_Import(self, node: ast.Import) -> None:
        current_scope = self.scope_stack[-1]
        for alias in node.names:
            symbol = alias.asname or alias.name.split(".")[0]
            target = alias.name
            current_scope.import_aliases[symbol] = target
            self.file_info.imports.append(
                ImportRef(
                    source_module=alias.name,
                    imported_name=None,
                    alias=symbol,
                    lineno=node.lineno,
                )
            )
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        current_scope = self.scope_stack[-1]
        level_prefix = "." * node.level if node.level else ""
        for alias in node.names:
            symbol = alias.asname or alias.name
            target = f"{level_prefix}{module}.{alias.name}".strip(".")
            current_scope.import_aliases[symbol] = target
            self.file_info.imports.append(
                ImportRef(
                    source_module=f"{level_prefix}{module}".strip("."),
                    imported_name=alias.name,
                    alias=symbol,
                    lineno=node.lineno,
                )
            )
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        parent = self.scope_stack[-1]
        qualname = f"{parent.qualname}.{node.name}" if parent.qualname else node.name
        class_id = f"{self.file_info.module}:{qualname}"
        self.file_info.classes[class_id] = ClassInfo(
            id=class_id,
            name=node.name,
            qualname=qualname,
            module=self.file_info.module,
            file_path=self.file_info.rel_path,
            lineno=node.lineno,
            end_lineno=getattr(node, "end_lineno", None),
            code=self._extract_code(node),
        )
        class_scope = Scope(
            qualname=qualname,
            node_id=class_id,
            kind="class",
            import_aliases=dict(parent.import_aliases),
            class_name=qualname,
        )
        self.scope_stack.append(class_scope)
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._handle_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._handle_function(node)

    def _handle_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        parent = self.scope_stack[-1]
        qualname = f"{parent.qualname}.{node.name}" if parent.qualname else node.name
        func_id = f"{self.file_info.module}:{qualname}"
        nested_under = parent.node_id if parent.kind == "function" else None
        function_info = FunctionInfo(
            id=func_id,
            name=node.name,
            qualname=qualname,
            module=self.file_info.module,
            file_path=self.file_info.rel_path,
            lineno=node.lineno,
            end_lineno=getattr(node, "end_lineno", None),
            code=self._extract_code(node),
            class_name=parent.class_name,
            nested_under=nested_under,
            import_aliases=dict(parent.import_aliases),
        )
        self.file_info.functions[func_id] = function_info
        function_scope = Scope(
            qualname=qualname,
            node_id=func_id,
            kind="function",
            import_aliases=dict(parent.import_aliases),
            class_name=parent.class_name,
        )
        self.scope_stack.append(function_scope)
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_Call(self, node: ast.Call) -> None:
        current_scope = self.scope_stack[-1]
        if current_scope.kind != "function" or not current_scope.node_id:
            self.generic_visit(node)
            return
        target = self._resolve_call_name(node.func, current_scope)
        if target:
            self.file_info.functions[current_scope.node_id].calls.add(target)
        self.generic_visit(node)

    def _resolve_call_name(self, func_node: ast.AST, scope: Scope) -> str | None:
        if isinstance(func_node, ast.Name):
            name = func_node.id
            if name in scope.import_aliases:
                return scope.import_aliases[name]
            return f"{self.file_info.module}:{scope.qualname.rsplit('.', 1)[0]}.{name}" if "." in scope.qualname else f"{self.file_info.module}:{name}"

        if isinstance(func_node, ast.Attribute):
            chain = self._attribute_chain(func_node)
            if not chain:
                return None
            if chain[0] == "self" and scope.class_name:
                method = ".".join([scope.class_name, *chain[1:]])
                return f"{self.file_info.module}:{method}"
            if chain[0] in scope.import_aliases:
                base = scope.import_aliases[chain[0]]
                return ".".join([base, *chain[1:]])
            return ".".join(chain)
        return None

    def _attribute_chain(self, node: ast.Attribute) -> list[str]:
        chain: list[str] = []
        current: ast.AST = node
        while isinstance(current, ast.Attribute):
            chain.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            chain.append(current.id)
            chain.reverse()
            return chain
        return []

    def _extract_code(self, node: ast.AST) -> str | None:
        if not hasattr(node, "lineno"):
            return None
        start = getattr(node, "lineno", None)
        end = getattr(node, "end_lineno", None)
        if start is None or end is None:
            return None
        lines = self.source.splitlines()
        return "\n".join(lines[start - 1 : end])


def module_name_from_path(root_path: Path, file_path: Path) -> str:
    rel = file_path.relative_to(root_path)
    if rel.name == "__init__.py":
        rel = rel.parent
    else:
        rel = rel.with_suffix("")
    parts = [p for p in rel.parts if p]
    return ".".join(parts) if parts else file_path.stem


def parse_python_file(root_path: Path, file_path: Path) -> FileInfo:
    source = file_path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    rel_path = str(file_path.relative_to(root_path)).replace("\\", "/")
    module = module_name_from_path(root_path, file_path)
    file_info = FileInfo(
        id=f"file:{module}",
        module=module,
        rel_path=rel_path,
        abs_path=str(file_path),
        source=source,
    )
    visitor = ModuleVisitor(root_path=root_path, file_path=file_path, source=source, file_info=file_info)
    visitor.visit(tree)
    return file_info
