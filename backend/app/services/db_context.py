from __future__ import annotations

from contextlib import contextmanager


@contextmanager
def background_session(session_factory):
    """Context manager for background task DB sessions.

    Commits on success, rolls back on error, always closes.
    """
    db = session_factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
