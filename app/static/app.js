(function(){
  const $ = (id) => document.getElementById(id);
  const consoleEl = $("console");
  const authStatus = $("authStatus");

  let token = sessionStorage.getItem("token") || "";
  let role = sessionStorage.getItem("role") || "";
  let username = sessionStorage.getItem("username") || "";

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

      sessionStorage.setItem("token", token);
      sessionStorage.setItem("role", role);
      sessionStorage.setItem("username", username);

      log("✅ Logged in", out);
      setAuthUI();
      refreshBooks();
    } catch (e){
      log("❌ Login failed", e);
    }
  });

  $("logoutBtn").addEventListener("click", ()=>{
    token = ""; role = ""; username = "";
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("username");
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

  $("financialReportBtn")?.addEventListener("click", async ()=>{
    try{
      const start = $("fin_start").value.trim();
      const end = $("fin_end").value.trim();
      const group_by = $("fin_group_by").value;

      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      if (group_by) params.set("group_by", group_by);

      const out = await api(`/api/reports/financial?${params.toString()}`, { method:"GET" });
      $("reportOut").textContent = JSON.stringify(out, null, 2);
      log("Financial report loaded");
    } catch (e){
      log("❌ Financial report failed", e);
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

  function fmtDate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

$("fin_today")?.addEventListener("click", ()=>{
  const t = new Date();
  $("fin_start").value = fmtDate(t);
  $("fin_end").value = fmtDate(t);
  log("📅 Set dates to Today");
});

$("fin_last7")?.addEventListener("click", ()=>{
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  $("fin_start").value = fmtDate(start);
  $("fin_end").value = fmtDate(end);
  log("📅 Set dates to Last 7 days");
});

$("fin_month")?.addEventListener("click", ()=>{
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  $("fin_start").value = fmtDate(start);
  $("fin_end").value = fmtDate(end);
  log("📅 Set dates to This month");
});

$("fin_clear")?.addEventListener("click", ()=>{
  $("fin_start").value = "";
  $("fin_end").value = "";
  log("🧹 Cleared date filters");
});

// Publisher Orders
$("createPOBtn")?.addEventListener("click", async ()=>{
  try{
    log("➡️ Create Publisher Order clicked");
    const items = JSON.parse($("po_items").value);

    const out = await api("/api/publisher-orders", {
      method:"POST",
      body: JSON.stringify({ items })
    });

    log("✅ Publisher Order created", out);
  } catch (e){
    log("❌ Create publisher order failed", e);
  }
});

$("listPOBtn")?.addEventListener("click", async ()=>{
  try{
    log("➡️ List Publisher Orders clicked");
    const out = await api("/api/publisher-orders", { method:"GET" });
    $("reportOut").textContent = JSON.stringify(out, null, 2);
    log("✅ Publisher Orders loaded", out);
  } catch (e){
    log("❌ List publisher orders failed", e);
  }
});

$("submitPOBtn")?.addEventListener("click", async ()=>{
  try{
    log("➡️ Submit Order clicked");
    const id = parseInt($("po_id").value, 10);
    if (Number.isNaN(id)) { log("❌ Enter a valid PO ID."); return; }

    const out = await api(`/api/publisher-orders/${id}/submit`, { method:"PATCH" });
    log("✅ Purchase order submitted", out);
  } catch (e){
    log("❌ Submit purchase order failed", e);
  }
});

$("receivePOBtn")?.addEventListener("click", async ()=>{
  try{
    log("➡️ Receive & Restock clicked");
    const id = parseInt($("po_id").value, 10);
    if (Number.isNaN(id)) { log("❌ Enter a valid PO ID."); return; }

    const out = await api(`/api/publisher-orders/${id}/receive`, { method:"PATCH" });
    log("✅ Purchase order received + inventory updated", out);
    refreshBooks();
  } catch (e){
    log("❌ Receive purchase order failed", e);
  }
});


// boot
setAuthUI();
refreshBooks();

})();