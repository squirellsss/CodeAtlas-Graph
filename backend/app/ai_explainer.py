from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import ast
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import ExplainResponse


@dataclass(frozen=True)
class ExplainPayload:
    node_id: str
    node_type: str
    code: str
    file: str | None
    lineno: int | None
    end_lineno: int | None


@dataclass(frozen=True)
class ProviderConfig:
    provider: str
    api_base: str
    model: str
    api_key: str = ""


class LLMExplainService:
    def __init__(self, cache_size: int = 512):
        self.cache_size = cache_size
        self._cache: OrderedDict[str, ExplainResponse] = OrderedDict()
        self._lock = threading.Lock()
        self._backend_root = Path(__file__).resolve().parents[1]
        self._project_root = Path(__file__).resolve().parents[2]
        self._dotenv_cache: dict[str, str] = {}
        self._dotenv_cache_stamp: tuple[tuple[str, float], ...] = ()
        self._dotenv_cache_loaded_at: float = 0.0

    def explain(self, payload: ExplainPayload) -> ExplainResponse:
        if not payload.code.strip():
            return ExplainResponse(
                purpose="No code provided.",
                inputs="Unknown.",
                outputs="Unknown.",
                short_explanation="This node does not include a code snippet.",
                side_effects="Unknown.",
                risks="Unknown.",
                cached=False,
            )

        payload = ExplainPayload(
            node_id=payload.node_id,
            node_type=payload.node_type,
            code=self._truncate_code(payload.code),
            file=payload.file,
            lineno=payload.lineno,
            end_lineno=payload.end_lineno,
        )
        providers = self._resolve_provider_configs()
        if not providers:
            raise RuntimeError(
                "No LLM provider is configured. "
                "Set OLLAMA_BASE_URL/Ollama model, or OPENROUTER_API_KEY, or OPENAI_API_KEY."
            )

        provider_errors: dict[str, str] = {}
        for cfg in providers:
            cache_key = self._make_cache_key(payload, cfg.provider, cfg.model)
            cached = self._cache_get(cache_key)
            if cached:
                return ExplainResponse(**cached.model_dump(), cached=True)
            try:
                response = self._call_with_provider(payload, cfg)
                self._cache_set(cache_key, response)
                return response
            except RuntimeError as exc:
                provider_errors[cfg.provider] = str(exc)
                continue

        fallback_key = self._make_cache_key(payload, "rule_based", "heuristic-v1")
        fallback_cached = self._cache_get(fallback_key)
        if fallback_cached:
            return ExplainResponse(**fallback_cached.model_dump(), cached=True)
        fallback = self._fallback_explain(payload, provider_errors)
        self._cache_set(fallback_key, fallback)
        return fallback

    def _make_cache_key(self, payload: ExplainPayload, provider: str, model: str) -> str:
        normalized = "|".join(
            [
                payload.node_id,
                payload.node_type,
                payload.file or "",
                str(payload.lineno or ""),
                str(payload.end_lineno or ""),
                payload.code,
                provider,
                model,
            ]
        )
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def _cache_get(self, key: str) -> ExplainResponse | None:
        with self._lock:
            if key not in self._cache:
                return None
            value = self._cache.pop(key)
            self._cache[key] = value
            return value

    def _cache_set(self, key: str, value: ExplainResponse) -> None:
        with self._lock:
            if key in self._cache:
                self._cache.pop(key)
            self._cache[key] = value
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)

    def _call_with_provider(self, payload: ExplainPayload, cfg: ProviderConfig) -> ExplainResponse:
        if cfg.provider == "ollama":
            return self._call_ollama(payload, cfg)
        if cfg.provider in {"openrouter", "openai"}:
            return self._call_openai_compatible(payload, cfg)
        raise RuntimeError(f"Unsupported provider: {cfg.provider}")

    def _call_openai_compatible(self, payload: ExplainPayload, cfg: ProviderConfig) -> ExplainResponse:
        system_prompt = (
            "You are a senior software engineer. Explain code clearly and briefly. "
            "Return JSON with keys: purpose, inputs, outputs, short_explanation, side_effects, risks. "
            "Each value should be one concise paragraph."
        )
        user_prompt = (
            f"Node type: {payload.node_type}\n"
            f"Node id: {payload.node_id}\n"
            f"File: {payload.file or 'unknown'}\n"
            f"Location: {payload.lineno or '-'} to {payload.end_lineno or '-'}\n\n"
            "Code:\n"
            f"{payload.code}\n\n"
            "Respond with valid JSON only."
        )

        request_body = {
            "model": cfg.model,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
        }

        headers = {
            "Content-Type": "application/json",
        }
        if cfg.api_key:
            headers["Authorization"] = f"Bearer {cfg.api_key}"
        if cfg.provider == "openrouter":
            headers["HTTP-Referer"] = "http://localhost"
            headers["X-Title"] = "CodeAtlas-Graph"

        request = Request(
            url=f"{cfg.api_base}/chat/completions",
            data=json.dumps(request_body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        timeout_seconds = self._request_timeout_seconds()
        try:
            with urlopen(request, timeout=timeout_seconds) as resp:
                payload_raw = json.loads(resp.read().decode("utf-8"))
        except HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            safe_details = self._sanitize_provider_error(details)
            if exc.code == 401:
                raise RuntimeError(
                    f"{cfg.provider} authentication failed (401): API key is invalid or expired."
                ) from exc
            if exc.code == 429:
                raise RuntimeError(
                    f"{cfg.provider} request rejected (429): rate limit or quota reached."
                ) from exc
            raise RuntimeError(f"LLM request failed with status {exc.code}: {safe_details}") from exc
        except URLError as exc:
            raise RuntimeError(f"LLM request failed: {exc.reason}") from exc

        message_content = (
            payload_raw.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        try:
            parsed = json.loads(message_content)
        except json.JSONDecodeError:
            parsed = {
                "purpose": "Model returned a non-JSON response.",
                "inputs": "Could not parse inputs.",
                "outputs": "Could not parse outputs.",
                "short_explanation": message_content[:500] or "No explanation generated.",
                "side_effects": "Could not parse side effects.",
                "risks": "Could not parse risks.",
            }

        return ExplainResponse(
            purpose=str(parsed.get("purpose", "")).strip() or "Not available.",
            inputs=str(parsed.get("inputs", "")).strip() or "Not available.",
            outputs=str(parsed.get("outputs", "")).strip() or "Not available.",
            short_explanation=str(parsed.get("short_explanation", "")).strip() or "Not available.",
            side_effects=str(parsed.get("side_effects", "")).strip() or "Not available.",
            risks=str(parsed.get("risks", "")).strip() or "Not available.",
            cached=False,
        )

    def _call_ollama(self, payload: ExplainPayload, cfg: ProviderConfig) -> ExplainResponse:
        prompt = (
            "You are a senior software engineer. Explain code clearly and briefly.\n"
            "Return valid JSON with keys: purpose, inputs, outputs, short_explanation, side_effects, risks.\n"
            f"Node type: {payload.node_type}\n"
            f"Node id: {payload.node_id}\n"
            f"File: {payload.file or 'unknown'}\n"
            f"Location: {payload.lineno or '-'} to {payload.end_lineno or '-'}\n\n"
            "Code:\n"
            f"{payload.code}\n\n"
            "Return JSON only."
        )
        request_body = {
            "model": cfg.model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
        }
        request = Request(
            url=f"{cfg.api_base}/api/generate",
            data=json.dumps(request_body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        timeout_seconds = self._request_timeout_seconds()
        try:
            with urlopen(request, timeout=timeout_seconds) as resp:
                payload_raw = json.loads(resp.read().decode("utf-8"))
        except HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            safe_details = self._sanitize_provider_error(details)
            raise RuntimeError(f"Ollama request failed with status {exc.code}: {safe_details}") from exc
        except URLError as exc:
            raise RuntimeError(f"Ollama request failed: {exc.reason}") from exc

        message_content = payload_raw.get("response", "")
        try:
            parsed = json.loads(message_content)
        except json.JSONDecodeError:
            parsed = {
                "purpose": "Model returned a non-JSON response.",
                "inputs": "Could not parse inputs.",
                "outputs": "Could not parse outputs.",
                "short_explanation": message_content[:500] or "No explanation generated.",
                "side_effects": "Could not parse side effects.",
                "risks": "Could not parse risks.",
            }
        return ExplainResponse(
            purpose=str(parsed.get("purpose", "")).strip() or "Not available.",
            inputs=str(parsed.get("inputs", "")).strip() or "Not available.",
            outputs=str(parsed.get("outputs", "")).strip() or "Not available.",
            short_explanation=str(parsed.get("short_explanation", "")).strip() or "Not available.",
            side_effects=str(parsed.get("side_effects", "")).strip() or "Not available.",
            risks=str(parsed.get("risks", "")).strip() or "Not available.",
            cached=False,
        )

    def _read_config_value(self, key: str) -> str:
        env_value = os.getenv(key, "").strip()
        if env_value:
            return env_value
        dotenv = self._load_dotenv_values()
        return dotenv.get(key, "").strip()

    def _resolve_provider_configs(self) -> list[ProviderConfig]:
        order_raw = self._read_config_value("LLM_PROVIDER_ORDER") or "ollama,openrouter,openai"
        order = [part.strip().lower() for part in order_raw.split(",") if part.strip()]
        configs: list[ProviderConfig] = []

        for provider in order:
            if provider == "ollama":
                ollama_base = (self._read_config_value("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").rstrip("/")
                ollama_model = self._read_config_value("OLLAMA_MODEL") or "qwen2.5-coder:7b"
                if ollama_model:
                    configs.append(
                        ProviderConfig(
                            provider="ollama",
                            api_base=ollama_base,
                            model=ollama_model,
                        )
                    )
            elif provider == "openrouter":
                key = self._read_config_value("OPENROUTER_API_KEY")
                if not key:
                    continue
                base = (self._read_config_value("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")
                model = self._read_config_value("OPENROUTER_MODEL") or "openrouter/free"
                configs.append(
                    ProviderConfig(
                        provider="openrouter",
                        api_base=base,
                        model=model,
                        api_key=key,
                    )
                )
            elif provider == "openai":
                key = self._read_config_value("OPENAI_API_KEY")
                if not key:
                    continue
                base = (self._read_config_value("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
                model = self._read_config_value("OPENAI_MODEL") or "gpt-4o-mini"
                configs.append(
                    ProviderConfig(
                        provider="openai",
                        api_base=base,
                        model=model,
                        api_key=key,
                    )
                )
        return configs

    def _load_dotenv_values(self) -> dict[str, str]:
        candidates = [self._backend_root / ".env", self._project_root / ".env"]
        stamp: list[tuple[str, float]] = []
        for env_file in candidates:
            if env_file.exists():
                stamp.append((str(env_file), env_file.stat().st_mtime))

        now = time.monotonic()
        if (
            self._dotenv_cache
            and tuple(stamp) == self._dotenv_cache_stamp
            and now - self._dotenv_cache_loaded_at < 10
        ):
            return self._dotenv_cache

        values: dict[str, str] = {}
        for env_file in candidates:
            if not env_file.exists():
                continue
            for raw_line in env_file.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and value:
                    values[key] = value
        self._dotenv_cache = values
        self._dotenv_cache_stamp = tuple(stamp)
        self._dotenv_cache_loaded_at = now
        return values

    def _truncate_code(self, code: str) -> str:
        max_chars_raw = self._read_config_value("EXPLAIN_MAX_CODE_CHARS")
        max_chars = int(max_chars_raw) if max_chars_raw.isdigit() else 12000
        if len(code) <= max_chars:
            return code
        head = code[: max_chars // 2]
        tail = code[-(max_chars // 2) :]
        return (
            f"{head}\n\n# ... trimmed {len(code) - max_chars} characters for explanation ...\n\n{tail}"
        )

    def _request_timeout_seconds(self) -> int:
        raw = self._read_config_value("LLM_REQUEST_TIMEOUT_SECONDS")
        if raw.isdigit():
            return max(5, min(int(raw), 120))
        return 25

    def _sanitize_provider_error(self, details: str) -> str:
        # Remove anything that looks like a provider key to avoid accidental leakage in UI/logs.
        redacted = re.sub(r"sk-[A-Za-z0-9\-_]+", "sk-***", details)
        redacted = re.sub(r"rk-[A-Za-z0-9\-_]+", "rk-***", redacted)
        redacted = redacted.replace("exceeded retry limit", "rate-limit reached")
        if len(redacted) > 400:
            return redacted[:400] + "..."
        return redacted

    def _fallback_explain(self, payload: ExplainPayload, provider_errors: dict[str, str]) -> ExplainResponse:
        code = payload.code or ""
        purpose = "Rule-based summary: code behavior inferred from signature/body patterns."
        inputs = "Not available."
        outputs = "Not available."
        side_effects = "No obvious side effects detected."
        risks = "No obvious risks detected."

        try:
            tree = ast.parse(code)
            first_node = tree.body[0] if tree.body else None

            if isinstance(first_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                arg_names = [a.arg for a in first_node.args.args]
                if first_node.args.vararg:
                    arg_names.append(f"*{first_node.args.vararg.arg}")
                if first_node.args.kwarg:
                    arg_names.append(f"**{first_node.args.kwarg.arg}")
                inputs = ", ".join(arg_names) if arg_names else "No explicit parameters."
                if first_node.returns is not None:
                    outputs = f"Return annotation: {ast.unparse(first_node.returns)}"
                else:
                    outputs = "Return value not explicitly annotated."
                purpose = f"{'Async ' if isinstance(first_node, ast.AsyncFunctionDef) else ''}function `{first_node.name}`."

            elif isinstance(first_node, ast.ClassDef):
                purpose = f"Class `{first_node.name}` with {len(first_node.body)} members."
                inputs = "Class constructor parameters depend on __init__."
                outputs = "Class instance / class behaviors."

            side_effect_tags = []
            risk_tags = []
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    callee = ""
                    if isinstance(node.func, ast.Name):
                        callee = node.func.id
                    elif isinstance(node.func, ast.Attribute):
                        callee = node.func.attr
                    if callee in {"print", "open", "write", "writelines", "remove", "unlink", "mkdir", "rmdir"}:
                        side_effect_tags.append(callee)
                    if callee in {"eval", "exec", "system", "popen", "loads"}:
                        risk_tags.append(callee)
                if isinstance(node, ast.Raise):
                    risk_tags.append("raise")
                if isinstance(node, (ast.Global, ast.Nonlocal)):
                    side_effect_tags.append("state mutation")

            if side_effect_tags:
                side_effects = "Possible side effects: " + ", ".join(sorted(set(side_effect_tags)))
            if risk_tags:
                risks = "Potential risks: " + ", ".join(sorted(set(risk_tags)))
        except Exception:
            # Keep defaults if AST parse fails.
            pass

        if provider_errors:
            short = (
                "LLM providers were unavailable; this is a local rule-based fallback summary. "
                "Configure Ollama/OpenRouter/OpenAI for richer analysis."
            )
        else:
            short = "Local rule-based summary generated."

        return ExplainResponse(
            purpose=purpose,
            inputs=inputs,
            outputs=outputs,
            short_explanation=short,
            side_effects=side_effects,
            risks=risks,
            cached=False,
        )
