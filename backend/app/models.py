from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


NodeType = Literal["function", "method", "file", "class", "directory"]
EdgeType = Literal["calls", "imports", "defines", "contains"]


class GraphNode(BaseModel):
    id: str
    type: NodeType
    label: str | None = None
    file: str | None = None
    lineno: int | None = None
    end_lineno: int | None = None
    code: str | None = None
    attributes: dict[str, Any] | None = None


class GraphEdge(BaseModel):
    source: str
    target: str
    type: EdgeType
    weight: int | None = None


class GraphResponse(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list)
    warnings: list["ParseWarning"] = Field(default_factory=list)


class ParseWarning(BaseModel):
    file: str
    kind: Literal["syntax_error", "decode_error", "parse_error", "unresolved_call"]
    message: str
    lineno: int | None = None


class ExplainRequest(BaseModel):
    node_id: str
    node_type: str
    code: str
    file: str | None = None
    lineno: int | None = None
    end_lineno: int | None = None


class ExplainResponse(BaseModel):
    purpose: str
    inputs: str
    outputs: str
    short_explanation: str
    side_effects: str = "Not available."
    risks: str = "Not available."
    cached: bool = False


class ServerMetaResponse(BaseModel):
    workspace_root: str
    cors_allow_origins: list[str] = Field(default_factory=list)


class ExplainAllRequest(BaseModel):
    path: str = "."
    view: Literal["directory", "overview", "full", "knowledge"] = "knowledge"
    max_nodes: int = 3000
    include_external: bool = False
    limit: int | None = None


class ExplainAllResponse(BaseModel):
    total_candidates: int
    explained_count: int
    cached_count: int
    failed_count: int
    failed_node_ids: list[str] = Field(default_factory=list)
