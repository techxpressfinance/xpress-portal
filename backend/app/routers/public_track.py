"""The no-login progress page behind a tracking link.

No authentication by design — the token is the credential. It is looked up by
hash within the tenant the host resolves to, rate-limited per IP, and every
failure (unknown, revoked, or a target that has since been deleted or
deactivated) is the same 404 so a guesser learns nothing. See
services/tracking_links.py for what the page may show.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.rate_limit import RateLimiter
from app.models.user import User, UserRole
from app.services import tracking_links as links
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/public/track", tags=["public-track"])

_track_limiter = RateLimiter(max_requests=30, window_seconds=60)

_GONE = "This link is no longer active. Please contact us for a new one."


@router.get("/{token}")
def view_tracking_link(
    token: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_tenant_id),
):
    _track_limiter.check(request)
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"

    link = links.resolve(db, tenant_id, token)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_GONE)

    if link.kind == links.KIND_REFERRER:
        referrer = db.query(User).filter(
            User.id == link.referrer_id,
            User.tenant_id == tenant_id,
            User.role == UserRole.referrer,
            User.deleted_at.is_(None),
            User.is_active.is_(True),
        ).first()
        if referrer is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_GONE)
        page = links.referrer_page(db, tenant_id, referrer)
    else:
        application, lead = links.deal_target(db, link)
        if application is None and lead is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_GONE)
        page = links.deal_page(db, application, lead)

    links.record_open(link)
    db.commit()
    return page
