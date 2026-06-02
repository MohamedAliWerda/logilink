from __future__ import annotations

import logging
import os
import re
import unicodedata
from collections import defaultdict
from functools import lru_cache
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

try:
    from sentence_transformers import SentenceTransformer
except Exception:  # pragma: no cover - optional dependency for runtime portability
    SentenceTransformer = None  # type: ignore[assignment]


LOGGER = logging.getLogger("matching_service")
logging.basicConfig(level=logging.INFO)

DEFAULT_MODEL_NAME = os.getenv("BERT_MODEL_NAME", "paraphrase-multilingual-MiniLM-L12-v2")
FALLBACK_MODEL_NAME = "lexical-hash-embedding"
MATCH_THRESHOLD = float(os.getenv("STATUS_MATCH_THRESHOLD", "0.80"))
DEFAULT_NIVEAU_WEIGHT = 0.50
NIVEAU_WEIGHTS = {
    "avancé": 1.00,
    "intermediaire": 0.50,
    "débutant": 0.20,
}
MAX_GLOBAL_GAPS = int(os.getenv("MAX_GLOBAL_GAPS", "5000"))
MAX_TOP_METIER_GAPS = int(os.getenv("MAX_TOP_METIER_GAPS", "40"))


class StudentSkill(BaseModel):
    nom: str
    niveau: str | None = None
    type: str | None = None


class ReferenceCompetence(BaseModel):
    domaine: str | None = None
    metier: str | None = None
    competence: str
    type_competence: str | None = None
    mots_cles: str | None = None


class AnalyzeRequest(BaseModel):
    cv_submission_id: str | None = None
    match_threshold: float = Field(default=MATCH_THRESHOLD, ge=0.0, le=1.0)
    student_skills: list[StudentSkill]
    reference_competences: list[ReferenceCompetence]


class TopSkill(BaseModel):
    skill: str
    score: float


class MetierRankingEntry(BaseModel):
    metier: str
    domaine: str
    n_competences: int
    matched: int
    coverage_pct: float
    avg_score: float
    top_skills: list[TopSkill]


class MatchGapEntry(BaseModel):
    ref_competence: str
    ref_metier: str
    ref_domaine: str
    ref_type: str
    ref_mots_cles: str
    best_cv_skill: str
    best_cv_niveau: str
    niveau_weight: float | None = None
    raw_similarity_score: float | None = None
    similarity_score: float
    status: str
    match_tier: str = "gap"


class AnalysisSummary(BaseModel):
    n_skills: int
    n_matches: int
    n_gaps: int
    match_rate_pct: float


class AnalyzeResponse(BaseModel):
    cv_submission_id: str | None = None
    model_name: str
    threshold: float
    summary: AnalysisSummary
    top_metier: MetierRankingEntry | None = None
    metier_ranking: list[MetierRankingEntry]
    matches: list[MatchGapEntry]
    gaps: list[MatchGapEntry]
    top_metier_gaps: list[MatchGapEntry]


app = FastAPI(title="Competence Matching Service", version="1.0.0")


@app.on_event("startup")
def _warm_model() -> None:
    """Load the BERT model at boot so the first /analyze request is fast.

    Lazy loading meant the very first request triggered the (slow) model
    download/load. If that exceeded the caller's timeout, the backend silently
    fell back to a lexical token-overlap algorithm, producing wrong scores.
    Warming here moves that cost to service boot, before any request arrives.
    """
    model = get_model()
    if model is None:
        LOGGER.warning("Startup warm-up: BERT model unavailable, using lexical fallback embeddings.")
    else:
        LOGGER.info("Startup warm-up complete: %s ready.", DEFAULT_MODEL_NAME)


