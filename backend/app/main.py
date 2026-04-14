from __future__ import annotations

import os
from typing import Literal
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .analyzer.graph_builder import analyze_repository
from .ai_explainer import ExplainPayload, LLMExplainService
from .models import ExplainRequest, ExplainResponse, GraphResponse, ServerMetaResponse

app = FastAPI(title="Repository Graph Analyzer", version="1.0.0")
explain_service = LLMExplainService()


def _parse_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _default_workspace_root() -> Path:
    cwd = Path.cwd().resolve()
    # If backend is launched from ./backend, default workspace should be project root.
    if cwd.name.lower() == "backend" and (cwd / "app").exists():
        return cwd.parent.resolve()
    return cwd


WORKSPACE_ROOT = Path(os.getenv("ANALYZE_WORKSPACE_ROOT", str(_default_workspace_root()))).resolve()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_credentials=False,
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
    requested_path = Path(path)
    if not requested_path.is_absolute():
        resolved_path = (WORKSPACE_ROOT / requested_path).resolve()
    else:
        resolved_path = requested_path.resolve()
    try:
        resolved_path.relative_to(WORKSPACE_ROOT)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Path must be within ANALYZE_WORKSPACE_ROOT. "
                f"workspace={WORKSPACE_ROOT}, requested={resolved_path}"
            ),
        ) from exc

    try:
        return analyze_repository(
            path=str(resolved_path),
            view=view,
            include_external=include_external,
            max_nodes=max_nodes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/explain", response_model=ExplainResponse)
def explain_function(request: ExplainRequest) -> ExplainResponse:
    try:
        return explain_service.explain(
            ExplainPayload(
                node_id=request.node_id,
                node_type=request.node_type,
                code=request.code,
                file=request.file,
                lineno=request.lineno,
                end_lineno=request.end_lineno,
            )
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/meta", response_model=ServerMetaResponse)
def meta() -> ServerMetaResponse:
    return ServerMetaResponse(
        workspace_root=str(WORKSPACE_ROOT),
        cors_allow_origins=_parse_cors_origins(),
    )
