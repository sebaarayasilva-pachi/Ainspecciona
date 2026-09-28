(function () {
  const headers = {};
  try {
    const t = sessionStorage.getItem("platform_session");
    if (t) headers["x-platform-session"] = t;
  } catch (_) {}

  const menuBtn = document.getElementById("menuBtn");
  const backdrop = document.getElementById("backdrop");
  const content = document.getElementById("content");
  const navMain = document.getElementById("navMain");
  const navMods = document.getElementById("navMods");

  function closeNav() {
    document.body.classList.remove("nav-open");
    backdrop.hidden = true;
  }
  function openNav() {
    document.body.classList.add("nav-open");
    backdrop.hidden = false;
  }
  menuBtn.addEventListener("click", () => {
    if (document.body.classList.contains("nav-open")) closeNav();
    else openNav();
  });
  backdrop.addEventListener("click", closeNav);

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  let appContext = null;
  let orgMe = null;
  let ndaGateOpen = false;
  let entered = {};
  let currentRoute = parseRoute();

  function parseRoute() {
    const parts = location.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    const params = new URLSearchParams(location.search);
    const enter = String(params.get("enter") || "").toUpperCase();
    const page = parts[1] || "inicio";
    const item = parts[2] || "";
    return { page, item, enter };
  }

  function pathFor(page, item) {
    if (!page || page === "inicio") return "/app";
    return item ? "/app/" + page + "/" + item : "/app/" + page;
  }

  function go(page, item, replace) {
    const url = pathFor(page, item);
    if (replace) history.replaceState({}, "", url);
    else if (location.pathname !== url) history.pushState({}, "", url);
    currentRoute = { page, item: item || "", enter: "" };
    render();
  }

  window.addEventListener("popstate", () => {
    currentRoute = parseRoute();
    render();
  });

  async function showNdaGate() {
    ndaGateOpen = true;
    document.body.classList.add("nda-locked");
    const overlay = document.getElementById("ndaOverlay");
    overlay.classList.add("show");
    const body = document.getElementById("ndaBody");
    try {
      const res = await fetch("/app/nda-content.html", { credentials: "same-origin", cache: "no-store" });
      body.innerHTML = await res.text();
    } catch (_) {
      body.innerHTML = "<p>No se pudo cargar el texto del NDA. Recarga la página o contacta a soporte.</p>";
    }
    const check = document.getElementById("ndaCheck");
    const btn = document.getElementById("ndaAccept");
    check.checked = false;
    btn.disabled = true;
    check.onchange = () => { btn.disabled = !check.checked; };
    btn.onclick = acceptNda;
  }

  function hideNdaGate() {
    ndaGateOpen = false;
    document.body.classList.remove("nda-locked");
    document.getElementById("ndaOverlay").classList.remove("show");
  }

  async function acceptNda() {
    const errEl = document.getElementById("ndaErr");
    errEl.style.display = "none";
    const btn = document.getElementById("ndaAccept");
    btn.disabled = true;
    try {
      const res = await fetch("/api/auth/accept-nda", {
        method: "POST",
        credentials: "include",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "No se pudo registrar la aceptación");
      if (data.context) appContext = data.context;
      hideNdaGate();
      await loadOrg();
      render();
    } catch (ex) {
      errEl.textContent = ex.message;
      errEl.style.display = "block";
      btn.disabled = !document.getElementById("ndaCheck").checked;
    }
  }

  function moduleBySlug(slug) {
    return (orgMe && orgMe.modules || []).find((m) => m.slug === slug) || null;
  }

  function setChrome() {
    const ctx = appContext || {};
    document.getElementById("orgLine").textContent = ctx.organization
      ? ctx.organization.name
      : "Sin organización";
    const who = document.getElementById("who");
    who.innerHTML = "<strong>" + escapeHtml(ctx.user && ctx.user.fullName) + "</strong><span>" +
      escapeHtml(ctx.user && ctx.user.email) + "</span>";
    document.getElementById("controlLink").style.display = ctx.user && ctx.user.isPlatformAdmin ? "flex" : "none";
  }

  function renderNav() {
    const page = currentRoute.page;
    const item = currentRoute.item;
    navMain.innerHTML = "";
    [
      { page: "inicio", label: "Dashboard" },
      { page: "usuarios", label: "Usuarios" },
      { page: "configuracion", label: "Configuración" }
    ].forEach((n) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-item" + (page === n.page || (n.page === "inicio" && page === "modulos") ? " active" : "");
      btn.innerHTML = '<span class="dot"></span>' + n.label;
      btn.addEventListener("click", () => {
        if (ndaGateOpen) return;
        closeNav();
        go(n.page);
      });
      navMain.appendChild(btn);
    });

    const modules = (orgMe && orgMe.modules) || [];
    navMods.innerHTML = "";
    if (!modules.length) {
      navMods.innerHTML = '<p class="empty">No hay módulos en el catálogo.</p>';
      return;
    }
    modules.forEach((mod) => {
      const block = document.createElement("div");
      const open = page === mod.slug;
      block.className = "mod-block" + (open ? " open" : "");
      const head = document.createElement("button");
      head.type = "button";
      head.className = "nav-item" + (open ? " active" : "");
      head.innerHTML = '<span class="dot"></span>' + escapeHtml(mod.label) + '<span class="chev">▸</span>';
      head.addEventListener("click", () => {
        if (ndaGateOpen) return;
        if (mod.state === "activo") {
          const first = (mod.items && mod.items[0]) || { key: "" };
          closeNav();
          go(mod.slug, first.key);
        } else {
          const was = block.classList.contains("open");
          navMods.querySelectorAll(".mod-block").forEach((el) => el.classList.remove("open"));
          if (!was) block.classList.add("open");
        }
      });
      block.appendChild(head);

      if (mod.state === "activo" && mod.items && mod.items.length) {
        const list = document.createElement("div");
        list.className = "mod-items";
        mod.items.forEach((it) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "mod-item" + (open && item === it.key ? " active" : "");
          b.textContent = it.label;
          b.addEventListener("click", () => {
            if (ndaGateOpen) return;
            closeNav();
            go(mod.slug, it.key);
          });
          list.appendChild(b);
        });
        block.appendChild(list);
      } else if (mod.state === "contratado") {
        const note = document.createElement("p");
        note.className = "mod-note";
        note.textContent = "Contratado. Tu usuario aún no tiene acceso. Pide a un admin que te invite de nuevo.";
        block.appendChild(note);
      } else {
        const ask = document.createElement("div");
        ask.className = "mod-ask";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Solicitar";
        btn.addEventListener("click", () => requestProduct(mod, btn));
        ask.appendChild(btn);
        block.appendChild(ask);
      }
      navMods.appendChild(block);
    });
  }

  async function requestProduct(mod, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/org/request-product", {
        method: "POST",
        credentials: "include",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ product: mod.code })
      });
      const data = await res.json();
      alert(data.message || "Solicitud enviada.");
    } catch (ex) {
      alert(ex.message || "No se pudo enviar la solicitud.");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  let dashByAgentChart = null;
  let dashStarsChart = null;
  let dashDays = 30;

  function destroyDashCharts() {
    if (dashByAgentChart) {
      dashByAgentChart.destroy();
      dashByAgentChart = null;
    }
    if (dashStarsChart) {
      dashStarsChart.destroy();
      dashStarsChart = null;
    }
  }

  function scoreModule() {
    return ((orgMe && orgMe.modules) || []).find((m) => m.code === "INSPECTION") || null;
  }

  async function ensureInspectionSession() {
    if (entered.INSPECTION && entered.INSPECTION.token) return entered.INSPECTION;
    const res = await fetch("/api/auth/enter-product", {
      method: "POST",
      credentials: "include",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ product: "INSPECTION" })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || "No se pudo abrir Inspección Score.");
    if (data.token) {
      try { localStorage.setItem("tenant_session", data.token); } catch (_) {}
    }
    entered.INSPECTION = data;
    return data;
  }

  function tenantHeaders() {
    const h = { ...headers };
    try {
      const t = localStorage.getItem("tenant_session");
      if (t) h.Authorization = "Bearer " + t;
    } catch (_) {}
    return h;
  }

  function renderHome() {
    content.className = "content";
    const orgName = (appContext && appContext.organization && appContext.organization.name) || "tu organización";
    const score = scoreModule();
    destroyDashCharts();

    if (!score || score.state !== "activo") {
      content.innerHTML =
        "<div class=\"dash-head\"><div><h1>Dashboard</h1><p class=\"lead\">" +
        escapeHtml(orgName) + ". El dashboard vive aquí, en la casa de la plataforma.</p></div></div>" +
        "<p class=\"empty\">Inspección Score no está activo para tu usuario. Actívalo o pídelo en Módulos para ver KPIs y gráficos.</p>" +
        (score && score.state === "disponible"
          ? "<p style=\"margin-top:12px\"><button type=\"button\" class=\"btn\" id=\"askScore\">Solicitar Inspección Score</button></p>"
          : "");
      const ask = document.getElementById("askScore");
      if (ask && score) ask.addEventListener("click", () => requestProduct(score, ask));
      return;
    }

    content.innerHTML =
      "<div class=\"dash-head\">" +
        "<div><h1>Dashboard</h1><p class=\"lead\">KPIs de gestión de inspecciones de " + escapeHtml(orgName) + ".</p></div>" +
        "<div class=\"dash-toolbar\">" +
          "<label class=\"muted\" for=\"dashDaysSelect\">Periodo</label>" +
          "<select id=\"dashDaysSelect\">" +
            "<option value=\"7\"" + (dashDays === 7 ? " selected" : "") + ">Últimos 7 días</option>" +
            "<option value=\"30\"" + (dashDays === 30 ? " selected" : "") + ">Últimos 30 días</option>" +
            "<option value=\"60\"" + (dashDays === 60 ? " selected" : "") + ">Últimos 60 días</option>" +
            "<option value=\"90\"" + (dashDays === 90 ? " selected" : "") + ">Últimos 90 días</option>" +
          "</select>" +
          "<button type=\"button\" class=\"btn ghost\" id=\"dashRefreshBtn\">Actualizar</button>" +
          "<span class=\"muted\" id=\"dashStatus\">Cargando…</span>" +
        "</div>" +
      "</div>" +
      "<div class=\"kpi-grid\">" +
        "<div class=\"kpi-card\"><div class=\"label\">Inspecciones</div><div class=\"value\" id=\"kpiTotal\">—</div><div class=\"hint\" id=\"kpiTotalHint\">en el periodo</div></div>" +
        "<div class=\"kpi-card\"><div class=\"label\">Completadas</div><div class=\"value\" id=\"kpiDone\">—</div><div class=\"hint\">DONE</div></div>" +
        "<div class=\"kpi-card\"><div class=\"label\">Pend. aprobación</div><div class=\"value\" id=\"kpiPending\">—</div><div class=\"hint\">esperando admin</div></div>" +
        "<div class=\"kpi-card\"><div class=\"label\">Score promedio</div><div class=\"value\" id=\"kpiAvgScore\">—</div><div class=\"hint\" id=\"kpiAvgHint\">casos con score</div></div>" +
        "<div class=\"kpi-card\"><div class=\"label\">En curso</div><div class=\"value\" id=\"kpiInProgress\">—</div><div class=\"hint\">captura activa</div></div>" +
        "<div class=\"kpi-card\"><div class=\"label\">Badge verde</div><div class=\"value\" id=\"kpiGreen\">—</div><div class=\"hint\">score alto</div></div>" +
        "<div class=\"kpi-card\"><div class=\"label\">Badge amarillo</div><div class=\"value\" id=\"kpiYellow\">—</div><div class=\"hint\">score medio</div></div>" +
        "<div class=\"kpi-card\"><div class=\"label\">Créditos</div><div class=\"value\" id=\"kpiCredits\">—</div><div class=\"hint\">saldo actual</div></div>" +
      "</div>" +
      "<div class=\"dash-charts\">" +
        "<article class=\"card\"><h2>Inspecciones por agente</h2><p>Todos los agentes de la corredora (incluye quienes van en cero).</p>" +
          "<div style=\"position:relative;height:340px\"><canvas id=\"dashByAgentChart\"></canvas></div>" +
          "<p class=\"muted\" id=\"dashByAgentErr\"></p></article>" +
        "<article class=\"card\"><h2>Distribución por estrellas</h2><p>Percentil por estrella: % de inspecciones con score en 1★ a 5★.</p>" +
          "<div style=\"position:relative;height:280px\"><canvas id=\"dashStarsChart\"></canvas></div>" +
          "<div class=\"percentile-row\" id=\"dashPercentiles\"></div>" +
          "<p class=\"muted\" id=\"dashStarsErr\"></p></article>" +
      "</div>";

    document.getElementById("dashRefreshBtn").addEventListener("click", () => loadScoreDashboard());
    document.getElementById("dashDaysSelect").addEventListener("change", (ev) => {
      dashDays = parseInt(ev.target.value, 10) || 30;
      loadScoreDashboard();
    });
    loadScoreDashboard();
  }

  function setKpi(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null || value === "" ? "—" : String(value);
  }

  function paintAgentChart(d) {
    const agents = d.byAgent || [];
    const unassigned = (d.unassigned && d.unassigned.total) || 0;
    const err = document.getElementById("dashByAgentErr");
    const ctx = document.getElementById("dashByAgentChart");
    if (dashByAgentChart) {
      dashByAgentChart.destroy();
      dashByAgentChart = null;
    }
    if (!agents.length && !unassigned) {
      if (err) err.textContent = "No hay agentes en la corredora.";
      return;
    }
    if (!ctx || !window.Chart) return;
    if (err) err.textContent = "";
    const labels = agents.map((a) => {
      const n = String(a.fullName || "—");
      return n.length > 22 ? n.slice(0, 20) + "…" : n;
    });
    const totals = agents.map((a) => a.total || 0);
    const dones = agents.map((a) => (a.byStatus && a.byStatus.DONE) || 0);
    if (unassigned > 0) {
      labels.push("Sin asignar");
      totals.push(unassigned);
      dones.push((d.unassigned && d.unassigned.byStatus && d.unassigned.byStatus.DONE) || 0);
    }
    if (ctx.parentElement) ctx.parentElement.style.height = Math.max(240, labels.length * 32) + "px";
    dashByAgentChart = new window.Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Total", data: totals, backgroundColor: "rgba(43,182,115,0.75)", borderColor: "#2bb673", borderWidth: 1, borderRadius: 4 },
          { label: "Completadas", data: dones, backgroundColor: "rgba(96,165,250,0.65)", borderColor: "#60a5fa", borderWidth: 1, borderRadius: 4 }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#8b9aab" } } },
        scales: {
          x: { beginAtZero: true, ticks: { color: "#8b9aab", precision: 0 }, grid: { color: "rgba(255,255,255,0.06)" } },
          y: { ticks: { color: "#d5dde6" }, grid: { display: false } }
        }
      }
    });
  }

  function paintStarsChart(d) {
    const stars = (d.scoreDistribution && d.scoreDistribution.stars) || (d.kpis && d.kpis.byStars) || {};
    const err = document.getElementById("dashStarsErr");
    const ctx = document.getElementById("dashStarsChart");
    if (dashStarsChart) {
      dashStarsChart.destroy();
      dashStarsChart = null;
    }
    const counts = [1, 2, 3, 4, 5].map((s) => Number(stars[s] || 0));
    const total = counts.reduce((a, b) => a + b, 0);
    const pcts = counts.map((c) => (total ? Math.round((c / total) * 1000) / 10 : 0));
    const pctEl = document.getElementById("dashPercentiles");
    if (!total) {
      if (err) err.textContent = "Aún no hay casos con score en este periodo.";
      if (pctEl) pctEl.innerHTML = "";
      return;
    }
    if (err) err.textContent = "";
    if (pctEl) {
      pctEl.innerHTML = [1, 2, 3, 4, 5].map((s, i) =>
        "<span class=\"percentile-pill\">" + s + "★: " + pcts[i] + "% <span style=\"opacity:.7\">(" + counts[i] + ")</span></span>"
      ).join("");
    }
    if (!ctx || !window.Chart) return;
    dashStarsChart = new window.Chart(ctx, {
      type: "bar",
      data: {
        labels: ["1 ★", "2 ★", "3 ★", "4 ★", "5 ★"],
        datasets: [{
          label: "% inspecciones",
          data: pcts,
          backgroundColor: [
            "rgba(240,113,120,0.75)",
            "rgba(249,115,22,0.75)",
            "rgba(240,180,41,0.75)",
            "rgba(132,204,22,0.75)",
            "rgba(43,182,115,0.85)"
          ],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(item) {
                const i = item.dataIndex;
                return pcts[i] + "% (" + counts[i] + " insp.)";
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: "#d5dde6" }, grid: { display: false } },
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { color: "#8b9aab", callback(v) { return v + "%"; } },
            grid: { color: "rgba(255,255,255,0.06)" }
          }
        }
      }
    });
  }

  async function loadScoreDashboard() {
    const status = document.getElementById("dashStatus");
    if (status) status.textContent = "Cargando…";
    try {
      await ensureInspectionSession();
      const res = await fetch("/api/tenant/analytics/dashboard?days=" + dashDays, {
        credentials: "include",
        headers: tenantHeaders()
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.message || d.error || "No se pudo cargar el dashboard.");
      if (status) status.textContent = "Últimos " + dashDays + " días";
      const k = d.kpis || {};
      setKpi("kpiTotal", k.total ?? 0);
      setKpi("kpiDone", k.done ?? 0);
      setKpi("kpiPending", k.pendingApproval ?? 0);
      setKpi("kpiInProgress", k.inProgress ?? 0);
      setKpi("kpiAvgScore", k.avgScore != null ? k.avgScore : "—");
      setKpi("kpiGreen", (k.byBadge && k.byBadge.GREEN) || 0);
      setKpi("kpiYellow", (k.byBadge && k.byBadge.YELLOW) || 0);
      setKpi("kpiCredits", k.creditsBalance ?? 0);
      const avgHint = document.getElementById("kpiAvgHint");
      if (avgHint) avgHint.textContent = (k.scoredCount || 0) + " con score";
      paintAgentChart(d);
      paintStarsChart(d);
    } catch (ex) {
      if (status) status.textContent = ex.message || "Error de conexión.";
    }
  }

  function renderUsers() {
    content.className = "content";
    const can = orgMe && orgMe.canManageUsers;
    content.innerHTML = "<h1>Usuarios</h1><p class=\"lead\">Un equipo para toda la organización. Al invitar, se habilita en los módulos contratados.</p>" +
      (can
        ? "<form class=\"form\" id=\"inviteForm\">" +
          "<label>Nombre<input name=\"fullName\" required autocomplete=\"name\" /></label>" +
          "<label>Email<input name=\"email\" type=\"email\" required autocomplete=\"off\" /></label>" +
          "<label>Contraseña temporal<input name=\"password\" type=\"password\" required minlength=\"8\" autocomplete=\"new-password\" /></label>" +
          "<label>Rol<select name=\"role\"><option value=\"MEMBER\">Miembro</option><option value=\"ORGANIZATION_ADMIN\">Administrador</option></select></label>" +
          "<button class=\"btn\" type=\"submit\">Invitar</button></form>"
        : "<p class=\"empty\">Solo un administrador puede invitar. Puedes ver tu propia cuenta en Configuración.</p>") +
      "<div id=\"membersWrap\" style=\"margin-top:22px\"><p class=\"lead\">Cargando equipo…</p></div>" +
      "<p class=\"err\" id=\"err\" style=\"display:none\"></p>";

    if (can) {
      document.getElementById("inviteForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const err = document.getElementById("err");
        err.style.display = "none";
        const fd = new FormData(ev.target);
        try {
          const res = await fetch("/api/org/members", {
            method: "POST",
            credentials: "include",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              fullName: String(fd.get("fullName") || ""),
              email: String(fd.get("email") || ""),
              password: String(fd.get("password") || ""),
              role: String(fd.get("role") || "MEMBER")
            })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.message || "No se pudo invitar");
          ev.target.reset();
          await loadMembers();
          alert(data.message || "Usuario agregado.");
        } catch (ex) {
          err.textContent = ex.message;
          err.style.display = "block";
        }
      });
      loadMembers();
    } else {
      document.getElementById("membersWrap").innerHTML = "";
    }
  }

  async function loadMembers() {
    const wrap = document.getElementById("membersWrap");
    if (!wrap) return;
    try {
      const res = await fetch("/api/org/members", { credentials: "include", headers });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "No se pudo cargar el equipo");
      if (!data.members.length) {
        wrap.innerHTML = "<p class=\"empty\">Aún no hay miembros.</p>";
        return;
      }
      const roleLabel = { ORGANIZATION_ADMIN: "Admin", MEMBER: "Miembro", VIEWER: "Lectura" };
      wrap.innerHTML = "<div class=\"table-wrap\"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Módulos</th></tr></thead><tbody>" +
        data.members.map((m) => {
          const prods = (m.user.products || []).join(", ") || "—";
          return "<tr><td>" + escapeHtml(m.user.fullName) + "</td><td>" + escapeHtml(m.user.email) +
            "</td><td>" + escapeHtml(roleLabel[m.role] || m.role) + "</td><td>" + escapeHtml(prods) + "</td></tr>";
        }).join("") +
        "</tbody></table></div>";
    } catch (ex) {
      wrap.innerHTML = "<p class=\"err\">" + escapeHtml(ex.message) + "</p>";
    }
  }

  function renderConfig() {
    content.className = "content";
    const org = (orgMe && orgMe.organization) || {};
    const can = orgMe && orgMe.canManageUsers;
    const modules = (orgMe && orgMe.modules) || [];
    content.innerHTML = "<h1>Configuración</h1><p class=\"lead\">Datos de la organización. Los módulos los habilita Control Ainspecciona.</p>" +
      "<form class=\"form\" id=\"orgForm\">" +
      "<label>Nombre de la organización<input name=\"name\" value=\"" + escapeHtml(org.name || "") + "\" " + (can ? "required" : "disabled") + " /></label>" +
      (can ? "<button class=\"btn\" type=\"submit\">Guardar</button>" : "") +
      "</form>" +
      "<h2 style=\"margin:28px 0 12px;font-size:1.1rem\">Módulos</h2><div class=\"cards\">" +
      modules.map((m) => {
        const st = m.state === "activo" ? "Activo" : m.state === "contratado" ? "Contratado" : "Disponible";
        const cls = m.state === "activo" ? "" : m.state === "contratado" ? " warn" : " muted";
        const action = m.state === "disponible"
          ? "<button type=\"button\" class=\"btn ghost\" data-ask=\"" + escapeHtml(m.code) + "\">Solicitar</button>"
          : "";
        return "<article class=\"card\"><span class=\"state" + cls + "\">" + st + "</span><h2>" +
          escapeHtml(m.label) + "</h2>" + action + "</article>";
      }).join("") +
      "</div><p class=\"err\" id=\"err\" style=\"display:none\"></p>";

    if (can) {
      document.getElementById("orgForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const err = document.getElementById("err");
        err.style.display = "none";
        const name = String(new FormData(ev.target).get("name") || "").trim();
        try {
          const res = await fetch("/api/org/profile", {
            method: "PATCH",
            credentials: "include",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ name })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.message || "No se pudo guardar");
          if (appContext && appContext.organization) appContext.organization.name = data.organization.name;
          if (orgMe && orgMe.organization) orgMe.organization.name = data.organization.name;
          setChrome();
        } catch (ex) {
          err.textContent = ex.message;
          err.style.display = "block";
        }
      });
    }
    content.querySelectorAll("[data-ask]").forEach((el) => {
      el.addEventListener("click", () => {
        const mod = ((orgMe && orgMe.modules) || []).find((m) => m.code === el.getAttribute("data-ask"));
        if (mod) requestProduct(mod, el);
      });
    });
  }

  async function enterAndEmbed(mod, item) {
    content.className = "content workspace";
    content.innerHTML = "<div class=\"workspace-status\" id=\"wsStatus\">Abriendo " + escapeHtml(mod.label) + "…</div>" +
      "<iframe class=\"workspace-frame\" id=\"wsFrame\" title=\"" + escapeHtml(mod.label) + "\"></iframe>";
    const status = document.getElementById("wsStatus");
    const frame = document.getElementById("wsFrame");
    try {
      let pack = entered[mod.code];
      if (!pack) {
        const res = await fetch("/api/auth/enter-product", {
          method: "POST",
          credentials: "include",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ product: mod.code })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || "No se pudo abrir el módulo");
        if (data.storageKey && data.token) {
          try {
            if (data.storage === "local") localStorage.setItem(data.storageKey, data.token);
            else sessionStorage.setItem(data.storageKey, data.token);
          } catch (_) {}
        }
        pack = data;
        entered[mod.code] = pack;
      }
      const chosen = (mod.items || []).find((it) => it.key === item) || (mod.items || [])[0];
      let href = pack.embedHref || "/app";
      if (chosen) {
        const u = new URL(chosen.href, location.origin);
        u.searchParams.set("embed", "1");
        if (mod.code === "INSPECTION" && pack.token) u.searchParams.set("t", pack.token);
        href = u.pathname + u.search + (chosen.hash ? "#" + chosen.hash : "");
      }
      status.textContent = mod.label + (chosen ? " · " + chosen.label : "");
      frame.src = href;
    } catch (ex) {
      status.textContent = ex.message;
    }
  }

  function render() {
    setChrome();
    renderNav();
    const page = currentRoute.page;
    if (page === "usuarios") return renderUsers();
    if (page === "configuracion") return renderConfig();
    if (page === "inicio" || page === "modulos" || !page) return renderHome();
    const mod = moduleBySlug(page);
    if (!mod) return renderHome();
    if (mod.state !== "activo") return renderHome();
    enterAndEmbed(mod, currentRoute.item);
  }

  async function loadOrg() {
    const res = await fetch("/api/org/me", { credentials: "include", headers });
    if (res.status === 401) {
      location.href = "/?login=1&next=" + encodeURIComponent(location.pathname + location.search);
      return;
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "No se pudo cargar la organización");
    orgMe = data;
  }

  async function load() {
    const res = await fetch("/api/auth/me", { credentials: "include", headers });
    if (res.status === 401) {
      location.href = "/?login=1&next=" + encodeURIComponent(location.pathname + location.search);
      return;
    }
    const data = await res.json();
    if (!data.ok) throw new Error("No se pudo cargar la sesión");
    const ctx = data.context;
    appContext = ctx;
    if (ctx && ctx.token) {
      try { sessionStorage.setItem("platform_session", ctx.token); } catch (_) {}
      headers["x-platform-session"] = ctx.token;
    }
    if (ctx.nda && ctx.nda.required && !ctx.nda.accepted) {
      setChrome();
      await showNdaGate();
      return;
    }
    await loadOrg();
    if (currentRoute.enter) {
      const match = ((orgMe && orgMe.modules) || []).find((m) => m.code === currentRoute.enter);
      if (match) {
        go(match.slug, (match.items[0] && match.items[0].key) || "", true);
        return;
      }
    }
    render();
  }

  document.getElementById("logout").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include", headers });
    try {
      sessionStorage.removeItem("platform_session");
      sessionStorage.removeItem("entrega_session");
      sessionStorage.removeItem("postventa_session");
      sessionStorage.removeItem("inout_session");
      localStorage.removeItem("tenant_session");
      localStorage.removeItem("tenant_id");
    } catch (_) {}
    location.href = "/?login=1";
  });

  load().catch((ex) => {
    content.className = "content";
    content.innerHTML = "<h1>Dashboard</h1><p class=\"err\">" + escapeHtml(ex.message) + "</p>";
  });
})();
