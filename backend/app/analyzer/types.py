from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ImportRef:
    source_module: str
    imported_name: str | None
    alias: str
    lineno: int


@dataclass
class FunctionInfo:
    id: str
    name: str
    qualname: str
    module: str
    file_path: str
    lineno: int
    end_lineno: int | None
    code: str | None
    class_name: str | None = None
    nested_under: str | None = None
    calls: set[str] = field(default_factory=set)
    import_aliases: dict[str, str] = field(default_factory=dict)


@dataclass
class ClassInfo:
    id: str
    name: str
    qualname: str
    module: str
    file_path: str
    lineno: int
    end_lineno: int | None
    code: str | None


@dataclass
class FileInfo:
    id: str
    module: str
    rel_path: str
    abs_path: str
    imports: list[ImportRef] = field(default_factory=list)
    functions: dict[str, FunctionInfo] = field(default_factory=dict)
    classes: dict[str, ClassInfo] = field(default_factory=dict)
    source: str | None = None
