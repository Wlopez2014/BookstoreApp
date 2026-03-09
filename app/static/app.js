(function(){
  const $ = (id) => document.getElementById(id);

  const consoleEl = $("console");
  const authStatus = $("authStatus");
  const publisherOut = $("publisherOut");

  let token = sessionStorage.getItem("token") || "";
  let role = sessionStorage.getItem("role") || "";
  let username = sessionStorage.getItem("username") || "";

  // Chart.js instances — kept so we can destroy/recreate on refresh
  let revenueChart = null;

  // Cart: { [book_id]: { book_id, title, price, quantity, stock } }
  let cart = {};
  let revenueTrendChart = null;

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
    if (message) el.classList.add(type, "show");
  }

  function clearStatus(id){
    setStatus(id, "", "success");
  }

  function clearAllStatuses(){
    [
      "loginStatus","registerStatus","catalogStatus",
      "addBookStatus","updateQtyStatus","updateDetailsStatus","deleteBookStatus",
      "recordSaleStatus","placeOrderStatus",
      "publisherListStatus","publisherActionStatus",
      "ordersStatus"
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

    clearAllStatuses();
  }

  function setNavForRole(){
    document.querySelectorAll(".navBtn").forEach(btn => {
      const roles = (btn.getAttribute("data-roles") || "")
        .split(",").map(s=>s.trim()).filter(Boolean);

      if (!token){
        const view = btn.getAttribute("data-view");
        const allow = (view === "view-catalog" || view === "view-console");
        btn.disabled = !allow;
        return;
      }

      if (!roles.length){ btn.disabled = false; return; }
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

    document.querySelectorAll(".roleBlock").forEach(el => {
      const allowed = (el.getAttribute("data-role") || "")
        .split(",").map(s=>s.trim()).filter(Boolean);

      if (!allowed.length) return;
      if (!token){ el.classList.add("hidden"); return; }

      if (allowed.includes(role)) el.classList.remove("hidden");
      else el.classList.add("hidden");
    });

    setNavForRole();

    if (!token) showView("view-auth");
    else showView("view-catalog");
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

    if (!res.ok) throw { status: res.status, data };
    return data;
  }

  async function refreshBooks(q=""){
    try{
      const path = q ? `/api/books/search?q=${encodeURIComponent(q)}` : "/api/books";
      const books = await api(path, { method:"GET" });
      const table = $("booksTable");
      if (!table) return;

      // Show Add column header only for customers
      const cartColHeader = $("cartColHeader");
      if (cartColHeader) cartColHeader.classList.toggle("hidden", role !== "customer");

      const tbody = table.querySelector("tbody");
      tbody.innerHTML = "";

      (books || []).forEach(b => {
        const tr = document.createElement("tr");
        const inCart = cart[b.id] ? cart[b.id].quantity : 0;
        const cartCell = role === "customer"
          ? `<td><button class="smallBtn secondary addToCartBtn"
               data-id="${b.id}" data-title="${escHtml(b.title)}"
               data-price="${b.price}" data-stock="${b.quantity}"
               style="padding:4px 10px;font-size:11px;"
               ${b.quantity <= 0 ? "disabled title='Out of stock'" : ""}>
               ${inCart > 0 ? `✓ ${inCart} in cart` : "+ Add"}
             </button></td>`
          : "";
        tr.innerHTML = `
          <td>${b.id}</td>
          <td>${b.isbn || ""}</td>
          <td>${escHtml(b.title)}</td>
          <td>${escHtml(b.author)}</td>
          <td>$${Number(b.price).toFixed(2)}</td>
          <td>${b.quantity}</td>
          ${cartCell}`;
        tbody.appendChild(tr);
      });

      // Wire Add-to-Cart buttons
      tbody.querySelectorAll(".addToCartBtn").forEach(btn => {
        btn.addEventListener("click", () => {
          addToCart(parseInt(btn.dataset.id,10), btn.dataset.title,
                    parseFloat(btn.dataset.price), parseInt(btn.dataset.stock,10));
          refreshBooks(q);
        });
      });

      // Show cart panel only for customers
      const cartPanel = $("cartPanel");
      if (cartPanel) cartPanel.classList.toggle("hidden", role !== "customer");

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

  // ---- Auth tab toggle ----
  function switchAuthTab(tab) {
    const isLogin = tab === "login";
    $("loginPanel")?.classList.toggle("hidden", !isLogin);
    $("registerPanel")?.classList.toggle("hidden", isLogin);
    $("tabLoginBtn")?.classList.toggle("active", isLogin);
    $("tabRegisterBtn")?.classList.toggle("active", !isLogin);
    clearStatus("loginStatus"); clearStatus("registerStatus");
  }
  $("tabLoginBtn")?.addEventListener("click", () => switchAuthTab("login"));
  $("tabRegisterBtn")?.addEventListener("click", () => switchAuthTab("register"));

  // ---- Register ----
  $("registerBtn")?.addEventListener("click", async () => {
    clearStatus("registerStatus");
    const u = ($("reg_username")?.value||"").trim();
    const p  = $("reg_password")?.value||"";
    const c  = $("reg_confirm")?.value||"";
    if (!u) { setStatus("registerStatus","⚠️ Username is required.","warn"); return; }
    if (p.length < 8) { setStatus("registerStatus","⚠️ Password must be at least 8 characters.","warn"); return; }
    if (p !== c) { setStatus("registerStatus","⚠️ Passwords do not match.","warn"); return; }
    try {
      const out = await api("/api/auth/register",{method:"POST",body:JSON.stringify({username:u,password:p})});
      setStatus("registerStatus",`✅ Account created! Switching to login…`,"success");
      setTimeout(() => {
        if ($("username")) $("username").value = u;
        ["reg_username","reg_password","reg_confirm"].forEach(id => { if ($(id)) $(id).value = ""; });
        switchAuthTab("login");
        setStatus("loginStatus",`✅ Account "${u}" created — please log in.`,"success");
      }, 1200);
    } catch(e) {
      setStatus("registerStatus",`❌ ${e?.data?.error||errText(e)}`,"error");
    }
  });

  // Enter-key shortcuts
  $("password")?.addEventListener("keydown", e => { if (e.key==="Enter") $("loginBtn")?.click(); });
  $("reg_confirm")?.addEventListener("keydown", e => { if (e.key==="Enter") $("registerBtn")?.click(); });
  $("searchQ")?.addEventListener("keydown", e => { if (e.key==="Enter") refreshBooks($("searchQ").value.trim()); });

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
      if (!raw){ setStatus("deleteBookStatus", "⚠️ Enter a Book ID to delete.", "warn"); return; }

      const bookId = parseInt(raw, 10);
      if (Number.isNaN(bookId)){ setStatus("deleteBookStatus", "⚠️ Book ID must be a number.", "warn"); return; }

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
  $("placeOrderBtn")?.addEventListener("click", async () => {
    try {
      clearStatus("placeOrderStatus");
      const items = Object.values(cart).map(i => ({ book_id: i.book_id, quantity: i.quantity }));
      if (!items.length) {
        setStatus("placeOrderStatus","⚠️ Your cart is empty. Add books from the Catalog first.","warn"); return;
      }
      const out = await api("/api/orders", { method:"POST", body: JSON.stringify({items}) });
      log("✅ Order placed", out);
      cart = {};
      renderCart();
      renderCheckoutCart();
      setStatus("placeOrderStatus",`✅ Order #${out.order_id} placed! Total: $${Number(out.total).toFixed(2)}`,"success");
      refreshBooks();
    } catch(e) {
      log("❌ Place order failed", e);
      setStatus("placeOrderStatus",`❌ Order failed: ${errText(e)}`,"error");
    }
  });
  $("backToCatalogBtn")?.addEventListener("click", () => showView("view-catalog"));

  // =============================================================
  //  REPORTS
  // =============================================================

  // ---- Low Stock Report (generic JSON output) ----
  $("lowStockBtn")?.addEventListener("click", async ()=>{
    try{
      const th = $("lowStockThreshold").value.trim();
      const qs = th ? `?threshold=${encodeURIComponent(th)}` : "";
      const out = await api(`/api/reports/low-stock${qs}`, { method:"GET" });
      showGenericReport(out);
      log("Low stock report loaded");
    } catch (e){
      log("❌ Low stock report failed", e);
      $("reportOut").textContent = `Error: ${errText(e)}`;
    }
  });

  function showGenericReport(data){
    // Hide the financial dashboard, show the generic card
    $("finDashboard").classList.add("hidden");
    $("genericReportCard").classList.remove("hidden");
    $("reportOut").textContent = JSON.stringify(data, null, 2);
  }

  // ---- Financial Dashboard Report ----
  $("financialReportBtn")?.addEventListener("click", async ()=>{
    try{
      const start = $("fin_start").value.trim();
      const end = $("fin_end").value.trim();
      const group_by = $("fin_group_by").value;

      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      if (group_by) params.set("group_by", group_by);

      const qs = params.toString();

      // Fetch both in parallel
      const [finData, salesData] = await Promise.all([
        api(`/api/reports/financial?${qs}`, { method:"GET" }),
        api(`/api/reports/sales?${qs}`, { method:"GET" })
      ]);

      log("Financial + sales data loaded");
      renderFinancialDashboard(finData, salesData.sales || []);
    } catch (e){
      log("❌ Financial report failed", e);
    }
  });

  // ---- Core dashboard renderer ----
  function renderFinancialDashboard(data, salesRows){
    // Switch views: hide generic, show dashboard
    $("genericReportCard").classList.add("hidden");
    $("finDashboard").classList.remove("hidden");

    const kpis = data.kpis || {};
    const series = data.series || [];
    const topBooks = data.top_books_by_revenue || [];
    const staff = data.staff_performance || [];

    // ---- KPI Cards ----
    const fmt = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 })}`;

    $("kpi-total-revenue").textContent = fmt(kpis.total_revenue);
    $("kpi-total-sub").textContent =
      `${(kpis.sales_count || 0) + (kpis.orders_count || 0)} transactions total`;

    $("kpi-pos-revenue").textContent = fmt(kpis.sales_revenue);
    $("kpi-pos-sub").textContent =
      `${kpis.sales_count || 0} POS sale${kpis.sales_count !== 1 ? "s" : ""} · avg ${fmt(kpis.avg_sale_value)}`;

    $("kpi-orders-revenue").textContent = fmt(kpis.orders_revenue);
    $("kpi-orders-sub").textContent =
      `${kpis.orders_count || 0} order${kpis.orders_count !== 1 ? "s" : ""} · avg ${fmt(kpis.avg_order_value)}`;

    $("kpi-units").textContent = (kpis.sales_units || 0).toLocaleString();
    $("kpi-avg-sale").textContent = `Avg sale value: ${fmt(kpis.avg_sale_value)}`;

    // ---- Revenue Trend Chart ----
    renderChart(series);

    // ---- Top Books Table ----
    renderTopBooks(topBooks);

    // ---- Staff Performance Table ----
    renderStaffTable(staff);

    // ---- Transaction Log ----
    renderTransactionLog(salesRows || []);

    // ---- Raw JSON ----
    $("finRawOut").textContent = JSON.stringify(data, null, 2);
  }

  function renderChart(series){
    const labels  = series.map(r => r.bucket);
    const posData = series.map(r => r.revenue_sales);
    const ordData = series.map(r => r.revenue_orders);
    const totData = series.map(r => r.revenue_total);

    const sharedOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#121826",
          borderColor: "#23304a",
          borderWidth: 1,
          titleColor: "#e7eefc",
          bodyColor: "#a9b4cc",
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: $${Number(ctx.parsed.y).toFixed(2)}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(35,48,74,0.6)" },
          ticks: { color: "#a9b4cc", font: { size: 11 } }
        },
        y: {
          grid: { color: "rgba(35,48,74,0.6)" },
          ticks: {
            color: "#a9b4cc",
            font: { size: 11 },
            callback: (v) => `$${v}`
          }
        }
      }
    };

    // ---- Bar chart: POS Sales vs Online Orders ----
    if (revenueChart) { revenueChart.destroy(); revenueChart = null; }
    const barCanvas = $("revenueChart");
    if (barCanvas) {
      const ctx = barCanvas.getContext("2d");
      if (!series.length) {
        ctx.clearRect(0, 0, barCanvas.width, barCanvas.height);
        ctx.fillStyle = "#a9b4cc";
        ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No data for the selected period.", barCanvas.width / 2, barCanvas.height / 2);
      } else {
        revenueChart = new Chart(ctx, {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                label: "POS Sales",
                data: posData,
                backgroundColor: "rgba(110,168,254,0.7)",
                borderColor: "#6ea8fe",
                borderWidth: 1,
                borderRadius: 4
              },
              {
                label: "Online Orders",
                data: ordData,
                backgroundColor: "rgba(167,139,250,0.7)",
                borderColor: "#a78bfa",
                borderWidth: 1,
                borderRadius: 4
              }
            ]
          },
          options: sharedOptions
        });
      }
    }

    // ---- Line chart: Total Revenue trend ----
    if (revenueTrendChart) { revenueTrendChart.destroy(); revenueTrendChart = null; }
    const lineCanvas = $("revenueTrendChart");
    if (lineCanvas) {
      const ctx = lineCanvas.getContext("2d");
      if (!series.length) {
        ctx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
        ctx.fillStyle = "#a9b4cc";
        ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No data for the selected period.", lineCanvas.width / 2, lineCanvas.height / 2);
      } else {
        revenueTrendChart = new Chart(ctx, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "Total Revenue",
                data: totData,
                borderColor: "#34d399",
                backgroundColor: "rgba(52,211,153,0.08)",
                borderWidth: 2,
                pointBackgroundColor: "#34d399",
                pointRadius: series.length > 1 ? 4 : 6,
                pointHoverRadius: 6,
                tension: 0.3,
                fill: true
              }
            ]
          },
          options: sharedOptions
        });
      }
    }
  }

  function renderTopBooks(books){
    const wrap = $("topBooksWrap");
    if (!wrap) return;

    if (!books.length){
      wrap.innerHTML = `<div class="dashEmpty">No sales data available.</div>`;
      return;
    }

    const maxRev = books[0].revenue || 1;
    const rankClass = (i) => i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";

    const rows = books.map((b, i) => {
      const barWidth = Math.round((b.revenue / maxRev) * 100);
      return `
        <tr>
          <td><span class="rankBadge ${rankClass(i)}">${i + 1}</span></td>
          <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
              title="${escHtml(b.title)}">${escHtml(b.title)}</td>
          <td>${b.units}</td>
          <td>
            <div class="revenueBar">
              <div class="revenueBarFill" style="width:${barWidth}px;max-width:80px;"></div>
              <span>$${Number(b.revenue).toFixed(2)}</span>
            </div>
          </td>
        </tr>`;
    }).join("");

    wrap.innerHTML = `
      <table class="dashTable">
        <thead>
          <tr>
            <th>#</th><th>Title</th><th>Units</th><th>Revenue</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderStaffTable(staff){
    const wrap = $("staffWrap");
    if (!wrap) return;

    if (!staff.length){
      wrap.innerHTML = `<div class="dashEmpty">No staff sales data available.</div>`;
      return;
    }

    const maxRev = staff[0].revenue || 1;

    const rows = staff.map((s, i) => {
      const barWidth = Math.round((s.revenue / maxRev) * 100);
      return `
        <tr>
          <td><span class="rankBadge ${i === 0 ? "gold" : ""}">${i + 1}</span></td>
          <td>${escHtml(s.staff)}</td>
          <td>${s.sales_count}</td>
          <td>${s.units}</td>
          <td>
            <div class="revenueBar">
              <div class="revenueBarFill" style="width:${barWidth}px;max-width:80px;"></div>
              <span>$${Number(s.revenue).toFixed(2)}</span>
            </div>
          </td>
        </tr>`;
    }).join("");

    wrap.innerHTML = `
      <table class="dashTable">
        <thead>
          <tr>
            <th>#</th><th>Staff</th><th>Sales</th><th>Units</th><th>Revenue</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ---- Transaction Log ----
  let txnAllRows = [];
  let txnPage = 0;
  const TXN_PAGE_SIZE = 10;

  function renderTransactionLog(rows){
    txnAllRows = rows;
    txnPage = 0;
    applyTxnFilters();

    // Wire up filter controls (idempotent: remove old listeners by cloning)
    const searchEl = $("txnSearch");
    const srcEl = $("txnSourceFilter");

    const newSearch = searchEl.cloneNode(true);
    const newSrc = srcEl.cloneNode(true);
    searchEl.replaceWith(newSearch);
    srcEl.replaceWith(newSrc);

    $("txnSearch").addEventListener("input", () => { txnPage = 0; applyTxnFilters(); });
    $("txnSourceFilter").addEventListener("change", () => { txnPage = 0; applyTxnFilters(); });

    $("txnPrev").onclick = () => { if (txnPage > 0){ txnPage--; applyTxnFilters(); } };
    $("txnNext").onclick = () => { txnPage++; applyTxnFilters(); };
  }

  function applyTxnFilters(){
    const q = ($("txnSearch").value || "").toLowerCase();
    const src = $("txnSourceFilter").value;

    const filtered = txnAllRows.filter(r => {
      if (src !== "all" && r.source !== src) return false;
      if (q){
        const title = (r.title || "").toLowerCase();
        const actor = (r.actor || "").toLowerCase();
        if (!title.includes(q) && !actor.includes(q)) return false;
      }
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / TXN_PAGE_SIZE));
    if (txnPage >= totalPages) txnPage = totalPages - 1;

    const pageRows = filtered.slice(txnPage * TXN_PAGE_SIZE, (txnPage + 1) * TXN_PAGE_SIZE);
    renderTxnTable(pageRows, filtered.length);
  }

  function renderTxnTable(rows, totalCount){
    const wrap = $("txnWrap");
    const pager = $("txnPager");
    const pageInfo = $("txnPageInfo");
    if (!wrap) return;

    if (!txnAllRows.length){
      wrap.innerHTML = `<div class="dashEmpty">No transactions in the selected period.</div>`;
      pager.classList.add("hidden");
      return;
    }

    if (!rows.length){
      wrap.innerHTML = `<div class="dashEmpty">No transactions match the current filter.</div>`;
      pager.classList.add("hidden");
      return;
    }

    const sourceLabel = (src) =>
      src === "pos_sale"
        ? `<span class="txnBadge pos">POS</span>`
        : `<span class="txnBadge order">Order</span>`;

    const tableRows = rows.map(r => {
      const ts = r.timestamp
        ? new Date(r.timestamp).toLocaleString("en-US", { dateStyle:"medium", timeStyle:"short" })
        : "—";
      return `
        <tr>
          <td>${sourceLabel(r.source)}</td>
          <td>${ts}</td>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
              title="${escHtml(r.title || "")}">${escHtml(r.title || "—")}</td>
          <td style="text-align:center;">${r.quantity}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">$${Number(r.total).toFixed(2)}</td>
          <td>${escHtml(r.actor || "—")}</td>
        </tr>`;
    }).join("");

    wrap.innerHTML = `
      <div style="overflow:auto;">
        <table class="dashTable">
          <thead>
            <tr>
              <th>Source</th>
              <th>Date / Time</th>
              <th>Title</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Total</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;

    // Pager
    const totalPages = Math.max(1, Math.ceil(totalCount / TXN_PAGE_SIZE));
    const start = txnPage * TXN_PAGE_SIZE + 1;
    const end = Math.min((txnPage + 1) * TXN_PAGE_SIZE, totalCount);

    pageInfo.textContent = `${start}–${end} of ${totalCount} transactions`;
    $("txnPrev").disabled = txnPage === 0;
    $("txnNext").disabled = txnPage >= totalPages - 1;
    pager.classList.remove("hidden");
    pager.style.display = "flex";
  }

  function escHtml(str){
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- Date shortcuts ----
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
      if (Number.isNaN(id)) { setStatus("publisherActionStatus", "⚠️ Enter a valid PO ID.", "warn"); return; }

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
      if (Number.isNaN(id)) { setStatus("publisherActionStatus", "⚠️ Enter a valid PO ID.", "warn"); return; }

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

  // =============================================================
  //  CART SYSTEM
  // =============================================================
  function addToCart(id, title, price, stock) {
    if (cart[id]) { if (cart[id].quantity < stock) cart[id].quantity++; }
    else cart[id] = { book_id:id, title, price, quantity:1, stock };
    renderCart(); renderCheckoutCart();
  }
  function removeFromCart(id) { delete cart[id]; renderCart(); renderCheckoutCart(); }
  function updateCartQty(id, qty) {
    const n = parseInt(qty,10);
    if (!cart[id]) return;
    if (isNaN(n)||n<=0) { removeFromCart(id); return; }
    cart[id].quantity = Math.min(n, cart[id].stock);
    renderCart(); renderCheckoutCart();
  }
  function cartTotal() { return Object.values(cart).reduce((s,i)=>s+i.price*i.quantity,0); }

  function renderCart() {
    const body=$("#cartBody"||$("cartBody")), footer=$("cartFooter"), label=$("cartTotalLabel");
    const bodyEl = $("cartBody");
    if (!bodyEl) return;
    const items = Object.values(cart);
    if (!items.length) {
      bodyEl.innerHTML = `<div class="dashEmpty">Your cart is empty — click <strong>+ Add</strong> on any book above.</div>`;
      if (footer) footer.classList.add("hidden"); return;
    }
    bodyEl.innerHTML = items.map(item=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="flex:1;font-size:13px;">${escHtml(item.title)}</span>
        <span style="font-size:12px;color:var(--muted);width:64px;text-align:right;">$${item.price.toFixed(2)} ea</span>
        <div style="display:flex;align-items:center;gap:4px;">
          <button class="smallBtn secondary cartDecBtn" data-id="${item.book_id}" style="padding:2px 8px;">−</button>
          <input class="cartQtyInput" data-id="${item.book_id}" type="number" value="${item.quantity}"
                 min="1" max="${item.stock}" style="width:44px;text-align:center;padding:4px;font-size:12px;" />
          <button class="smallBtn secondary cartIncBtn" data-id="${item.book_id}" style="padding:2px 8px;"
                  ${item.quantity>=item.stock?"disabled":""}>+</button>
        </div>
        <span style="font-size:13px;font-weight:700;width:64px;text-align:right;">$${(item.price*item.quantity).toFixed(2)}</span>
        <button class="smallBtn secondary cartRemoveBtn" data-id="${item.book_id}"
                style="padding:2px 8px;color:var(--danger);">✕</button>
      </div>`).join("");
    bodyEl.querySelectorAll(".cartDecBtn").forEach(b=>b.addEventListener("click",()=>updateCartQty(b.dataset.id,(cart[b.dataset.id]?.quantity||1)-1)));
    bodyEl.querySelectorAll(".cartIncBtn").forEach(b=>b.addEventListener("click",()=>updateCartQty(b.dataset.id,(cart[b.dataset.id]?.quantity||0)+1)));
    bodyEl.querySelectorAll(".cartQtyInput").forEach(inp=>inp.addEventListener("change",()=>updateCartQty(inp.dataset.id,inp.value)));
    bodyEl.querySelectorAll(".cartRemoveBtn").forEach(b=>b.addEventListener("click",()=>removeFromCart(b.dataset.id)));
    if (footer) { footer.classList.remove("hidden"); footer.style.display="flex"; }
    if (label)  label.textContent = `Total: $${cartTotal().toFixed(2)}`;
  }

  function renderCheckoutCart() {
    const review=$("checkoutCartReview"), footer=$("checkoutFooter"), total=$("checkoutTotal");
    if (!review) return;
    const items = Object.values(cart);
    if (!items.length) {
      review.innerHTML=`<div class="dashEmpty">Your cart is empty — go to <strong>Catalog</strong> to add books.</div>`;
      if (footer) footer.classList.add("hidden"); return;
    }
    review.innerHTML=`
      <table class="dashTable">
        <thead><tr><th>Book</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Line Total</th></tr></thead>
        <tbody>${items.map(it=>`<tr>
          <td>${escHtml(it.title)}</td>
          <td style="text-align:center;">${it.quantity}</td>
          <td style="text-align:right;">$${it.price.toFixed(2)}</td>
          <td style="text-align:right;font-weight:700;">$${(it.price*it.quantity).toFixed(2)}</td>
        </tr>`).join("")}</tbody>
      </table>`;
    if (footer) { footer.classList.remove("hidden"); footer.style.display="flex"; }
    if (total)  total.textContent = `Total: $${cartTotal().toFixed(2)}`;
  }

  $("clearCartBtn")?.addEventListener("click",()=>{ cart={}; renderCart(); renderCheckoutCart(); });
  $("goCheckoutBtn")?.addEventListener("click",()=>{ renderCheckoutCart(); showView("view-sales"); });

  // =============================================================
  //  MY ORDERS
  // =============================================================
  let _lastOrders = [];
  async function refreshOrderHistory() {
    setStatus("ordersStatus","Loading…","warn");
    try {
      const orders = await api("/api/orders/mine",{method:"GET"});
      _lastOrders = orders||[];
      renderOrderHistory(_lastOrders);
      clearStatus("ordersStatus");
    } catch(e) {
      setStatus("ordersStatus",`❌ Failed to load orders: ${errText(e)}`,"error");
    }
  }
  function renderOrderHistory(orders) {
    const filterVal = $("ordersStatusFilter")?.value||"all";
    const filtered  = filterVal==="all" ? orders : orders.filter(o=>o.status===filterVal);
    const totalSpent = orders.reduce((s,o)=>s+(o.total||0),0);
    const totalItems = orders.reduce((s,o)=>s+(o.items||[]).reduce((si,i)=>si+(i.quantity||0),0),0);
    const avgVal = orders.length ? totalSpent/orders.length : 0;
    const kpiGrid=$("ordersKpiGrid");
    if (kpiGrid) kpiGrid.style.display = orders.length?"":"none";
    const fmt=v=>`$${Number(v).toFixed(2)}`;
    [["kpi-order-count",orders.length],["kpi-order-spent",fmt(totalSpent)],
     ["kpi-order-items",totalItems],["kpi-order-avg",fmt(avgVal)]].forEach(([id,val])=>{
      const el=$(id); if(el) el.textContent=val;
    });
    const wrap=$("ordersListWrap"); if(!wrap) return;
    if (!filtered.length) {
      wrap.innerHTML=`<div class="dashEmpty" style="padding:40px;text-align:center;">
        ${orders.length?"No orders match the selected status.":"You haven't placed any orders yet."}</div>`;
      return;
    }
    const sc={Processing:"#fbbf24",Completed:"#34d399",Shipped:"#6ea8fe",Cancelled:"#fb7185"};
    wrap.innerHTML = filtered.map(order=>{
      const date=new Date(order.timestamp).toLocaleString();
      const color=sc[order.status]||"#a9b4cc";
      const rows=(order.items||[]).map(it=>`<tr>
        <td>${escHtml(it.title||"Unknown")}</td>
        <td style="text-align:center;">${it.quantity}</td>
        <td style="text-align:right;">$${Number(it.price_each).toFixed(2)}</td>
        <td style="text-align:right;font-weight:700;">$${(it.price_each*it.quantity).toFixed(2)}</td>
      </tr>`).join("");
      return `<div class="dashTableCard" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
          <span style="font-weight:700;font-size:14px;">Order #${order.id}</span>
          <span class="muted small">${date}</span>
          <span style="padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;
                       background:${color}22;color:${color};border:1px solid ${color}44;">${order.status}</span>
        </div>
        <table class="dashTable"><thead><tr><th>Book</th><th style="text-align:center;">Qty</th>
          <th style="text-align:right;">Unit Price</th><th style="text-align:right;">Line Total</th></tr></thead>
          <tbody>${rows}</tbody></table>
        <div style="text-align:right;padding-top:8px;font-size:13px;font-weight:700;">
          Order Total: $${Number(order.total).toFixed(2)}</div>
      </div>`;
    }).join("");
  }
  $("refreshOrdersBtn")?.addEventListener("click", refreshOrderHistory);
  $("ordersStatusFilter")?.addEventListener("change",()=>renderOrderHistory(_lastOrders));
  document.querySelectorAll(".navBtn").forEach(btn=>{
    if (btn.getAttribute("data-view")==="view-orders")
      btn.addEventListener("click", refreshOrderHistory);
  });

  // boot
  setAuthUI();
  refreshBooks();
})();