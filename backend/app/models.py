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
