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
from app.services.email import send_referrer_access_email
from app.services.tenant_scope import get_tenant_id

router = APIRouter(prefix="/api/public/track", tags=["public-track"])

_track_limiter = RateLimiter(max_requests=30, window_seconds=60)
# Password-link requests send mail, so they are held far tighter — per IP and
# per link, so a forwarded link can't be used to flood the referrer's inbox.
_login_link_ip_limiter = RateLimiter(max_requests=5, window_seconds=600)
_login_link_limiter = RateLimiter(max_requests=3, window_seconds=3600)

_GONE = "This link is no longer active. Please contact us for a new one."


def _active_referrer(db: Session, tenant_id: str, referrer_id) -> User | None:
    return db.query(User).filter(
        User.id == referrer_id,
        User.tenant_id == tenant_id,
        User.role == UserRole.referrer,
        User.deleted_at.is_(None),
        User.is_active.is_(True),
    ).first()


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
        referrer = _active_referrer(db, tenant_id, link.referrer_id)
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


@router.post("/{token}/login-link")
def request_login_link(
    token: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    tenant_id: str = Depends(get_tenant_id),
):
    """Email the referrer a way into the portal — a setup link if they have
    never logged in, a password reset otherwise.

    The link on this page is a bearer credential that gets forwarded, so it
    never logs anyone in and nothing secret comes back: the setup/reset link
    goes only to the address on file, and the reply shows it masked. Referrer
    links only — a borrower's deal link has no portal login behind it here."""
    _login_link_ip_limiter.check(request)
    response.headers["Cache-Control"] = "no-store"
    link = links.resolve(db, tenant_id, token)
    if link is None or link.kind != links.KIND_REFERRER:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_GONE)
    referrer = _active_referrer(db, tenant_id, link.referrer_id)
    if referrer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_GONE)
    _login_link_limiter.check_key(f"track-login:{link.id}")

    email = referrer.email if referrer.email and not referrer.email.endswith("@deleted.invalid") else None
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="We don't have an email address for you — please contact us.")
    login = links.issue_login_link(referrer, staff=False)
    if not send_referrer_access_email(email, referrer.full_name, progress_url=None, login=login):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="We couldn't send email just now — please contact us.")
    db.commit()
    return {"sent_to": links.mask_email(email), "action": login["action"] if login else None}
