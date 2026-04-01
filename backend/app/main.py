from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .analyzer.graph_builder import analyze_repository
from .models import GraphResponse

app = FastAPI(title="Repository Graph Analyzer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/analyze", response_model=GraphResponse)
def analyze(
    path: str = Query(".", description="Absolute or relative path to repository root"),
    view: Literal["directory", "overview", "full", "knowledge"] = Query(
        "knowledge",
        description="knowledge=typed code graph, directory=folder graph, overview=file imports, full=all function calls",
    ),
    max_nodes: int = Query(3000, ge=100, le=50000),
    include_external: bool = Query(False, description="Include external imports not found in current repository"),
) -> GraphResponse:
    try:
        return analyze_repository(
            path=path,
            view=view,
            include_external=include_external,
            max_nodes=max_nodes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
