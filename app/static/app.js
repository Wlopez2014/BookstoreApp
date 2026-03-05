(function(){
  const $ = (id) => document.getElementById(id);

  const consoleEl = $("console");
  const authStatus = $("authStatus");
  const publisherOut = $("publisherOut");

  let token = sessionStorage.getItem("token") || "";
  let role = sessionStorage.getItem("role") || "";
  let username = sessionStorage.getItem("username") || "";

  // Chart.js instance — kept so we can destroy/recreate on refresh
  let revenueChart = null;

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

    // Destroy old chart before creating new one
    if (revenueChart) {
      revenueChart.destroy();
      revenueChart = null;
    }

    const canvas = $("revenueChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    // Empty-state: show a helpful placeholder
    if (!series.length){
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#a9b4cc";
      ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No time-series data for the selected period.", canvas.width / 2, canvas.height / 2);
      return;
    }

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
            borderRadius: 4,
            order: 2
          },
          {
            label: "Online Orders",
            data: ordData,
            backgroundColor: "rgba(167,139,250,0.7)",
            borderColor: "#a78bfa",
            borderWidth: 1,
            borderRadius: 4,
            order: 2
          },
          {
            label: "Total",
            data: totData,
            type: "line",
            borderColor: "#34d399",
            backgroundColor: "rgba(52,211,153,0.08)",
            borderWidth: 2,
            pointBackgroundColor: "#34d399",
            pointRadius: series.length > 1 ? 4 : 0,
            pointHoverRadius: 4,
            tension: 0.3,
            fill: false,
            order: 1
          }
        ]
      },
      options: {
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
            stacked: false,
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
      }
    });
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

  // boot
  setAuthUI();
  refreshBooks();
})();
