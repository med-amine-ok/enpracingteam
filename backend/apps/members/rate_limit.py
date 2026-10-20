# apps/members/rate_limit.py

from django.conf import settings
from django.core.cache import cache


def check_and_increment(key: str, limit: int, window_seconds: int) -> bool:
    """
    Atomic counter: True if under the limit (and incremented), False if over.
    cache.add() is an atomic SETNX — only one concurrent caller actually
    creates the key, avoiding a race on first use. cache.incr() maps to
    Redis's INCR, which is atomic. This is why Redis specifically is required
    here, not just any cache backend.
    """
    cache.add(key, 0, timeout=window_seconds)
    count = cache.incr(key)
    return count <= limit


def is_in_cooldown(key: str, seconds: int) -> bool:
    """
    True if a cooldown is active. Setting the key is itself the atomic
    "claim" — cache.add() returns False if another concurrent request
    already claimed it, so two near-simultaneous resend requests can't
    both pass.
    """
    claimed = cache.add(key, "1", timeout=seconds)
    return not claimed