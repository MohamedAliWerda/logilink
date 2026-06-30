"""
Recommendation Service v2 — ISGIS
FastAPI micro-service que :
  1) lit cv_submissions + cv_matching_competence_results (Supabase REST)
  2) agrege les gaps (TARGET_METIER / OTHER_METIER) avec cohorte par metier
  3) embed les competences via SentenceTransformer (fallback lexical) puis cluster
     semantiquement (KMeans) pour fusionner les libelles synonymes
  4) RAG retrieval sur RAG_MASTER_*.xlsx (sheets 1, 7, 8, 9, 11, 19, 20, 23)
  5) Two-stage : Gemini batch (CRITIQUE uniquement) + RAG-only (MOYENNE/FAIBLE)
  6) enrichit les certifs depuis le lookup sheet 8 quand un champ est manquant
  7) insere les recos (status=pending) + targets dans Supabase, en preservant
     les decisions admin (approved/edited/rejected) et en purgeant les pending
     obsoletes des runs precedents
  8) expose POST /generate, GET /status/{job_id}, GET /health

Declenche par le backend NestJS quand l'admin clique sur "Generer".
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import threading
import time
import unicodedata
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sklearn.cluster import KMeans


LOGGER = logging.getLogger("recommendation_service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


# =============================================================================
# Configuration (env d'abord, valeurs par defaut en dur)
# =============================================================================

SUPABASE_URL = os.getenv(
    "SUPABASE_URL",
    "https://kayhpmwnerluxfuaalmg.supabase.co",
).rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtheWhwbXduZXJsdXhmdWFhbG1nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzczNTkxMiwiZXhwIjoyMDg5MzExOTEyfQ."
    "A5kQ2sDy5r-EMUSUllPr7OrcyTuz7Z3LXcRNs14I0qo",
)

# Gemini (seul provider LLM)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_RATE_LIMIT_SLEEP = float(os.getenv("GEMINI_RATE_LIMIT_SLEEP", "1.0"))
GEMINI_BATCH_SIZE = int(os.getenv("GEMINI_BATCH_SIZE", "5"))

# RAG corpus (par defaut le fichier present dans ce dossier)
RAG_XLSX_PATH = os.getenv(
    "RAG_XLSX_PATH",
    str(Path(__file__).parent / "RAG_MASTER_v5.xlsx"),
)

# Sentence-transformer model (downloads once, cached locally)
ST_MODEL_NAME = os.getenv("ST_MODEL_NAME", "paraphrase-multilingual-MiniLM-L12-v2")

# Pipeline tuning
EMBED_DIM = 384
TOP_K_RAG = int(os.getenv("TOP_K_RAG", "5"))
N_CLUSTERS_PER_GROUP = int(os.getenv("N_CLUSTERS_PER_GROUP", "3"))
# Cap optionnel sur le nb d'appels LLM par job (0 = illimite). Chaque appel
# couvre GEMINI_BATCH_SIZE clusters, pas 1 reco.
MAX_LLM_CALLS = int(os.getenv("MAX_LLM_CALLS", "0"))

# Tiers qui declenchent un appel Gemini (les autres restent en RAG-only)
LLM_PRIORITY_TIERS = {
    t.strip().upper()
    for t in os.getenv("LLM_PRIORITY_TIERS", "CRITIQUE").split(",")
    if t.strip()
}

# Seuils priorite (en % du cohorte) — conserves pour tri/affichage mais ne
# determinent plus le niveau affiché a l'etudiant.
PRIORITY_THRESHOLDS = {
    "CRITIQUE": float(os.getenv("PRIORITY_CRITIQUE", "70")),
    "MOYENNE": float(os.getenv("PRIORITY_MOYENNE", "40")),
    "FAIBLE": float(os.getenv("PRIORITY_FAIBLE", "20")),
}

# Seuils de severite du gap (avg_similarity) — miroir exact de
# levelFromGapSimilarityScore dans le backend NestJS :
#   score >= 0.5 → FAIBLE  (gap leger, competence presque acquise)
#   score >= 0.3 → MOYENNE (gap modere)
#   score <  0.3 → CRITIQUE (gap important, competence absente)
GAP_SEVERITY_FAIBLE   = float(os.getenv("GAP_SEVERITY_FAIBLE",   "0.5"))
GAP_SEVERITY_MOYENNE  = float(os.getenv("GAP_SEVERITY_MOYENNE",  "0.3"))


# =============================================================================
# Supabase REST helpers
# =============================================================================

def _supabase_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _sanitize_json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return {str(k): _sanitize_json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_sanitize_json_value(v) for v in value]
    if isinstance(value, np.generic):
        return _sanitize_json_value(value.item())
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    return value


def _serialize_json_payload(payload: Any) -> str:
    sanitized = _sanitize_json_value(payload)
    try:
        return json.dumps(sanitized, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"Invalid JSON payload for Supabase: {exc}") from exc


def supabase_select(table: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Page through a PostgREST select so we avoid the default 1000-row cap."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    base_params = dict(params or {})
    rows: list[dict[str, Any]] = []
    page_size = 1000
    offset = 0

    with httpx.Client(timeout=60.0) as client:
        while True:
            headers = _supabase_headers()
            headers["Range-Unit"] = "items"
            headers["Range"] = f"{offset}-{offset + page_size - 1}"
            resp = client.get(url, params=base_params, headers=headers)
            if resp.status_code >= 400:
                raise RuntimeError(f"Supabase SELECT {table} failed: {resp.status_code} {resp.text}")
            batch = resp.json() or []
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size

    return rows


def supabase_upsert(table: str, rows: list[dict[str, Any]], on_conflict: str | None = None) -> None:
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    params: dict[str, Any] = {}
    if on_conflict:
        params["on_conflict"] = on_conflict

    headers = _supabase_headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

    with httpx.Client(timeout=120.0) as client:
        for i in range(0, len(rows), 500):
            chunk = rows[i: i + 500]
            payload = _serialize_json_payload(chunk)
            resp = client.post(url, params=params, content=payload, headers=headers)
            if resp.status_code >= 400:
                raise RuntimeError(f"Supabase UPSERT {table} failed: {resp.status_code} {resp.text}")


def supabase_delete_where(table: str, params: dict[str, str]) -> None:
    """Delete rows with raw PostgREST filter params."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    with httpx.Client(timeout=60.0) as client:
        resp = client.delete(url, params=params, headers=_supabase_headers())
        if resp.status_code >= 400:
            raise RuntimeError(f"Supabase DELETE {table} failed: {resp.status_code} {resp.text}")


def get_recommendation_status_map(recommendation_ids: list[str]) -> dict[str, str]:
    if not recommendation_ids:
        return {}
    status_map: dict[str, str] = {}
    for i in range(0, len(recommendation_ids), 200):
        chunk = [rid for rid in recommendation_ids[i: i + 200] if rid]
        if not chunk:
            continue
        rows = supabase_select(
            "ai_recommendations",
            {"select": "id,status", "id": f"in.({','.join(chunk)})"},
        )
        for row in rows:
            rid = str(row.get("id") or "").strip()
            if rid:
                status_map[rid] = str(row.get("status") or "").strip().lower()
    return status_map


def list_pending_recommendation_ids() -> list[str]:
    rows = supabase_select(
        "ai_recommendations",
        {"select": "id", "status": "eq.pending"},
    )
    return [str(row.get("id") or "").strip() for row in rows if row.get("id")]


