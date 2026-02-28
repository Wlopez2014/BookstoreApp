from __future__ import annotations

import os
from datetime import timedelta
from flask import Flask, jsonify

from . import db, jwt
from .routes import register_routes
from .seed import seed_data


def create_app(config_overrides: dict | None = None) -> Flask:
    """
    Application factory.
    - Uses SQLite file DB in ./instance/bookstore.db by default.
    - Creates tables and seeds demo data on startup.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app = Flask(__name__, instance_relative_config=True,
               template_folder=os.path.join(base_dir, "templates"),
               static_folder=os.path.join(base_dir, "static"))

    # Ensure instance folder exists
    os.makedirs(app.instance_path, exist_ok=True)

    app.config.from_mapping(
        SQLALCHEMY_DATABASE_URI=os.environ.get(
            "BOOKSTORE_DB_URI",
            "sqlite:///" + os.path.join(app.instance_path, "bookstore.db"),
        ),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY=os.environ.get("BOOKSTORE_JWT_SECRET", "dev-secret-change-me"),
        JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=1),
    )

    if config_overrides:
        app.config.update(config_overrides)

    db.init_app(app)
    jwt.init_app(app)

    # Basic health check
    @app.get("/health")
    def health():
        return jsonify({"status": "ok"})

    # Register API routes
    register_routes(app)

    # Create tables + seed demo data
    with app.app_context():
        db.create_all()
        seed_data()

    return app
