(function(){
  const $ = (id) => document.getElementById(id);
  const consoleEl = $("console");
  const authStatus = $("authStatus");

  let token = localStorage.getItem("token") || "";
  let role = localStorage.getItem("role") || "";
  let username = localStorage.getItem("username") || "";

  function log(msg, obj){
    const ts = new Date().toLocaleTimeString();
    let line = `[${ts}] ${msg}`;
    if (obj !== undefined){
      try{ line += `\n${JSON.stringify(obj, null, 2)}`; }
      catch{ line += `\n${String(obj)}`; }
    }

    // Append to bottom + keep scroll at bottom
    consoleEl.textContent += line + "\n\n";
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function setAuthUI(){
    if (token){
      authStatus.textContent = `Logged in as ${username} (${role})`;
      authStatus.classList.remove("muted");
      $("logoutBtn").disabled = false;
      $("loginBtn").disabled = true;
    } else {
      authStatus.textContent = "Not logged in";
      authStatus.classList.add("muted");
      $("logoutBtn").disabled = true;
      $("loginBtn").disabled = false;
    }

    // Role-based blocks
    document.querySelectorAll(".roleBlock").forEach(el => {
      const allowed = (el.getAttribute("data-role") || "")
        .split(",").map(s=>s.trim()).filter(Boolean);

      if (!allowed.length) return;
      if (!token){ el.classList.add("hidden"); return; }

      if (allowed.includes(role)) el.classList.remove("hidden");
      else el.classList.add("hidden");
    });
  }

  async function api(path, options = {}){
    const headers = options.headers || {};
    headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(path, { ...options, headers });

    let data = null;
    const text = await res.text();
    try{ data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok){
      throw { status: res.status, data };
    }
    return data;
  }

  async function refreshBooks(q=""){
    try{
      const path = q ? `/api/books/search?q=${encodeURIComponent(q)}` : "/api/books";
      const books = await api(path, { method:"GET" });
      const tbody = $("booksTable").querySelector("tbody");
      tbody.innerHTML = "";

      (books || []).forEach(b=>{
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${b.id}</td>
          <td>${b.isbn || ""}</td>
          <td>${b.title}</td>
          <td>${b.author}</td>
          <td>${b.price}</td>
          <td>${b.quantity}</td>`;
        tbody.appendChild(tr);
      });

      log(`Books loaded (${(books || []).length})`);
    } catch (e){
      log("❌ Failed to load books", e);
    }
  }

  // Login / logout
  $("loginBtn").addEventListener("click", async ()=>{
    try{
      const u = $("username").value.trim();
      const p = $("password").value;

      const out = await api("/api/auth/login", {
        method:"POST",
        body: JSON.stringify({username:u, password:p})
      });

      token = out.access_token;
      role = out.role;
      username = out.username;

      localStorage.setItem("token", token);
      localStorage.setItem("role", role);
      localStorage.setItem("username", username);

      log("✅ Logged in", out);
      setAuthUI();
      refreshBooks();
    } catch (e){
      log("❌ Login failed", e);
    }
  });

  $("logoutBtn").addEventListener("click", ()=>{
    token = ""; role = ""; username = "";
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    log("Logged out");
    setAuthUI();
  });

  $("clearConsoleBtn").addEventListener("click", ()=> {
    consoleEl.textContent = "";
  });

  // Books actions
  $("refreshBooksBtn").addEventListener("click", ()=> refreshBooks());
  $("searchBtn").addEventListener("click", ()=> refreshBooks($("searchQ").value.trim()));

  $("addBookBtn").addEventListener("click", async ()=>{
    try{
      const payload = {
        isbn: $("add_isbn").value.trim() || null,
        title: $("add_title").value.trim(),
        author: $("add_author").value.trim(),
        price: parseFloat($("add_price").value),
        quantity: parseInt($("add_qty").value, 10)
      };
      const out = await api("/api/books", { method:"POST", body: JSON.stringify(payload) });
      log("✅ Book added", out);
      refreshBooks();
    } catch (e){
      log("❌ Add book failed", e);
    }
  });

  $("updateQtyBtn").addEventListener("click", async ()=>{
    try{
      const bookId = parseInt($("qty_book_id").value, 10);
      const quantity = parseInt($("qty_new").value, 10);
      const out = await api(`/api/books/${bookId}/quantity`, {
        method:"PATCH",
        body: JSON.stringify({quantity})
      });
      log("✅ Quantity updated", out);
      refreshBooks();
    } catch (e){
      log("❌ Update quantity failed", e);
    }
  });

  $("updateDetailsBtn").addEventListener("click", async ()=>{
    try{
      const bookId = parseInt($("edit_book_id").value, 10);
      const payload = {};
      const t = $("edit_title").value.trim();
      const a = $("edit_author").value.trim();
      const i = $("edit_isbn").value.trim();
      const p = $("edit_price").value.trim();

      if (t) payload.title = t;
      if (a) payload.author = a;
      if (i) payload.isbn = i;
      if (p) payload.price = parseFloat(p);

      if (!Object.keys(payload).length){
        log("⚠️ Nothing to update (fill at least one field).");
        return;
      }

      const out = await api(`/api/books/${bookId}`, { method:"PATCH", body: JSON.stringify(payload) });
      log("✅ Book details updated", out);
      refreshBooks();
    } catch (e){
      log("❌ Update details failed", e);
    }
  });

  // Remove Book (DELETE)
  const deleteBookBtn = $("deleteBookBtn");
  if (deleteBookBtn){
    deleteBookBtn.addEventListener("click", async ()=>{
      try{
        const raw = $("del_book_id").value.trim();
        if (!raw){
          log("❌ Enter a Book ID to delete.");
          return;
        }
        const bookId = parseInt(raw, 10);
        if (Number.isNaN(bookId)){
          log("❌ Book ID must be a number.");
          return;
        }

        const ok = confirm(`Delete Book ID ${bookId}? This cannot be undone.`);
        if (!ok) return;

        const out = await api(`/api/books/${bookId}`, { method:"DELETE" });
        log(`✅ Book ${bookId} deleted`, out);
        refreshBooks();
      } catch (e){
        log("❌ Delete book failed", e);
      }
    });
  }

  // Sales
  $("recordSaleBtn").addEventListener("click", async ()=>{
    try{
      const book_id = parseInt($("sale_book_id").value, 10);
      const quantity = parseInt($("sale_qty").value, 10);
      const out = await api("/api/sales", { method:"POST", body: JSON.stringify({book_id, quantity}) });
      log("✅ Sale recorded", out);
      refreshBooks();
    } catch (e){
      log("❌ Record sale failed", e);
    }
  });

  // Orders
  $("placeOrderBtn").addEventListener("click", async ()=>{
    try{
      const items = JSON.parse($("order_items").value);
      const out = await api("/api/orders", { method:"POST", body: JSON.stringify({items}) });
      log("✅ Order placed", out);
      refreshBooks();
    } catch (e){
      log("❌ Place order failed", e);
    }
  });

  // Reports
  $("salesReportBtn").addEventListener("click", async ()=>{
    try{
      const out = await api("/api/reports/sales", { method:"GET" });
      $("reportOut").textContent = JSON.stringify(out, null, 2);
      log("Sales report loaded");
    } catch (e){
      log("❌ Sales report failed", e);
    }
  });

  $("lowStockBtn").addEventListener("click", async ()=>{
    try{
      const th = $("lowStockThreshold").value.trim();
      const qs = th ? `?threshold=${encodeURIComponent(th)}` : "";
      const out = await api(`/api/reports/low-stock${qs}`, { method:"GET" });
      $("reportOut").textContent = JSON.stringify(out, null, 2);
      log("Low stock report loaded");
    } catch (e){
      log("❌ Low stock report failed", e);
    }
  });

  // boot
  setAuthUI();
  refreshBooks();
})();