def delete_recommendations_by_ids(ids: list[str]) -> int:
    if not ids:
        return 0
    deleted = 0
    for i in range(0, len(ids), 200):
        chunk = [rid for rid in ids[i: i + 200] if rid]
        if not chunk:
            continue
        supabase_delete_where("ai_recommendations", {"id": f"in.({','.join(chunk)})"})
        deleted += len(chunk)
    return deleted


def delete_targets_by_recommendation_ids(ids: list[str]) -> int:
    if not ids:
        return 0
    deleted = 0
    for i in range(0, len(ids), 200):
        chunk = [rid for rid in ids[i: i + 200] if rid]
        if not chunk:
            continue
        supabase_delete_where(
            "ai_recommendation_targets",
            {"recommendation_id": f"in.({','.join(chunk)})"},
        )
        deleted += len(chunk)
    return deleted


# =============================================================================
# Embedding (SentenceTransformer prefere, fallback lexical)
# =============================================================================

_TOKEN_RE = re.compile(r"[a-z0-9_]{2,}")
_ST_MODEL: Any = None
_ST_LOAD_TRIED = False
_ST_LOCK = threading.Lock()


def _normalize_text(text: Any) -> str:
    s = str(text or "").strip().lower()
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", s).strip()


def lexical_embed(texts: list[str], dim: int = EMBED_DIM) -> np.ndarray:
    vectors = np.zeros((len(texts), dim), dtype=np.float32)
    for i, raw in enumerate(texts):
        tokens = _TOKEN_RE.findall(_normalize_text(raw))
        for tok in tokens:
            vectors[i, hash(tok) % dim] += 1.0
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    np.divide(vectors, np.maximum(norms, 1e-9), out=vectors)
    return vectors


def get_st_model() -> Any:
    """Lazy singleton. Returns None if sentence-transformers can't be loaded."""
    global _ST_MODEL, _ST_LOAD_TRIED
    if _ST_LOAD_TRIED:
        return _ST_MODEL
    with _ST_LOCK:
        if _ST_LOAD_TRIED:
            return _ST_MODEL
        _ST_LOAD_TRIED = True
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
            LOGGER.info("Loading SentenceTransformer: %s ...", ST_MODEL_NAME)
            # Try local cache first — instant, no network required.
            try:
                _ST_MODEL = SentenceTransformer(ST_MODEL_NAME, local_files_only=True)
                LOGGER.info("SentenceTransformer loaded from local cache.")
            except Exception:
                # HF now uses XET (P2P protocol) which may be blocked by firewalls/proxies.
                os.environ["HF_HUB_DISABLE_XET"] = "1"
                LOGGER.info("Downloading %s (first run, XET disabled) …", ST_MODEL_NAME)
                _ST_MODEL = SentenceTransformer(ST_MODEL_NAME)
                LOGGER.info("SentenceTransformer ready.")
        except Exception as exc:
            LOGGER.warning(
                "SentenceTransformer unavailable (%s) — falling back to lexical embeddings.",
                exc,
            )
            _ST_MODEL = None
    return _ST_MODEL


def encode_texts(texts: list[str], st_model: Any | None) -> np.ndarray:
    if st_model is not None and len(texts) > 0:
        try:
            return st_model.encode(
                texts,
                batch_size=64,
                show_progress_bar=False,
                normalize_embeddings=True,
            ).astype(np.float32)
        except Exception as exc:
            LOGGER.warning("ST encode failed (%s) — falling back to lexical.", exc)
    return lexical_embed(texts)


# =============================================================================
# RAG corpus (lazy singleton)
# =============================================================================

_RAG_CACHE: dict[str, Any] = {"docs": None, "vectors": None, "loaded_at": None}
_RAG_LOCK = threading.Lock()


SHEET_CONFIGS = {
    "1-Metiers ISGIS": {
        "fmt": lambda r: (
            f"[METIER] {r.get('Metier FR','')} | Domaine: {r.get('Domaine','')} | "
            f"Comp Tech: {r.get('Comp Tech','')} | Comp Organ: {r.get('Comp Organ','')} | "
            f"Certifs: {r.get('Certifs','')} | Mots-cles: {r.get('Mots-cles','')}"
        ),
        "titre_col": ["Metier FR"],
    },
    "8-Ressources Formation": {
        "fmt": lambda r: (
            f"[CERTIF] {r.get('Titre','')} | Plateforme: {r.get('Plateforme','')} | "
            f"Duree: {r.get('Duree','')}h | Cout: {r.get('Cout','')} | "
            f"URL: {r.get('URL','')} | Competences: {r.get('Competences','')} | "
            f"Pour: {r.get('Recommande Pour','')}"
        ),
        "titre_col": ["Titre"],
    },
    "9-RNCP": {
        "fmt": lambda r: (
            f"[RNCP] {r.get('Certification','')} | Metier: {r.get('Metier','')} | "
            f"Competences: {r.get('Competences','')} | Mots-cles: {r.get('Mots-cles','')}"
        ),
        "titre_col": ["Certification"],
    },
    "11-AFT": {
        "fmt": lambda r: (
            f"[AFT] {r.get('Titre','')} | Metier: {r.get('Metier','')} | "
            f"Certif: {r.get('Certifications','')} | Mots-cles: {r.get('Mots-cles','')}"
        ),
        "titre_col": ["Titre"],
    },
    "19-Frequence Gaps TN": {
        "fmt": lambda r: (
            f"[GAP_TN] {r.get('Gap','')} | Criticite: {r.get('Criticite','')} | "
            f"Ressource: {r.get('Ressource','')} | Duree: {r.get('Duree','')}"
        ),
        "titre_col": ["Gap"],
    },
    "20-Regles Recommandation": {
        "fmt": lambda r: (
            f"[REGLE] {r.get('Condition','')} | Priorite: {r.get('Priorite','')} | "
            f"Action: {r.get('Action','')} | {r.get('Message Admin','')}"
        ),
        "titre_col": ["Condition"],
    },
    "7-Comp Transversales": {
        "fmt": lambda r: (
            f"[TRANSV] {r.get('Competence FR','')} | Freq: {r.get('Frequence','')} | "
            f"Formation: {r.get('Formation','')} | Ressources: {r.get('Ressources Gratuites','')}"
        ),
        "titre_col": ["Competence FR"],
    },
    "23-Comp Emergentes": {
        "fmt": lambda r: (
            f"[EMERGENT] {r.get('Competence','')} | Tendance: {r.get('Tendance','')} | "
            f"Formation: {r.get('Formation','')} | Outils: {r.get('Outils','')}"
        ),
        "titre_col": ["Competence"],
    },
}


def _get_titre(row: dict[str, Any], cols: list[str]) -> str:
    for c in cols:
        v = row.get(c, "")
        if v and str(v).strip():
            return str(v).strip()
    return "N/A"


