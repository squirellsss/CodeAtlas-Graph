from __future__ import annotations

import tempfile
import textwrap
import unittest
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.analyzer.graph_builder import analyze_repository


class GraphBuilderTests(unittest.TestCase):
    def test_directory_view_uses_directory_node_type(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pkg").mkdir(parents=True, exist_ok=True)
            (root / "pkg" / "a.py").write_text("import os\n", encoding="utf-8")
            result = analyze_repository(str(root), view="directory", include_external=False, max_nodes=5000)
            self.assertTrue(result.nodes)
            for node in result.nodes:
                self.assertEqual(node.type, "directory")

    def test_syntax_error_file_returns_warning(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "bad.py").write_text("def broken(:\n    pass\n", encoding="utf-8")
            result = analyze_repository(str(root), view="knowledge", include_external=False, max_nodes=5000)
            warning_kinds = [warn.kind for warn in result.warnings]
            self.assertIn("syntax_error", warning_kinds)

    def test_unresolved_call_returns_warning(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "x.py").write_text(
                textwrap.dedent(
                    """
                    def caller():
                        unknown_symbol()
                    """
                ).strip()
                + "\n",
                encoding="utf-8",
            )
            result = analyze_repository(str(root), view="knowledge", include_external=False, max_nodes=5000)
            unresolved = [warn for warn in result.warnings if warn.kind == "unresolved_call"]
            self.assertTrue(unresolved)
            self.assertIn("caller", unresolved[0].message)


if __name__ == "__main__":
    unittest.main()
