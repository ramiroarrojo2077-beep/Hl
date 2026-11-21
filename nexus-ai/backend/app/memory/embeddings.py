"""Generación de embeddings.

Siempre se calcula un embedding léxico local (feature hashing de unigramas y bigramas,
768 dimensiones, normalizado L2): es determinista, gratuito y permite búsqueda por
similitud aun sin proveedor de embeddings. Si el usuario configura un modelo de
embeddings (OpenAI, Gemini, Ollama...), se guarda además el embedding semántico y la
búsqueda combina ambos.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
import unicodedata
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AIModel, AIProvider
from app.models.memory import EMBEDDING_DIM
from app.providers.base import ProviderCallError
from app.providers.registry import adapter_for

logger = logging.getLogger(__name__)
LEXICAL_MODEL = "lexical-hash-v1"
_TOKEN = re.compile(r"[a-z0-9ñ]{2,}")
_STOP = set(
    "de la el en y a los las del se que un una por con para es al lo como mas pero sus le ya o fue este ha si "
    "porque esta son entre cuando muy sin sobre ser tiene tambien me hasta hay donde quien desde todo nos durante "
    "the of and to in is it that for on with as are was be this by an or at from".split()
)


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(_normalize(text)) if t not in _STOP]


def lexical_embedding(text: str, dim: int = EMBEDDING_DIM) -> list[float]:
    tokens = tokenize(text)
    features = tokens + [f"{a}_{b}" for a, b in zip(tokens, tokens[1:])]
    counts: dict[str, int] = {}
    for f in features:
        counts[f] = counts.get(f, 0) + 1
    vec = [0.0] * dim
    for feature, tf in counts.items():
        digest = hashlib.blake2b(feature.encode(), digest_size=8).digest()
        idx = int.from_bytes(digest[:4], "little") % dim
        sign = 1.0 if digest[4] & 1 else -1.0
        weight = (1.0 + math.log(tf)) * (0.6 if "_" in feature else 1.0)
        vec[idx] += sign * weight
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0:
        vec[0] = 1.0  # vector unitario para textos vacíos (similaridad nula con el resto)
        return vec
    return [v / norm for v in vec]


@dataclass
class SemanticEmbedder:
    model: AIModel
    provider: AIProvider

    @property
    def label(self) -> str:
        return f"{self.provider.kind}:{self.model.model_name}"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        adapter = adapter_for(self.provider)
        vectors = await adapter.embed(self.model.model_name, texts, EMBEDDING_DIM)
        for v in vectors:
            if len(v) != EMBEDDING_DIM:
                raise ProviderCallError(
                    f"El modelo {self.model.model_name} devuelve {len(v)} dimensiones; NEXUS requiere {EMBEDDING_DIM}.",
                    retryable=False,
                )
        return vectors


async def semantic_embedder(session: AsyncSession, user_id: uuid.UUID) -> SemanticEmbedder | None:
    rows = (
        await session.execute(
            select(AIModel, AIProvider)
            .join(AIProvider, AIModel.provider_id == AIProvider.id)
            .where(
                AIModel.user_id == user_id,
                AIModel.is_enabled.is_(True),
                AIProvider.is_enabled.is_(True),
                AIModel.capabilities.contains(["embedding"]),
            )
            .order_by(AIModel.is_embedding_default.desc(), AIModel.created_at)
        )
    ).all()
    if not rows:
        return None
    model, provider = rows[0]
    return SemanticEmbedder(model=model, provider=provider)


async def embed_with_fallback(session: AsyncSession, user_id: uuid.UUID, texts: list[str]) -> tuple[str, list[list[float]]] | None:
    embedder = await semantic_embedder(session, user_id)
    if embedder is None:
        return None
    try:
        return embedder.label, await embedder.embed(texts)
    except ProviderCallError as exc:
        logger.warning("Embeddings semánticos no disponibles (%s); se usa solo el índice léxico", exc.message)
        return None