def _load_rag_corpus(st_model: Any | None) -> tuple[list[dict[str, Any]], np.ndarray]:
    path = Path(RAG_XLSX_PATH)
    if not path.exists():
        LOGGER.warning("RAG file not found at %s — retrieval will return empty.", path)
        return [], np.zeros((0, EMBED_DIM), dtype=np.float32)

    docs: list[dict[str, Any]] = []
    for sheet, cfg in SHEET_CONFIGS.items():
        try:
            df = pd.read_excel(path, sheet_name=sheet)
        except Exception as exc:
            LOGGER.warning("RAG sheet %s skipped: %s", sheet, exc)
            continue
        for _, row in df.iterrows():
            r = row.to_dict()
            text = cfg["fmt"](r)
            if len(str(text).strip()) <= 10:
                continue
            raw_fields: dict[str, str] = {}
            if sheet == "8-Ressources Formation":
                raw_fields = {
                    "plateforme": str(r.get("Plateforme", "") or "").strip(),
                    "duree":      str(r.get("Duree", "")      or "").strip(),
                    "cout":       str(r.get("Cout", "")        or "").strip(),
                    "url":        str(r.get("URL", "")         or "").strip(),
                    "langue":     str(r.get("Langue", "")      or "").strip(),
                    "niveau":     str(r.get("Niveau", "")      or "").strip(),
                }
            elif sheet == "11-AFT":
                raw_fields = {
                    "plateforme": "AFT",
                    "duree":      str(r.get("Duree", "") or "").strip(),
                    "cout":       "",
                    "url":        "",
                }
            docs.append({
                "text": str(text),
                "source": sheet,
                "titre": _get_titre(r, cfg["titre_col"]),
                **raw_fields,
            })

    if not docs:
        return [], np.zeros((0, EMBED_DIM), dtype=np.float32)

    texts = [d["text"] for d in docs]
    vectors = encode_texts(texts, st_model)
    LOGGER.info(
        "RAG corpus loaded: %d docs from %d sheets (embed=%s).",
        len(docs),
        len(SHEET_CONFIGS),
        "ST" if st_model is not None else "lexical",
    )
    return docs, vectors


def get_rag_corpus(st_model: Any | None) -> tuple[list[dict[str, Any]], np.ndarray]:
    with _RAG_LOCK:
        if _RAG_CACHE["docs"] is None:
            docs, vecs = _load_rag_corpus(st_model)
            _RAG_CACHE["docs"] = docs
            _RAG_CACHE["vectors"] = vecs
            _RAG_CACHE["loaded_at"] = datetime.now(timezone.utc).isoformat()
        return _RAG_CACHE["docs"], _RAG_CACHE["vectors"]


def retrieve_rag(query: str, k: int = TOP_K_RAG, st_model: Any | None = None) -> list[dict[str, Any]]:
    docs, vectors = get_rag_corpus(st_model)
    if not docs or vectors.shape[0] == 0:
        return []
    q_vec = encode_texts([query], st_model)[0]
    sims = vectors @ q_vec
    top_idx = np.argsort(-sims)[:k]
    return [
        {**docs[int(i)], "score": float(sims[int(i)])}
        for i in top_idx
    ]


# =============================================================================
# Cert lookup (sheet 8 — used to enrich missing fields after Gemini)
# =============================================================================

_CERT_LOOKUP: dict[str, dict] = {}
_CERT_LOOKUP_LOCK = threading.Lock()
_CERT_LOOKUP_LOADED = False


def _norm_title(t: str) -> str:
    t = str(t or "").lower().strip()
    t = unicodedata.normalize("NFD", t)
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", t).strip()


def build_cert_lookup() -> None:
    global _CERT_LOOKUP_LOADED
    with _CERT_LOOKUP_LOCK:
        if _CERT_LOOKUP_LOADED:
            return
        _CERT_LOOKUP_LOADED = True
        try:
            df8 = pd.read_excel(RAG_XLSX_PATH, sheet_name="8-Ressources Formation")
        except Exception as exc:
            LOGGER.warning("Could not build cert lookup: %s", exc)
            return
        for _, row in df8.iterrows():
            r = row.to_dict()
            titre_norm = _norm_title(str(r.get("Titre", "")))
            if titre_norm:
                _CERT_LOOKUP[titre_norm] = {
                    "cert_provider": str(r.get("Plateforme", "") or "").strip(),
                    "cert_duration": str(r.get("Duree", "") or "").strip(),
                    "cert_pricing":  str(r.get("Cout", "") or "").strip(),
                    "cert_url":      str(r.get("URL", "") or "").strip(),
                }
        LOGGER.info("Cert lookup index built: %d entries.", len(_CERT_LOOKUP))


_DOMAIN_FALLBACK = [
    ("logistique verte",       "AFTRAL / AFT",         "https://www.aftral.com",       "14h",   "Payant (financement OPCO)"),
    ("decarbon",               "AFTRAL / AFT",         "https://www.aftral.com",       "14h",   "Payant (financement OPCO)"),
    ("commerce international", "CNCE / CCI Paris",     "https://www.cnce.fr",          "180h",  "Payant (financement OPCO)"),
    ("douane",                 "ISTELI / AFTRAL",      "https://www.isteli.aftral.com","180h",  "Payant (financement OPCO)"),
    ("supply chain",           "ASCM / APICS",         "https://www.ascm.org",         "120h",  "Payant (800-1200 USD)"),
    ("demand plan",            "Coursera / Google",    "https://www.coursera.org",     "180h",  "Payant (~50 USD/mois)"),
    ("master",                 "Universite / CCI",     "https://www.onisep.fr",        "2 ans", "Frais universitaires"),
    ("licence pro",            "Universite / IUT",     "https://www.onisep.fr",        "1 an",  "Frais universitaires"),
    ("bts",                    "CCI Formation / Lycee","https://www.cci.fr/formation", "2 ans", "Frais scolarite"),
    ("changement",             "Prosci",               "https://www.prosci.com",       "21h",   "Payant (2000-3500 USD)"),
]


def enrich_from_lookup(reco: dict[str, Any]) -> dict[str, Any]:
    def _missing(field: str) -> bool:
        return not str(reco.get(field) or "").strip()

    if not any(_missing(f) for f in ["cert_provider", "cert_duration", "cert_url", "cert_pricing"]):
        return reco

    title_norm = _norm_title(reco.get("cert_title", ""))
    if not title_norm:
        return reco

    hit = _CERT_LOOKUP.get(title_norm)
    if hit is None:
        for key, fields in _CERT_LOOKUP.items():
            if key in title_norm or title_norm in key:
                hit = fields
                break
    if hit is None:
        title_tokens = set(title_norm.split())
        best_overlap, best_fields = 0, None
        for key, fields in _CERT_LOOKUP.items():
            overlap = len(title_tokens & set(key.split()))
            if overlap > best_overlap:
                best_overlap, best_fields = overlap, fields
        if best_overlap >= 2:
            hit = best_fields
    if hit is None:
        for kw, prov, url, dur, price in _DOMAIN_FALLBACK:
            if kw in title_norm:
                hit = {"cert_provider": prov, "cert_url": url, "cert_duration": dur, "cert_pricing": price}
                break
    if hit is None:
        return reco

    enriched = dict(reco)
    for field in ["cert_provider", "cert_duration", "cert_url", "cert_pricing"]:
        if _missing(field) and hit.get(field):
            enriched[field] = hit[field]
    return enriched


_FIELD_RE = re.compile(r"([A-Za-zà-ÿ\- ]+):\s*([^|]+?)(?=\s*\||$)")


