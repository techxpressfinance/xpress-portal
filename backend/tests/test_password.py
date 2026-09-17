"""Long passwords must be rejected with a validation error, never a 500 (S-08)."""
import pytest
from pydantic import ValidationError

from app.schemas.user import PASSWORD_MAX_LENGTH, UserRegister
from app.services.auth import hash_password, verify_password


def test_register_rejects_password_over_max_length():
    with pytest.raises(ValidationError):
        UserRegister(email="a@example.com", full_name="A", password="Aa1" + "x" * PASSWORD_MAX_LENGTH)


def test_register_accepts_password_at_max_length():
    pw = "Aa1" + "x" * (PASSWORD_MAX_LENGTH - 3)
    assert UserRegister(email="a@example.com", full_name="A", password=pw).password == pw


def test_multibyte_password_is_measured_in_bytes():
    with pytest.raises(ValidationError):
        UserRegister(email="a@example.com", full_name="A", password="Aa1" + "é" * 40)


def test_verify_password_never_raises():
    assert verify_password("x" * 200, hash_password("Short1pw")) is False
    assert verify_password("anything", "!invited") is False
    assert verify_password("Short1pw", hash_password("Short1pw")) is True
