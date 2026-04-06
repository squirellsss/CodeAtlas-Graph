from __future__ import annotations

import hashlib
import json
import os
import re
import threading
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

    def explain(self, payload: ExplainPayload) -> ExplainResponse:
        if not payload.code.strip():
            return ExplainResponse(
                purpose="No code provided.",
                inputs="Unknown.",
                outputs="Unknown.",
                short_explanation="This node does not include a code snippet.",
                cached=False,
            )

        providers = self._resolve_provider_configs()
        if not providers:
            raise RuntimeError(
                "No LLM provider is configured. "
                "Set OLLAMA_BASE_URL/Ollama model, or OPENROUTER_API_KEY, or OPENAI_API_KEY."
            )

        errors: list[str] = []
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
                errors.append(f"{cfg.provider}: {exc}")
                continue

        raise RuntimeError("All LLM providers failed. " + " | ".join(errors))

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
            "Return JSON with keys: purpose, inputs, outputs, short_explanation. "
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
        try:
            with urlopen(request, timeout=45) as resp:
                payload_raw = json.loads(resp.read().decode("utf-8"))
        except HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            safe_details = self._sanitize_provider_error(details)
            if exc.code == 401:
                raise RuntimeError(
                    f"{cfg.provider} authentication failed (401): API key is invalid or expired."
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
            }

        return ExplainResponse(
            purpose=str(parsed.get("purpose", "")).strip() or "Not available.",
            inputs=str(parsed.get("inputs", "")).strip() or "Not available.",
            outputs=str(parsed.get("outputs", "")).strip() or "Not available.",
            short_explanation=str(parsed.get("short_explanation", "")).strip() or "Not available.",
            cached=False,
        )

    def _call_ollama(self, payload: ExplainPayload, cfg: ProviderConfig) -> ExplainResponse:
        prompt = (
            "You are a senior software engineer. Explain code clearly and briefly.\n"
            "Return valid JSON with keys: purpose, inputs, outputs, short_explanation.\n"
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
        try:
            with urlopen(request, timeout=60) as resp:
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
            }
        return ExplainResponse(
            purpose=str(parsed.get("purpose", "")).strip() or "Not available.",
            inputs=str(parsed.get("inputs", "")).strip() or "Not available.",
            outputs=str(parsed.get("outputs", "")).strip() or "Not available.",
            short_explanation=str(parsed.get("short_explanation", "")).strip() or "Not available.",
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
        values: dict[str, str] = {}
        candidates = [self._backend_root / ".env", self._project_root / ".env"]
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
        return values

    def _sanitize_provider_error(self, details: str) -> str:
        # Remove anything that looks like a provider key to avoid accidental leakage in UI/logs.
        redacted = re.sub(r"sk-[A-Za-z0-9\-_]+", "sk-***", details)
        redacted = re.sub(r"rk-[A-Za-z0-9\-_]+", "rk-***", redacted)
        if len(redacted) > 400:
            return redacted[:400] + "..."
        return redacted
