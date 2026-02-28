from __future__ import annotations

from werkzeug.security import generate_password_hash

from . import db
from .models import User, Book


def seed_data() -> None:
    """
    Create demo users and starter books (only if tables are empty).
    Safe to call on every startup.
    """
    if User.query.count() == 0:
        db.session.add(User(username="admin", password_hash=generate_password_hash("Admin123!"), role="admin"))
        db.session.add(User(username="staff", password_hash=generate_password_hash("Staff123!"), role="staff"))
        db.session.add(User(username="customer", password_hash=generate_password_hash("Customer123!"), role="customer"))
        db.session.commit()

    if Book.query.count() == 0:
        db.session.add(Book(isbn="978-0-00-000000-1", title="Alice in Wonderland", author="Lewis Carroll", price=9.99, quantity=5))
        db.session.add(Book(isbn="978-0-00-000000-2", title="The Hobbit", author="J.R.R. Tolkien", price=12.50, quantity=2)) 
        db.session.add(Book(isbn="978-0-00-000000-3", title="Dune", author="Frank Herbert", price=14.25, quantity=7))
        db.session.commit()
