from fastapi import Response

from app.config import ENVIRONMENT, REFRESH_TOKEN_EXPIRE_DAYS


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=ENVIRONMENT != "development",
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/auth",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        secure=ENVIRONMENT != "development",
        samesite="lax",
        path="/api/auth",
    )
