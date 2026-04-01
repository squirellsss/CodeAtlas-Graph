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

## Implemented Features

- Parse all `*.py` files under the selected directory.
- Extract function definitions, nested functions, class definitions, methods, imports, and call sites.
- Build call graph (`calls`) and dependency graph (`imports`).
- Visualize graph with zoom/pan, node search, neighbor highlighting, and node-to-code inspection.
- Three-panel responsive UI: file tree, graph canvas, code viewer.