def _normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _safe_label(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text if text else fallback


def _resolve_niveau_weight(niveau: Any) -> float:
    # _normalize_text already strips accents (avancé -> avance), so the lookup
    # keywords here must be accent-free too — otherwise every level silently
    # fell through to DEFAULT_NIVEAU_WEIGHT, halving "Avancé" scores.
    normalized = _normalize_text(niveau)
    if not normalized:
        return DEFAULT_NIVEAU_WEIGHT

    if "avance" in normalized or "expert" in normalized:
        return NIVEAU_WEIGHTS["avancé"]

    if "debutant" in normalized or "notions" in normalized:
        return NIVEAU_WEIGHTS["débutant"]

    if "intermediaire" in normalized:
        return NIVEAU_WEIGHTS["intermediaire"]

    return DEFAULT_NIVEAU_WEIGHT


@lru_cache(maxsize=1)
def get_model() -> Any | None:
    if SentenceTransformer is None:
        LOGGER.warning(
            "sentence-transformers is unavailable in this environment; using lexical fallback embeddings"
        )
        return None

    LOGGER.info("Loading BERT model: %s", DEFAULT_MODEL_NAME)
    try:
        return SentenceTransformer(DEFAULT_MODEL_NAME)
    except Exception as exc:
        LOGGER.warning("Failed to load BERT model, using lexical fallback embeddings: %s", exc)
        return None


def _fallback_encode(phrases: list[str], dim: int = 384) -> np.ndarray:
    vectors = np.zeros((len(phrases), dim), dtype=np.float32)
    token_re = re.compile(r"[a-z0-9_]{2,}")

    for i, phrase in enumerate(phrases):
        tokens = token_re.findall(phrase)
        if not tokens:
            continue

        for token in tokens:
            vectors[i, hash(token) % dim] += 1.0

    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    np.divide(vectors, np.maximum(norms, 1e-9), out=vectors)
    return vectors


def _build_similarity_matrix(
    student_phrases: list[str],
    ref_phrases: list[str],
) -> np.ndarray:
    if not ref_phrases:
        return np.zeros((max(len(student_phrases), 1), 0), dtype=np.float32)

    if not student_phrases:
        return np.zeros((1, len(ref_phrases)), dtype=np.float32)

    model = get_model()
    if model is None:
        cv_emb = _fallback_encode(student_phrases)
        ref_emb = _fallback_encode(ref_phrases)
    else:
        cv_emb = model.encode(student_phrases, normalize_embeddings=True, show_progress_bar=False)
        ref_emb = model.encode(ref_phrases, normalize_embeddings=True, show_progress_bar=False)

    return np.dot(cv_emb, ref_emb.T)


def _analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    status_threshold = MATCH_THRESHOLD

    student_skills = [s for s in payload.student_skills if _normalize_text(s.nom)]
    if not payload.reference_competences:
        raise HTTPException(status_code=400, detail="reference_competences is required")

    # Keep one row per normalized skill phrase and preserve the strongest level weight.
    cv_skill_profiles: dict[str, dict[str, Any]] = {}
    for skill in student_skills:
        phrase = _normalize_text(skill.nom)
        if not phrase:
            continue

        niveau_label = _safe_label(skill.niveau, "")
        weight = _resolve_niveau_weight(niveau_label)

        existing = cv_skill_profiles.get(phrase)
        if existing is None or float(existing["weight"]) < weight:
            cv_skill_profiles[phrase] = {
                "niveau": niveau_label,
                "weight": weight,
            }

    cv_phrases = list(cv_skill_profiles.keys())
    cv_niveaux = {phrase: str(meta["niveau"]) for phrase, meta in cv_skill_profiles.items()}
    cv_weights = np.array(
        [float(meta["weight"]) for meta in cv_skill_profiles.values()],
        dtype=np.float32,
    )

    ref_rows = payload.reference_competences
    ref_phrases = [_normalize_text(r.competence) for r in ref_rows]

    sim_matrix = _build_similarity_matrix(cv_phrases, ref_phrases)
    weighted_sim_matrix = (
        sim_matrix * cv_weights[:, np.newaxis]
        if cv_weights.size > 0
        else sim_matrix
    )

    matches: list[MatchGapEntry] = []
    gaps: list[MatchGapEntry] = []

    for j, ref_row in enumerate(ref_rows):
        if weighted_sim_matrix.shape[1] == 0:
            best_raw_score = 0.0
            best_weighted_score = 0.0
            best_weight = DEFAULT_NIVEAU_WEIGHT
            best_cv_phrase = ""
        else:
            best_i = int(weighted_sim_matrix[:, j].argmax())
            best_weighted_score = float(weighted_sim_matrix[:, j].max())
            best_raw_score = float(sim_matrix[best_i, j]) if best_i < sim_matrix.shape[0] else 0.0
            best_weight = float(cv_weights[best_i]) if best_i < cv_weights.size else DEFAULT_NIVEAU_WEIGHT
            best_cv_phrase = cv_phrases[best_i] if best_i < len(cv_phrases) else ""

        entry = MatchGapEntry(
            ref_competence=_safe_label(ref_row.competence, ""),
            ref_metier=_safe_label(ref_row.metier, "Metier non defini"),
            ref_domaine=_safe_label(ref_row.domaine, "Domaine non defini"),
            ref_type=_safe_label(ref_row.type_competence, ""),
            ref_mots_cles=_safe_label(ref_row.mots_cles, ""),
            best_cv_skill=best_cv_phrase,
            best_cv_niveau=cv_niveaux.get(best_cv_phrase, ""),
            niveau_weight=round(best_weight, 2),
            raw_similarity_score=round(best_raw_score, 4),
            similarity_score=round(best_weighted_score, 4),
            # Covered (match) when the level-weighted similarity — the score the
            # student actually sees — clears the cut-off; below it is a gap.
            status="match" if best_weighted_score >= status_threshold else "gap",
            match_tier="match" if best_weighted_score >= status_threshold else "gap",
        )

        if entry.status == "match":
            matches.append(entry)
        else:
            gaps.append(entry)

    metier_groups: dict[str, list[int]] = defaultdict(list)
    for idx, ref_row in enumerate(ref_rows):
        metier_groups[_safe_label(ref_row.metier, "Metier non defini")].append(idx)

    metier_ranking: list[MetierRankingEntry] = []

    for metier, indices in metier_groups.items():
        n_comp = len(indices)

        if sim_matrix.shape[1] == 0:
            sim_met_raw = np.zeros((max(len(cv_phrases), 1), n_comp), dtype=np.float32)
            sim_met_weighted = np.zeros((max(len(cv_phrases), 1), n_comp), dtype=np.float32)
        else:
            sim_met_raw = sim_matrix[:, indices]
            sim_met_weighted = weighted_sim_matrix[:, indices]

        max_per_ref_raw = sim_met_raw.max(axis=0) if n_comp > 0 else np.array([])
        max_per_ref_weighted = sim_met_weighted.max(axis=0) if n_comp > 0 else np.array([])
        matched_count = int((max_per_ref_weighted >= status_threshold).sum()) if max_per_ref_weighted.size else 0

        matched_sum = float(max_per_ref_weighted[max_per_ref_weighted >= status_threshold].sum()) if max_per_ref_weighted.size else 0.0
        coverage_pct = round(matched_sum / n_comp * 100, 1) if n_comp > 0 else 0.0
        avg_score = round(float(max_per_ref_raw.mean()), 4) if max_per_ref_raw.size else 0.0

        top_skills: list[TopSkill] = []
        if cv_phrases and sim_met_weighted.size:
            best_per_skill = sim_met_weighted.max(axis=1)
            top_indices = best_per_skill.argsort()[-3:][::-1]
            for idx_skill in top_indices:
                if idx_skill < len(cv_phrases):
                    top_skills.append(
                        TopSkill(
                            skill=cv_phrases[int(idx_skill)],
                            score=round(float(best_per_skill[int(idx_skill)]), 4),
                        )
                    )

        first_ref = ref_rows[indices[0]]
        metier_ranking.append(
            MetierRankingEntry(
                metier=metier,
                domaine=_safe_label(first_ref.domaine, "Domaine non defini"),
                n_competences=n_comp,
                matched=matched_count,
                coverage_pct=coverage_pct,
                avg_score=avg_score,
                top_skills=top_skills,
            )
        )

    metier_ranking.sort(key=lambda x: (x.coverage_pct, x.avg_score), reverse=True)
    top_metier = metier_ranking[0] if metier_ranking else None

    sorted_gaps = sorted(gaps, key=lambda g: g.similarity_score, reverse=True)
    top_metier_gaps = [
        gap for gap in sorted_gaps if top_metier and gap.ref_metier == top_metier.metier
    ][:MAX_TOP_METIER_GAPS]

    n_matches = len(matches)
    n_gaps = len(gaps)
    total = max(n_matches + n_gaps, 1)

    return AnalyzeResponse(
        cv_submission_id=payload.cv_submission_id,
        model_name=DEFAULT_MODEL_NAME if get_model() is not None else FALLBACK_MODEL_NAME,
        threshold=MATCH_THRESHOLD,
        summary=AnalysisSummary(
            n_skills=len(cv_phrases),
            n_matches=n_matches,
            n_gaps=n_gaps,
            match_rate_pct=round((n_matches / total) * 100, 1),
        ),
        top_metier=top_metier,
        metier_ranking=metier_ranking,
        matches=matches,
        gaps=sorted_gaps[:MAX_GLOBAL_GAPS],
        top_metier_gaps=top_metier_gaps,
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": DEFAULT_MODEL_NAME,
    }


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    try:
        return _analyze(payload)
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception("Matching analysis failed")
        raise HTTPException(status_code=500, detail=f"Matching analysis failed: {exc}") from exc
