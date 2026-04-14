# Repository Graph Analyzer

This project contains:

- `backend/`: FastAPI service that parses Python repositories with AST and returns graph JSON.
- `frontend/`: React + Cytoscape app for interactive graph visualization.

## Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API:

- `GET /analyze?path=<repo_path>`
- `POST /explain` (LLM explanation for selected function/class node)
- `GET /meta` (workspace/cors info for frontend hints)

Response format:

```json
{
  "nodes": [{ "id": "", "type": "function|method|class|file|directory" }],
  "edges": [{ "source": "", "target": "", "type": "calls|imports|defines|contains" }],
  "warnings": [{ "file": "", "kind": "syntax_error|decode_error|parse_error|unresolved_call", "message": "" }]
}
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Optional environment:

- `VITE_API_BASE` (default: `http://localhost:8000`)

Backend environment:

- `ANALYZE_WORKSPACE_ROOT` (optional, restricts `/analyze` to this root directory)
- `CORS_ALLOW_ORIGINS` (optional, comma-separated origins)

Path note:

- Frontend `Repository path` should be relative to `ANALYZE_WORKSPACE_ROOT`.

Backend LLM environment:

- `LLM_PROVIDER_ORDER` (optional, default: `ollama,openrouter,openai`)
- `OLLAMA_BASE_URL` (optional, default: `http://127.0.0.1:11434`)
- `OLLAMA_MODEL` (optional, default: `qwen2.5-coder:7b`)
- `OPENROUTER_API_KEY` (optional, for free cloud fallback)
- `OPENROUTER_MODEL` (optional, default: `openrouter/free`)
- `OPENAI_API_KEY` (optional, final fallback)
- `EXPLAIN_MAX_CODE_CHARS` (optional, default: `12000`, trims very large code before explain)

Quick start (no paid API required):

1. Install Ollama and run a model locally (example: `ollama pull qwen2.5-coder:7b`).
2. Copy `backend/.env.example` to `backend/.env`.
3. Keep provider order as `ollama,openrouter,openai`.
4. Start backend and use "Explain this function".

## What Users Need To Do After Cloning

1. Backend:
```bash
cd backend
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```
2. Optional local LLM (recommended, free):
```bash
ollama pull qwen2.5-coder:7b
ollama serve
```
3. Start backend:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
4. Frontend:
```bash
cd ../frontend
npm install
npm run dev
```

## Explain Latency Expectations

- Cached explain result: usually near-instant.
- Local Ollama (7B class model): typically `1-6s` for common functions.
- Cloud fallback (OpenRouter/OpenAI): typically `2-10s` depending on network/provider load.
- Very large functions may take longer; backend trims oversized code by `EXPLAIN_MAX_CODE_CHARS`.

## Quality Checks

Backend quick checks:

```bash
python -m unittest backend.tests.test_graph_builder
```

Coverage in this test file:

- Directory view node-type consistency (`directory` only)
- Syntax parse warning visibility
- Unresolved-call warning visibility

## Implemented Features

- Parse all `*.py` files under the selected directory.
- Extract function definitions, nested functions, class definitions, methods, imports, and call sites.
- Build call graph (`calls`) and dependency graph (`imports`).
- Visualize graph with zoom/pan, node search, neighbor highlighting, and node-to-code inspection.
- Three-panel responsive UI: file tree, graph canvas, code viewer.
- AI function insight: click node or use "Explain this function" to generate purpose + input/output summary.
- Explain output includes purpose, input/output, side effects, and potential risks.
- Auto-explain uses delayed trigger and cancellation to avoid API bursts while quickly switching nodes.
- Explanation cache on backend (LRU) and frontend (per-node session cache) to reduce repeated API calls.
- Multi-provider LLM fallback: local Ollama first, then OpenRouter free, then OpenAI.
- Parse warnings are returned and shown in the UI (`Skipped files / Parse warnings` style visibility).
- Inspector panel uses tabs (`Overview`, `Explain`, `Why Connected`, `Warnings`, `Code`).
- `Why Connected` shows shortest path steps between selected node and target node in current graph.
