/* Ainspecciona Recepción — prototipo. Helpers compartidos, sidebar y gráficos. */
(function () {
  "use strict";

  const THEME_KEY = "entrega-theme";
  const NF = new Intl.NumberFormat("es-CL");
  const STATE_COLORS = {
    lista: "#22C55E",
    pendiente_menor: "#FACC15",
    pendiente_intermedio: "#F97316",
    critico: "#EF4444",
    no_inspeccionado: "#64748B",
  };

  function getTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark") return t;
    } catch (_) {}
    return "dark";
  }

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) return v;
    } catch (_) {}
    return fallback;
  }

  function chartPalette() {
    return {
      grid: cssVar("--chart-grid", "#243044"),
      tick: cssVar("--chart-tick", "#94A3B8"),
      ink: cssVar("--plan-ink", "#E8EDF7"),
      muted: cssVar("--plan-muted", "#CBD5E1"),
      track: cssVar("--border", "#2A3347"),
      surface2: cssVar("--surface-2", "#1A2234"),
    };
  }

  function applyChartTheme() {
    if (!window.Chart) return;
    const p = chartPalette();
    Chart.defaults.color = p.tick;
  }

  function applyTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch (_) {}
    applyChartTheme();
    document.querySelectorAll("[data-theme-btn]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-theme-btn") === t ? "true" : "false");
    });
  }

  function initTheme() {
    applyTheme(getTheme());
  }

  initTheme();
  const STATE_LABELS = {
    lista: "Lista",
    pendiente_menor: "Pendiente menor",
    pendiente_intermedio: "Pendiente intermedio",
    critico: "Crítico",
    no_inspeccionado: "No inspeccionado",
  };

  const ICONS = {
    overview: '<path d="M3 13h8V3H3zM13 21h8V8h-8zM13 3v3h8V3zM3 21h8v-5H3z"/>',
    proyecto: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/>',
    unidades: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    pisos: '<path d="M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z"/>',
    kpi: '<path d="M3 3v18h18"/><path d="M7 14l3-4 4 3 5-7"/>',
    ot: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13l2 2 4-4"/>',
    reportes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/>',
    captura: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    usuarios: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  };

  const ENTREGA_BASE = "/entrega";
  const ENTREGA_LOGIN = "/entrega/login";

  /** Reescribe rutas relativas a /entrega. */
  function appHref(path) {
    let p = String(path || "");
    if (!p || p.startsWith("#") || p.startsWith("/api/") || p.startsWith("http")) return p;
    if (p.startsWith("/entrega")) return p;
    if (p.startsWith("/")) return ENTREGA_BASE + p;
    return ENTREGA_BASE + "/" + p;
  }

  const NAV = [
    { key: "proyecto", label: "Proyecto", icon: "proyecto", href: "/entrega/proyecto" },
    { key: "pisos", label: "Pisos", icon: "pisos", href: "/entrega/piso" },
    { key: "unidades", label: "Unidades", icon: "unidades", href: "/entrega/unidad" },
    { key: "ot", label: "Órdenes de Trabajo", icon: "ot", href: "/entrega/ot" },
    { key: "reportes", label: "Reportes", icon: "reportes", href: "/entrega/reportes" },
    { key: "usuarios", label: "Usuarios", icon: "usuarios", href: "/entrega/usuarios", adminOnly: true },
  ];

  let ENTREGA_PROJECT_ID = "cuvee-2";

  let SEED = null;
  let KPI_CATALOG = null;

  async function loadKpiCatalog(seedFallback) {
    if (KPI_CATALOG) return KPI_CATALOG;
    try {
      const res = await entregaFetch("/api/entrega/public/kpi-catalog");
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && Array.isArray(data.kpis) && data.kpis.length) {
          KPI_CATALOG = data;
          return KPI_CATALOG;
        }
      }
    } catch {
      /* fallback seed */
    }
    const kpis = (seedFallback && seedFallback.kpis) || [];
    const catalogoEspecialidades = (seedFallback && seedFallback.catalogoEspecialidades) || {};
    const kpiLookup = kpis.reduce((acc, k) => {
      acc[k.toLowerCase()] = k;
      return acc;
    }, {});
    const especialidadToKpi = Object.entries(catalogoEspecialidades).reduce((acc, [kpi, list]) => {
      (list || []).forEach((esp) => {
        acc[esp] = kpi;
        acc[esp.toLowerCase()] = kpi;
      });
      return acc;
    }, {});
    KPI_CATALOG = {
      ok: true,
      kpis,
      catalogoEspecialidades,
      kpiLookup,
      especialidadToKpi,
      source: "seed",
      approvedCount: 0,
    };
    return KPI_CATALOG;
  }

  let ME = null;
  const ENTREGA_TOKEN_KEY = "entrega_session";

  function getStoredToken() {
    try {
      return sessionStorage.getItem(ENTREGA_TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setStoredToken(token) {
    try {
      if (token) sessionStorage.setItem(ENTREGA_TOKEN_KEY, token);
      else sessionStorage.removeItem(ENTREGA_TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  /** fetch a APIs Entrega: cookie + header (Firebase Hosting strippea cookies que no sean __session). */
  function entregaFetch(url, opts) {
    opts = opts || {};
    const headers = new Headers(opts.headers || {});
    const token = getStoredToken();
    if (token) headers.set("x-entrega-session", token);
    return fetch(url, {
      ...opts,
      credentials: "same-origin",
      cache: opts.cache || "no-store",
      headers
    });
  }

  async function ensureAuth() {
    if (ME) return ME;
    if (location.pathname === "/entrega/login") return null;
    try {
      const res = await entregaFetch("/api/entrega/me");
      if (res.status === 401) {
        setStoredToken("");
        const next = encodeURIComponent(location.pathname + location.search);
        location.replace(ENTREGA_LOGIN + "?next=" + next);
        return null;
      }
      const data = await res.json();
      if (!data || !data.ok) {
        location.replace(ENTREGA_LOGIN);
        return null;
      }
      ME = data;
      return ME;
    } catch {
      location.replace(ENTREGA_LOGIN);
      return null;
    }
  }

  async function loadSeed() {
    if (SEED) return SEED;
    await ensureAuth();
    const tenantSlug = (ME && ME.tenant && ME.tenant.slug) || "";
    const seedUrl =
      tenantSlug === "plaenge-demo"
        ? "/entrega/data/plaenge-ii.json"
        : "/entrega/data/seed.json";
    const res = await fetch(seedUrl, { credentials: "same-origin", cache: "no-store" });
    SEED = await res.json();
    if (ME && ME.tenant && ME.tenant.name) {
      SEED.tenant = SEED.tenant || {};
      SEED.tenant.name = ME.tenant.name;
      SEED.tenant.slug = ME.tenant.slug || SEED.tenant.slug;
    }
    const firstId = SEED.projects && SEED.projects[0] && SEED.projects[0].id;
    if (firstId) ENTREGA_PROJECT_ID = firstId;
    return SEED;
  }

  async function logout() {
    try {
      await entregaFetch("/api/entrega/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setStoredToken("");
    location.replace("/entrega/login");
  }

  function qs(name, def) {
    const v = new URLSearchParams(location.search).get(name);
    return v == null ? def : v;
  }

  function currentProjectId() {
    return ENTREGA_PROJECT_ID;
  }

  function setProject(id) {
    localStorage.setItem("entrega.project", ENTREGA_PROJECT_ID);
  }

  function entregaProjects(seed) {
    const all = (seed && seed.projects) || [];
    const active = all.filter((p) => p.id === ENTREGA_PROJECT_ID);
    return active.length ? active : all.slice(0, 1);
  }

  function getProject(seed, id) {
    const list = entregaProjects(seed);
    return list.find((p) => p.id === ENTREGA_PROJECT_ID) || list[0] || null;
  }

  function fmt(n) {
    return NF.format(n);
  }

  function svgIcon(name) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || "") +
      "</svg>"
    );
  }

  function renderSidebar(activeKey, project, seed) {
    const comp = project.composition || {};
    const isAdmin = ME && ME.user && ME.user.role === "ADMIN";
    const navHtml = NAV.filter((n) => !n.adminOnly || isAdmin)
      .map(
        (n) =>
          `<a href="${withProject(n.href, project.id)}" class="${n.key === activeKey ? "active" : ""}">${svgIcon(n.icon)}<span>${n.label}</span></a>`
      )
      .join("");
    return `
      <aside class="sidebar">
        <div class="brand">
          <img class="brand-logo" src="/assets/Logo%20Ainspecciona.png" alt="Ainspecciona" />
          <span class="brand-pill">Recepción</span>
        </div>
        <nav class="nav">${navHtml}</nav>
        <div class="project-card">
          <div class="pc-title">${project.name}</div>
          <div class="pc-row"><span>Locales</span><b>${comp.locales ?? 0}</b></div>
          <div class="pc-row"><span>Oficinas</span><b>${comp.oficinas ?? 0}</b></div>
          <div class="pc-row"><span>Departamentos</span><b>${comp.departamentos ?? 0}</b></div>
          <div class="pc-row"><span>Estacionamientos</span><b>${comp.estacionamientos ?? 0}</b></div>
          <div class="pc-row"><span>Bodegas</span><b>${comp.bodegas ?? 0}</b></div>
        </div>
        <div class="theme-toggle" aria-label="Tema">
          <span>Tema</span>
          <span style="display:flex;gap:6px">
            <button type="button" data-theme-btn="dark" aria-pressed="${getTheme() === "dark" ? "true" : "false"}">Dark</button>
            <button type="button" data-theme-btn="light" aria-pressed="${getTheme() === "light" ? "true" : "false"}">Light</button>
          </span>
        </div>
        <div class="user-chip">
          <div class="avatar">${escapeHtml(initialsFromName((ME && ME.user && ME.user.fullName) || "U"))}</div>
          <div>
            <div class="u-name">${escapeHtml((ME && ME.user && ME.user.fullName) || "Usuario")}</div>
            <div class="u-mail">${escapeHtml((ME && ME.tenant && ME.tenant.name) || (ME && ME.user && ME.user.email) || "")}</div>
            <button type="button" class="u-logout" id="entregaLogoutBtn">Cerrar sesión</button>
          </div>
        </div>
      </aside>`;
  }

  function initialsFromName(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  document.addEventListener("click", (e) => {
    const themeBtn = e.target && e.target.closest && e.target.closest("[data-theme-btn]");
    if (themeBtn) {
      e.preventDefault();
      applyTheme(themeBtn.getAttribute("data-theme-btn"));
      location.reload();
      return;
    }
    const btn = e.target && e.target.closest && e.target.closest("#entregaLogoutBtn");
    if (btn) {
      e.preventDefault();
      logout();
    }
  });

  function withProject(href, pid) {
    const resolved = appHref(href);
    if (resolved.startsWith("#") || resolved.includes("#")) {
      const [base, hash] = resolved.split("#");
      return `${base}?p=${pid}${hash ? "#" + hash : ""}`;
    }
    return `${resolved}?p=${pid}`;
  }

  function projectSelector(seed, project) {
    const p = project || getProject(seed, ENTREGA_PROJECT_ID);
    if (!p) return "";
    const label = `${p.building || ""} / ${p.name || ENTREGA_PROJECT_ID}`.replace(/^\s*\/\s*/, "");
    return `<div class="project-chip" title="Proyecto activo">${escapeHtml(label)}</div>`;
  }

  function bindProjectSelector() {
    /* Proyecto único: sin selector interactivo */
  }

  function dateChip(project) {
    return `<div class="date-chip">📅 Hoy</div>`;
  }

  /* ---------- Charts ---------- */
  function ensureChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = "Inter, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.display = false;
    applyChartTheme();
  }

  function donutChart(canvas, items, opts) {
    opts = opts || {};
    return new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: items.map((i) => i.label),
        datasets: [{ data: items.map((i) => i.value), backgroundColor: items.map((i) => i.color || "#6366F1"), borderWidth: 0 }],
      },
      options: {
        cutout: opts.cutout || "70%",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
      },
    });
  }

  function titleCaseEspecialidad(label) {
    const s = String(label || "").trim();
    if (!s) return s;
    const small = new Set(["de", "y", "la", "el", "los", "las", "del", "en", "a"]);
    return s
      .toLowerCase()
      .split(/\s+/)
      .map((w, i) => {
        if (i > 0 && small.has(w)) return w;
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(" ");
  }

  function displayEspecialidadLabel(raw, catalog) {
    const known = normalizeEspecialidadLabel(raw, catalog);
    if (known) return known;
    return titleCaseEspecialidad(raw);
  }

  function barChart(canvas, items, opts) {
    opts = opts || {};
    const horizontal = !!opts.horizontal;
    const labels = (items || []).map((i) => displayEspecialidadLabel(i.label, opts.catalog) || i.label);
    const maxThick = opts.barThickness || (horizontal ? 14 : 22);
    const pal = chartPalette();
    return new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: items.map((i) => i.value),
            backgroundColor: items.map((i) => i.color || "#6366F1"),
            borderRadius: horizontal
              ? { topRight: 4, bottomRight: 4, topLeft: 0, bottomLeft: 0 }
              : 5,
            borderSkipped: horizontal ? "start" : false,
            maxBarThickness: maxThick,
            categoryPercentage: horizontal ? 0.65 : 0.8,
            barPercentage: horizontal ? 0.75 : 0.9,
          },
        ],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: horizontal ? { right: 10 } : { top: 4 } },
        scales: {
          x: {
            grid: { display: !horizontal, color: pal.grid, drawBorder: false },
            ticks: { precision: 0, font: { size: 11, weight: "500" }, color: pal.tick },
            beginAtZero: true,
          },
          y: {
            grid: { display: horizontal ? false : true, color: pal.grid, drawBorder: false },
            ticks: {
              font: { size: horizontal ? 11 : 11, weight: horizontal ? "600" : "500" },
              color: horizontal ? pal.ink : pal.tick,
              autoSkip: false,
              crossAlign: "far",
            },
            beginAtZero: true,
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = horizontal ? ctx.parsed.x : ctx.parsed.y;
                return ` ${v} observación${v === 1 ? "" : "es"}`;
              },
            },
          },
        },
      },
    });
  }

  function lineChart(canvas, series) {
    if (!canvas) return null;
    const labels = series && Array.isArray(series.labels) ? series.labels : [];
    const aperturas = series && Array.isArray(series.aperturas) ? series.aperturas : [];
    const cierres = series && Array.isArray(series.cierres) ? series.cierres : [];
    const pal = chartPalette();
    return new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Aperturas", data: aperturas, borderColor: "#EF4444", backgroundColor: "rgba(239,68,68,.08)", tension: 0.35, fill: true, pointRadius: 2 },
          { label: "Cierres", data: cierres, borderColor: "#22C55E", backgroundColor: "rgba(34,197,94,.08)", tension: 0.35, fill: true, pointRadius: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: "top", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: pal.tick } },
          y: { grid: { color: pal.grid }, beginAtZero: true, ticks: { color: pal.tick } },
        },
      },
    });
  }

  function legendList(items, opts) {
    opts = opts || {};
    return items
      .map((i) => {
        const pct = opts.total ? ` <span class="muted">${Math.round((i.value / opts.total) * 100)}%</span>` : i.pct != null ? ` <span class="muted">${i.pct}%</span>` : "";
        return `<div class="flex between" style="padding:4px 0;font-size:12px"><span class="flex gap"><i class="dot" style="background:${i.color || "#6366F1"}"></i>${i.label}</span><b>${fmt(i.value)}${pct}</b></div>`;
      })
      .join("");
  }

  const KPI_COLORS = {
    Terminaciones: "#6366F1",
    "Instalaciones Sanitarias": "#F97316",
    "Instalaciones Eléctricas": "#22C55E",
    "Instalaciones de Gas": "#EAB308",
    "Fachadas y Terminaciones Exteriores": "#8B5CF6",
    "Estructura Visible": "#64748B",
    Climatización: "#06B6D4",
    "Ventanas y Cerramientos": "#EC4899",
    "Áreas Verdes y Exteriores": "#84CC16",
  };

  function hallazgosPorKpi(hallazgos, catalog) {
    const counts = {};
    (catalog || []).forEach((k) => { counts[k] = 0; });
    (hallazgos || []).forEach((h) => {
      const k = String(h.kpi || "Sin KPI").trim();
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, color: KPI_COLORS[label] || "#94A3B8" }));
  }

  function hallazgosPorRecinto(hallazgos) {
    const counts = {};
    (hallazgos || []).forEach((h) => {
      const r = String(h.recinto || "Sin recinto").trim();
      counts[r] = (counts[r] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, color: "#6366F1" }));
  }

  function parseDayKey(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function dayKeyToLabel(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return key;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
  }

  /** Serie de aperturas/cierres en los últimos `days` días calendario (incluye ceros). */
  function hallazgosTimeline(hallazgos, days) {
    const windowDays = Math.max(1, Number(days) || 14);
    if (!hallazgos || !hallazgos.length) return null;

    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - (windowDays - 1));

    const keys = [];
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      keys.push(`${yyyy}-${mm}-${dd}`);
    }
    const inWindow = new Set(keys);
    const aperturas = Object.fromEntries(keys.map((k) => [k, 0]));
    const cierres = Object.fromEntries(keys.map((k) => [k, 0]));

    let any = false;
    hallazgos.forEach((h) => {
      const a = parseDayKey(h.apertura || h.fecha || h.createdAt || h.openedAt);
      if (a && inWindow.has(a)) {
        aperturas[a]++;
        any = true;
      }
      const c = parseDayKey(h.cierre || h.closedAt || h.cerradoEn);
      if (c && inWindow.has(c)) {
        cierres[c]++;
        any = true;
      }
    });
    if (!any) return null;

    return {
      labels: keys.map(dayKeyToLabel),
      aperturas: keys.map((k) => aperturas[k]),
      cierres: keys.map((k) => cierres[k]),
      days: windowDays,
    };
  }

  function kpiDominante(hallazgos, catalog) {
    const items = hallazgosPorKpi(hallazgos, catalog);
    if (!items.length) return null;
    const total = items.reduce((a, b) => a + b.value, 0);
    const top = items[0];
    return { nombre: top.label, pct: total ? Math.round((top.value / total) * 100) : 0 };
  }

  /** Resumen técnico y acciones a partir de hallazgos reales (no texto estático del seed). */
  function buildUnitResumen(unit, hallazgos, catalog) {
    unit = unit || {};
    hallazgos = hallazgos || [];
    const ref = unit.ref || "";
    const tipo = unit.tipoUnidad ? ` ${unit.tipoUnidad}` : "";
    const meta = [];
    if (unit.dormitorios) meta.push(`${unit.dormitorios} dormitorio${unit.dormitorios > 1 ? "s" : ""}`);
    if (unit.superficie && unit.superficie.total) meta.push(`${unit.superficie.total} m²`);
    const metaTxt = meta.length ? ` (${meta.join(", ")})` : "";

    const total = hallazgos.length;
    const abiertos = hallazgos.filter((h) => h.estado !== "cerrado");
    const criticos = abiertos.filter((h) => h.severidad === "critica").length;

    if (!total) {
      return {
        resumenTecnico: `La unidad ${ref}${tipo}${metaTxt} no registra hallazgos en la recepción técnica.`,
        accionesRecomendadas: ["Continuar inspección de recintos pendientes."],
      };
    }

    const critPart = criticos
      ? `, ${criticos} crítico${criticos > 1 ? "s" : ""}`
      : "";
    const openPart = abiertos.length
      ? ` con ${abiertos.length} observación${abiertos.length > 1 ? "es" : ""} abierta${abiertos.length > 1 ? "s" : ""}`
      : " sin observaciones abiertas";

    const kpiItems = hallazgosPorKpi(hallazgos, (catalog && catalog.kpis) || []);
    const topKpis = kpiItems.slice(0, 2).map((i) => i.label);
    const kpiTxt = topKpis.length
      ? `La mayor concentración corresponde a ${topKpis.join(" y ")}.`
      : "";

    const recMap = {};
    abiertos.forEach((h) => {
      const r = String(h.recinto || "").trim();
      if (r && r !== "Sin recinto") recMap[r] = (recMap[r] || 0) + 1;
    });
    const topRecs = Object.entries(recMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r]) => r);
    const recTxt = topRecs.length
      ? `Los recintos con más observaciones abiertas son ${topRecs.join(", ")}.`
      : "";

    const resumenTecnico = [
      `La unidad ${ref}${tipo}${metaTxt} registra ${total} hallazgo${total > 1 ? "s" : ""}${critPart}${openPart}.`,
      kpiTxt,
      recTxt,
    ]
      .filter(Boolean)
      .join(" ");

    const sevRank = { critica: 3, intermedia: 2, menor: 1 };
    const accionesRecomendadas = abiertos
      .slice()
      .sort((a, b) => (sevRank[b.severidad] || 0) - (sevRank[a.severidad] || 0))
      .slice(0, 5)
      .map((h) => {
        const desc = String(h.descripcion || "Revisar observación").trim();
        const rec = h.recinto && h.recinto !== "Sin recinto" ? ` (${h.recinto})` : "";
        return `${desc}${rec}`;
      });

    if (!accionesRecomendadas.length) {
      accionesRecomendadas.push("Validar cierre documental y preparar acta de recepción de la unidad.");
    }

    return { resumenTecnico, accionesRecomendadas };
  }

  function flatEspecialidades(catalogoEspecialidades) {
    const set = new Set();
    Object.values(catalogoEspecialidades || {}).forEach((list) => {
      (list || []).forEach((e) => {
        const s = String(e).trim();
        if (s) set.add(s);
      });
    });
    return [...set];
  }

  function normalizeKpiLabel(label, catalog) {
    const s = String(label || "").trim();
    if (!s) return null;
    const lookup = catalog?.kpiLookup || {};
    const kpis = catalog?.kpis || [];
    const normalized = lookup[s.toLowerCase()] || s;
    return kpis.includes(normalized) ? normalized : null;
  }

  function normalizeEspecialidadLabel(label, catalog) {
    const s = String(label || "").trim();
    if (!s) return null;
    const flat = flatEspecialidades(catalog?.catalogoEspecialidades);
    return flat.find((e) => e.toLowerCase() === s.toLowerCase()) || null;
  }

  function remapKpiChart(items, catalog) {
    const counts = {};
    (catalog?.kpis || []).forEach((k) => {
      counts[k] = 0;
    });
    (items || []).forEach((i) => {
      const k = normalizeKpiLabel(i.label, catalog);
      if (k) counts[k] += Number(i.value) || 0;
    });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value, color: KPI_COLORS[label] || "#94A3B8" }));
  }

  function hallazgosPorEspecialidad(hallazgos, catalog, opts) {
    opts = opts || {};
    const limit = opts.limit || 12;
    const counts = {};
    (hallazgos || []).forEach((h) => {
      const raw = String(h.especialidad || "").trim();
      if (!raw || raw === "—") return;
      if (opts.knownOnly && !normalizeEspecialidadLabel(raw, catalog)) return;
      const label = displayEspecialidadLabel(raw, catalog);
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([label, value]) => ({ label, value, color: "#6366F1" }));
  }

  function remapEspChart(items, catalog, opts) {
    opts = opts || {};
    const limit = opts.limit || 12;
    const counts = {};
    (items || []).forEach((i) => {
      const label = displayEspecialidadLabel(i.label, catalog) || i.label;
      if (opts.knownOnly && !normalizeEspecialidadLabel(i.label, catalog)) return;
      counts[label] = (counts[label] || 0) + (Number(i.value) || 0);
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([label, value]) => ({ label, value, color: "#6366F1" }));
  }

  function chartDataKpi({ hallazgos, seedItems, catalog }) {
    if (hallazgos && hallazgos.length) return hallazgosPorKpi(hallazgos, catalog.kpis);
    return remapKpiChart(seedItems, catalog);
  }

  function chartDataEsp({ hallazgos, seedItems, catalog, limit, knownOnly }) {
    // Live: incluir todas las especialidades capturadas (no solo las del catálogo).
    // Seed: mantener knownOnly para no mezclar labels demo inválidos.
    const opts = {
      limit: limit || 12,
      knownOnly: knownOnly != null ? !!knownOnly : !(hallazgos && hallazgos.length),
    };
    if (hallazgos && hallazgos.length) return hallazgosPorEspecialidad(hallazgos, catalog, opts);
    return remapEspChart(seedItems, catalog, { ...opts, knownOnly: knownOnly != null ? !!knownOnly : true });
  }

  function remapOtChart(items, catalog) {
    const merged = {};
    (items || []).forEach((i) => {
      const label = normalizeEspecialidadLabel(i.label, catalog);
      if (!label) return;
      if (!merged[label]) merged[label] = { label, value: 0, color: i.color || "#6366F1" };
      merged[label].value += Number(i.value) || 0;
    });
    const arr = Object.values(merged).sort((a, b) => b.value - a.value);
    const total = arr.reduce((a, b) => a + b.value, 0);
    return arr.map((i) => ({
      ...i,
      pct: total ? Math.round((i.value / total) * 100) : 0,
    }));
  }

  const OT_ASIGNADO = {
    Terminaciones: "Cuadrilla Terminaciones",
    "Instalaciones Sanitarias": "Subcontrato Sanitario",
    "Instalaciones Eléctricas": "Subcontrato Eléctrico",
    "Instalaciones de Gas": "Instalador SEC Gas",
    "Estructura Visible": "ITO / Estructural",
    Climatización: "Subcontrato Climatización",
    "Ventanas y Cerramientos": "Subcontrato Carpintería",
    "Fachadas y Terminaciones Exteriores": "Cuadrilla Fachada",
    "Áreas Verdes y Exteriores": "Paisajismo",
  };

  function otEstadoFromHallazgos(list) {
    const criticos = (list || []).filter((h) => h.severidad === "critica").length;
    if (criticos) return { label: "Atrasada", cls: "critico" };
    if ((list || []).some((h) => h.severidad === "intermedia")) return { label: "En proceso", cls: "pendiente_intermedio" };
    return { label: "Pendiente", cls: "pendiente_menor" };
  }

  /** OT activas agrupadas por especialidad (hallazgos abiertos de la unidad). */
  function otsFromHallazgos(hallazgos, catalog, unitRef) {
    const open = (hallazgos || []).filter((h) => h.estado !== "cerrado");
    const groups = new Map();
    open.forEach((h) => {
      const esp = normalizeEspecialidadLabel(h.especialidad, catalog) || String(h.especialidad || "Sin especialidad").trim();
      const kpi = normalizeKpiLabel(h.kpi, catalog) || String(h.kpi || "—").trim();
      if (!groups.has(esp)) groups.set(esp, { especialidad: esp, kpi, hallazgos: [] });
      const g = groups.get(esp);
      g.hallazgos.push(h);
      if (kpi && kpi !== "—") g.kpi = kpi;
    });
    let idx = 1;
    return [...groups.values()]
      .map((g) => {
        const estado = otEstadoFromHallazgos(g.hallazgos);
        return {
          id: `OT-${unitRef}-${String(idx++).padStart(2, "0")}`,
          kpi: g.kpi,
          especialidad: g.especialidad,
          hallazgos: g.hallazgos,
          count: g.hallazgos.length,
          criticos: g.hallazgos.filter((h) => h.severidad === "critica").length,
          estado,
          asignado: OT_ASIGNADO[g.kpi] || g.especialidad,
        };
      })
      .sort((a, b) => b.criticos - a.criticos || b.count - a.count);
  }

  /**
   * OT del proyecto a partir de un mapa de hallazgos (live preferido).
   * Ya no inventa OT sintéticas desde charts del seed.
   */
  function projectOtsFromFindingsMap(findingsMap, seed, projectId, catalog) {
    const out = [];
    const project = (seed.projects || []).find((p) => p.id === projectId) || {};
    const hasLive = findingsMapHasLiveFetch(findingsMap, seed, projectId);
    projectUnitKeys(seed, projectId).forEach((key) => {
      const ref = key.split(":")[1];
      const hall = hallazgosForUnitMode(findingsMap, seed, projectId, ref, hasLive);
      const seedUnit = (seed.units || {})[key] || {};
      const fromFloor = findFloorUnitSummary(project, ref);
      const piso =
        seedUnit.piso != null
          ? seedUnit.piso
          : fromFloor
            ? floorNumberFromId(fromFloor.floorId)
            : parseInt(String(ref).charAt(0), 10) || null;
      otsFromHallazgos(hall, catalog, ref).forEach((ot) => {
        out.push({ ...ot, unidad: ref, piso, unitKey: key });
      });
    });
    return out.sort((a, b) => b.criticos - a.criticos || b.count - a.count);
  }

  /** Compat: OT solo desde seed (sin mapa live). */
  function projectOtsFromSeed(seed, projectId, catalog) {
    return projectOtsFromFindingsMap({}, seed, projectId, catalog);
  }

  function buildPanelGerencial(hallazgos, metrics, units, kpiCatalog) {
    const list = hallazgos || [];
    const open = list.filter(isHallazgoAbierto);
    const dom = list.length ? kpiDominante(list, (kpiCatalog && kpiCatalog.kpis) || kpiCatalog) : null;
    const espItems = hallazgosPorEspecialidad(open.length ? open : list, kpiCatalog, { limit: 1, knownOnly: false });
    const topEsp = espItems[0] || null;
    const espTotal = open.length || list.length || 1;
    const byPiso = {};
    (units || []).forEach((u) => {
      const piso = u.piso != null ? u.piso : parseInt(String(u.ref).charAt(0), 10);
      if (!Number.isFinite(piso)) return;
      if (!byPiso[piso]) byPiso[piso] = { criticas: 0, abiertos: 0 };
      byPiso[piso].criticas += u.criticas || 0;
      byPiso[piso].abiertos += u.abiertos || 0;
    });
    const pisoCrit = Object.entries(byPiso)
      .sort((a, b) => b[1].criticas - a[1].criticas || b[1].abiertos - a[1].abiertos)[0];
    const unidadesBloqueadas = (units || []).filter((u) => (u.criticas || 0) > 0).length;
    const otAtrasadas =
      metrics && metrics._liveCierre
        ? metrics.otAtrasadas || 0
        : metrics && metrics.otAtrasadas != null
          ? metrics.otAtrasadas
          : open.filter((h) => h.severidad === "critica").length;

    return {
      kpiDominante: dom || { nombre: "—", pct: 0 },
      especialidadMayorAtraso: topEsp
        ? { nombre: topEsp.label, pct: Math.round((topEsp.value / espTotal) * 100) }
        : { nombre: "—", pct: 0 },
      pisoCritico: pisoCrit
        ? { nombre: "Piso " + pisoCrit[0], criticas: pisoCrit[1].criticas }
        : { nombre: "—", criticas: 0 },
      unidadesBloqueadas,
      otAtrasadas,
    };
  }

  function buildProjectResumenEjecutivo(project, metrics, hallazgos, hasLive) {
    const m = metrics || {};
    const name = (project && project.name) || "El proyecto";
    const total = m.hallazgosTotales != null ? m.hallazgosTotales : (hallazgos || []).length;
    const abiertos = m.hallazgosAbiertos ?? m.observacionesAbiertas ?? 0;
    const crit = m.criticasAbiertas || 0;
    if (hasLive) {
      if (!total) {
        return name + ": aún no hay hallazgos capturados en recepción. Las métricas reflejan el estado live (sin observaciones registradas).";
      }
      return (
        name +
        " registra " +
        total +
        " hallazgo" +
        (total === 1 ? "" : "s") +
        " en captura (" +
        abiertos +
        " abierto" +
        (abiertos === 1 ? "" : "s") +
        ", " +
        crit +
        " crítico" +
        (crit === 1 ? "" : "s") +
        "). Avance de recepción " +
        (m.avanceRecepcion ?? 0) +
        "% (" +
        (m.unidadesInspeccionadas ?? m.unidadesRecibidas ?? 0) +
        "/" +
        (m.unidadesTotales ?? 0) +
        " deptos inspeccionados) y avance de cierre " +
        (m.avanceCierreHallazgos ?? m.avanceCierre ?? 0) +
        "% (" +
        (m.hallazgosCerrados ?? 0) +
        "/" +
        (m.hallazgosTotales ?? total) +
        " hallazgos cerrados). Deptos listos: " +
        (m.unidadesListas ?? 0) +
        "."
      );
    }
    return (
      (project && project.resumenEjecutivo) ||
      name +
        ": avance de recepción " +
        (m.avanceRecepcion ?? 0) +
        "%, " +
        (m.observacionesTotales || 0) +
        " observaciones, " +
        crit +
        " críticas abiertas."
    );
  }

  function buildAccionesRecomendadas(hallazgos, panel, hasLive) {
    if (!hasLive) return null;
    const actions = [];
    const open = (hallazgos || []).filter(isHallazgoAbierto);
    const crit = open.filter((h) => h.severidad === "critica");
    if (crit.length) {
      actions.push(
        "Priorizar cierre de " +
          crit.length +
          " hallazgo" +
          (crit.length === 1 ? "" : "s") +
          " crítico" +
          (crit.length === 1 ? "" : "s") +
          "."
      );
    }
    if (panel && panel.pisoCritico && panel.pisoCritico.nombre !== "—" && panel.pisoCritico.criticas > 0) {
      actions.push(
        "Concentrar cuadrillas en " + panel.pisoCritico.nombre + " (" + panel.pisoCritico.criticas + " críticas)."
      );
    }
    if (panel && panel.especialidadMayorAtraso && panel.especialidadMayorAtraso.nombre !== "—") {
      actions.push("Acelerar OT de " + panel.especialidadMayorAtraso.nombre + ".");
    }
    if (panel && panel.kpiDominante && panel.kpiDominante.nombre !== "—") {
      actions.push("Reforzar control de calidad en KPI " + panel.kpiDominante.nombre + ".");
    }
    if (!open.length) {
      actions.push("Mantener ritmo de inspección y documentar unidades sin hallazgos.");
    }
    return actions.length ? actions : ["Continuar captura y verificación de hallazgos."];
  }

  function hashStr(s) {
    s = String(s);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function sceneGradient(recinto) {
    const palette = [
      ["#E9E3D8", "#CDBFA8"],
      ["#E4E9EF", "#C2CAD6"],
      ["#ECE6E1", "#CFC0B2"],
      ["#E3EAE5", "#BFD0C5"],
    ];
    const p = palette[hashStr(recinto) % palette.length];
    return `linear-gradient(180deg, ${p[0]} 0%, ${p[0]} 60%, ${p[1]} 60%, ${p[1]} 100%)`;
  }

  function targetSvgMarkup(x, y, col) {
    return `<svg class="ot-ph-target" viewBox="0 0 100 100" style="left:${x}%;top:${y}%"><circle cx="50" cy="50" r="28" fill="none" stroke="${col}" stroke-width="5"/><circle cx="50" cy="50" r="3" fill="${col}"/></svg>`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function fmtDateShort(d) {
    if (!d) return "—";
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return "—";
    return x.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function hallazgoPhotoHtml(h) {
    if (h.fotoUrl) {
      const tx = h.target ? h.target.x * 100 : 50;
      const ty = h.target ? h.target.y * 100 : 50;
      const target = h.target ? targetSvgMarkup(tx, ty, "#EF4444") : "";
      return `<div class="ot-ph"><img src="${escapeHtml(h.fotoUrl)}" alt="" loading="lazy"/>${target}<span class="ot-ph-badge">R0</span></div>`;
    }
    const resolvedUrl = h.fotoResueltaUrl || h.fotoCierreUrl;
    if (resolvedUrl) {
      return `<div class="ot-ph"><img src="${escapeHtml(resolvedUrl)}" alt="" loading="lazy"/><span class="ot-ph-badge ok">Resuelto</span></div>`;
    }
    if (h.foto) {
      const hash = hashStr(h.id || h.recinto);
      const tx = 32 + (hash % 36);
      const ty = 34 + ((hash >> 3) % 28);
      return `<div class="ot-ph ot-ph-sim" style="background:${sceneGradient(h.recinto)}">${targetSvgMarkup(tx, ty, "#EF4444")}<span class="ot-ph-badge">R0 · demo</span></div>`;
    }
    return `<div class="ot-ph ot-ph-empty">Sin foto</div>`;
  }

  function otHallazgosDetailHtml(hallazgos) {
    if (!hallazgos || !hallazgos.length) return `<p class="muted" style="padding:12px">Sin hallazgos.</p>`;
    return `<div class="ot-findings">${hallazgos
      .map(
        (h) =>
          `<div class="ot-finding">${hallazgoPhotoHtml(h)}<div class="ot-finding-body"><div class="ot-finding-title">${escapeHtml(h.recinto)}</div><div class="ot-finding-label">Qué debe corregir</div><div class="ot-finding-desc">${escapeHtml(h.descripcion)}</div><div class="ot-finding-meta"><span class="badge ${h.severidad || "menor"}">${h.severidad || "—"}</span> · ${fmtDateShort(h.apertura)} · ${escapeHtml(h.estado || "—")}</div></div></div>`
      )
      .join("")}</div>`;
  }

  function hallazgoPhotoPrintHtml(h, opts) {
    opts = opts || {};
    const large = opts.large ? " ot-print-ph-lg" : "";
    const src = absUrl(h.fotoUrl);
    if (src) return `<img class="ot-print-ph${large}" src="${escapeHtml(src)}" alt=""/>`;
    const resolvedUrl = absUrl(h.fotoResueltaUrl || h.fotoCierreUrl);
    if (resolvedUrl) return `<img class="ot-print-ph${large}" src="${escapeHtml(resolvedUrl)}" alt=""/>`;
    if (h.foto) {
      return `<div class="ot-print-ph ot-print-ph-sim${large}" style="background:${sceneGradient(h.recinto)}"><span>Foto R0</span></div>`;
    }
    return `<div class="ot-print-ph ot-print-ph-empty${large}">Sin foto</div>`;
  }

  function absUrl(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (typeof location !== "undefined" && location.origin) return location.origin + (s.startsWith("/") ? s : "/" + s);
    return s;
  }

  function hallazgoPrintItemHtml(h, n) {
    const sev = String(h.severidad || "menor");
    return `<article class="ot-print-item">
      <div class="ot-print-item-head">
        <span class="ot-print-item-num">#${n}</span>
        <span class="ot-print-item-rec">${escapeHtml(h.recinto || "Sin recinto")}</span>
        <span class="ot-print-item-sev ot-print-sev-${escapeHtml(sev)}">${escapeHtml(sev)}</span>
      </div>
      <div class="ot-print-item-body">
        <div class="ot-print-item-photo">${hallazgoPhotoPrintHtml(h, { large: true })}</div>
        <div class="ot-print-item-text">
          <div class="ot-print-item-label">Qué debe corregir el maestro</div>
          <p class="ot-print-item-desc">${escapeHtml(h.descripcion || "Corregir la observación registrada en la inspección.")}</p>
          <div class="ot-print-item-meta">KPI: ${escapeHtml(h.kpi || "—")} · Especialidad: ${escapeHtml(h.especialidad || "—")} · Apertura: ${fmtDateShort(h.apertura)}</div>
          <div class="ot-print-item-check">☐ Trabajo ejecutado · adjuntar foto de cierre</div>
        </div>
      </div>
    </article>`;
  }

  function otPrintSheetHtml(ot, ctx) {
    const project = ctx.project || {};
    const tenant = ctx.tenant || {};
    const emittedAt = ctx.emittedAt || fmtDateShort(new Date());
    const items = (ot.hallazgos || []).map((h, i) => hallazgoPrintItemHtml(h, i + 1)).join("");
    const pisoTxt = ot.piso != null && ot.piso !== "" ? ` · Piso ${ot.piso}` : "";
    const maestro = ot.especialidad || ot.asignado || "Maestro / cuadrilla";
    return `<div class="ot-print-sheet">
      <header class="ot-print-header">
        <img src="/assets/Logo%20Ainspecciona.png" alt="Ainspecciona" class="ot-print-logo"/>
        <div class="ot-print-header-text">
          <div class="ot-print-tenant">${escapeHtml(tenant.name || "Ainspecciona Recepción")}</div>
          <h1>Orden de Trabajo</h1>
          <div class="ot-print-sub">Entrega al maestro · ${escapeHtml(maestro)}</div>
          <div class="ot-print-id">${escapeHtml(ot.id)}</div>
        </div>
      </header>
      <div class="ot-print-grid">
        <div><span>Proyecto</span><b>${escapeHtml(project.name || "—")}</b></div>
        <div><span>Edificio / dirección</span><b>${escapeHtml(project.building || "—")} · ${escapeHtml(project.address || "—")}</b></div>
        <div><span>Unidad</span><b>${escapeHtml(ot.unidad || "—")}${pisoTxt}</b></div>
        <div><span>KPI</span><b>${escapeHtml(ot.kpi || "—")}</b></div>
        <div><span>Cuadrilla / asignado</span><b>${escapeHtml(ot.asignado || "—")}</b></div>
        <div><span>Fecha emisión</span><b>${escapeHtml(emittedAt)}</b></div>
      </div>
      <p class="ot-print-brief">Corrija cada ítem indicado abajo. Cada observación incluye <b>foto de referencia (R0)</b> y la <b>explicación del hallazgo</b>. Al terminar, registre foto de cierre y marque como ejecutado.</p>
      <h2 class="ot-print-section">Trabajos a ejecutar (${ot.count || (ot.hallazgos || []).length})</h2>
      <div class="ot-print-items">${items || `<p>Sin hallazgos en esta OT.</p>`}</div>
      <div class="ot-print-signatures">
        <div><span>Maestro / especialidad</span><div class="ot-print-line"></div></div>
        <div><span>Responsable ITO / obra</span><div class="ot-print-line"></div></div>
        <div><span>Fecha de cierre</span><div class="ot-print-line"></div></div>
      </div>
    </div>`;
  }

  function otPrintAllHtml(ots, ctx) {
    return (ots || []).map((ot) => otPrintSheetHtml(ot, ctx)).join("");
  }

  function printEntregaDocuments(html, areaId) {
    areaId = areaId || "otPrintArea";
    let area = document.getElementById(areaId);
    if (!area) {
      area = document.createElement("div");
      area.id = areaId;
      document.body.appendChild(area);
    }
    area.innerHTML = `<div class="ot-print-doc">${html}</div>`;
    const imgs = area.querySelectorAll("img");
    const runPrint = () => window.print();
    if (!imgs.length) {
      runPrint();
      return;
    }
    let pending = imgs.length;
    const tick = () => {
      pending -= 1;
      if (pending <= 0) setTimeout(runPrint, 150);
    };
    imgs.forEach((img) => {
      if (img.complete) tick();
      else {
        img.onload = tick;
        img.onerror = tick;
      }
    });
    setTimeout(runPrint, 3000);
  }

  function printOtDocuments(html) {
    printEntregaDocuments(html, "otPrintArea");
  }

  function printReportDocuments(html) {
    printEntregaDocuments(html, "repPrintArea");
  }

  function projectUnitKeys(seed, projectId) {
    const allProjects = (seed && seed.projects) || [];
    const project = allProjects.find((p) => p.id === projectId);
    if (project) {
      return unitsForUnitSelector(project, seed)
        .map((u) => `${projectId}:${u.ref}`)
        .sort((a, b) => a.split(":")[1].localeCompare(b.split(":")[1], undefined, { numeric: true }));
    }
    return Object.keys((seed && seed.units) || {})
      .filter((k) => k.startsWith(String(projectId) + ":"))
      .sort((a, b) => a.split(":")[1].localeCompare(b.split(":")[1], undefined, { numeric: true }));
  }

  function defaultUnitRecintos() {
    return [
      "Living Comedor Cocina",
      "Dormitorio 1",
      "Dormitorio 2",
      "Dormitorio Suite",
      "Baño",
      "Baño Suite",
      "W. Closet",
      "Logia",
      "Pasillo",
      "Terraza",
    ];
  }

  function findFloorUnitSummary(project, ref) {
    for (const [floorId, detail] of Object.entries((project && project.floorDetail) || {})) {
      const u = (detail.units || []).find((x) => String(x.ref) === String(ref));
      if (u) {
        const piso = parseInt(String(floorId).replace("piso-", ""), 10);
        return { floorId, piso: Number.isFinite(piso) ? piso : null, summary: u };
      }
    }
    return null;
  }

  /** Unidad completa del seed o resumen mínimo desde floorDetail (p. ej. depto 303). */
  function resolveUnitRecord(seed, project, ref) {
    const key = `${project.id}:${ref}`;
    const full = (seed.units || {})[key];
    if (full) return full;
    const floor = findFloorUnitSummary(project, ref);
    if (!floor) return null;
    const st = floor.summary.estado || "no_inspeccionado";
    return {
      ref: String(ref),
      projectId: project.id,
      tipo: floor.summary.tipo || "Departamento",
      piso: floor.piso,
      floorId: floor.floorId,
      estado: st,
      estadoLabel: STATE_LABELS[st] || st,
      recintos: defaultUnitRecintos(),
      hallazgos: [],
      metrics: {
        avance: floor.summary.avance ?? 0,
        verificados: 0,
        totalVerificables: 0,
        hallazgosTotales: floor.summary.hallazgos ?? 0,
        abiertos: 0,
        cerrados: 0,
        criticos: floor.summary.criticas ?? 0,
        otActivas: 0,
      },
      resumenTecnico: "",
      accionesRecomendadas: [],
    };
  }

  function recintosForUnit(seed, project, ref) {
    const unit = resolveUnitRecord(seed, project, ref) || (seed.units || {})[`${project.id}:${ref}`];
    if (unit && unit.recintos && unit.recintos.length) return unit.recintos;
    if (unit && unit.plano && unit.plano.zones) return unit.plano.zones.map((z) => z.recinto);
    return defaultUnitRecintos();
  }

  function mergeRecintosFromHallazgos(recintos, hallazgos) {
    const set = new Set(recintos || []);
    (hallazgos || []).forEach((h) => {
      const r = String(h.recinto || "").trim();
      if (r && r !== "Sin recinto" && r !== "Sin asignar") set.add(r);
    });
    return [...set];
  }

  const PISO_VIEW_MIN = 2;
  const PISO_VIEW_MAX = 7;

  function floorIdFromNumber(n) {
    return `piso-${n}`;
  }

  function floorNumberFromId(floorId) {
    const n = parseInt(String(floorId || "").replace("piso-", ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  /** Pisos 2–7 para el selector de la vista Piso (crea filas mínimas si faltan en seed). */
  function floorsForPisoSelector(project, min, max) {
    min = min == null ? PISO_VIEW_MIN : min;
    max = max == null ? PISO_VIEW_MAX : max;
    const byId = {};
    (project.floors || []).forEach((f) => {
      byId[f.id] = f;
    });
    const out = [];
    for (let n = min; n <= max; n++) {
      const id = floorIdFromNumber(n);
      out.push(
        byId[id] || {
          id,
          name: `Piso ${n}`,
          estado: "no_inspeccionado",
          avanceRecepcion: 0,
          criticas: 0,
          cells: Array(8).fill("no_inspeccionado"),
        }
      );
    }
    return out;
  }

  function defaultFloorCharts(floor, project) {
    const base = (project.charts && project.charts.hallazgosPorKpi) || [];
    const scale = Math.max(0.08, (floor.avanceRecepcion || 40) / 400);
    return {
      hallazgosPorKpi: base.slice(0, 5).map((i) => ({ ...i, value: Math.max(1, Math.round(i.value * scale)) })),
      observacionesPorEspecialidad: ((project.charts && project.charts.observacionesPorEspecialidad) || [])
        .slice(0, 6)
        .map((i) => ({ ...i, value: Math.max(1, Math.round(i.value * scale)) })),
      aperturasVsCierres: (project.charts && project.charts.aperturasVsCierres) || {
        labels: ["Sem 1", "Sem 2", "Sem 3", "Sem 4"],
        aperturas: [4, 8, 6, 5],
        cierres: [2, 4, 5, 6],
      },
    };
  }

  function synthFloorUnits(floor) {
    const num = floorNumberFromId(floor.id);
    if (num == null) return [];
    const cells = floor.cells || [];
    const hallazgoEst = { critico: 14, pendiente_intermedio: 9, pendiente_menor: 5, lista: 2, no_inspeccionado: 0 };
    const avanceEst = { lista: 96, pendiente_menor: 74, pendiente_intermedio: 58, critico: 38, no_inspeccionado: 0 };
    return Array.from({ length: 8 }, (_, i) => {
      const estado = cells[i] || "no_inspeccionado";
      const hallazgos = hallazgoEst[estado] ?? 0;
      return {
        ref: `${num}0${i + 1}`,
        tipo: "Departamento",
        estado,
        avance: avanceEst[estado] ?? floor.avanceRecepcion ?? 0,
        hallazgos,
        criticas: estado === "critico" ? Math.max(1, Math.floor(hallazgos / 4)) : 0,
      };
    });
  }

  function synthFloorMetrics(floor, units) {
    const total = units.length || 8;
    const avance = floor.avanceRecepcion ?? 0;
    const criticas = floor.criticas ?? units.filter((u) => u.estado === "critico").length;
    const hallazgos = units.reduce((a, u) => a + (u.hallazgos || 0), 0);
    const recibidas = Math.round((total * avance) / 100);
    const cierre = Math.max(0, avance - 10);
    return {
      avanceRecepcion: avance,
      unidadesRecibidas: recibidas,
      unidadesTotales: total,
      avanceCierre: cierre,
      unidadesCierre: Math.round((total * cierre) / 100),
      observacionesAbiertas: Math.round(hallazgos * 0.55),
      criticas,
      criticasPct: hallazgos ? Math.round((criticas / hallazgos) * 1000) / 10 : 0,
      otActivas: Math.max(criticas, Math.round(criticas * 0.6)),
      otAtrasadas: Math.max(0, Math.floor(criticas / 3)),
      unidadesInspeccionadas: recibidas,
    };
  }

  /** Detalle de piso: seed floorDetail o síntesis desde project.floors. */
  function resolveFloorDetail(project, floorId) {
    const saved = (project.floorDetail || {})[floorId];
    if (saved) return saved;
    const floor = (project.floors || []).find((f) => f.id === floorId);
    if (!floor) return null;
    const units = synthFloorUnits(floor);
    return {
      name: floor.name || `Piso ${floorNumberFromId(floorId) || ""}`,
      units,
      metrics: synthFloorMetrics(floor, units),
      charts: defaultFloorCharts(floor, project),
    };
  }

  /** Unidades del proyecto (pisos 2–7) para el selector de la vista Unidad. */
  function unitsForUnitSelector(project, seed, opts) {
    opts = opts || {};
    const min = opts.minFloor != null ? opts.minFloor : PISO_VIEW_MIN;
    const max = opts.maxFloor != null ? opts.maxFloor : PISO_VIEW_MAX;
    const floorFilter = opts.floorId || null;
    const byRef = new Map();

    Object.keys((seed && seed.units) || {})
      .filter((k) => k.startsWith(String(project.id) + ":"))
      .forEach((key) => {
      const ref = key.split(":")[1];
      const u = (seed.units || {})[key] || {};
      const piso = u.piso != null ? u.piso : parseInt(String(ref).charAt(0), 10);
      byRef.set(ref, {
        ref,
        piso: Number.isFinite(piso) ? piso : null,
        floorId: u.floorId || (Number.isFinite(piso) ? floorIdFromNumber(piso) : null),
        tipo: u.tipo || "Departamento",
      });
    });

    Object.entries((project && project.floorDetail) || {}).forEach(([floorId, detail]) => {
      const piso = floorNumberFromId(floorId);
      (detail.units || []).forEach((u) => {
        if (!byRef.has(u.ref)) {
          byRef.set(u.ref, {
            ref: u.ref,
            piso,
            floorId,
            tipo: u.tipo || "Departamento",
          });
        }
      });
    });

    floorsForPisoSelector(project, min, max).forEach((floor) => {
      synthFloorUnits(floor).forEach((u) => {
        if (!byRef.has(u.ref)) {
          byRef.set(u.ref, {
            ref: u.ref,
            piso: floorNumberFromId(floor.id),
            floorId: floor.id,
            tipo: u.tipo || "Departamento",
          });
        }
      });
    });

    let list = [...byRef.values()];
    if (floorFilter) list = list.filter((u) => u.floorId === floorFilter);
    list.sort((a, b) => parseInt(a.ref, 10) - parseInt(b.ref, 10));
    return list;
  }

  function unitOptionsGroupedHtml(units, currentRef, opts) {
    opts = opts || {};
    const byFloor = {};
    units.forEach((u) => {
      const fk = u.floorId || "sin-piso";
      if (!byFloor[fk]) byFloor[fk] = [];
      byFloor[fk].push(u);
    });
    const floorIds = Object.keys(byFloor).sort((a, b) => {
      const na = floorNumberFromId(a);
      const nb = floorNumberFromId(b);
      if (na == null && nb == null) return 0;
      if (na == null) return 1;
      if (nb == null) return -1;
      return na - nb;
    });
    const resolveValue =
      Object.prototype.hasOwnProperty.call(opts, "valueOf") && typeof opts.valueOf === "function"
        ? opts.valueOf
        : (u) => u.ref;
    const resolveLabel =
      Object.prototype.hasOwnProperty.call(opts, "labelOf") && typeof opts.labelOf === "function"
        ? opts.labelOf
        : (u) => u.ref;
    let html = "";
    floorIds.forEach((fid) => {
      const n = floorNumberFromId(fid);
      const label = n != null ? `Piso ${n}` : "Sin piso";
      html += `<optgroup label="${escapeHtml(label)}">`;
      byFloor[fid].forEach((u) => {
        if (!u) return;
        const val = resolveValue(u);
        const sel = String(val) === String(currentRef) ? " selected" : "";
        html += `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(resolveLabel(u))}</option>`;
      });
      html += `</optgroup>`;
    });
    return html;
  }

  function unitSelectorHtml(units, currentRef) {
    const inner = unitOptionsGroupedHtml(units, currentRef);
    return `<select class="select" id="unitSelector" aria-labelledby="unitSelectorLabel" title="Seleccionar unidad">${inner}</select>`;
  }

  /** Opciones agrupadas por piso para Captura (solo refs, prefijo Depto). */
  function capturaUnitOptionsHtml(seed, project, currentRef) {
    const units = unitsForUnitSelector(project, seed);
    const refs = units.map((u) => u.ref);
    const def =
      currentRef && refs.includes(String(currentRef))
        ? String(currentRef)
        : refs.includes("301")
          ? "301"
          : refs[0] || "301";
    return unitOptionsGroupedHtml(units, def, {
      labelOf: (u) => {
        const full = (seed.units || {})[`${project.id}:${u.ref}`];
        return full && full.tipoUnidad ? `Depto ${u.ref} · ${full.tipoUnidad}` : `Depto ${u.ref}`;
      },
    });
  }

  function bindUnitSelector() {
    const sel = document.getElementById("unitSelector");
    if (!sel) return;
    sel.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("u", sel.value);
      location.href = url.toString();
    });
  }

  function reportUnitSelectorHtml(seed, project, selectedKey) {
    const units = unitsForUnitSelector(project, seed);
    const byFloor = {};
    units.forEach((u) => {
      const fk = u.floorId || "sin-piso";
      if (!byFloor[fk]) byFloor[fk] = [];
      byFloor[fk].push(u);
    });
    const floorIds = Object.keys(byFloor).sort((a, b) => {
      const na = floorNumberFromId(a);
      const nb = floorNumberFromId(b);
      if (na == null && nb == null) return 0;
      if (na == null) return 1;
      if (nb == null) return -1;
      return na - nb;
    });
    let html = "";
    floorIds.forEach((fid) => {
      const n = floorNumberFromId(fid);
      const label = n != null ? `Piso ${n}` : "Sin piso";
      html += `<optgroup label="${escapeHtml(label)}">`;
      byFloor[fid].forEach((u) => {
        const key = `${project.id}:${u.ref}`;
        const full = (seed.units || {})[key];
        const optLabel = full && full.tipoUnidad ? `${u.ref} · ${full.tipoUnidad}` : u.ref;
        const sel = key === selectedKey ? " selected" : "";
        html += `<option value="${escapeHtml(key)}"${sel}>${escapeHtml(optLabel)}</option>`;
      });
      html += `</optgroup>`;
    });
    return html;
  }

  /**
   * Carga hallazgos live de una unidad.
   * - Array (incl. []) = respuesta OK del API (fuente de verdad)
   * - null = error / sin respuesta → el caller puede usar seed
   */
  async function loadUnitFindings(unitKey) {
    try {
      const r = await entregaFetch(`/api/entrega/units/${encodeURIComponent(unitKey)}/findings`);
      if (!r.ok) return null;
      const j = await r.json();
      if (j && Array.isArray(j.findings)) return j.findings;
    } catch {
      /* prototipo / offline */
    }
    return null;
  }

  async function loadProjectFindingsMap(seed, projectId) {
    const map = {};
    await Promise.all(
      projectUnitKeys(seed, projectId).map(async (key) => {
        const live = await loadUnitFindings(key);
        // Solo respuestas OK del API (incl. []). Seed queda como fallback en hallazgosForUnit.
        if (live !== null) map[key] = live;
      })
    );
    return map;
  }

  function isHallazgoAbierto(h) {
    return h && h.estado !== "cerrado";
  }

  function findingsMapHasKey(findingsMap, key) {
    return !!(findingsMap && Object.prototype.hasOwnProperty.call(findingsMap, key));
  }

  function hallazgosForUnit(findingsMap, seed, projectId, ref) {
    const key = `${projectId}:${ref}`;
    if (findingsMapHasKey(findingsMap, key)) return findingsMap[key] || [];
    const seedUnit = (seed.units || {})[key];
    return (seedUnit && seedUnit.hallazgos) || [];
  }

  function findingsMapHasLiveFetch(findingsMap, seed, projectId) {
    return projectUnitKeys(seed, projectId).some((key) => findingsMapHasKey(findingsMap, key));
  }

  function hasLiveFindings(hallazgos) {
    return (hallazgos || []).some((h) => h.origen === "agente" || h.fotoUrl || h.fotoResueltaUrl);
  }

  function estadoFromAvance(avance) {
    const n = Number(avance) || 0;
    if (n >= 90) return "lista";
    if (n >= 70) return "pendiente_menor";
    if (n >= 50) return "pendiente_intermedio";
    return "critico";
  }

  function estadoRank(estado) {
    return { critico: 4, pendiente_intermedio: 3, pendiente_menor: 2, lista: 1, no_inspeccionado: 0 }[estado] || 0;
  }

  function estadoForUnitDisplay(unit) {
    const u = unit || {};
    // Con hallazgos live (aunque sea []), el estado ya viene de severidad — no empeorar con avance 0% → crítico.
    if (Array.isArray(u._hallazgos)) {
      return u.estado || "no_inspeccionado";
    }
    // Sin hallazgos ni avance: no pintar como crítico por avance 0%.
    if (!(u.hallazgos > 0) && !(Number(u.avance) > 0) && (!u.estado || u.estado === "no_inspeccionado")) {
      return "no_inspeccionado";
    }
    const byHallazgos = u.estado && u.estado !== "no_inspeccionado" ? u.estado : null;
    const byAvance = estadoFromAvance(u.avance);
    if (!byHallazgos) return byAvance;
    return estadoRank(byAvance) > estadoRank(byHallazgos) ? byAvance : byHallazgos;
  }

  function estadoFromHallazgos(hallazgos) {
    if (!hallazgos || !hallazgos.length) return null;
    const open = hallazgos.filter(isHallazgoAbierto);
    if (!open.length) return "lista";
    const sevRank = { critica: 3, intermedia: 2, menor: 1 };
    let worst = "menor";
    open.forEach((h) => {
      if ((sevRank[h.severidad] || 0) > (sevRank[worst] || 0)) worst = h.severidad;
    });
    const map = { critica: "critico", intermedia: "pendiente_intermedio", menor: "pendiente_menor" };
    return map[worst] || "pendiente_menor";
  }

  function countHallazgosMetrics(hallazgos) {
    const list = hallazgos || [];
    const total = list.length;
    const abiertos = list.filter(isHallazgoAbierto).length;
    const cerrados = list.filter((h) => h.estado === "cerrado").length;
    const criticasAbiertas = list.filter((h) => h.severidad === "critica" && isHallazgoAbierto(h)).length;
    const avanceCierre = total ? Math.round((cerrados / total) * 100) : null;
    return { total, abiertos, cerrados, criticasAbiertas, avanceCierre };
  }

  function liveHallazgosOnly(hallazgos) {
    return (hallazgos || []).filter((h) => h.origen === "agente" || h.fotoUrl || h.fotoResueltaUrl);
  }

  /**
   * Fusiona resumen de unidad con hallazgos.
   * opts.authoritative = true: el array (incl. []) es fuente de verdad; no conserva estado/críticas del seed.
   */
  function mergeUnitSummaryWithFindings(unit, hallazgos, opts) {
    const authoritative = !!(opts && opts.authoritative);
    const list = Array.isArray(hallazgos) ? hallazgos : [];
    const m = countHallazgosMetrics(list);
    const live = hasLiveFindings(list);
    const out = { ...unit };
    if (authoritative || m.total || live) {
      out.hallazgos = m.total;
      out.criticas = m.criticasAbiertas;
      out.abiertos = m.abiertos;
      out.cerrados = m.cerrados;
      if (!m.total) {
        out.avance = 0;
        out.estado = "no_inspeccionado";
      } else {
        if (m.avanceCierre != null) out.avance = m.avanceCierre;
        // Prioriza severidad de abiertos; avance 0% no debe pintar la unidad de rojo.
        const st = estadoFromHallazgos(list);
        out.estado = st || (m.abiertos === 0 ? "lista" : "pendiente_menor");
      }
    }
    out._hallazgos = list;
    return out;
  }

  /** Hallazgos de unidad: con hasLive no cae al seed si el API no trajo esa key. */
  function hallazgosForUnitMode(findingsMap, seed, projectId, ref, hasLive) {
    const key = `${projectId}:${ref}`;
    if (findingsMapHasKey(findingsMap, key)) return findingsMap[key] || [];
    if (hasLive) return [];
    return hallazgosForUnit(findingsMap, seed, projectId, ref);
  }

  function computeFloorMetrics(units, allHallazgos, baseMetrics) {
    const base = baseMetrics || {};
    const m = countHallazgosMetrics(allHallazgos);
    const hasLive = hasLiveFindings(allHallazgos);
    const unitsTotal = units.length || 8;
    const hallazgosSeedPiso = units.reduce((a, u) => a + (u.hallazgos || 0), 0);
    const hallazgosTotalPiso = hasLive ? m.total : hallazgosSeedPiso || m.total;
    const unitsRecibidasLive = units.filter((u) => hasLiveFindings(u._hallazgos || [])).length;
    const unitsListasLive = units.filter((u) => {
      if (!hasLiveFindings(u._hallazgos || [])) return false;
      const abiertos = u.abiertos != null ? u.abiertos : (u._hallazgos || []).filter(isHallazgoAbierto).length;
      return abiertos === 0;
    }).length;
    const unidadesRecibidas = hasLive
      ? unitsRecibidasLive
      : Math.round((unitsTotal * (base.avanceRecepcion || 0)) / 100);
    const avanceUnidadesRecibidas = unitsTotal ? Math.round((unidadesRecibidas / unitsTotal) * 100) : 0;
    const hallazgosRecepcion = hasLive ? unidadesRecibidas : Math.round((hallazgosTotalPiso * (base.avanceRecepcion || 0)) / 100);
    const hallazgosRecepcionTotal = hasLive ? unitsTotal : hallazgosTotalPiso;
    const avanceRecepcion = hasLive ? avanceUnidadesRecibidas : base.avanceRecepcion ?? 0;
    const unitsCierre = units.filter((u) => (u.cerrados || 0) > 0 && (u.abiertos || 0) === 0).length;
    const unidadesCierre = hasLive ? unitsCierre : Math.round((unitsTotal * (base.avanceCierre || 0)) / 100);
    const avanceCierreHallazgos = m.total ? m.avanceCierre : 0;
    const criticasCount = hasLive
      ? m.criticasAbiertas
      : units.reduce((a, u) => a + (u.criticas || 0), 0) || base.criticas || 0;
    const hallazgosRef = m.total || hallazgosTotalPiso || 1;
    const criticasPct = Math.round((criticasCount / hallazgosRef) * 1000) / 10;
    const otActivas = hasLive ? countOtActivasFromHallazgos(allHallazgos) : base.otActivas ?? 0;

    if (!hasLive && !m.total) {
      return {
        ...base,
        unidadesTotales: unitsTotal,
        hallazgosRecepcion,
        hallazgosRecepcionTotal,
        unidadesRecibidas,
        avanceUnidadesRecibidas,
        unidadesInspeccionadas: unidadesRecibidas,
        unidadesCierre,
        avanceCierre: avanceUnidadesRecibidas,
        _liveCierre: false,
        _liveRecepcion: false,
      };
    }

    return {
      ...base,
      avanceRecepcion,
      hallazgosRecepcion,
      hallazgosRecepcionTotal,
      unidadesRecibidas,
      avanceUnidadesRecibidas,
      unidadesTotales: unitsTotal,
      unidadesInspeccionadas: unidadesRecibidas,
      unidadesListas: hasLive ? unitsListasLive : base.unidadesListas ?? 0,
      avanceCierre: hasLive ? avanceCierreHallazgos : avanceUnidadesRecibidas,
      avanceCierreHallazgos: hasLive ? avanceCierreHallazgos : null,
      unidadesCierre,
      observacionesAbiertas: hasLive ? m.abiertos : base.observacionesAbiertas ?? m.abiertos,
      observacionesTotales: hasLive ? m.total : hallazgosTotalPiso,
      criticas: criticasCount,
      criticasAbiertas: criticasCount,
      criticasPct,
      criticasPctTotal: criticasPct,
      otActivas,
      otAbiertas: hasLive ? m.abiertos : base.otAbiertas ?? m.abiertos,
      otAtrasadas: hasLive ? 0 : base.otAtrasadas ?? 0,
      hallazgosTotales: m.total,
      hallazgosCerrados: m.cerrados,
      hallazgosAbiertos: m.abiertos,
      _liveCierre: hasLive,
      _liveRecepcion: hasLive,
    };
  }

  function countOtActivasFromHallazgos(allHallazgos) {
    // Misma regla que OT: 1 OT por (unidad × especialidad) con hallazgos abiertos.
    const keys = new Set();
    (allHallazgos || []).filter(isHallazgoAbierto).forEach((h) => {
      const esp = String(h.especialidad || "").trim() || "Sin especialidad";
      const unit = String(h.unitRef || h.unidad || "").trim() || "_";
      keys.add(unit + "|" + esp);
    });
    return keys.size;
  }

  function computeAggregatedClosureMetrics(units, allHallazgos, baseMetrics) {
    const base = baseMetrics || {};
    const m = countHallazgosMetrics(allHallazgos);
    const unitsTotal = base.unidadesTotales || units.length || 8;
    const isDeptoUnit = (u) => {
      const tipo = String((u && u.tipo) || "Departamento").toLowerCase();
      return !tipo || tipo.includes("departamento") || tipo === "depto";
    };
    // Inspeccionados = con captura. Listos/entregables = inspeccionados sin hallazgos abiertos.
    const unitsInspeccionadasLive = units.filter(
      (u) => isDeptoUnit(u) && hasLiveFindings(u._hallazgos || [])
    ).length;
    const unitsListasLive = units.filter((u) => {
      if (!isDeptoUnit(u) || !hasLiveFindings(u._hallazgos || [])) return false;
      const abiertos = u.abiertos != null ? u.abiertos : (u._hallazgos || []).filter(isHallazgoAbierto).length;
      return abiertos === 0;
    }).length;
    const unitsCierre = units.filter((u) => (u.cerrados || 0) > 0 && (u.abiertos || 0) === 0).length;
    const unitsListas = hasLiveFindings(allHallazgos)
      ? unitsListasLive
      : units.filter((u) => u.estado === "lista" && (u.hallazgos || 0) > 0).length;
    const hasLive = hasLiveFindings(allHallazgos);
    const hallazgosTotalProyecto = base.observacionesTotales || 0;
    // Compat: unidadesRecibidas en live = inspeccionadas (no “entregadas”).
    const unidadesInspeccionadas = hasLive ? unitsInspeccionadasLive : base.unidadesRecibidas ?? unitsInspeccionadasLive;
    const unidadesRecibidas = unidadesInspeccionadas;
    const avanceUnidadesRecibidas = unitsTotal ? Math.round((unidadesInspeccionadas / unitsTotal) * 100) : 0;
    const avanceUnidadesListas = unitsTotal ? Math.round((unitsListas / unitsTotal) * 100) : 0;

    // Live: recepción = cobertura de inspección (captura), no entrega final.
    // Live: cierre = % hallazgos cerrados sobre capturados.
    const hallazgosRecepcion = hasLive ? unidadesInspeccionadas : Math.round((hallazgosTotalProyecto * (base.avanceRecepcion || 0)) / 100);
    const hallazgosRecepcionTotal = hasLive ? unitsTotal : hallazgosTotalProyecto;
    const avanceRecepcion = hasLive
      ? avanceUnidadesRecibidas
      : base.avanceRecepcion ?? 0;
    const unidadesCierre = hasLive ? unitsCierre : base.unidadesCierre ?? unitsCierre;
    const avanceCierreHallazgos = m.total ? m.avanceCierre : 0;
    const avanceCierre = hasLive
      ? avanceCierreHallazgos
      : unitsTotal
        ? Math.round((unidadesCierre / unitsTotal) * 100)
        : base.avanceCierre ?? 0;

    if (!hasLive && !m.total) {
      return {
        ...base,
        hallazgosRecepcion,
        hallazgosRecepcionTotal,
        avanceUnidadesRecibidas,
        _liveCierre: false,
        _liveRecepcion: false,
      };
    }

    const otActivas = hasLive ? countOtActivasFromHallazgos(allHallazgos) : base.otActivas;
    const criticasPctLive = m.total ? Math.round((m.criticasAbiertas / m.total) * 1000) / 10 : 0;

    return {
      ...base,
      avanceRecepcion,
      hallazgosRecepcion,
      hallazgosRecepcionTotal,
      unidadesRecibidas,
      unidadesInspeccionadas,
      avanceUnidadesRecibidas,
      avanceUnidadesListas,
      unidadesTotales: unitsTotal,
      avanceCierre,
      avanceCierreHallazgos: hasLive ? avanceCierreHallazgos : null,
      unidadesCierre,
      observacionesAbiertas: hasLive ? m.abiertos : base.observacionesAbiertas ?? m.abiertos,
      observacionesTotales: hasLive ? m.total : base.observacionesTotales ?? m.total,
      criticas: hasLive ? m.criticasAbiertas : base.criticas ?? m.criticasAbiertas,
      criticasAbiertas: hasLive ? m.criticasAbiertas : base.criticasAbiertas ?? m.criticasAbiertas,
      criticasPct: hasLive ? criticasPctLive : m.total ? Math.round((m.criticasAbiertas / m.total) * 1000) / 10 : base.criticasPct,
      criticasPctTotal: hasLive ? criticasPctLive : base.criticasPctTotal ?? criticasPctLive,
      otActivas: hasLive ? otActivas : base.otActivas,
      otAbiertas: hasLive ? m.abiertos : base.otAbiertas ?? m.abiertos,
      // Sin fechas de vencimiento live: no arrastrar OT atrasadas del seed demo.
      otAtrasadas: hasLive ? 0 : base.otAtrasadas ?? 0,
      unidadesListas: hasLive ? unitsListas : base.unidadesListas,
      unidadesListasPct: unitsTotal
        ? Math.round(((hasLive ? unitsListas : base.unidadesListas || 0) / (base.unidadesTotales || unitsTotal)) * 100)
        : base.unidadesListasPct,
      hallazgosTotales: m.total,
      hallazgosCerrados: m.cerrados,
      hallazgosAbiertos: m.abiertos,
      _liveCierre: hasLive,
      _liveRecepcion: hasLive,
    };
  }

  function parseIsoDate(iso) {
    if (!iso) return null;
    const str = String(iso).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    out.setDate(out.getDate() + n);
    return out;
  }

  function daysBetween(a, b) {
    const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
    return Math.round(ms / 86400000);
  }

  function fmtEntregaDate(dOrIso) {
    if (!dOrIso) return "—";
    if (typeof dOrIso === "string") {
      const p = String(dOrIso).slice(0, 10).split("-");
      return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : dOrIso;
    }
    const dd = String(dOrIso.getDate()).padStart(2, "0");
    const mm = String(dOrIso.getMonth() + 1).padStart(2, "0");
    const yyyy = dOrIso.getFullYear();
    return dd + "/" + mm + "/" + yyyy;
  }

  function earliestHallazgoDate(hallazgos) {
    let best = null;
    (hallazgos || []).forEach((h) => {
      const raw = h.fecha || h.createdAt || h.abiertoEn || h.openedAt;
      const d = parseIsoDate(raw) || (raw ? new Date(raw) : null);
      if (!d || Number.isNaN(d.getTime())) return;
      const day = startOfDay(d);
      if (!best || day < best) best = day;
    });
    return best;
  }

  /**
   * Pronóstico de entrega del proyecto:
   * - Comprometida: fecha total del proyecto
   * - Proyectada: según ritmo de avance (recepción 60% + cierre 40%)
   * - Cumplimiento: En plazo / Atención / Riesgo / Crítico
   */
  function computeEntregaForecast(project, metrics, hallazgos, hasLive) {
    const m = metrics || {};
    const comprometida = parseIsoDate(project && project.fechaComprometidaEntrega);
    const today = startOfDay(new Date());
    const start =
      parseIsoDate(project && project.fechaInicioRecepcion) ||
      earliestHallazgoDate(hallazgos) ||
      parseIsoDate(project && project.inspectionDate) ||
      addDays(today, -14);

    const avRec = Number(m.avanceRecepcion) || 0;
    const avCie =
      Number(hasLive ? m.avanceCierreHallazgos ?? m.avanceCierre : m.avanceCierre ?? m.avanceUnidadesRecibidas) || 0;
    const avance = Math.min(100, Math.round(avRec * 0.6 + avCie * 0.4));
    const elapsed = Math.max(0, daysBetween(start, today));

    let proyectada = null;
    let diasHolgura = null;
    if (avance >= 100) {
      proyectada = today;
    } else if (avance > 0 && elapsed > 0) {
      const totalDays = Math.ceil(elapsed / (avance / 100));
      proyectada = addDays(start, totalDays);
    } else if (comprometida) {
      proyectada = comprometida;
    }

    if (proyectada && comprometida) {
      diasHolgura = daysBetween(proyectada, comprometida);
    }

    let label = (project && project.riesgoEntrega) || "Atención";
    let cls = "pendiente_intermedio";
    const crit = m.criticasAbiertas || 0;

    if (crit > 0 && hasLive) {
      label = "Crítico";
      cls = "critico";
    } else if (comprometida && proyectada) {
      if (diasHolgura >= 0) {
        label = "En plazo";
        cls = diasHolgura >= 14 ? "lista" : "pendiente_menor";
      } else if (diasHolgura >= -30) {
        label = "Atención";
        cls = "pendiente_intermedio";
      } else if (diasHolgura >= -90) {
        label = "Riesgo";
        cls = "pendiente_intermedio";
      } else {
        label = "Crítico";
        cls = "critico";
      }
    } else if (hasLive) {
      if ((m.hallazgosTotales || 0) > 0 && (m.hallazgosAbiertos || 0) === 0 && avRec >= 100) {
        label = "En plazo";
        cls = "lista";
      } else {
        label = "Atención";
        cls = "pendiente_intermedio";
      }
    } else {
      const fb = String(label)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      cls = fb || "pendiente_intermedio";
    }

    return {
      comprometida,
      proyectada,
      avance,
      diasHolgura,
      label,
      cls,
      start,
    };
  }

  function riesgoEntregaFromMetrics(metrics, hasLive, fallback, project, hallazgos) {
    if (project) {
      const f = computeEntregaForecast(project, metrics, hallazgos, hasLive);
      return { label: f.label, cls: f.cls, forecast: f };
    }
    const m = metrics || {};
    if (!hasLive) {
      const label = fallback || "Crítico";
      const cls = String(label)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return { label, cls: cls || "critico" };
    }
    const crit = m.criticasAbiertas || 0;
    const abiertos = m.hallazgosAbiertos ?? m.observacionesAbiertas ?? 0;
    const total = m.hallazgosTotales || 0;
    if (crit > 0) return { label: "Crítico", cls: "critico" };
    if (total > 0 && abiertos === 0) return { label: "En plazo", cls: "lista" };
    if ((m.avanceCierre || 0) < 25) return { label: "Atención", cls: "pendiente_intermedio" };
    return { label: "En curso", cls: "pendiente_menor" };
  }

  function enrichChartsWithHallazgos(hallazgos, charts, kpiCatalog) {
    const c = charts ? { ...charts } : {};
    if (!hallazgos || !hallazgos.length) return c;

    const kpiItems = chartDataKpi({ hallazgos, seedItems: c.hallazgosPorKpi || [], catalog: kpiCatalog });
    if (kpiItems.length) c.hallazgosPorKpi = kpiItems;

    const espItems = chartDataEsp({
      hallazgos,
      seedItems: c.observacionesPorEspecialidad || [],
      catalog: kpiCatalog,
      limit: 10,
    });
    if (espItems.length) c.observacionesPorEspecialidad = espItems;

    const timeline = hallazgosTimeline(hallazgos);
    if (timeline) c.aperturasVsCierres = timeline;

    return c;
  }

  function enrichFloorDetailWithFindings(project, floorId, findingsMap, seed, kpiCatalog, hasLive) {
    const liveMode = hasLive == null ? findingsMapHasLiveFetch(findingsMap, seed, project.id) : !!hasLive;
    const base = resolveFloorDetail(project, floorId);
    if (!base) return null;
    const detail = {
      ...base,
      units: (base.units || []).map((u) => {
        const hall = hallazgosForUnitMode(findingsMap, seed, project.id, u.ref, liveMode);
        const clean = liveMode
          ? { ref: u.ref, piso: u.piso, tipo: u.tipo, estado: "no_inspeccionado", avance: 0, hallazgos: 0, criticas: 0 }
          : u;
        return mergeUnitSummaryWithFindings(clean, hall, { authoritative: liveMode });
      }),
    };
    const floorHallazgos = [];
    detail.units.forEach((u) => {
      (u._hallazgos || []).forEach((h) => {
        floorHallazgos.push({ ...h, unitRef: h.unitRef || u.ref, piso: floorNumberFromId(floorId) });
      });
    });
    const liveFloor = liveHallazgosOnly(floorHallazgos);
    const metricsHallazgos = liveMode ? floorHallazgos : liveFloor.length ? liveFloor : floorHallazgos;
    const chartBase = liveMode
      ? {
          hallazgosPorKpi: [],
          observacionesPorEspecialidad: [],
          // Si no hay serie live, conservar seed para no romper el gráfico de línea.
          aperturasVsCierres: (base.charts && base.charts.aperturasVsCierres) || null
        }
      : base.charts || {
          hallazgosPorKpi: [],
          observacionesPorEspecialidad: [],
          aperturasVsCierres: null
        };
    detail.metrics = computeFloorMetrics(
      detail.units,
      metricsHallazgos,
      liveMode ? { unidadesTotales: (detail.units || []).length } : base.metrics
    );
    if (liveMode && !hasLiveFindings(metricsHallazgos)) {
      const n = (detail.units || []).length || 0;
      detail.metrics = {
        ...(detail.metrics || {}),
        avanceRecepcion: 0,
        avanceCierre: 0,
        avanceCierreHallazgos: 0,
        avanceUnidadesRecibidas: 0,
        unidadesRecibidas: 0,
        unidadesInspeccionadas: 0,
        unidadesListas: 0,
        unidadesTotales: n,
        observacionesAbiertas: 0,
        observacionesTotales: 0,
        criticas: 0,
        criticasAbiertas: 0,
        criticasPct: 0,
        otActivas: 0,
        otAbiertas: 0,
        hallazgosTotales: 0,
        hallazgosCerrados: 0,
        hallazgosAbiertos: 0,
        _liveCierre: true,
        _liveRecepcion: true,
      };
    }
    detail.charts = enrichChartsWithHallazgos(metricsHallazgos, chartBase, kpiCatalog);
    detail._liveCierre = liveMode ? true : detail.metrics._liveCierre;
    return detail;
  }

  function buildAvanceCierrePorPiso(project, findingsMap, seed) {
    const hasLive = findingsMapHasLiveFetch(findingsMap, seed, project.id);
    return floorsForPisoSelector(project).map((f) => {
      const base = resolveFloorDetail(project, f.id);
      const units = (base && base.units ? base.units : synthFloorUnits(f)).map((u) =>
        mergeUnitSummaryWithFindings(
          hasLive
            ? { ref: u.ref, piso: u.piso, tipo: u.tipo, estado: "no_inspeccionado", avance: 0, hallazgos: 0, criticas: 0 }
            : u,
          hallazgosForUnitMode(findingsMap, seed, project.id, u.ref, hasLive),
          { authoritative: hasLive }
        )
      );
      const fh = units.flatMap((u) => u._hallazgos || []);
      const fm = computeFloorMetrics(
        units,
        fh,
        hasLive ? { unidadesTotales: units.length } : (base && base.metrics) || {}
      );
      const inspeccionadas = units.filter((u) => hasLiveFindings(u._hallazgos || [])).length;
      return {
        label: f.name,
        value: hasLive ? (fm.avanceCierreHallazgos ?? fm.avanceCierre ?? 0) : (f.avanceRecepcion || 0),
        color: "#22C55E",
        inspeccionadas,
        hallazgos: fh.length,
      };
    });
  }

  function enrichProjectWithFindings(project, findingsMap, seed, kpiCatalog) {
    const hasLive = findingsMapHasLiveFetch(findingsMap, seed, project.id);
    // Con live: solo hallazgos del API. Sin live: seed + lo que haya.
    const sourceHallazgos = hasLive
      ? projectUnitKeys(seed, project.id).flatMap((key) => {
          if (!findingsMapHasKey(findingsMap, key)) return [];
          const ref = key.split(":")[1];
          return (findingsMap[key] || []).map((h) => ({ ...h, unitRef: h.unitRef || ref }));
        })
      : flattenProjectHallazgos(findingsMap, seed, project.id);
    const allHallazgos = sourceHallazgos;

    const allUnits = unitsForUnitSelector(project, seed).map((u) => {
      const sum = findFloorUnitSummary(project, u.ref);
      const base = sum
        ? { ...sum.summary, piso: u.piso != null ? u.piso : sum.summary.piso }
        : {
            ref: u.ref,
            piso: u.piso,
            estado: "no_inspeccionado",
            avance: 0,
            hallazgos: 0,
            criticas: 0,
            tipo: "Departamento",
          };
      // Evita arrastrar estado/críticas demo del seed al merge.
      const cleanBase = hasLive
        ? {
            ref: base.ref,
            piso: base.piso,
            tipo: base.tipo || "Departamento",
            estado: "no_inspeccionado",
            avance: 0,
            hallazgos: 0,
            criticas: 0,
          }
        : base;
      const hall = hallazgosForUnitMode(findingsMap, seed, project.id, u.ref, hasLive);
      return mergeUnitSummaryWithFindings(cleanBase, hall, { authoritative: hasLive });
    });

    const deptosTotales =
      (project.composition && project.composition.departamentos) ||
      (project.metrics && project.metrics.unidadesTotales) ||
      null;
    const metrics = computeAggregatedClosureMetrics(allUnits, sourceHallazgos, {
      ...(project.metrics || {}),
      // Recepción del proyecto se mide sobre departamentos (no locales/oficinas).
      unidadesTotales: deptosTotales || (project.metrics && project.metrics.unidadesTotales),
    });
    const charts = hasLive
      ? enrichChartsWithHallazgos(
          sourceHallazgos,
          { hallazgosPorKpi: [], observacionesPorEspecialidad: [], aperturasVsCierres: null },
          kpiCatalog
        )
      : enrichChartsWithHallazgos(sourceHallazgos, project.charts, kpiCatalog);
    const avancePorPiso = buildAvanceCierrePorPiso(project, findingsMap, seed);

    const floorsUpdated = (project.floors || []).map((f) => {
      const units = (resolveFloorDetail(project, f.id)?.units || synthFloorUnits(f)).map((u) =>
        mergeUnitSummaryWithFindings(
          hasLive
            ? { ref: u.ref, piso: u.piso, tipo: u.tipo, estado: "no_inspeccionado", avance: 0, hallazgos: 0, criticas: 0 }
            : u,
          hallazgosForUnitMode(findingsMap, seed, project.id, u.ref, hasLive),
          { authoritative: hasLive }
        )
      );
      return { ...f, cells: units.map((u) => u.estado || "no_inspeccionado") };
    });

    // Actualiza floorDetail para elevación / plantas.
    const floorDetailUpdated = { ...(project.floorDetail || {}) };
    Object.keys(floorDetailUpdated).forEach((floorId) => {
      const enrichedFloor = enrichFloorDetailWithFindings(project, floorId, findingsMap, seed, kpiCatalog, hasLive);
      if (enrichedFloor) floorDetailUpdated[floorId] = enrichedFloor;
    });
    floorsForPisoSelector(project).forEach((f) => {
      if (!floorDetailUpdated[f.id]) {
        const enrichedFloor = enrichFloorDetailWithFindings(
          { ...project, floorDetail: floorDetailUpdated },
          f.id,
          findingsMap,
          seed,
          kpiCatalog,
          hasLive
        );
        if (enrichedFloor) floorDetailUpdated[f.id] = enrichedFloor;
      }
    });

    const topCriticas = allUnits
      .filter((u) => (u.criticas || 0) > 0)
      .sort((a, b) => (b.criticas || 0) - (a.criticas || 0))
      .slice(0, 5)
      .map((u) => ({
        unidad: u.ref,
        piso: u.piso != null ? u.piso : parseInt(String(u.ref).charAt(0), 10) || null,
        criticas: u.criticas,
        abiertos: u.abiertos || 0,
        hallazgos: u.hallazgos || 0,
        estado: u.estado,
        mode: "criticas",
      }));
    const topConHallazgos = allUnits
      .filter((u) => (u.abiertos || 0) > 0 || (u.hallazgos || 0) > 0)
      .sort(
        (a, b) =>
          (b.abiertos || 0) - (a.abiertos || 0) ||
          (b.hallazgos || 0) - (a.hallazgos || 0) ||
          String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true })
      )
      .slice(0, 5)
      .map((u) => ({
        unidad: u.ref,
        piso: u.piso != null ? u.piso : parseInt(String(u.ref).charAt(0), 10) || null,
        criticas: u.criticas || 0,
        abiertos: u.abiertos || 0,
        hallazgos: u.hallazgos || 0,
        estado: u.estado,
        mode: "abiertos",
      }));
    const topUnidades = topCriticas.length ? topCriticas : topConHallazgos;

    const panelGerencial = hasLive
      ? buildPanelGerencial(sourceHallazgos, metrics, allUnits, kpiCatalog)
      : project.panelGerencial;
    const resumenEjecutivo = buildProjectResumenEjecutivo(project, metrics, sourceHallazgos, hasLive);
    const accionesLive = buildAccionesRecomendadas(sourceHallazgos, panelGerencial, hasLive);
    const accionesRecomendadas = accionesLive || project.accionesRecomendadas || [];
    const riesgo = riesgoEntregaFromMetrics(metrics, hasLive, project.riesgoEntrega, project, sourceHallazgos);
    const forecast = riesgo.forecast || computeEntregaForecast(project, metrics, sourceHallazgos, hasLive);

    return {
      project: {
        ...project,
        metrics,
        charts,
        floors: floorsUpdated,
        floorDetail: floorDetailUpdated,
        panelGerencial,
        resumenEjecutivo,
        accionesRecomendadas,
        riesgoEntrega: riesgo.label,
        fechaProyectadaEntrega: forecast.proyectada
          ? forecast.proyectada.getFullYear() +
            "-" +
            String(forecast.proyectada.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(forecast.proyectada.getDate()).padStart(2, "0")
          : project.fechaProyectadaEntrega,
      },
      allHallazgos: sourceHallazgos,
      avancePorPiso,
      topUnidadesCriticas: hasLive ? topUnidades : (project.charts && project.charts.topUnidadesCriticas) || [],
      hasLive,
      units: allUnits,
      chartHallazgos: sourceHallazgos,
    };
  }

  async function loadFloorFindingsMap(seed, projectId, floorId, project) {
    const units = unitsForUnitSelector(project || {}, seed, { floorId });
    const map = {};
    await Promise.all(
      units.map(async (u) => {
        const key = `${projectId}:${u.ref}`;
        const live = await loadUnitFindings(key);
        if (live !== null) map[key] = live;
      })
    );
    return map;
  }

  function flattenProjectHallazgos(findingsMap, seed, projectId) {
    const out = [];
    projectUnitKeys(seed, projectId).forEach((key) => {
      const ref = key.split(":")[1];
      const unit = (seed.units || {})[key] || {};
      const list = findingsMapHasKey(findingsMap, key)
        ? findingsMap[key] || []
        : (unit.hallazgos || []);
      list.forEach((h) => {
        out.push({ ...h, unitRef: ref, piso: unit.piso });
      });
    });
    return out;
  }

  function unitFromKey(seed, unitKey) {
    return (seed.units || {})[unitKey] || { ref: unitKey.split(":")[1] };
  }

  function reportPrintWrap(ctx, title, subtitle, bodyHtml) {
    const project = ctx.project || {};
    const tenant = ctx.tenant || {};
    const emittedAt = ctx.emittedAt || fmtDateShort(new Date());
    return `<div class="ot-print-sheet rep-print-sheet">
      <header class="ot-print-header">
        <img src="/assets/Logo%20Ainspecciona.png" alt="Ainspecciona" class="ot-print-logo"/>
        <div class="ot-print-header-text">
          <div class="ot-print-tenant">${escapeHtml(tenant.name || "Ainspecciona Recepción")}</div>
          <h1>${escapeHtml(title)}</h1>
          <div class="ot-print-sub">${escapeHtml(subtitle || "")}</div>
          <div class="ot-print-id">${escapeHtml(project.name || "—")} · ${escapeHtml(project.building || "")} · ${escapeHtml(emittedAt)}</div>
        </div>
      </header>
      ${bodyHtml}
    </div>`;
  }

  function reportMetaGrid(items) {
    return `<div class="ot-print-grid rep-print-meta">${(items || [])
      .map((i) => `<div><span>${escapeHtml(i.label)}</span><b>${i.html != null ? i.html : escapeHtml(i.value)}</b></div>`)
      .join("")}</div>`;
  }

  function reportTableHtml(headers, rowsHtml) {
    const head = (headers || []).map((h) => `<th>${escapeHtml(h)}</th>`).join("");
    return `<table class="rep-print-table"><thead><tr>${head}</tr></thead><tbody>${rowsHtml || ""}</tbody></table>`;
  }

  function hallazgoDualPhotoPrintHtml(h) {
    const r0 = hallazgoPhotoPrintHtml(h, { large: false });
    const resolved = h.fotoResueltaUrl || h.fotoCierreUrl;
    const after = resolved
      ? `<img class="ot-print-ph" src="${escapeHtml(absUrl(resolved))}" alt=""/>`
      : h.estado === "cerrado"
        ? `<div class="ot-print-ph ot-print-ph-empty">Cierre registrado</div>`
        : `<div class="ot-print-ph ot-print-ph-empty">Pendiente</div>`;
    return `<div class="rep-dual-photo"><div><div class="rep-photo-label">Antes (R0)</div>${r0}</div><div><div class="rep-photo-label">Después</div>${after}</div></div>`;
  }

  function hallazgoUnitReportItemHtml(h, n) {
    const sev = String(h.severidad || "menor");
    return `<article class="ot-print-item rep-unit-item">
      <div class="ot-print-item-head">
        <span class="ot-print-item-num">#${n}</span>
        <span class="ot-print-item-rec">${escapeHtml(h.recinto || "Sin recinto")}</span>
        <span class="ot-print-item-sev ot-print-sev-${escapeHtml(sev)}">${escapeHtml(sev)}</span>
      </div>
      <div class="ot-print-item-body rep-unit-body">
        <div class="ot-print-item-photo">${hallazgoDualPhotoPrintHtml(h)}</div>
        <div class="ot-print-item-text">
          <div class="ot-print-item-label">Observación</div>
          <p class="ot-print-item-desc">${escapeHtml(h.descripcion || "—")}</p>
          <div class="ot-print-item-meta">KPI: ${escapeHtml(h.kpi || "—")} · Especialidad: ${escapeHtml(h.especialidad || "—")} · Estado: ${escapeHtml(h.estado || "—")} · Apertura: ${fmtDateShort(h.apertura)}${h.cierre ? ` · Cierre: ${fmtDateShort(h.cierre)}` : ""}</div>
        </div>
      </div>
    </article>`;
  }

  const REPORT_TITLES = {
    acta: "Acta de recepción",
    por_unidad: "Informe de hallazgos por unidad",
    por_especialidad: "Informe por especialidad",
    por_piso: "Informe por piso / torre",
    punch_list: "Punch list — observaciones abiertas",
    avance_cierre: "Avance de cierre y levantamiento",
    ejecutivo: "Reporte ejecutivo / gerencial",
    certificado: "Certificado de unidad lista",
  };

  function buildReportHtml(reportId, ctx) {
    const project = ctx.project || {};
    const seed = ctx.seed || {};
    const kpiCatalog = ctx.kpiCatalog || {};
    const findingsMap = ctx.findingsMap || {};
    const unitKey = ctx.unitKey || projectUnitKeys(seed, project.id)[0];
    const unit = unitFromKey(seed, unitKey);
    const unitHallazgos = findingsMap[unitKey] || unit.hallazgos || [];
    const allHallazgos = flattenProjectHallazgos(findingsMap, seed, project.id);
    const openAll = allHallazgos.filter((h) => h.estado === "abierto");
    const title = REPORT_TITLES[reportId] || "Reporte";
    const addr = [project.building, project.address].filter(Boolean).join(" · ");

    switch (reportId) {
      case "acta": {
        const abiertos = unitHallazgos.filter((h) => h.estado === "abierto").length;
        const meta = reportMetaGrid([
          { label: "Unidad", value: unit.ref || "—" },
          { label: "Piso", value: unit.piso != null ? String(unit.piso) : "—" },
          { label: "Inspector", value: unit.inspector || "—" },
          { label: "Fecha inspección", value: fmtDateShort(unit.fechaInspeccion) },
          { label: "Hallazgos", value: `${unitHallazgos.length} (${abiertos} abiertos)` },
          { label: "Dirección", value: addr || "—" },
        ]);
        const rows = unitHallazgos
          .map(
            (h, i) =>
              `<tr><td class="num">${i + 1}</td><td>${escapeHtml(h.recinto)}</td><td>${escapeHtml(h.descripcion)}</td><td>${escapeHtml(h.kpi || "—")}</td><td>${escapeHtml(h.especialidad || "—")}</td><td>${escapeHtml(h.severidad || "—")}</td><td>${escapeHtml(h.estado || "—")}</td><td>${fmtDateShort(h.apertura)}</td></tr>`
          )
          .join("");
        const body =
          meta +
          `<p class="ot-print-brief">Acta formal de observaciones detectadas en la recepción técnica de la unidad. Las partes declaran conocer el listado y comprometen plan de corrección según severidad.</p>` +
          reportTableHtml(["#", "Recinto", "Descripción", "KPI", "Especialidad", "Severidad", "Estado", "Apertura"], rows || `<tr><td colspan="8">Sin hallazgos registrados.</td></tr>`) +
          `<div class="ot-print-signatures"><div><span>Inspector / ITO</span><div class="ot-print-line"></div></div><div><span>Representante constructora</span><div class="ot-print-line"></div></div><div><span>Fecha</span><div class="ot-print-line"></div></div></div>`;
        return reportPrintWrap(ctx, title, `Unidad ${unit.ref || "—"} · Recepción técnica`, body);
      }
      case "por_unidad": {
        const items = unitHallazgos.map((h, i) => hallazgoUnitReportItemHtml(h, i + 1)).join("");
        const meta = reportMetaGrid([
          { label: "Unidad", value: unit.ref || "—" },
          { label: "Tipo", value: unit.tipo || unit.tipoUnidad || "—" },
          { label: "Piso", value: unit.piso != null ? String(unit.piso) : "—" },
          { label: "Inspector", value: unit.inspector || "—" },
          { label: "Total hallazgos", value: String(unitHallazgos.length) },
        ]);
        const body =
          meta +
          `<p class="ot-print-brief">Detalle de hallazgos con evidencia fotográfica <b>Antes (R0)</b> y <b>Después</b> cuando existe cierre registrado.</p>` +
          `<h2 class="ot-print-section">Hallazgos (${unitHallazgos.length})</h2>` +
          `<div class="ot-print-items">${items || `<p>Sin hallazgos en esta unidad.</p>`}</div>`;
        return reportPrintWrap(ctx, title, `Unidad ${unit.ref || "—"}`, body);
      }
      case "por_especialidad": {
        const espItems = chartDataEsp({
          hallazgos: allHallazgos.length ? allHallazgos : null,
          seedItems: (project.charts && project.charts.observacionesPorEspecialidad) || [],
          catalog: kpiCatalog,
          limit: 15,
        });
        const summaryRows = espItems
          .map((e) => `<tr><td>${escapeHtml(e.label)}</td><td class="num">${fmt(e.value)}</td></tr>`)
          .join("");
        const groups = new Map();
        allHallazgos.forEach((h) => {
          const raw = String(h.especialidad || "Sin especialidad").trim();
          const label = normalizeEspecialidadLabel(raw, kpiCatalog) || raw;
          if (!groups.has(label)) groups.set(label, []);
          groups.get(label).push(h);
        });
        const sections = espItems
          .map((e) => {
            const list = groups.get(e.label) || [];
            if (!list.length) return "";
            const rows = list
              .slice(0, 20)
              .map(
                (h) =>
                  `<tr><td>${escapeHtml(h.unitRef || "—")}</td><td>${escapeHtml(h.recinto)}</td><td>${escapeHtml(h.descripcion)}</td><td>${escapeHtml(h.severidad || "—")}</td><td>${escapeHtml(h.estado || "—")}</td></tr>`
              )
              .join("");
            return `<h2 class="ot-print-section">${escapeHtml(e.label)} (${list.length})</h2>${reportTableHtml(["Unidad", "Recinto", "Descripción", "Sev.", "Estado"], rows)}`;
          })
          .join("");
        const body =
          reportMetaGrid([
            { label: "Proyecto", value: project.name || "—" },
            { label: "Observaciones (muestra)", value: String(allHallazgos.length || "—") },
            { label: "Especialidades", value: String(espItems.length) },
          ]) +
          `<h2 class="ot-print-section">Resumen por especialidad</h2>` +
          reportTableHtml(["Especialidad", "Observaciones"], summaryRows || `<tr><td colspan="2">Sin datos.</td></tr>`) +
          sections;
        return reportPrintWrap(ctx, title, "Asignación a subcontratistas", body);
      }
      case "por_piso": {
        const floors = project.floors || [];
        const byFloor = {};
        allHallazgos.forEach((h) => {
          const p = h.piso != null ? `Piso ${h.piso}` : "Sin piso";
          if (!byFloor[p]) byFloor[p] = { abiertos: 0, criticos: 0, total: 0 };
          byFloor[p].total += 1;
          if (h.estado === "abierto") byFloor[p].abiertos += 1;
          if (h.severidad === "critica" && h.estado === "abierto") byFloor[p].criticos += 1;
        });
        const rows = floors
          .map((f) => {
            const live = byFloor[f.name] || {};
            const avance = f.avanceRecepcion != null ? `${f.avanceRecepcion}%` : "—";
            const estado = STATE_LABELS[f.estado] || f.estado || "—";
            return `<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(estado)}</td><td class="num">${avance}</td><td class="num">${f.criticas ?? live.criticos ?? 0}</td><td class="num">${live.abiertos ?? "—"}</td><td class="num">${live.total ?? "—"}</td></tr>`;
          })
          .join("");
        const body =
          reportMetaGrid([
            { label: "Proyecto", value: project.name || "—" },
            { label: "Pisos", value: String(floors.length) },
            { label: "Riesgo entrega", value: project.riesgoEntrega || "—" },
          ]) +
          `<p class="ot-print-brief">Avance de recepción y criticidad por piso. Columnas <b>Abiertos</b> y <b>Hallazgos</b> reflejan unidades con detalle cargado (${projectUnitKeys(seed, project.id).length} unidades).</p>` +
          reportTableHtml(["Piso", "Estado", "% Avance", "Críticas", "Abiertos", "Hallazgos"], rows);
        return reportPrintWrap(ctx, title, project.building || "", body);
      }
      case "punch_list": {
        const sorted = [...openAll].sort(
          (a, b) =>
            (b.severidad === "critica") - (a.severidad === "critica") ||
            (b.severidad === "intermedia") - (a.severidad === "intermedia") ||
            String(a.unitRef).localeCompare(String(b.unitRef), undefined, { numeric: true })
        );
        const items = sorted.map((h, i) => {
          const n = i + 1;
          const copy = { ...h, descripcion: `[${h.unitRef}] ${h.descripcion}` };
          return hallazgoPrintItemHtml(copy, n);
        }).join("");
        const body =
          reportMetaGrid([
            { label: "Proyecto", value: project.name || "—" },
            { label: "Observaciones abiertas", value: String(sorted.length) },
            { label: "Críticas abiertas", value: String(sorted.filter((h) => h.severidad === "critica").length) },
          ]) +
          `<p class="ot-print-brief">Listado de punch para constructora: solo observaciones <b>abiertas</b>, ordenadas por severidad. Cada ítem incluye foto R0 y descripción del trabajo pendiente.</p>` +
          `<h2 class="ot-print-section">Pendientes (${sorted.length})</h2>` +
          `<div class="ot-print-items">${items || `<p>No hay observaciones abiertas en las unidades cargadas.</p>`}</div>`;
        return reportPrintWrap(ctx, title, "Constructora · plan de cierre", body);
      }
      case "avance_cierre": {
        const enriched = enrichProjectWithFindings(project, findingsMap, seed, kpiCatalog);
        const liveMetrics = enriched.project.metrics || {};
        const timeline =
          hallazgosTimeline(allHallazgos) ||
          (project.charts && project.charts.aperturasVsCierres) ||
          null;
        const ots = projectOtsFromFindingsMap(findingsMap, seed, project.id, kpiCatalog);
        const rows = timeline
          ? timeline.labels
              .map(
                (l, i) =>
                  `<tr><td>${escapeHtml(l)}</td><td class="num">${fmt(timeline.aperturas[i] || 0)}</td><td class="num">${fmt(timeline.cierres[i] || 0)}</td></tr>`
              )
              .join("")
          : "";
        const body =
          reportMetaGrid([
            { label: "Avance cierre", value: `${liveMetrics.avanceCierre != null ? liveMetrics.avanceCierre : "—"}%` },
            { label: "Hallazgos cerrados", value: `${liveMetrics.hallazgosCerrados != null ? liveMetrics.hallazgosCerrados : "—"} / ${liveMetrics.hallazgosTotales != null ? liveMetrics.hallazgosTotales : "—"}` },
            { label: "OT activas", value: String(liveMetrics.otActivas || ots.length || 0) },
            { label: "OT atrasadas", value: String(liveMetrics.otAtrasadas || project.metrics && project.metrics.otAtrasadas || 0) },
          ]) +
          `<h2 class="ot-print-section">Aperturas vs cierres</h2>` +
          (timeline
            ? reportTableHtml(["Periodo", "Aperturas", "Cierres"], rows)
            : `<p>Sin serie temporal disponible.</p>`) +
          `<h2 class="ot-print-section" style="margin-top:16px">OT por especialidad (proyecto)</h2>` +
          reportTableHtml(
            ["OT", "Unidad", "Especialidad", "Hallazgos", "Críticos"],
            ots
              .slice(0, 25)
              .map(
                (o) =>
                  `<tr><td>${escapeHtml(o.id)}</td><td>${escapeHtml(o.unidad || "—")}</td><td>${escapeHtml(o.especialidad || "—")}</td><td class="num">${o.count || 0}</td><td class="num">${o.criticos || 0}</td></tr>`
              )
              .join("") || `<tr><td colspan="5">Sin OT activas.</td></tr>`
          );
        return reportPrintWrap(ctx, title, "Seguimiento de levantamiento", body);
      }
      case "ejecutivo": {
        const m = project.metrics || {};
        const kpiItems = chartDataKpi({
          hallazgos: allHallazgos.length ? allHallazgos : null,
          seedItems: (project.charts && project.charts.hallazgosPorKpi) || [],
          catalog: kpiCatalog,
        });
        const kpiRows = kpiItems
          .slice(0, 12)
          .map((k) => `<tr><td>${escapeHtml(k.label)}</td><td class="num">${fmt(k.value)}</td></tr>`)
          .join("");
        const dom = allHallazgos.length ? kpiDominante(allHallazgos, kpiCatalog.kpis) : project.panelGerencial && project.panelGerencial.kpiDominante;
        const body =
          reportMetaGrid([
            { label: "Avance recepción", value: `${m.avanceRecepcion != null ? m.avanceRecepcion : "—"}%` },
            { label: "Avance cierre", value: `${m.avanceCierre != null ? m.avanceCierre : "—"}%` },
            { label: "Unidades recibidas", value: `${m.unidadesRecibidas != null ? m.unidadesRecibidas : "—"} / ${m.unidadesTotales != null ? m.unidadesTotales : "—"}` },
            { label: "Riesgo entrega", value: project.riesgoEntrega || "—" },
          ]) +
          `<table class="rep-print-table"><tr><th>Indicador</th><th>Valor</th></tr>
            <tr><td>Observaciones totales (proyecto)</td><td class="num">${fmt(m.observacionesTotales || allHallazgos.length || 0)}</td></tr>
            <tr><td>Críticas abiertas</td><td class="num">${m.criticasAbiertas != null ? m.criticasAbiertas : openAll.filter((h) => h.severidad === "critica").length}</td></tr>
            <tr><td>OT activas / atrasadas</td><td class="num">${m.otActivas != null ? m.otActivas : "—"} / ${m.otAtrasadas != null ? m.otAtrasadas : "—"}</td></tr>
            <tr><td>KPI dominante</td><td>${escapeHtml((dom && dom.nombre) || "—")}${dom && dom.pct != null ? ` (${dom.pct}%)` : ""}</td></tr>
          </table>` +
          `<h2 class="ot-print-section">Distribución por KPI (taxonomía)</h2>` +
          reportTableHtml(["KPI", "Observaciones"], kpiRows || `<tr><td colspan="2">Sin datos.</td></tr>`) +
          `<p class="ot-print-brief" style="margin-top:14px">${escapeHtml(project.resumenEjecutivo || "")}</p>`;
        return reportPrintWrap(ctx, title, "Panel gerencial", body);
      }
      case "certificado": {
        const abiertos = unitHallazgos.filter((h) => h.estado === "abierto").length;
        const listo = abiertos === 0 && unitHallazgos.length >= 0;
        const statusHtml = listo
          ? `<p class="rep-cert-status ok">La unidad <b>${escapeHtml(unit.ref)}</b> ha cerrado la totalidad de sus observaciones registradas y se encuentra <b>lista para entrega</b>.</p>`
          : `<p class="rep-cert-status warn">La unidad <b>${escapeHtml(unit.ref)}</b> aún presenta <b>${abiertos}</b> observación(es) abierta(s) y <b>no puede certificarse</b> como lista para entrega.</p>`;
        const body =
          reportMetaGrid([
            { label: "Unidad", value: unit.ref || "—" },
            { label: "Proyecto", value: project.name || "—" },
            { label: "Piso", value: unit.piso != null ? String(unit.piso) : "—" },
            { label: "Hallazgos totales", value: String(unitHallazgos.length) },
            { label: "Estado", value: listo ? "Lista para entrega" : "Con pendientes" },
          ]) +
          `<div class="rep-cert-body">${statusHtml}<p class="rep-cert-legal">Certificado emitido conforme al proceso de recepción técnica Ainspecciona Recepción. Válido como respaldo documental previo a escrituración / entrega de llaves.</p></div>` +
          `<div class="ot-print-signatures"><div><span>Inspector / ITO</span><div class="ot-print-line"></div></div><div><span>Gerente proyecto</span><div class="ot-print-line"></div></div><div><span>Fecha entrega</span><div class="ot-print-line"></div></div></div>`;
        return reportPrintWrap(ctx, title, listo ? "Unidad apta para entrega" : "Certificado condicional — pendientes", body);
      }
      default:
        return reportPrintWrap(ctx, title, "", `<p>Reporte no disponible.</p>`);
    }
  }

  window.Entrega = {
    ensureAuth,
    logout,
    entregaFetch,
    setStoredToken,
    loadSeed,
    loadKpiCatalog,
    qs,
    currentProjectId,
    setProject,
    getProject,
    entregaProjects,
    ENTREGA_PROJECT_ID,
    fmt,
    svgIcon,
    renderSidebar,
    projectSelector,
    bindProjectSelector,
    dateChip,
    withProject,
    ensureChartDefaults,
    donutChart,
    barChart,
    lineChart,
    legendList,
    hallazgosPorKpi,
    hallazgosPorRecinto,
    hallazgosPorEspecialidad,
    hallazgosTimeline,
    kpiDominante,
    buildUnitResumen,
    chartDataKpi,
    chartDataEsp,
    remapOtChart,
    otsFromHallazgos,
    projectOtsFromSeed,
    projectOtsFromFindingsMap,
    buildPanelGerencial,
    buildProjectResumenEjecutivo,
    buildAccionesRecomendadas,
    escapeHtml,
    fmtDateShort,
    hallazgoPhotoHtml,
    otHallazgosDetailHtml,
    otPrintSheetHtml,
    otPrintAllHtml,
    printOtDocuments,
    printReportDocuments,
    projectUnitKeys,
    resolveUnitRecord,
    recintosForUnit,
    mergeRecintosFromHallazgos,
    defaultUnitRecintos,
    floorsForPisoSelector,
    resolveFloorDetail,
    unitsForUnitSelector,
    unitSelectorHtml,
    bindUnitSelector,
    capturaUnitOptionsHtml,
    reportUnitSelectorHtml,
    PISO_VIEW_MIN,
    PISO_VIEW_MAX,
    loadUnitFindings,
    loadProjectFindingsMap,
    loadFloorFindingsMap,
    enrichFloorDetailWithFindings,
    enrichProjectWithFindings,
    riesgoEntregaFromMetrics,
    computeEntregaForecast,
    fmtEntregaDate,
    mergeUnitSummaryWithFindings,
    computeAggregatedClosureMetrics,
    flattenProjectHallazgos,
    buildReportHtml,
    REPORT_TITLES,
    KPI_COLORS,
    STATE_COLORS,
    STATE_LABELS,
    estadoForUnitDisplay,
    getTheme,
    applyTheme,
    chartPalette,
    cssVar,
  };

  // Compat: enlace antiguo /entrega?p=...#ot → vista OT
  if (typeof location !== "undefined") {
    const path = location.pathname.replace(/\/$/, "");
    if (path === "/entrega" && location.hash === "#ot") {
      const pid = ENTREGA_PROJECT_ID;
      location.replace(withProject("/entrega/ot", pid));
    }
  }
})();
