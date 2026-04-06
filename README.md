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

Response format:

```json
{
  "nodes": [{ "id": "", "type": "function|file|class" }],
  "edges": [{ "source": "", "target": "", "type": "calls|imports" }]
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

Backend LLM environment:

- `LLM_PROVIDER_ORDER` (optional, default: `ollama,openrouter,openai`)
- `OLLAMA_BASE_URL` (optional, default: `http://127.0.0.1:11434`)
- `OLLAMA_MODEL` (optional, default: `qwen2.5-coder:7b`)
- `OPENROUTER_API_KEY` (optional, for free cloud fallback)
- `OPENROUTER_MODEL` (optional, default: `openrouter/free`)
- `OPENAI_API_KEY` (optional, final fallback)

Quick start (no paid API required):

1. Install Ollama and run a model locally (example: `ollama pull qwen2.5-coder:7b`).
2. Copy `backend/.env.example` to `backend/.env`.
3. Keep provider order as `ollama,openrouter,openai`.
4. Start backend and use "Explain this function".

## Implemented Features

- Parse all `*.py` files under the selected directory.
- Extract function definitions, nested functions, class definitions, methods, imports, and call sites.
- Build call graph (`calls`) and dependency graph (`imports`).
- Visualize graph with zoom/pan, node search, neighbor highlighting, and node-to-code inspection.
- Three-panel responsive UI: file tree, graph canvas, code viewer.
- AI function insight: click node or use "Explain this function" to generate purpose + input/output summary.
- Explanation cache on backend (LRU) and frontend (per-node session cache) to reduce repeated API calls.
- Multi-provider LLM fallback: local Ollama first, then OpenRouter free, then OpenAI.