def extract_rag_cert_fields(rag_results: list[dict[str, Any]]) -> dict[str, str]:
    source_weight = {"8-Ressources Formation": 10, "9-RNCP": 5, "11-AFT": 4, "23-Comp Emergentes": 2}
    sheet8_hits = [r for r in rag_results if r.get("source") == "8-Ressources Formation"]
    other_hits = [r for r in rag_results if r.get("source") != "8-Ressources Formation"]

    best: dict[str, Any] | None = None
    if sheet8_hits:
        best = max(sheet8_hits, key=lambda r: r.get("score", 0.0))
    elif other_hits:
        best = max(
            other_hits,
            key=lambda r: r.get("score", 0.0) + source_weight.get(r.get("source", ""), 0) * 0.1,
        )

    if best is None:
        return {
            "cert_title": "A definir",
            "cert_provider": "",
            "cert_duration": "",
            "cert_url": "",
            "cert_pricing": "",
            "cert_description": "",
        }

    cert_provider = best.get("plateforme", "")
    cert_duration = best.get("duree", "")
    cert_url = best.get("url", "")
    cert_pricing = best.get("cout", "")

    if not any([cert_provider, cert_duration, cert_url, cert_pricing]):
        fields = dict(_FIELD_RE.findall(best["text"]))

        def _get(*keys: str) -> str:
            for k in keys:
                v = fields.get(k, "").strip()
                if v and v.lower() not in ("nan", "none", ""):
                    return v
            return ""

        cert_provider = _get("Plateforme", "Organisme")
        cert_duration = _get("Duree", "Duree")
        cert_url = _get("URL", "Url", "Lien")
        cert_pricing = _get("Cout", "Tarif", "Prix")

    def _clean(v: Any) -> str:
        if str(v).lower() in ("nan", "none", "nat", ""):
            return ""
        return str(v).strip()

    return {
        "cert_title":       best.get("titre") or "A definir",
        "cert_provider":    _clean(cert_provider),
        "cert_duration":    _clean(cert_duration),
        "cert_url":         _clean(cert_url),
        "cert_pricing":     _clean(cert_pricing),
        "cert_description": str(best["text"])[:400],
    }


# =============================================================================
# Gemini (batched) + RAG-only recommendation
# =============================================================================

SYSTEM_PROMPT = (
    "Tu es un conseiller pedagogique expert de l'ISGIS Sfax (Tunisie). "
    "Tu analyses les gaps de competences des etudiants ISGIS et recommandes UNE formation certifiante pour chaque gap. "
    "Tu reponds en francais, en JSON strict (tableau d'objets), sans texte avant ou apres. "
    "REGLES STRICTES : "
    "(1) cert_title, cert_provider, cert_duration, cert_url -> copies EXACTES des valeurs du bloc RAG fourni. Ne les invente jamais. "
    "(2) cert_description -> 1 a 2 phrases redigees par toi decrivant pourquoi cette certification comble ce gap precis. "
    "(3) gap_label -> libelle court et lisible du gap, PAS une troncature du nom de competence. Max 60 car. "
    "(4) gap_title -> titre descriptif avec le type de competence en prefixe. Max 100 car. "
    "(5) llm_recommendation -> 3-4 lignes : constat du gap + donnees chiffrees + justification + action concrete."
)


class LLMDailyCapExhausted(Exception):
    """Raised when Gemini hits its daily quota — retrying is futile."""


_RETRY_AFTER_RE = re.compile(r"try again in ([0-9]+)m([0-9.]+)s", re.IGNORECASE)
_RETRY_AFTER_SEC_RE = re.compile(r"try again in ([0-9.]+)s", re.IGNORECASE)


def _extract_retry_after_seconds(err_msg: str) -> float:
    m = _RETRY_AFTER_RE.search(err_msg)
    if m:
        return float(m.group(1)) * 60 + float(m.group(2))
    m = _RETRY_AFTER_SEC_RE.search(err_msg)
    return float(m.group(1)) if m else 0.0


def _build_batch_prompt(batch: list[dict[str, Any]], rag_results_per_gap: list[list[dict[str, Any]]]) -> str:
    lines: list[str] = []
    for i, (gap, rag) in enumerate(zip(batch, rag_results_per_gap), 1):
        comp_list = " / ".join(gap.get("all_competences", [])[:4]) or gap.get("competence_name", "")
        ctx = "\n".join(f"   - [{r['source']}] {r['text'][:200]}" for r in rag[:3]) \
              or "   (pas de ressource RAG disponible)"
        lines.append(
            f"=== GAP {i} ===\n"
            f"Bucket: {gap['bucket']} | Metier: {gap['metier_name']} | Domaine: {gap['domaine_name']}\n"
            f"Competences groupees: {comp_list}\n"
            f"Type: {gap['competence_type']} | Priorite: {gap['priority']} | "
            f"{gap['pct']}% cohorte ({gap['n_students']} etudiants)\n"
            f"Mots-cles: {gap['keywords']}\n"
            f"Ressources RAG:\n{ctx}"
        )
    prompt = "\n\n".join(lines)
    prompt += (
        "\n\nINSTRUCTIONS FINALES:\n"
        "- cert_title    : copie exacte du champ 'Titre' du bloc RAG\n"
        "- cert_provider : copie exacte du champ 'Plateforme' du bloc RAG\n"
        "- cert_duration : copie exacte du champ 'Duree' du bloc RAG\n"
        "- cert_url      : copie exacte de l'URL si presente dans le RAG, sinon ''\n"
        "- cert_description : 1-2 phrases redigees par toi\n"
        "- llm_recommendation : 3-4 lignes -> constat chiffre + justification + action\n"
        "- gap_label : libelle court et lisible (max 60 car.)\n"
        "- gap_title : [Type] + titre descriptif (max 100 car.)\n"
        f"\nReponds UNIQUEMENT avec un tableau JSON de {len(batch)} objets dans l'ordre des gaps:\n"
        '[{"cert_title": "...(du RAG)", "cert_provider": "...(du RAG)", '
        '"cert_duration": "...(du RAG)", "cert_pricing": "...", '
        '"cert_url": "...(du RAG ou \'\')", '
        '"cert_description": "...(redige par toi)", '
        '"llm_recommendation": "...(3-4 lignes)", '
        '"gap_label": "...(libelle court)", "gap_title": "[Type] titre"}, ...]'
    )
    return prompt


def call_gemini_batch(
    batch: list[dict[str, Any]],
    rag_results_per_gap: list[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    if not GEMINI_API_KEY:
        raise RuntimeError("gemini api key unavailable")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": _build_batch_prompt(batch, rag_results_per_gap)}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2000,
            "responseMimeType": "application/json",
        },
    }

    last_err: Optional[str] = None
    for attempt in range(1, 4):
        try:
            with httpx.Client(timeout=90.0) as client:
                resp = client.post(url, json=body, headers={"Content-Type": "application/json"})
            if resp.status_code == 429:
                text = resp.text
                if "per day" in text.lower() or "quota" in text.lower():
                    raise LLMDailyCapExhausted(f"gemini: {text[:300]}")
                wait = min(_extract_retry_after_seconds(text) or (2 ** attempt), 30.0)
                LOGGER.warning("Gemini rate-limited (%d/3) — sleeping %.1fs", attempt, wait)
                time.sleep(wait)
                continue
            if resp.status_code >= 400:
                raise RuntimeError(f"gemini {resp.status_code}: {resp.text[:300]}")

            data = resp.json()
            candidates = data.get("candidates") or []
            if not candidates:
                raise RuntimeError(f"gemini empty response: {data}")
            parts = candidates[0].get("content", {}).get("parts") or []
            text_out = "".join(p.get("text", "") for p in parts).strip()
            parsed = json.loads(text_out)
            if isinstance(parsed, dict):
                parsed = list(parsed.values())
            while len(parsed) < len(batch):
                parsed.append({})
            return parsed[: len(batch)]
        except LLMDailyCapExhausted:
            raise
        except Exception as exc:
            last_err = str(exc)
            if attempt >= 3:
                raise
            time.sleep(1.0)

    raise RuntimeError(last_err or "gemini unknown failure")


