"""
llm_pipeline
============
LLM pipeline that reads certifications, builds prompts,
queries a Gemini model by default, and saves structured results.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent

PROMPT_TEMPLATE_PATH: Path = PROJECT_ROOT / "prompt.txt"
CERTIFICATIONS_PATH: Path = PROJECT_ROOT / "cetrif.json"
OUTPUT_PATH: Path = PROJECT_ROOT / "output_llm.json"

GEMINI_API_KEY: str = "AIzaSyBZ-CNa-wtB7UTfa_Pd_GXREVxx-3LH33U"
GEMINI_MODEL: str = "gemini-2.5-flash-lite"
GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_GENERATE_ENDPOINT: str = (
    f"{GEMINI_BASE_URL}/models/{GEMINI_MODEL}:generateContent"
)

LLM_PROVIDER: str = "gemini"

# If you want to switch back to Ollama later, uncomment this block,
# set LLM_PROVIDER = "ollama", and comment the Gemini block above.
# OLLAMA_BASE_URL: str = "http://localhost:11434"
# OLLAMA_GENERATE_ENDPOINT: str = f"{OLLAMA_BASE_URL}/api/generate"
# OLLAMA_LIST_ENDPOINT: str = f"{OLLAMA_BASE_URL}/api/tags"
# OLLAMA_MODEL_PRIORITY: List[str] = [
    
#     "qwen2.5:7b",
#     "qwen3:8b",
# ]

REQUEST_TIMEOUT: int = 600
MAX_RETRIES: int = 2
RETRY_DELAY_SEC: float = 3.0

# ---------------------------------------------------------------------------
# Logger
# ---------------------------------------------------------------------------

logger = logging.getLogger("llm_pipeline")

# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class PipelineError(Exception):
    """Base exception for LLM pipeline."""


class PromptBuildError(PipelineError):
    """Raised when prompt building fails."""


class LLMConnectionError(PipelineError):
    """Raised when the LLM backend is unreachable."""


class LLMResponseError(PipelineError):
    """Raised when the LLM response is invalid or unparseable."""

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Certification:
    """A single certification entry from cetrif.json."""

    title: str
    source: str
    duration_hours: int
    description: str


@dataclass(frozen=True)
class LLMResult:
    """Parsed result from the LLM for a single certification."""

    certification_title: str
    weights: Dict[str, float]
    delta_max_points: int


@dataclass
class PipelineOutput:
    """Aggregated output of the full pipeline."""

    results: List[dict] = field(default_factory=list)

# ---------------------------------------------------------------------------
# Certification loader
# ---------------------------------------------------------------------------


class CertificationLoader:
    """Loads certification entries from cetrif.json."""

    @staticmethod
    def load(path: Path = CERTIFICATIONS_PATH) -> List[Certification]:
        if not path.exists():
            raise PipelineError(f"Certifications file not found: {path}")

        raw: List[dict]
        try:
            with path.open("r", encoding="utf-8-sig") as f:
                raw = json.load(f)
        except json.JSONDecodeError as exc:
            raise PipelineError(f"Invalid JSON in {path}: {exc}")

        if not isinstance(raw, list):
            raise PipelineError(f"Expected a JSON array in {path}, got {type(raw).__name__}")

        certs: List[Certification] = []
        for idx, item in enumerate(raw, start=1):
            if not isinstance(item, dict):
                raise PipelineError(f"Item #{idx} in {path} must be a dict")
            try:
                certs.append(
                    Certification(
                        title=str(item["title"]),
                        source=str(item["source"]),
                        duration_hours=int(item["duration_hours"]),
                        description=str(item["description"]),
                    )
                )
            except KeyError as exc:
                raise PipelineError(f"Item #{idx} in {path} is missing key: {exc}")

        logger.info("Loaded %d certification(s) from %s", len(certs), path.name)
        return certs

# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------


class PromptBuilder:
    """Injects certification data into the prompt template."""

    PLACEHOLDER_BLOCK = (
        '{\n'
        '"title": "DEA — ",\n'
        '"source": "IFA /,\n'
        '"duration_hours": ,\n'
        '"description": \n'
        '},'
    )

    @staticmethod
    def load_template(path: Path = PROMPT_TEMPLATE_PATH) -> str:
        if not path.exists():
            raise PromptBuildError(f"Prompt template not found: {path}")
        return path.read_text(encoding="utf-8")

    @staticmethod
    def _format_cert_entry(cert: Certification) -> str:
        return (
            '{\n'
            f'"title": "{cert.title}",\n'
            f'"source": "{cert.source}",\n'
            f'"duration_hours": {cert.duration_hours},\n'
            f'"description": "{cert.description}"\n'
            '},'
        )

    @staticmethod
    def build(template: str, cert: Certification) -> str:
        entry = PromptBuilder._format_cert_entry(cert)
        filled = template.replace(PromptBuilder.PLACEHOLDER_BLOCK, entry)
        if filled == template:
            raise PromptBuildError(
                "Placeholder block not found in template; injection failed."
            )
        return filled

# ---------------------------------------------------------------------------
# Local LLM client
# ---------------------------------------------------------------------------


class LocalLLMClient:
    """Abstracted client for LLM inference via Gemini or Ollama."""

    def __init__(
        self,
        provider: str = LLM_PROVIDER,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: int = REQUEST_TIMEOUT,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self.provider = provider.strip().lower()
        self.api_key = api_key or GEMINI_API_KEY
        self.base_url = (base_url or GEMINI_BASE_URL).rstrip("/")
        self._session = requests.Session()
        self.timeout = timeout
        self.max_retries = max_retries

        if self.provider == "ollama":
            self.base_url = (base_url or "http://localhost:11434").rstrip("/")
            self.model = model if model else self._resolve_model()
        else:
            self.model = model if model else GEMINI_MODEL

        logger.info(
            "LLM client initialized — provider=%s model=%s endpoint=%s",
            self.provider,
            self.model,
            self.base_url,
        )

    # ---------------------------------------------------------------
    # Model resolution
    # ---------------------------------------------------------------

    def _resolve_model(self) -> str:
        if self.provider != "ollama":
            return self.model if hasattr(self, "model") else GEMINI_MODEL

        priority_models = globals().get("OLLAMA_MODEL_PRIORITY", [])
        available = self._fetch_available_models()
        for idx, preferred in enumerate(priority_models):
            if preferred in available:
                logger.info("Selected model: %s", preferred)
                return preferred

            if idx + 1 < len(priority_models):
                logger.warning(
                    "%s unavailable — fallback to %s",
                    preferred,
                    priority_models[idx + 1],
                )
            else:
                logger.warning("%s unavailable — no preferred fallback left", preferred)
        if available:
            fallback = available[0]
            logger.warning("No preferred model found, falling back to: %s", fallback)
            return fallback
        raise LLMConnectionError(
            "No models available via Ollama. Ensure Ollama is running and has a model pulled."
        )

    def _fetch_available_models(self) -> List[str]:
        if self.provider != "ollama":
            return []

        try:
            resp = self._session.get(f"{self.base_url}/api/tags", timeout=10)
            resp.raise_for_status()
            data = resp.json()
            models = data.get("models", [])
            return [m["name"] for m in models]
        except requests.RequestException as exc:
            logger.warning("Could not fetch model list from Ollama: %s", exc)
            return []

    # ---------------------------------------------------------------
    # Generate
    # ---------------------------------------------------------------

    def generate(self, prompt: str) -> str:
        last_error: Optional[Exception] = None

        for attempt in range(1, self.max_retries + 2):
            try:
                return self._generate_once(prompt)
            except (requests.RequestException, LLMResponseError) as exc:
                last_error = exc
                logger.warning(
                    "LLM call attempt %d/%d failed: %s",
                    attempt,
                    self.max_retries + 1,
                    exc,
                )
                if attempt <= self.max_retries:
                    time.sleep(RETRY_DELAY_SEC)

        raise LLMConnectionError(
            f"LLM generation failed after {self.max_retries + 1} attempt(s): {last_error}"
        )

    def _generate_once(self, prompt: str) -> str:
        if self.provider == "ollama":
            payload: Dict[str, Any] = {
                "model": self.model,
                "prompt": prompt,
                "stream": False,
            }

            resp = self._session.post(
                f"{self.base_url}/api/generate",
                json=payload,
                timeout=self.timeout,
            )
            resp.raise_for_status()

            data = resp.json()
            raw_response = data.get("response", "")

            if not raw_response:
                raise LLMResponseError("LLM returned an empty response.")

            return raw_response

        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
            "generationConfig": {
                "temperature": 0.2,
                "topP": 0.95,
                "maxOutputTokens": 4096,
            },
        }

        resp = self._session.post(
            GEMINI_GENERATE_ENDPOINT,
            params={"key": self.api_key},
            json=payload,
            timeout=self.timeout,
        )
        resp.raise_for_status()

        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise LLMResponseError("Gemini returned no candidates.")

        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        raw_response = "".join(
            part.get("text", "") for part in parts if isinstance(part, dict)
        ).strip()

        if not raw_response:
            raise LLMResponseError("Gemini returned an empty response.")

        return raw_response

    # ---------------------------------------------------------------
    # Response cleaning
    # ---------------------------------------------------------------

    @staticmethod
    def clean_response(raw: str) -> str:
        cleaned = raw.strip()

        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```\s*$", "", cleaned)
        cleaned = cleaned.strip()

        return cleaned

    @staticmethod
    def _extract_balanced_json(text: str, opener: str, closer: str) -> Optional[str]:
        start = text.find(opener)
        if start == -1:
            return None

        depth = 0
        in_string = False
        escaped = False

        for index in range(start, len(text)):
            char = text[index]

            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue

            if char == '"':
                in_string = True
                continue

            if char == opener:
                depth += 1
            elif char == closer:
                depth -= 1
                if depth == 0:
                    return text[start : index + 1]

        return None

    @staticmethod
    def parse_json_response(raw: str) -> dict:
        cleaned = LocalLLMClient.clean_response(raw)

        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list):
                return {"results": parsed}
            return parsed
        except json.JSONDecodeError:
            pass

        for opener, closer in (("{", "}"), ("[", "]")):
            json_fragment = LocalLLMClient._extract_balanced_json(cleaned, opener, closer)
            if not json_fragment:
                continue

            try:
                parsed = json.loads(json_fragment)
                if isinstance(parsed, list):
                    return {"results": parsed}
                return parsed
            except json.JSONDecodeError:
                continue

        raise LLMResponseError(
            "Failed to parse LLM response as JSON after cleaning."
        )

    @staticmethod
    def extract_results(parsed: dict) -> List[LLMResult]:
        if "results" in parsed:
            items = parsed["results"]
        else:
            items = [parsed]

        if not isinstance(items, list):
            raise LLMResponseError("'results' must be a list in LLM response.")

        results: List[LLMResult] = []
        for item in items:
            if not isinstance(item, dict):
                logger.warning("Skipping non-dict item in LLM response: %s", type(item))
                continue
            try:
                results.append(
                    LLMResult(
                        certification_title=str(item.get("certification_title", "")),
                        weights={k: float(v) for k, v in item.get("weights", {}).items()},
                        delta_max_points=int(item.get("delta_max_points", 0)),
                    )
                )
            except (ValueError, TypeError) as exc:
                logger.warning("Skipping malformed LLM result item: %s", exc)

        return results

# ---------------------------------------------------------------------------
# Output writer
# ---------------------------------------------------------------------------


class OutputWriter:
    """Writes structured pipeline output to disk."""

    @staticmethod
    def write(output: PipelineOutput, path: Path = OUTPUT_PATH) -> None:
        data = {"results": output.results}
        content = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        path.write_text(content, encoding="utf-8")
        logger.info("Pipeline output saved to %s (%d result(s))", path.resolve(), len(output.results))

# ---------------------------------------------------------------------------
# Pipeline orchestrator
# ---------------------------------------------------------------------------


class LLMPipeline:
    """Orchestrates the full certification-to-LLM-to-output pipeline."""

    def __init__(
        self,
        certs_path: Path = CERTIFICATIONS_PATH,
        prompt_path: Path = PROMPT_TEMPLATE_PATH,
        output_path: Path = OUTPUT_PATH,
        llm_client: Optional[LocalLLMClient] = None,
    ) -> None:
        self.certs_path = certs_path
        self.prompt_path = prompt_path
        self.output_path = output_path
        self.llm_client = llm_client or LocalLLMClient()

    def run(self) -> PipelineOutput:
        certs = CertificationLoader.load(self.certs_path)
        template = PromptBuilder.load_template(self.prompt_path)
        output = PipelineOutput()

        for idx, cert in enumerate(certs, start=1):
            logger.info(
                "[%d/%d] Processing certification: %s",
                idx,
                len(certs),
                cert.title,
            )

            prompt = PromptBuilder.build(template, cert)

            raw_llm = self.llm_client.generate(prompt)

            parsed = LocalLLMClient.parse_json_response(raw_llm)
            results = LocalLLMClient.extract_results(parsed)

            for result in results:
                output.results.append(
                    {
                        "certification_title": result.certification_title,
                        "weights": result.weights,
                        "delta_max_points": result.delta_max_points,
                    }
                )

        OutputWriter.write(output, self.output_path)
        return output

# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    try:
        pipeline = LLMPipeline()
        output = pipeline.run()
        print(json.dumps({"results": output.results}, indent=2, ensure_ascii=False))
    except PipelineError as exc:
        logger.error(str(exc))
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()

