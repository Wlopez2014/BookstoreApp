(function(){
  const $ = (id) => document.getElementById(id);

  const consoleEl = $("console");
  const authStatus = $("authStatus");
  const publisherOut = $("publisherOut");

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
    if (consoleEl){
      consoleEl.textContent += line + "\n\n";
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  }

  function errText(e){
    if (!e) return "";
    if (typeof e === "string") return e;
    if (e.data){
      try { return typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 2); }
      catch { return String(e.data); }
    }
    try { return JSON.stringify(e, null, 2); } catch { return String(e); }
  }

  // ---------- Inline Status ----------
  function setStatus(id, message, type="success"){
    const el = document.getElementById(id);
    if (!el) return;

    el.textContent = message || "";
    el.classList.remove("success","error","warn","show");
    if (message){
      el.classList.add(type, "show");
    }
  }

  function clearStatus(id){
    setStatus(id, "", "success");
  }

  function clearAllStatuses(){
    [
      "loginStatus","catalogStatus",
      "addBookStatus","updateQtyStatus","updateDetailsStatus","deleteBookStatus",
      "recordSaleStatus","placeOrderStatus",
      "publisherListStatus","publisherActionStatus"
    ].forEach(clearStatus);
  }

  function setPublisherOut(obj){
    if (!publisherOut) return;
    publisherOut.textContent = (typeof obj === "string") ? obj : JSON.stringify(obj, null, 2);
  }

  // ---- Views / Navigation ----
  function showView(viewId){
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    const target = document.getElementById(viewId);
    if (target) target.classList.remove("hidden");

    document.querySelectorAll(".navBtn").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === viewId);
    });

    // optional: clear statuses when changing tabs
    clearAllStatuses();
  }

  function setNavForRole(){
    document.querySelectorAll(".navBtn").forEach(btn => {
      const roles = (btn.getAttribute("data-roles") || "")
        .split(",").map(s=>s.trim()).filter(Boolean);

      // If not logged in, allow Catalog + Console
      if (!token){
        const view = btn.getAttribute("data-view");
        const allow = (view === "view-catalog" || view === "view-console");
        btn.disabled = !allow;
        return;
      }

      // Logged in: allow by role
      if (!roles.length){
        btn.disabled = false;
        return;
      }

      btn.disabled = !roles.includes(role);
    });
  }

  // ---- Auth UI + Role Blocks ----
  function setAuthUI(){
    const logoutBtn = $("logoutBtn");
    const loginBtn = $("loginBtn");
    const loginNavBtn = $("loginNavBtn");

    if (token){
      authStatus.textContent = `Logged in as ${username} (${role})`;
      authStatus.classList.remove("muted");
      if (logoutBtn) logoutBtn.disabled = false;
      if (loginBtn) loginBtn.disabled = true;
      if (loginNavBtn) loginNavBtn.classList.add("hidden");
    } else {
      authStatus.textContent = "Not logged in";
      authStatus.classList.add("muted");
      if (logoutBtn) logoutBtn.disabled = true;
      if (loginBtn) loginBtn.disabled = false;
      if (loginNavBtn) loginNavBtn.classList.remove("hidden");
    }

    // Role-based blocks in the DOM
    document.querySelectorAll(".roleBlock").forEach(el => {
      const allowed = (el.getAttribute("data-role") || "")
        .split(",").map(s=>s.trim()).filter(Boolean);

      if (!allowed.length) return;
      if (!token){ el.classList.add("hidden"); return; }

      if (allowed.includes(role)) el.classList.remove("hidden");
      else el.classList.add("hidden");
    });

    setNavForRole();

    if (!token){
      showView("view-auth");
    } else {
      showView("view-catalog");
    }
  }

  // ---- API ----
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
      const table = $("booksTable");
      if (!table) return;

      const tbody = table.querySelector("tbody");
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
      setStatus("catalogStatus", `✅ Loaded ${(books || []).length} books.`, "success");
    } catch (e){
      log("❌ Failed to load books", e);
      setStatus("catalogStatus", `❌ Failed to load books: ${errText(e)}`, "error");
    }
  }

  // ---- Nav click wiring ----
  document.querySelectorAll(".navBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-view");
      if (!view) return;
      showView(view);
    });
  });

  $("loginNavBtn")?.addEventListener("click", () => showView("view-auth"));

  // ---- Login / logout ----
  $("loginBtn")?.addEventListener("click", async ()=>{
    try{
      clearAllStatuses();
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
      setStatus("loginStatus", `✅ Logged in as ${out.username} (${out.role})`, "success");
      setAuthUI();
      await refreshBooks();
      showView("view-catalog");
    } catch (e){
      log("❌ Login failed", e);
      setStatus("loginStatus", `❌ Login failed: invalid username or password.`, "error");
    }
  });

  $("logoutBtn")?.addEventListener("click", ()=>{
    token = ""; role = ""; username = "";
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("username");
    log("Logged out");
    clearAllStatuses();
    setAuthUI();
    showView("view-auth");
  });

  $("clearConsoleBtn")?.addEventListener("click", ()=> {
    if (consoleEl) consoleEl.textContent = "";
  });

  // ---- Books actions ----
  $("refreshBooksBtn")?.addEventListener("click", ()=> refreshBooks());
  $("searchBtn")?.addEventListener("click", ()=> refreshBooks($("searchQ").value.trim()));

  $("addBookBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("addBookStatus");

      const payload = {
        isbn: $("add_isbn").value.trim() || null,
        title: $("add_title").value.trim(),
        author: $("add_author").value.trim(),
        price: parseFloat($("add_price").value),
        quantity: parseInt($("add_qty").value, 10)
      };

      const out = await api("/api/books", { method:"POST", body: JSON.stringify(payload) });
      log("✅ Book added", out);
      setStatus("addBookStatus", `✅ Book added: "${payload.title}" (Qty ${payload.quantity})`, "success");
      refreshBooks();
    } catch (e){
      log("❌ Add book failed", e);
      setStatus("addBookStatus", `❌ Add failed: ${errText(e)}`, "error");
    }
  });

  $("updateQtyBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("updateQtyStatus");

      const bookId = parseInt($("qty_book_id").value, 10);
      const quantity = parseInt($("qty_new").value, 10);

      const out = await api(`/api/books/${bookId}/quantity`, {
        method:"PATCH",
        body: JSON.stringify({quantity})
      });

      log("✅ Quantity updated", out);
      setStatus("updateQtyStatus", `✅ Quantity updated: Book ${bookId} → ${quantity}`, "success");
      refreshBooks();
    } catch (e){
      log("❌ Update quantity failed", e);
      setStatus("updateQtyStatus", `❌ Update failed: ${errText(e)}`, "error");
    }
  });

  $("updateDetailsBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("updateDetailsStatus");

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
        setStatus("updateDetailsStatus", "⚠️ Nothing to update. Fill at least one field.", "warn");
        return;
      }

      const out = await api(`/api/books/${bookId}`, { method:"PATCH", body: JSON.stringify(payload) });
      log("✅ Book details updated", out);
      setStatus("updateDetailsStatus", `✅ Updated Book ${bookId}`, "success");
      refreshBooks();
    } catch (e){
      log("❌ Update details failed", e);
      setStatus("updateDetailsStatus", `❌ Update failed: ${errText(e)}`, "error");
    }
  });

  $("deleteBookBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("deleteBookStatus");

      const raw = $("del_book_id").value.trim();
      if (!raw){
        log("❌ Enter a Book ID to delete.");
        setStatus("deleteBookStatus", "⚠️ Enter a Book ID to delete.", "warn");
        return;
      }

      const bookId = parseInt(raw, 10);
      if (Number.isNaN(bookId)){
        log("❌ Book ID must be a number.");
        setStatus("deleteBookStatus", "⚠️ Book ID must be a number.", "warn");
        return;
      }

      const ok = confirm(`Delete Book ID ${bookId}? This cannot be undone.`);
      if (!ok) return;

      const out = await api(`/api/books/${bookId}`, { method:"DELETE" });
      log(`✅ Book ${bookId} deleted`, out);
      setStatus("deleteBookStatus", `✅ Book ${bookId} deleted.`, "success");
      refreshBooks();
    } catch (e){
      log("❌ Delete book failed", e);
      setStatus("deleteBookStatus", `❌ Delete failed: ${errText(e)}`, "error");
    }
  });

  // ---- Sales ----
  $("recordSaleBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("recordSaleStatus");

      const book_id = parseInt($("sale_book_id").value, 10);
      const quantity = parseInt($("sale_qty").value, 10);

      const out = await api("/api/sales", { method:"POST", body: JSON.stringify({book_id, quantity}) });
      log("✅ Sale recorded", out);
      setStatus("recordSaleStatus", `✅ Sale recorded: Book ${book_id} (Qty ${quantity})`, "success");
      refreshBooks();
    } catch (e){
      log("❌ Record sale failed", e);
      setStatus("recordSaleStatus", `❌ Sale failed: ${errText(e)}`, "error");
    }
  });

  // ---- Orders ----
  $("placeOrderBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("placeOrderStatus");

      const items = JSON.parse($("order_items").value);
      const out = await api("/api/orders", { method:"POST", body: JSON.stringify({items}) });
      log("✅ Order placed", out);
      setStatus("placeOrderStatus", "✅ Order placed successfully.", "success");
      refreshBooks();
    } catch (e){
      log("❌ Place order failed", e);
      setStatus("placeOrderStatus", `❌ Order failed: ${errText(e)}`, "error");
    }
  });

  // ---- Reports ----
  $("salesReportBtn")?.addEventListener("click", async ()=>{
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

  $("lowStockBtn")?.addEventListener("click", async ()=>{
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

  // ---- Publisher Orders ----
  $("createPOBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("publisherListStatus");
      clearStatus("publisherActionStatus");

      log("➡️ Create Publisher Order clicked");
      const items = JSON.parse($("po_items").value);

      const out = await api("/api/publisher-orders", {
        method:"POST",
        body: JSON.stringify({ items })
      });

      log("✅ Publisher Order created", out);
      setPublisherOut(out);
      setStatus("publisherListStatus", "✅ Purchase order created. See output below.", "success");
      showView("view-publisher");
    } catch (e){
      log("❌ Create publisher order failed", e);
      setStatus("publisherListStatus", `❌ Create PO failed: ${errText(e)}`, "error");
    }
  });

  $("listPOBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("publisherListStatus");

      log("➡️ List Publisher Orders clicked");
      const out = await api("/api/publisher-orders", { method:"GET" });

      setPublisherOut(out);
      log("✅ Publisher Orders loaded", out);
      setStatus("publisherListStatus", "✅ Orders loaded. See output below.", "success");
      showView("view-publisher");
    } catch (e){
      log("❌ List publisher orders failed", e);
      setStatus("publisherListStatus", `❌ List failed: ${errText(e)}`, "error");
    }
  });

  $("submitPOBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("publisherActionStatus");

      log("➡️ Submit Order clicked");
      const id = parseInt($("po_id").value, 10);
      if (Number.isNaN(id)) {
        log("❌ Enter a valid PO ID.");
        setStatus("publisherActionStatus", "⚠️ Enter a valid PO ID.", "warn");
        return;
      }

      const out = await api(`/api/publisher-orders/${id}/submit`, { method:"PATCH" });
      log("✅ Purchase order submitted", out);
      setPublisherOut(out);
      setStatus("publisherActionStatus", `✅ PO ${id} submitted.`, "success");
      showView("view-publisher");
    } catch (e){
      log("❌ Submit purchase order failed", e);
      setStatus("publisherActionStatus", `❌ Submit failed: ${errText(e)}`, "error");
    }
  });

  $("receivePOBtn")?.addEventListener("click", async ()=>{
    try{
      clearStatus("publisherActionStatus");

      log("➡️ Receive & Restock clicked");
      const id = parseInt($("po_id").value, 10);
      if (Number.isNaN(id)) {
        log("❌ Enter a valid PO ID.");
        setStatus("publisherActionStatus", "⚠️ Enter a valid PO ID.", "warn");
        return;
      }

      const out = await api(`/api/publisher-orders/${id}/receive`, { method:"PATCH" });
      log("✅ Purchase order received + inventory updated", out);
      setPublisherOut(out);
      setStatus("publisherActionStatus", `✅ PO ${id} received & restocked.`, "success");
      refreshBooks();
      showView("view-publisher");
    } catch (e){
      log("❌ Receive purchase order failed", e);
      setStatus("publisherActionStatus", `❌ Receive failed: ${errText(e)}`, "error");
    }
  });

  // boot
  setAuthUI();
  refreshBooks();
})();