def rag_only_reco(gap: dict[str, Any], rag: list[dict[str, Any]]) -> dict[str, Any]:
    cf = extract_rag_cert_fields(rag)
    comp = gap["competence_name"]
    # When RAG found no certification, derive a descriptive title from the competence
    if cf["cert_title"] in ("A definir", "", "N/A"):
        cf = dict(cf)
        cf["cert_title"] = f"Formation : {comp[:80]}"
    metier = gap["metier_name"]
    prio = gap["priority"]
    pct = gap["pct"]
    n_stu = gap["n_students"]
    coh = gap["cohort_size"]
    ctype = gap.get("competence_type", "")
    keywords = gap.get("keywords", "")
    bucket_ctx = (
        "competence directement requise pour le metier vise"
        if gap.get("bucket") == "TARGET_METIER"
        else "competence transversale pour elargir l'employabilite"
    )
    cert_description = (
        f"La certification « {cf['cert_title']} »"
        + (f" (via {cf['cert_provider']})" if cf["cert_provider"] else "")
        + f" permet de developper la competence '{comp[:60]}'"
        + f" essentielle dans le metier {metier}."
        + (f" Duree : {cf['cert_duration']}." if cf["cert_duration"] else "")
    )
    llm_recommendation = (
        f"CONSTAT : {n_stu} etudiant(s) sur {coh} ({pct}%) presentent un gap "
        f"de priorite {prio} sur la competence [{ctype}] « {comp} » ({bucket_ctx}). "
        f"Mots-cles : {keywords}.\n"
        f"CERTIFICATION RECOMMANDEE : {cf['cert_title']}"
        + (" — " + cf["cert_provider"] if cf["cert_provider"] else "") + ". "
        + ("Duree : " + cf["cert_duration"] + ". " if cf["cert_duration"] else "")
        + "\nJUSTIFICATION : Selectionnee depuis le referentiel 8-Ressources Formation "
        + f"car elle couvre directement les competences manquantes pour le metier {metier}.\n"
        + f"ACTION : Orienter les {n_stu} etudiant(s) concerne(s) vers cette certification "
        + "des la prochaine session disponible."
    )
    gap_label = f"Gap {prio}: {comp[:38]}…" if len(comp) > 41 else f"Gap {prio}: {comp}"
    gap_title = f"[{ctype}] {comp[:80]}"
    return {
        "cert_title":         cf["cert_title"],
        "cert_provider":      cf["cert_provider"],
        "cert_duration":      cf["cert_duration"],
        "cert_pricing":       cf["cert_pricing"],
        "cert_url":           cf["cert_url"],
        "cert_description":   cert_description,
        "llm_recommendation": llm_recommendation,
        "gap_label":          gap_label[:60],
        "gap_title":          gap_title[:100],
    }


# =============================================================================
# Pipeline — data loading, clustering, fan-out
# =============================================================================

def priority_label(pct: float) -> str:
    """Classe par taux de cohorte — utilise uniquement pour tri interne."""
    if pct >= PRIORITY_THRESHOLDS["CRITIQUE"]:
        return "CRITIQUE"
    if pct >= PRIORITY_THRESHOLDS["MOYENNE"]:
        return "MOYENNE"
    return "FAIBLE"


def priority_from_gap_severity(avg_sim: float) -> str:
    """Classe par severite du gap (score de similarite moyen).

    Un score faible signifie que la competence est tres eloignee du profil
    etudiant => gap critique.  Miroir de levelFromGapSimilarityScore (NestJS).
    """
    if avg_sim >= GAP_SEVERITY_FAIBLE:
        return "FAIBLE"
    if avg_sim >= GAP_SEVERITY_MOYENNE:
        return "MOYENNE"
    return "CRITIQUE"


def build_recommendation_id(bucket: str, metier: str, competence: str) -> str:
    h = hashlib.sha256(f"{bucket}|{metier}|{competence}".encode("utf-8")).hexdigest()[:16]
    return f"rec_{h}"


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _is_metier_match(left: Any, right: Any) -> bool:
    left_norm = _normalize_text(left)
    right_norm = _normalize_text(right)
    if not left_norm or not right_norm:
        return False

    if left_norm == right_norm:
        return True
    if left_norm in right_norm or right_norm in left_norm:
        return True

    left_tokens = set(_TOKEN_RE.findall(left_norm))
    right_tokens = set(_TOKEN_RE.findall(right_norm))
    if not left_tokens or not right_tokens:
        return False

    common = left_tokens & right_tokens
    if len(common) >= 2:
        return True

    return len(common) >= 1 and (len(left_tokens) <= 1 or len(right_tokens) <= 1)


def sync_confirmed_targets_for_approved_recommendations() -> int:
    approved_rows = supabase_select(
        "ai_recommendations",
        {"select": "id,metier", "status": "eq.approved"},
    )
    if not approved_rows:
        return 0

    submission_rows = supabase_select(
        "cv_submissions",
        {"select": "auth_id,professional_title"},
    )
    if not submission_rows:
        return 0

    students: list[tuple[str, str]] = []
    for row in submission_rows:
        auth_id = str(row.get("auth_id") or "").strip()
        target_job = str(row.get("professional_title") or "").strip()
        if auth_id and target_job:
            students.append((auth_id, target_job))
    if not students:
        return 0

    rows_to_upsert: list[dict[str, str]] = []
    seen_pairs: set[tuple[str, str]] = set()

    for row in approved_rows:
        recommendation_id = str(row.get("id") or "").strip()
        metier = str(row.get("metier") or "").strip()
        if not recommendation_id or not metier:
            continue

        for auth_id, target_job in students:
            if not _is_metier_match(metier, target_job):
                continue
            key = (recommendation_id, auth_id)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            rows_to_upsert.append({"recommendation_id": recommendation_id, "auth_id": auth_id})

    if not rows_to_upsert:
        return 0

    supabase_upsert(
        "ai_confirmed_recommendation_targets",
        rows_to_upsert,
        on_conflict="recommendation_id,auth_id",
    )
    return len(rows_to_upsert)


