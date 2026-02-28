from app.main import create_app

app = create_app()

if __name__ == "__main__":
    from waitress import serve

    print("✅ Bookstore API running at http://127.0.0.1:5000")
    print("Demo users: admin / staff / customer")
    print("Passwords: Admin123! / Staff123! / Customer123!")
    serve(app, host="127.0.0.1", port=5000)
