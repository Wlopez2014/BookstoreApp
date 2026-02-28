from __future__ import annotations

from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from .models import User


def role_required(*roles: str):
    """
    Restrict endpoint to a set of roles.
    """
    def outer(fn):
        @wraps(fn)
        @jwt_required()
        def inner(*args, **kwargs):
            username = get_jwt_identity()
            user = User.query.filter_by(username=username).first()
            if not user or user.role not in roles:
                return jsonify({"error": "Forbidden"}), 403
            return fn(*args, **kwargs)
        return inner
    return outer


def get_current_user() -> User | None:
    username = get_jwt_identity()
    return User.query.filter_by(username=username).first()