def load_and_cluster_gaps(st_model: Any | None) -> tuple[pd.DataFrame, list[dict[str, Any]], int]:
    """Fetch Supabase data, aggregate gaps, embed + cluster competences."""
    submissions_raw = supabase_select(
        "cv_submissions",
        {"select": "id,auth_id,metier_id,professional_title"},
    )
    results_raw = supabase_select(
        "cv_matching_competence_results",
        {"select": "cv_submission_id,auth_id,metier_name,domaine_name,metier_rank,"
                   "status,competence_name,competence_type,keywords,similarity_score"},
    )

    if not submissions_raw:
        raise RuntimeError("cv_submissions est vide — rien a recommander.")
    if not results_raw:
        raise RuntimeError("cv_matching_competence_results est vide — lance l'analyse de matching d'abord.")

    df_sub = pd.DataFrame(submissions_raw).rename(columns={
        "id": "cv_submission_id",
        "metier_id": "target_metier_id",
        "professional_title": "target_metier_name",
    })[["cv_submission_id", "auth_id", "target_metier_id", "target_metier_name"]]

    df_res = pd.DataFrame(results_raw)
    df = df_res.merge(df_sub, on=["cv_submission_id", "auth_id"], how="left")
    df = df.dropna(subset=["target_metier_name"])
    df["is_target"] = df["metier_name"] == df["target_metier_name"]

    df_gaps = df[df["status"] == "gap"].copy()
    n_students_total = int(df_sub["auth_id"].dropna().nunique())

    if df_gaps.empty:
        return pd.DataFrame(), [], n_students_total

    LOGGER.info("Gaps loaded: %d rows | %d unique students.", len(df_gaps), n_students_total)

    popularity = (
        df_sub.dropna(subset=["target_metier_name"])
        .groupby(["target_metier_id", "target_metier_name"])
        .size()
        .reset_index(name="n_stu")
        .sort_values("n_stu", ascending=False)
        .reset_index(drop=True)
    )
    popularity["rank"] = popularity.index + 1
    rank_map = dict(zip(popularity["target_metier_name"], popularity["rank"]))
    cohort_map = dict(zip(popularity["target_metier_name"], popularity["n_stu"]))

    group_cols = ["metier_name", "domaine_name", "competence_name", "competence_type", "keywords"]
    df_gaps["similarity_score"] = df_gaps["similarity_score"].apply(_to_float)

    agg_frames: list[pd.DataFrame] = []
    for bucket_flag, bucket_label in [(True, "TARGET_METIER"), (False, "OTHER_METIER")]:
        sub = df_gaps[df_gaps["is_target"] == bucket_flag].copy()
        if sub.empty:
            continue
        agg = (
            sub.groupby(group_cols, dropna=False)
            .agg(
                n_students=("auth_id", "nunique"),
                avg_similarity=("similarity_score", "mean"),
                impacted_auth_ids=("auth_id", lambda x: list(set(x))),
                target_metier_id=("target_metier_id", "first"),
            )
            .reset_index()
        )
        if bucket_flag:
            agg["cohort_size"] = agg["metier_name"].map(cohort_map).fillna(1).astype(int)
        else:
            agg["cohort_size"] = max(n_students_total, 1)
            agg["target_metier_id"] = None
        agg["pct"] = (agg["n_students"] / agg["cohort_size"].clip(lower=1) * 100).round(1)
        agg["priority"] = agg["avg_similarity"].apply(priority_from_gap_severity)
        agg["bucket"] = bucket_label
        agg["popularity_rank"] = agg["metier_name"].map(rank_map).fillna(99).astype(int)
        agg_frames.append(agg)

    if not agg_frames:
        return pd.DataFrame(), [], n_students_total

    df_agg = pd.concat(agg_frames, ignore_index=True).sort_values(
        ["bucket", "popularity_rank", "pct"], ascending=[True, True, False]
    ).reset_index(drop=True)
    LOGGER.info("Unique gaps after aggregation: %d", len(df_agg))

    # Semantic clustering of competence names
    comp_names = df_agg["competence_name"].astype(str).tolist()
    embeddings = encode_texts(comp_names, st_model)

    df_agg["cluster_id"] = -1
    cluster_counter = 0
    for _, sub_df in df_agg.groupby(["bucket", "metier_name", "competence_type"]):
        idxs = sub_df.index.tolist()
        n_cl = min(N_CLUSTERS_PER_GROUP, len(idxs))
        if len(idxs) <= n_cl:
            labels = np.arange(len(idxs))
        else:
            km = KMeans(n_clusters=n_cl, n_init=5, random_state=42)
            labels = km.fit_predict(embeddings[idxs])
        for local_i, global_i in enumerate(idxs):
            df_agg.loc[global_i, "cluster_id"] = cluster_counter + int(labels[local_i])
        cluster_counter += n_cl

    # Build cluster summaries
    cluster_summaries: list[dict[str, Any]] = []
    for cid, sub in df_agg.groupby("cluster_id"):
        rep = sub.sort_values("pct", ascending=False).iloc[0]
        all_comp_names = list(dict.fromkeys(sub["competence_name"].tolist()))
        all_keywords = list(dict.fromkeys(
            kw.strip()
            for cell in sub["keywords"].dropna()
            for kw in str(cell).split(",")
            if kw.strip()
        ))
        all_auth_ids = list({
            aid
            for cell in sub["impacted_auth_ids"]
            for aid in (cell if isinstance(cell, list) else [])
        })
        total_impacted = len(all_auth_ids)
        cohort_size = int(rep["cohort_size"])
        merged_pct = round(total_impacted / max(cohort_size, 1) * 100, 1)
        cluster_summaries.append({
            "cluster_id":       int(rep["cluster_id"]),
            "bucket":           rep["bucket"],
            "metier_name":      rep["metier_name"],
            "metier_id":        rep.get("target_metier_id"),
            "domaine_name":     rep["domaine_name"],
            "competence_name":  rep["competence_name"],
            "all_competences":  all_comp_names,
            "competence_type":  rep["competence_type"],
            "keywords":         ", ".join(all_keywords[:15]),
            "n_students":       total_impacted,
            "cohort_size":      cohort_size,
            "pct":              merged_pct,
            "priority":         priority_from_gap_severity(float(sub["avg_similarity"].mean())),
            "popularity_rank":  int(rep["popularity_rank"]),
            "avg_similarity":   float(sub["avg_similarity"].mean()),
        })

    priority_order = {"CRITIQUE": 0, "MOYENNE": 1, "FAIBLE": 2}
    cluster_summaries.sort(
        key=lambda c: (priority_order.get(c["priority"], 9), c["popularity_rank"], -c["pct"])
    )

    cnt = Counter(c["priority"] for c in cluster_summaries)
    LOGGER.info(
        "Clusters: %d total — CRITIQUE:%d MOYENNE:%d FAIBLE:%d",
        len(cluster_summaries),
        cnt.get("CRITIQUE", 0),
        cnt.get("MOYENNE", 0),
        cnt.get("FAIBLE", 0),
    )

    return df_agg, cluster_summaries, n_students_total


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_recommendations_pipeline(job_id: str, triggered_by: Optional[str] = None) -> dict[str, Any]:
    """Pipeline complet — met a jour recommendation_jobs au fur et a mesure."""
    started = time.time()
    supabase_upsert(
        "recommendation_jobs",
        [{
            "id": job_id,
            "status": "running",
            "triggered_by": triggered_by,
            "started_at": _iso_now(),
            "stats": {"stage": "loading"},
        }],
        on_conflict="id",
    )

    try:
        st_model = get_st_model()
        # Warm caches up front so clustering, retrieval & lookup share the same model.
        get_rag_corpus(st_model)
        build_cert_lookup()

        df_agg, cluster_summaries, n_students_total = load_and_cluster_gaps(st_model)
        total = len(df_agg)
        LOGGER.info("Job %s: %d aggregated gaps / %d clusters / %d students",
                job_id, total, len(cluster_summaries), n_students_total)

        # progress counter (number of clusters processed so far)
        processed = 0

        if total == 0:
            auto_confirmed_targets_synced = sync_confirmed_targets_for_approved_recommendations()
            stats = {
                "stage": "done",
                "total_generated": 0,
                "targets": 0,
                "confirmed_targets_synced": 0,
                "auto_confirmed_targets_synced": auto_confirmed_targets_synced,
                "preserved_non_pending": 0,
                "pruned_stale_pending": 0,
                "pruned_stale_targets": 0,
                "n_students": n_students_total,
                "elapsed_sec": round(time.time() - started, 1),
                "daily_cap_hit": False,
                "gemini_calls": 0,
                "rag_only": 0,
                "clusters": 0,
            }
            supabase_upsert(
                "recommendation_jobs",
                [{
                    "id": job_id,
                    "status": "succeeded",
                    "finished_at": _iso_now(),
                    "stats": stats,
                }],
                on_conflict="id",
            )
            return {"ok": True, "job_id": job_id, **stats}

        supabase_upsert(
            "recommendation_jobs",
            [{
                "id": job_id,
                "stats": {
                    "stage": "generating",
                    "total": total,
                    "clusters": len(cluster_summaries),
                    "n_students": n_students_total,
                    "done": processed,
                },
            }],
            on_conflict="id",
        )

        llm_clusters = [c for c in cluster_summaries if c["priority"] in LLM_PRIORITY_TIERS]
        rag_clusters = [c for c in cluster_summaries if c["priority"] not in LLM_PRIORITY_TIERS]
        LOGGER.info("Job %s: Gemini=%d clusters | RAG-only=%d clusters",
                    job_id, len(llm_clusters), len(rag_clusters))

        cluster_recos: dict[int, dict[str, Any]] = {}
        daily_cap_hit = False
        gemini_calls = 0
        rag_only_count = 0

        # Pre-fetch RAG for each LLM cluster
        llm_rags = [
            retrieve_rag(
                f"{c['competence_name']} {c['keywords']} {c['metier_name']}",
                st_model=st_model,
            )
            for c in llm_clusters
        ]

        for batch_start in range(0, len(llm_clusters), GEMINI_BATCH_SIZE):
            batch = llm_clusters[batch_start: batch_start + GEMINI_BATCH_SIZE]
            b_rags = llm_rags[batch_start: batch_start + GEMINI_BATCH_SIZE]
            batch_label = f"[{batch_start + 1}-{batch_start + len(batch)}/{len(llm_clusters)}]"

            cap_local_hit = MAX_LLM_CALLS > 0 and gemini_calls >= MAX_LLM_CALLS
            if daily_cap_hit or cap_local_hit:
                reason = "daily cap" if daily_cap_hit else f"local cap MAX_LLM_CALLS={MAX_LLM_CALLS}"
                LOGGER.info("Job %s %s skipping Gemini (%s) — RAG-only", job_id, batch_label, reason)
                for gap, rag in zip(batch, b_rags):
                    cluster_recos[gap["cluster_id"]] = rag_only_reco(gap, rag)
                rag_only_count += len(batch)
                continue

            try:
                LOGGER.info("Job %s %s calling Gemini ...", job_id, batch_label)
                parsed_list = call_gemini_batch(batch, b_rags)
                parsed_list = [enrich_from_lookup(r or {}) for r in parsed_list]
                gemini_calls += 1
                # Merge: LLM output overrides cert fields, but RAG-only fills any gaps left.
                for gap, llm_reco, rag in zip(batch, parsed_list, b_rags):
                    fallback = rag_only_reco(gap, rag)
                    merged = {**fallback, **{k: v for k, v in llm_reco.items() if v}}
                    cluster_recos[gap["cluster_id"]] = merged
                LOGGER.info("Job %s %s done (%d recos)", job_id, batch_label, len(parsed_list))
                # mark these clusters as processed for UI progress
                processed += len(batch)
            except LLMDailyCapExhausted as exc:
                LOGGER.warning("Job %s daily cap hit: %s — switching remaining batches to RAG-only",
                               job_id, exc)
                daily_cap_hit = True
                for gap, rag in zip(batch, b_rags):
                    cluster_recos[gap["cluster_id"]] = rag_only_reco(gap, rag)
                rag_only_count += len(batch)
            except Exception as exc:
                LOGGER.warning("Job %s %s Gemini error (%s) — RAG-only fallback for batch",
                               job_id, batch_label, exc)
                for gap, rag in zip(batch, b_rags):
                    cluster_recos[gap["cluster_id"]] = rag_only_reco(gap, rag)
                rag_only_count += len(batch)

            if GEMINI_RATE_LIMIT_SLEEP > 0:
                time.sleep(GEMINI_RATE_LIMIT_SLEEP)

            try:
                supabase_upsert(
                    "recommendation_jobs",
                    [{
                        "id": job_id,
                        "stats": {
                            "stage": "generating",
                            "total": total,
                            "clusters": len(cluster_summaries),
                            "n_students": n_students_total,
                            "gemini_done": batch_start + len(batch),
                            "gemini_total": len(llm_clusters),
                            "done": processed,
                        },
                    }],
                    on_conflict="id",
                )
            except Exception:
                pass

        # RAG-only clusters
        for gap in rag_clusters:
            rag = retrieve_rag(
                f"{gap['competence_name']} {gap['keywords']} {gap['metier_name']}",
                st_model=st_model,
            )
            cluster_recos[gap["cluster_id"]] = rag_only_reco(gap, rag)
            rag_only_count += 1
            processed += 1

            if processed % 10 == 0:
                try:
                    supabase_upsert(
                        "recommendation_jobs",
                        [{
                            "id": job_id,
                            "stats": {
                                "stage": "generating",
                                "total": total,
                                "done": processed,
                            },
                        }],
                        on_conflict="id",
                    )
                except Exception:
                    pass

        # Fan-out: one DB row per aggregated gap (sharing its cluster's reco)
        now_iso = _iso_now()
        reco_rows: list[dict[str, Any]] = []
        target_rows: list[dict[str, Any]] = []

        # Build a set of normalized competences present in TARGET_METIER so we
        # avoid producing redundant OTHER_METIER recommendations for the same
        # competence. This keeps OTHER_METIER suggestions available in the DB
        # (history preserved) but prevents duplicates in the active generated
        # run when a target métier already covers the same gap.
        target_competences = {
            _normalize_text(r) for r in df_agg[df_agg["bucket"] == "TARGET_METIER"]["competence_name"].astype(str).tolist()
        }
        skipped_other_dups = 0

        for _, row in df_agg.iterrows():
            # Skip OTHER_METIER rows when the same competence is already present
            # as a TARGET_METIER recommendation in this run.
            if row.get("bucket") == "OTHER_METIER":
                comp_norm = _normalize_text(row.get("competence_name") or "")
                if comp_norm and comp_norm in target_competences:
                    skipped_other_dups += 1
                    continue
            cid = int(row["cluster_id"])
            reco = cluster_recos.get(cid, {})
            rec_id = build_recommendation_id(row["bucket"], row["metier_name"], row["competence_name"])

            keywords_json = [
                k.strip()
                for k in str(row.get("keywords") or "").split(",")
                if k.strip()
            ]
            rag_sources = " | ".join(
                f"{r['source']}:{r['titre'][:25]}"
                for r in retrieve_rag(str(row["competence_name"]), st_model=st_model)[:3]
            )

            comp = str(row["competence_name"])
            ctype = str(row["competence_type"])
            raw_label = (reco.get("gap_label") or "").strip()
            raw_title = (reco.get("gap_title") or "").strip()
            is_dummy_label = (not raw_label) or comp.startswith(raw_label.rstrip("…").strip())
            is_dummy_title = (not raw_title) or comp.startswith(
                raw_title.replace(f"[{ctype}] ", "").strip()
            )
            gap_label = (
                raw_label if not is_dummy_label
                else (f"Gap: {comp[:45]}…" if len(comp) > 48 else f"Gap: {comp}")
            )
            gap_title = raw_title if not is_dummy_title else f"[{ctype}] {comp[:85]}"
            match_confidence = round(_to_float(row.get("avg_similarity", 0.0)) * 100, 1)

            cohort_size = int(row["cohort_size"])
            reco_rows.append({
                "id":                 rec_id,
                "cv_submission_id":   None,
                "target_job_id":      row.get("target_metier_id"),
                "status":             "pending",
                "created_at":         now_iso,
                "updated_at":         now_iso,
                "category":           row["bucket"],
                "level":              row["priority"],
                "metier":             row["metier_name"],
                "metier_id":          row.get("target_metier_id"),
                "domaine":            row["domaine_name"],
                "competence_name":    row["competence_name"],
                "competence_type":    row["competence_type"],
                "keywords":           keywords_json,
                "detected_gap":       row["competence_name"],
                "gap_label":          gap_label[:60],
                "gap_title":          gap_title[:100],
                "concern_rate":       float(row["pct"]),
                "students_impacted":  int(row["n_students"]),
                "cohort_size":        cohort_size,
                # total_students = denominator used for pct so the backend's
                # normalizeConcernRate stays consistent with the value we wrote.
                "total_students":     cohort_size,
                "popularity_rank":    int(row["popularity_rank"]),
                "match_confidence":   match_confidence,
                "llm_recommendation": reco.get("llm_recommendation", ""),
                "justification_llm":  reco.get("llm_recommendation", ""),
                "cert_title":         reco.get("cert_title", ""),
                "cert_description":   reco.get("cert_description", ""),
                "cert_provider":      reco.get("cert_provider", ""),
                "cert_duration":      reco.get("cert_duration", ""),
                "cert_pricing":       reco.get("cert_pricing", ""),
                "cert_url":           reco.get("cert_url", ""),
                "cert_id":            None,
                "recommended_certs":  reco.get("cert_title", ""),
                "rag_sources":        rag_sources,
            })
            for auth_id in (row.get("impacted_auth_ids") or []):
                target_rows.append({"recommendation_id": rec_id, "auth_id": auth_id})

        # Deduplicate (same id could appear if data has identical bucket+metier+comp keys)
        seen: set[str] = set()
        deduped_reco: list[dict[str, Any]] = []
        for r in reco_rows:
            if r["id"] in seen:
                continue
            seen.add(r["id"])
            deduped_reco.append(r)

        # Preserve admin decisions across runs.
        existing_status = get_recommendation_status_map([r["id"] for r in deduped_reco])
        preserved_ids: set[str] = set()
        upsertable_reco: list[dict[str, Any]] = []
        for row in deduped_reco:
            current = existing_status.get(row["id"], "")
            if current and current != "pending":
                preserved_ids.add(row["id"])
                continue
            upsertable_reco.append(row)

        if upsertable_reco:
            supabase_upsert("ai_recommendations", upsertable_reco, on_conflict="id")

        # Keep target mappings in sync for active recommendations (pending/approved/edited).
        # This ensures newly impacted students are attached even when a recommendation
        # is preserved because it is already approved.
        deduped_target_rows: list[dict[str, Any]] = []
        seen_target_keys: set[tuple[str, str]] = set()
        for target in target_rows:
            recommendation_id = str(target.get("recommendation_id") or "").strip()
            auth_id = str(target.get("auth_id") or "").strip()
            if not recommendation_id or not auth_id:
                continue

            status = existing_status.get(recommendation_id, "")
            if status == "rejected":
                continue

            key = (recommendation_id, auth_id)
            if key in seen_target_keys:
                continue
            seen_target_keys.add(key)
            deduped_target_rows.append({"recommendation_id": recommendation_id, "auth_id": auth_id})

        if deduped_target_rows:
            supabase_upsert(
                "ai_recommendation_targets",
                deduped_target_rows,
                on_conflict="recommendation_id,auth_id",
            )

        confirmed_target_rows = [
            t
            for t in deduped_target_rows
            if existing_status.get(t["recommendation_id"], "") == "approved"
        ]
        if confirmed_target_rows:
            supabase_upsert(
                "ai_confirmed_recommendation_targets",
                confirmed_target_rows,
                on_conflict="recommendation_id,auth_id",
            )

        # Auto-sync all approved recommendations against current student target jobs.
        # This keeps confirmed targets fresh when new students are added to a job.
        auto_confirmed_targets_synced = sync_confirmed_targets_for_approved_recommendations()

        # Prune stale pending rows that no longer appear in this run.
        latest_pending_ids = {row["id"] for row in upsertable_reco}
        current_pending_ids = set(list_pending_recommendation_ids())
        stale_ids = sorted(current_pending_ids - latest_pending_ids)
        pruned_pending = pruned_targets = 0
        if stale_ids:
            pruned_pending = delete_recommendations_by_ids(stale_ids)
            pruned_targets = delete_targets_by_recommendation_ids(stale_ids)

        elapsed = round(time.time() - started, 1)
        stats = {
            "stage": "done",
            "total_generated": len(upsertable_reco),
            "targets": len(deduped_target_rows),
            "confirmed_targets_synced": len(confirmed_target_rows),
            "auto_confirmed_targets_synced": auto_confirmed_targets_synced,
            "preserved_non_pending": len(preserved_ids),
            "pruned_stale_pending": pruned_pending,
            "pruned_stale_targets": pruned_targets,
            "n_students": n_students_total,
            "clusters": len(cluster_summaries),
            "done": total,
            "gemini_calls": gemini_calls,
            "rag_only": rag_only_count,
            "elapsed_sec": elapsed,
            "daily_cap_hit": daily_cap_hit,
        }
        supabase_upsert(
            "recommendation_jobs",
            [{
                "id": job_id,
                "status": "succeeded",
                "finished_at": _iso_now(),
                "stats": stats,
            }],
            on_conflict="id",
        )
        LOGGER.info(
            "Job %s done in %.1fs — %d reco inserted, %d preserved, %d pruned.",
            job_id, elapsed, len(upsertable_reco), len(preserved_ids), pruned_pending,
        )
        return {"ok": True, "job_id": job_id, **stats}

    except Exception as exc:
        LOGGER.exception("Job %s failed", job_id)
        try:
            supabase_upsert(
                "recommendation_jobs",
                [{
                    "id": job_id,
                    "status": "failed",
                    "finished_at": _iso_now(),
                    "error": str(exc)[:2000],
                }],
                on_conflict="id",
            )
        except Exception:
            pass
        return {"ok": False, "job_id": job_id, "error": str(exc)}


