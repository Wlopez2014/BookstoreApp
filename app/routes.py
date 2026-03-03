from __future__ import annotations

from datetime import datetime, timezone
from flask import request, jsonify, render_template
from flask_jwt_extended import create_access_token
from werkzeug.security import generate_password_hash, check_password_hash

from . import db
from .models import User, Book, Sale, Order, OrderItem, PurchaseOrder, PurchaseOrderItem
from .auth import role_required, get_current_user


def register_routes(app):

    # ----------------------------
    # Helpers
    # ----------------------------
    def parse_dt(s: str):
        """
        Accepts:
          - "YYYY-MM-DD"
          - full ISO datetime (with or without timezone)
        Returns timezone-aware datetime (UTC) or None.
        """
        try:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None

    # ----------------------------
    # UI (simple browser dashboard)
    # ----------------------------
    @app.get("/")
    def ui_home():
        return render_template("index.html")

    # ----------------------------
    # Auth
    # ----------------------------
    @app.post("/api/auth/login")
    def login():
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""

        user = User.query.filter_by(username=username).first()
        if not user or not check_password_hash(user.password_hash, password):
            return jsonify({"error": "Invalid credentials"}), 401

        token = create_access_token(identity=user.username)
        return jsonify({"access_token": token, "role": user.role, "username": user.username}), 200

    @app.post("/api/auth/register")
    def register_customer():
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""

        if not username or not password:
            return jsonify({"error": "username and password required"}), 400
        if User.query.filter_by(username=username).first():
            return jsonify({"error": "username already exists"}), 409

        user = User(username=username, password_hash=generate_password_hash(password), role="customer")
        db.session.add(user)
        db.session.commit()

        return jsonify({"message": "customer registered", "username": username}), 201

    # ----------------------------
    # Books (catalog)
    # ----------------------------
    @app.get("/api/books")
    def list_books():
        books = Book.query.order_by(Book.title.asc()).all()
        return jsonify([{
            "id": b.id,
            "isbn": b.isbn,
            "title": b.title,
            "author": b.author,
            "price": b.price,
            "quantity": b.quantity
        } for b in books]), 200

    @app.get("/api/books/search")
    def search_books():
        q = (request.args.get("q") or "").strip()
        if not q:
            return jsonify([]), 200

        like = f"%{q}%"
        books = Book.query.filter(
            (Book.title.ilike(like)) | (Book.author.ilike(like)) | (Book.isbn.ilike(like))
        ).order_by(Book.title.asc()).all()

        return jsonify([{
            "id": b.id,
            "isbn": b.isbn,
            "title": b.title,
            "author": b.author,
            "price": b.price,
            "quantity": b.quantity
        } for b in books]), 200

    @app.post("/api/books")
    @role_required("admin", "staff")
    def add_book():
        data = request.get_json(silent=True) or {}
        isbn = (data.get("isbn") or "").strip() or None
        title = (data.get("title") or "").strip()
        author = (data.get("author") or "").strip()

        try:
            price = float(data.get("price"))
        except (TypeError, ValueError):
            return jsonify({"error": "price must be a number"}), 400

        try:
            quantity = int(data.get("quantity", 0))
        except (TypeError, ValueError):
            return jsonify({"error": "quantity must be integer"}), 400

        if not title or not author:
            return jsonify({"error": "title and author required"}), 400
        if price < 0 or quantity < 0:
            return jsonify({"error": "price/quantity cannot be negative"}), 400

        if isbn and Book.query.filter_by(isbn=isbn).first():
            return jsonify({"error": "isbn already exists"}), 409

        b = Book(isbn=isbn, title=title, author=author, price=price, quantity=quantity)
        db.session.add(b)
        db.session.commit()

        return jsonify({"message": "book added", "book_id": b.id}), 201

    @app.patch("/api/books/<int:book_id>/quantity")
    @role_required("admin", "staff")
    def set_quantity(book_id: int):
        book = Book.query.get_or_404(book_id)
        data = request.get_json(silent=True) or {}
        try:
            quantity = int(data.get("quantity"))
        except (TypeError, ValueError):
            return jsonify({"error": "Quantity must be integer"}), 400
        if quantity < 0:
            return jsonify({"error": "Quantity cannot be negative"}), 400

        book.quantity = quantity
        db.session.commit()
        return jsonify({"message": "Quantity updated", "book_id": book.id, "quantity": book.quantity}), 200

    @app.patch("/api/books/<int:book_id>")
    @role_required("admin", "staff")
    def update_book_details(book_id: int):
        book = Book.query.get_or_404(book_id)
        data = request.get_json(silent=True) or {}

        allowed = {"title", "author", "price", "isbn"}
        unknown = set(data.keys()) - allowed
        if unknown:
            return jsonify({"error": f"Unknown field(s): {', '.join(sorted(unknown))}"}), 400

        if "title" in data:
            title = str(data["title"]).strip()
            if not title:
                return jsonify({"error": "Title cannot be empty"}), 400
            book.title = title

        if "author" in data:
            author = str(data["author"]).strip()
            if not author:
                return jsonify({"error": "Author cannot be empty"}), 400
            book.author = author

        if "isbn" in data:
            isbn = str(data["isbn"]).strip()
            if not isbn:
                return jsonify({"error": "ISBN cannot be empty"}), 400
            existing = Book.query.filter(Book.isbn == isbn, Book.id != book.id).first()
            if existing:
                return jsonify({"error": "ISBN already exists for another book"}), 409
            book.isbn = isbn

        if "price" in data:
            try:
                price = float(data["price"])
            except (TypeError, ValueError):
                return jsonify({"error": "Price must be a number"}), 400
            if price < 0:
                return jsonify({"error": "Price cannot be negative"}), 400
            book.price = price

        db.session.commit()
        return jsonify({
            "message": "Book updated",
            "book": {
                "id": book.id,
                "title": book.title,
                "author": book.author,
                "isbn": book.isbn,
                "price": book.price,
                "quantity": book.quantity,
            },
        }), 200

    @app.delete("/api/books/<int:book_id>")
    @role_required("admin", "staff")
    def delete_book(book_id: int):
        book = Book.query.get_or_404(book_id)

        # Block delete if it has sales/orders
        try:
            has_sales = hasattr(book, "sales") and book.sales and len(book.sales) > 0
            has_order_items = hasattr(book, "order_items") and book.order_items and len(book.order_items) > 0
            if has_sales or has_order_items:
                return jsonify({
                    "error": "Cannot delete book that has sales/orders. Consider marking it inactive instead."
                }), 409
        except Exception:
            pass

        db.session.delete(book)
        db.session.commit()
        return jsonify({"message": f"Book {book_id} deleted"}), 200

    # ----------------------------
    # Sales (staff/admin POS)
    # ----------------------------
    @app.post("/api/sales")
    @role_required("admin", "staff")
    def record_sale():
        data = request.get_json(silent=True) or {}
        try:
            book_id = int(data.get("book_id"))
            qty = int(data.get("quantity"))
        except (TypeError, ValueError):
            return jsonify({"error": "book_id and quantity must be integers"}), 400

        if qty <= 0:
            return jsonify({"error": "quantity must be > 0"}), 400

        book = Book.query.get_or_404(book_id)
        if book.quantity < qty:
            return jsonify({"error": "Insufficient stock"}), 400

        staff = get_current_user()
        book.quantity -= qty
        total = round(book.price * qty, 2)

        s = Sale(book_id=book.id, staff_id=staff.id, quantity=qty, total=total)
        db.session.add(s)
        db.session.commit()

        return jsonify({
            "message": "sale recorded",
            "sale_id": s.id,
            "book": {"id": book.id, "title": book.title},
            "quantity": qty,
            "total": total
        }), 201

    # ----------------------------
    # Orders (customer checkout)
    # ----------------------------
    @app.post("/api/orders")
    @role_required("customer")
    def place_order():
        data = request.get_json(silent=True) or {}
        items = data.get("items") or []
        if not isinstance(items, list) or len(items) == 0:
            return jsonify({"error": "items must be a non-empty list"}), 400

        customer = get_current_user()
        order = Order(customer_id=customer.id, status="Processing", total=0.0)
        db.session.add(order)

        total = 0.0
        for it in items:
            try:
                book_id = int(it.get("book_id"))
                qty = int(it.get("quantity"))
            except (TypeError, ValueError):
                db.session.rollback()
                return jsonify({"error": "Each item needs integer book_id and quantity"}), 400

            if qty <= 0:
                db.session.rollback()
                return jsonify({"error": "quantity must be > 0"}), 400

            book = Book.query.get_or_404(book_id)
            if book.quantity < qty:
                db.session.rollback()
                return jsonify({"error": f"Insufficient stock for '{book.title}'"}), 400

            book.quantity -= qty
            line_total = book.price * qty
            total += line_total

            db.session.add(OrderItem(order=order, book_id=book.id, quantity=qty, price_each=book.price))

        order.total = round(total, 2)
        order.status = "Completed"
        db.session.commit()

        return jsonify({
            "message": "order placed",
            "order_id": order.id,
            "total": order.total,
            "status": order.status
        }), 201

    @app.get("/api/orders/mine")
    @role_required("customer")
    def my_order_history():
        customer = get_current_user()
        orders = Order.query.filter_by(customer_id=customer.id).order_by(Order.timestamp.desc()).all()
        return jsonify([{
            "id": o.id,
            "total": o.total,
            "status": o.status,
            "timestamp": o.timestamp.isoformat(),
            "items": [{
                "book_id": it.book_id,
                "title": it.book.title if it.book else None,
                "quantity": it.quantity,
                "price_each": it.price_each
            } for it in o.items]
        } for o in orders]), 200

    @app.get("/api/orders")
    @role_required("admin", "staff")
    def orders_report():
        orders = Order.query.order_by(Order.timestamp.desc()).all()
        return jsonify([{
            "id": o.id,
            "customer": o.customer.username if o.customer else None,
            "total": o.total,
            "status": o.status,
            "timestamp": o.timestamp.isoformat(),
            "items": [{
                "book_id": it.book_id,
                "title": it.book.title if it.book else None,
                "quantity": it.quantity,
                "price_each": it.price_each
            } for it in o.items]
        } for o in orders]), 200

    # ----------------------------
    # Publisher Purchase Orders (staff/admin replenish stock workflow)
    # ----------------------------
    @app.post("/api/publisher-orders")
    @role_required("admin", "staff")
    def create_purchase_order():
        data = request.get_json(silent=True) or {}
        items = data.get("items") or []
        if not isinstance(items, list) or len(items) == 0:
            return jsonify({"error": "items must be a non-empty list"}), 400

        staff = get_current_user()
        po = PurchaseOrder(staff_id=staff.id, status="Pending")
        db.session.add(po)

        for it in items:
            try:
                book_id = int(it.get("book_id"))
                qty = int(it.get("quantity"))
            except (TypeError, ValueError):
                db.session.rollback()
                return jsonify({"error": "Each item needs integer book_id and quantity"}), 400

            if qty <= 0:
                db.session.rollback()
                return jsonify({"error": "quantity must be > 0"}), 400

            Book.query.get_or_404(book_id)
            db.session.add(PurchaseOrderItem(purchase_order=po, book_id=book_id, quantity=qty))

        db.session.commit()
        return jsonify({
            "message": "purchase order created",
            "purchase_order_id": po.id,
            "status": po.status
        }), 201

    @app.get("/api/publisher-orders")
    @role_required("admin", "staff")
    def list_purchase_orders():
        pos = PurchaseOrder.query.order_by(PurchaseOrder.timestamp.desc()).all()
        return jsonify([{
            "id": po.id,
            "staff": po.staff.username if po.staff else None,
            "status": po.status,
            "timestamp": po.timestamp.isoformat(),
            "items": [{
                "book_id": it.book_id,
                "title": it.book.title if it.book else None,
                "quantity": it.quantity
            } for it in po.items]
        } for po in pos]), 200

    @app.get("/api/publisher-orders/<int:po_id>")
    @role_required("admin", "staff")
    def get_purchase_order(po_id: int):
        po = PurchaseOrder.query.get_or_404(po_id)
        return jsonify({
            "id": po.id,
            "staff": po.staff.username if po.staff else None,
            "status": po.status,
            "timestamp": po.timestamp.isoformat(),
            "items": [{
                "book_id": it.book_id,
                "title": it.book.title if it.book else None,
                "quantity": it.quantity
            } for it in po.items]
        }), 200

    @app.patch("/api/publisher-orders/<int:po_id>/submit")
    @role_required("admin", "staff")
    def submit_purchase_order(po_id: int):
        po = PurchaseOrder.query.get_or_404(po_id)

        if po.status != "Pending":
            return jsonify({"error": "Only Pending purchase orders can be submitted"}), 400

        if not po.items or len(po.items) == 0:
            return jsonify({"error": "Cannot submit an empty purchase order"}), 400

        po.status = "Submitted"
        db.session.commit()

        return jsonify({
            "message": "purchase order submitted",
            "purchase_order_id": po.id,
            "status": po.status
        }), 200

    @app.patch("/api/publisher-orders/<int:po_id>/receive")
    @role_required("admin", "staff")
    def receive_purchase_order(po_id: int):
        po = PurchaseOrder.query.get_or_404(po_id)

        if po.status != "Submitted":
            return jsonify({"error": "Only Submitted purchase orders can be received"}), 400

        for it in po.items:
            book = Book.query.get_or_404(it.book_id)
            book.quantity += it.quantity

        po.status = "Received"
        db.session.commit()

        return jsonify({
            "message": "purchase order received and inventory updated",
            "purchase_order_id": po.id,
            "status": po.status
        }), 200

    # ----------------------------
    # Reports
    # ----------------------------
    @app.get("/api/reports/low-stock")
    @role_required("admin", "staff")
    def low_stock_report():
        try:
            threshold = int(request.args.get("threshold", 3))
        except (TypeError, ValueError):
            threshold = 3

        books = Book.query.filter(Book.quantity <= threshold).order_by(Book.quantity.asc()).all()
        return jsonify({
            "threshold": threshold,
            "count": len(books),
            "books": [{
                "id": b.id,
                "title": b.title,
                "author": b.author,
                "quantity": b.quantity
            } for b in books]
        }), 200

    @app.get("/api/reports/sales")
    @role_required("admin", "staff")
    def sales_report():
        start = request.args.get("start")
        end = request.args.get("end")

        q = Sale.query
        if start:
            dt = parse_dt(start)
            if dt:
                q = q.filter(Sale.timestamp >= dt)

        if end:
            dt = parse_dt(end)
            if dt:
                q = q.filter(Sale.timestamp <= dt)

        sales = q.order_by(Sale.timestamp.desc()).all()

        items = [{
            "id": s.id,
            "timestamp": s.timestamp.isoformat() if s.timestamp else None,
            "book_id": s.book_id,
            "title": s.book.title if s.book else None,
            "quantity": int(s.quantity),
            "total": float(s.total),
            "staff": s.staff.username if s.staff else None
        } for s in sales]

        total_sales = round(sum(float(s.total) for s in sales), 2)

        return jsonify({
            "count": len(items),
            "total_sales": total_sales,
            "sales": items
        }), 200

    @app.get("/api/reports/financial")
    @role_required("admin", "staff")
    def financial_report():
        """
        Advanced sales + financial tracking KPIs.

        Query params:
          - start: "YYYY-MM-DD" or ISO datetime (optional)
          - end:   "YYYY-MM-DD" or ISO datetime (optional)
          - group_by: day|week|month (default: day)
          - include_orders: 0|1 (default: 1)
          - order_status: Processing|Shipped|Completed (default: Completed)
        """
        start = request.args.get("start")
        end = request.args.get("end")
        group_by = (request.args.get("group_by") or "day").lower()
        include_orders = (request.args.get("include_orders") or "1") == "1"
        order_status = request.args.get("order_status") or "Completed"

        start_dt = parse_dt(start) if start else None
        end_dt = parse_dt(end) if end else None

        def in_range(dt):
            if start_dt and dt < start_dt:
                return False
            if end_dt and dt > end_dt:
                return False
            return True

        if group_by not in ("day", "week", "month"):
            group_by = "day"

        def bucket_key(dt):
            if group_by == "day":
                return dt.date().isoformat()
            if group_by == "week":
                iso = dt.isocalendar()
                return f"{iso.year}-W{iso.week:02d}"
            return f"{dt.year}-{dt.month:02d}"

        # Pull Sales
        sales_q = Sale.query
        if start_dt:
            sales_q = sales_q.filter(Sale.timestamp >= start_dt)
        if end_dt:
            sales_q = sales_q.filter(Sale.timestamp <= end_dt)
        sales = sales_q.order_by(Sale.timestamp.asc()).all()

        # Pull Orders (optional)
        orders = []
        if include_orders:
            orders_q = Order.query.filter(Order.status == order_status)
            if start_dt:
                orders_q = orders_q.filter(Order.timestamp >= start_dt)
            if end_dt:
                orders_q = orders_q.filter(Order.timestamp <= end_dt)
            orders = orders_q.order_by(Order.timestamp.asc()).all()

        # KPIs
        sales_revenue = round(sum(float(s.total) for s in sales), 2)
        sales_units = int(sum(int(s.quantity) for s in sales))
        sales_count = len(sales)
        avg_sale_value = round((sales_revenue / sales_count), 2) if sales_count else 0.0

        orders_revenue = round(sum(float(o.total) for o in orders), 2)
        orders_count = len(orders)
        avg_order_value = round((orders_revenue / orders_count), 2) if orders_count else 0.0

        total_revenue = round(sales_revenue + orders_revenue, 2)

        # Time series buckets
        series = {}
        for s in sales:
            if not in_range(s.timestamp):
                continue
            k = bucket_key(s.timestamp)
            series.setdefault(k, {
                "revenue_sales": 0.0,
                "revenue_orders": 0.0,
                "units": 0,
                "sales_count": 0,
                "orders_count": 0
            })
            series[k]["revenue_sales"] += float(s.total)
            series[k]["units"] += int(s.quantity)
            series[k]["sales_count"] += 1

        for o in orders:
            if not in_range(o.timestamp):
                continue
            k = bucket_key(o.timestamp)
            series.setdefault(k, {
                "revenue_sales": 0.0,
                "revenue_orders": 0.0,
                "units": 0,
                "sales_count": 0,
                "orders_count": 0
            })
            series[k]["revenue_orders"] += float(o.total)
            series[k]["orders_count"] += 1

        series_out = []
        for k in sorted(series.keys()):
            row = series[k]
            series_out.append({
                "bucket": k,
                "revenue_sales": round(row["revenue_sales"], 2),
                "revenue_orders": round(row["revenue_orders"], 2),
                "revenue_total": round(row["revenue_sales"] + row["revenue_orders"], 2),
                "units": row["units"],
                "sales_count": row["sales_count"],
                "orders_count": row["orders_count"]
            })

        # Top books + staff performance (from Sales only)
        top_books = {}
        staff_perf = {}

        for s in sales:
            title = s.book.title if s.book else f"Book {s.book_id}"
            top_books.setdefault(s.book_id, {"book_id": s.book_id, "title": title, "units": 0, "revenue": 0.0})
            top_books[s.book_id]["units"] += int(s.quantity)
            top_books[s.book_id]["revenue"] += float(s.total)

            staff = s.staff.username if s.staff else "unknown"
            staff_perf.setdefault(staff, {"staff": staff, "sales_count": 0, "units": 0, "revenue": 0.0})
            staff_perf[staff]["sales_count"] += 1
            staff_perf[staff]["units"] += int(s.quantity)
            staff_perf[staff]["revenue"] += float(s.total)

        top_books_out = sorted(top_books.values(), key=lambda x: x["revenue"], reverse=True)[:10]
        for b in top_books_out:
            b["revenue"] = round(b["revenue"], 2)

        staff_out = sorted(staff_perf.values(), key=lambda x: x["revenue"], reverse=True)
        for st in staff_out:
            st["revenue"] = round(st["revenue"], 2)

        return jsonify({
            "filters": {
                "start": start_dt.isoformat() if start_dt else None,
                "end": end_dt.isoformat() if end_dt else None,
                "group_by": group_by,
                "include_orders": include_orders,
                "order_status": order_status
            },
            "kpis": {
                "sales_revenue": sales_revenue,
                "sales_units": sales_units,
                "sales_count": sales_count,
                "avg_sale_value": avg_sale_value,
                "orders_revenue": orders_revenue,
                "orders_count": orders_count,
                "avg_order_value": avg_order_value,
                "total_revenue": total_revenue
            },
            "series": series_out,
            "top_books_by_revenue": top_books_out,
            "staff_performance": staff_out
        }), 200