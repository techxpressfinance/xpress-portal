"""Token-based relevance scoring shared by global and per-entity search.

Each query is split into lowercase tokens; every token must match at least
one field (AND-of-tokens) and a token's best field match accumulates into
the row score. Match tiers — exact > word-prefix > substring — reward more
precise hits with higher per-field weights so the caller can rank name hits
ahead of email hits ahead of phone hits, etc.
"""
from __future__ import annotations

from typing import Optional


def tokenize(q: str, max_tokens: int = 5) -> list[str]:
    """Split a query into lowercase tokens (max 5) for multi-word matching."""
    return [t.lower() for t in q.split() if t][:max_tokens]


def score_token(token: str, value: str, weight: int) -> int:
    """Score one token against one field value: exact > word-prefix > substring."""
    v = value.lower()
    if v == token:
        return weight * 4
    if any(word.startswith(token) for word in v.split()):
        return weight * 2
    if token in v:
        return weight
    return 0


def score(tokens: list[str], fields: list[tuple[Optional[str], int]]) -> int:
    """Relevance score: sum of each token's best field match; 0 if any token misses."""
    total = 0
    for token in tokens:
        best = max((score_token(token, v, w) for v, w in fields if v), default=0)
        if best == 0:
            return 0
        total += best
    return total