# =============================================================================
# FastAPI app
# =============================================================================

app = FastAPI(title="Recommendation Service", version="2.0.0")


class GenerateRequest(BaseModel):
    triggered_by: Optional[str] = None
    job_id: Optional[str] = None
    wait: bool = False


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": "2.0.0",
        "llm_provider": "gemini",
        "gemini_model": GEMINI_MODEL,
        "gemini_configured": bool(GEMINI_API_KEY),
        "rag_xlsx": RAG_XLSX_PATH,
        "rag_exists": Path(RAG_XLSX_PATH).exists(),
        "st_model": ST_MODEL_NAME,
        "st_loaded": _ST_MODEL is not None,
        "n_clusters_per_group": N_CLUSTERS_PER_GROUP,
        "llm_priority_tiers": sorted(LLM_PRIORITY_TIERS),
        "gemini_batch_size": GEMINI_BATCH_SIZE,
    }


@app.post("/generate")
def generate(payload: GenerateRequest) -> dict[str, Any]:
    job_id = (payload.job_id or f"job_{uuid.uuid4().hex[:12]}").strip()

    if payload.wait:
        result = generate_recommendations_pipeline(job_id, payload.triggered_by)
        if not result.get("ok"):
            raise HTTPException(status_code=500, detail=result)
        return result

    thread = threading.Thread(
        target=generate_recommendations_pipeline,
        args=(job_id, payload.triggered_by),
        name=f"reco-{job_id}",
        daemon=True,
    )
    thread.start()
    return {"ok": True, "job_id": job_id, "status": "running"}


@app.get("/status/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    rows = supabase_select(
        "recommendation_jobs",
        {"select": "*", "id": f"eq.{job_id}"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="job not found")
    return rows[0]