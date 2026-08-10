(function () {
  const TOKEN_KEY = "postventa_session";
  const STALE_KEY = "pv_portal_data_stale";
  const STATUS_OVERRIDES_KEY = "pv_portal_status_overrides";
  let ME = null;

  function getTheme() {
    try {
      return localStorage.getItem("postventa-portal-theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  }

  function applyTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("postventa-portal-theme", t);
    } catch {
      /* ignore */
    }
  }

  function getStoredToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setStoredToken(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  // Puente de sesión por query (Firebase no siempre reenvía cookies de producto).
  // Solo pv_s; tt_s se elimina sin aplicar.
  (function hydrateBridgeToken() {
    try {
      const params = new URLSearchParams(location.search);
      const tt = params.get("tt_s");
      const pv = params.get("pv_s");
      if (pv) {
        setStoredToken(pv);
      }
      params.delete("tt_s");
      params.delete("pv_s");
      if (tt || pv) {
        const clean = location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash;
        window.history.replaceState({}, "", clean);
      }
    } catch {
      /* ignore */
    }
  })();

  function portalFetch(url, opts) {
    opts = opts || {};
    const headers = new Headers(opts.headers || {});
    const token = getStoredToken();
    if (token) headers.set("x-postventa-session", token);
    if (opts.body && !headers.has("Content-Type") && typeof opts.body === "string") {
      headers.set("Content-Type", "application/json");
    }
    let finalUrl = url;
    if (!opts.method || String(opts.method).toUpperCase() === "GET") {
      const sep = String(url).indexOf("?") >= 0 ? "&" : "?";
      finalUrl = url + sep + "_ts=" + Date.now();
    }
    return fetch(finalUrl, {
      ...opts,
      credentials: "same-origin",
      cache: "no-store",
      headers
    });
  }

  function markDataStale() {
    try {
      sessionStorage.setItem(STALE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function isDataStale() {
    try {
      return sessionStorage.getItem(STALE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function consumeDataStale() {
    try {
      const stale = sessionStorage.getItem(STALE_KEY) === "1";
      if (stale) sessionStorage.removeItem(STALE_KEY);
      return stale;
    } catch {
      return false;
    }
  }

  function rememberTicketStatus(shortId, status, statusLabel) {
    if (!shortId || !status) return;
    try {
      const map = JSON.parse(sessionStorage.getItem(STATUS_OVERRIDES_KEY) || "{}") || {};
      map[String(shortId)] = {
        status: String(status),
        statusLabel: String(statusLabel || status),
        at: Date.now()
      };
      sessionStorage.setItem(STATUS_OVERRIDES_KEY, JSON.stringify(map));
      markDataStale();
    } catch {
      /* ignore */
    }
  }

  function applyStatusOverrides(tickets) {
    if (!Array.isArray(tickets) || !tickets.length) return tickets || [];
    let map = {};
    try {
      map = JSON.parse(sessionStorage.getItem(STATUS_OVERRIDES_KEY) || "{}") || {};
    } catch {
      map = {};
    }
    const now = Date.now();
    let changed = false;
    const out = tickets.map((t) => {
      const o = map[t.shortId];
      if (!o) return t;
      if (now - Number(o.at || 0) > 10 * 60 * 1000) {
        delete map[t.shortId];
        changed = true;
        return t;
      }
      if (String(o.status) === String(t.status)) {
        delete map[t.shortId];
        changed = true;
        return t;
      }
      return {
        ...t,
        status: o.status,
        statusLabel: o.statusLabel || t.statusLabel
      };
    });
    if (changed) {
      try {
        sessionStorage.setItem(STATUS_OVERRIDES_KEY, JSON.stringify(map));
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  function destroyChartsIn(root) {
    if (!root || !window.Chart || typeof window.Chart.getChart !== "function") return;
    root.querySelectorAll("canvas").forEach((c) => {
      try {
        const chart = window.Chart.getChart(c);
        if (chart) chart.destroy();
      } catch {
        /* ignore */
      }
    });
  }

  function navType() {
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      return nav ? nav.type : "";
    } catch {
      return "";
    }
  }

  /**
   * Desactiva bfcache del navegador en el portal.
   * Sin esto, "Atrás" restaura el dashboard con estados viejos.
   */
  let bfCacheDisabled = false;
  function disableBfCache() {
    if (bfCacheDisabled) return;
    bfCacheDisabled = true;
    // unload/beforeunload impiden que Chrome/Edge guarden la página en bfcache
    window.addEventListener("unload", () => {});
    window.addEventListener("beforeunload", () => {});
    window.addEventListener("pagehide", () => {
      markDataStale();
    });
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) {
        location.reload();
      }
    });
  }

  /** Carga inicial + re-fetch si la página vuelve con datos marcados stale. */
  function bindLiveReload(loadFn) {
    disableBfCache();

    let inflight = null;
    let ready = false;
    async function run() {
      if (inflight) return inflight;
      inflight = Promise.resolve()
        .then(() => loadFn())
        .finally(() => {
          inflight = null;
        });
      return inflight;
    }

    window.addEventListener("pageshow", (e) => {
      // persisted ya se maneja con location.reload() en disableBfCache
      if (e.persisted) return;
      if (!ready) return;
      if (navType() === "back_forward" || isDataStale()) {
        consumeDataStale();
        run();
      }
    });

    return async function bootLoad() {
      ready = true;
      const result = await run();
      consumeDataStale();
      return result;
    };
  }

  const PV_BASE = "/postventa";
  const PV_LOGIN = "/postventa/login";
  const PV_PORTAL_PAGES = ["", "/login", "/overview", "/proyecto", "/ticket", "/mis-tickets", "/configuracion"];

  function isPvPortalPath(pathname) {
    const p = String(pathname || "").replace(/\/+$/, "") || "/";
    if (p.startsWith("/postventa/portal")) return true;
    if (p === "/postventa") return true;
    return PV_PORTAL_PAGES.some((s) => s && p === "/postventa" + s);
  }

  /** Reescribe /postventa/portal/* a /postventa. */
  function appHref(path) {
    let raw = String(path || "");
    if (!raw || raw.startsWith("#") || raw.startsWith("/api/") || raw.startsWith("http")) return raw;
    try {
      const u = new URL(raw, location.origin);
      let pathname = u.pathname;
      if (pathname.startsWith("/postventa/portal")) {
        pathname = PV_BASE + pathname.slice("/postventa/portal".length);
      } else if (pathname === "/postventa" || pathname === "/postventa/") {
        pathname = PV_BASE;
      } else if (PV_PORTAL_PAGES.some((s) => s && (pathname === "/postventa" + s))) {
        pathname = PV_BASE + pathname.slice("/postventa".length);
      } else if (pathname.startsWith("/")) {
        pathname = PV_BASE + pathname;
      }
      return pathname + u.search + u.hash;
    } catch {
      return raw;
    }
  }

  function hardNavigate(href) {
    const url = new URL(appHref(href), location.origin);
    url.searchParams.set("_", String(Date.now()));
    location.assign(url.pathname + url.search + url.hash);
  }

  // Nav del sidebar / enlaces internos: evita bfcache con URL única
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      const href = a.getAttribute("href") || "";
      let pathOnly = href;
      try {
        pathOnly = new URL(href, location.origin).pathname;
      } catch {
        /* ignore */
      }
      if (!isPvPortalPath(pathOnly) && !href.startsWith("/postventa/portal")) {
        return;
      }
      if (a.target && a.target !== "_self") return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      hardNavigate(href);
    },
    true
  );

  async function ensureAuth() {
    if (ME) return ME;
    if (
      location.pathname === "/postventa/login" ||
      location.pathname.indexOf("/postventa/portal/login") === 0
    ) {
      return null;
    }
    try {
      const res = await portalFetch("/api/postventa/portal/me");
      if (res.status === 401) {
        setStoredToken("");
        const next = encodeURIComponent(location.pathname + location.search);
        location.replace(PV_LOGIN + "?next=" + next);
        return null;
      }
      const data = await res.json();
      if (!data || !data.ok) {
        location.replace(PV_LOGIN);
        return null;
      }
      ME = data;
      return ME;
    } catch {
      location.replace(PV_LOGIN);
      return null;
    }
  }

  async function logout() {
    try {
      await portalFetch("/api/postventa/portal/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setStoredToken("");
    location.replace("/postventa/login");
  }

  function qs(name, def) {
    const v = new URLSearchParams(location.search).get(name);
    return v == null ? def : v;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function fmt(n) {
    return Number(n || 0).toLocaleString("es-CL");
  }

  function dateChip() {
    const d = new Date();
    return d.toLocaleDateString("es-CL", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function statusPillClass(status) {
    const s = String(status || "");
    if (s === "closed" || s === "terminado") return "ok";
    if (s === "rejected") return "bad";
    if (s === "en_ejecucion" || s === "programado" || s === "asignada") return "warn";
    if (
      s === "classified" ||
      s === "recibido" ||
      s === "in_review" ||
      s === "routed"
    ) {
      return "info";
    }
    if (s === "pending_evidence" || s === "pending_ai_analysis") return "warn";
    return "";
  }

  function severityPillClass(sev) {
    const s = String(sev || "").toLowerCase();
    if (s === "critical" || s === "high") return "bad";
    if (s === "medium") return "warn";
    if (s === "low" || s === "none") return "ok";
    return "";
  }

  function renderSidebar(activeKey, project) {
    const me = ME || {};
    const tenantName = (me.tenant && me.tenant.name) || "Inmobiliaria";
    const userName = (me.user && me.user.fullName) || "Usuario";
    const nav = [
      { key: "overview", href: appHref("/postventa/portal"), label: "Portafolio" },
      { key: "mis", href: appHref("/postventa/portal/mis-tickets"), label: "Mis tickets" },
      {
        key: "proyecto",
        href: project
          ? appHref("/postventa/portal/proyecto?slug=" + encodeURIComponent(project.slug))
          : appHref("/postventa/portal"),
        label: "Proyecto"
      },
      { key: "config", href: appHref("/postventa/portal/configuracion"), label: "Configuración" }
    ];
    const navHtml = nav
      .map(
        (n) =>
          `<a href="${n.href}" class="${n.key === activeKey ? "active" : ""}"><span>${escapeHtml(n.label)}</span></a>`
      )
      .join("");

    const projectBlock = project
      ? `<div class="project-card">
          <div class="pc-title">${escapeHtml(project.name)}</div>
          <div class="pc-row"><span>Comuna</span><b>${escapeHtml(project.comuna || "—")}</b></div>
          <div class="pc-row"><span>Slug</span><b class="mono">${escapeHtml(project.slug)}</b></div>
        </div>`
      : `<div class="project-card">
          <div class="pc-title">${escapeHtml(tenantName)}</div>
          <div class="pc-row"><span>Vista</span><b>Portafolio</b></div>
        </div>`;

    return `
      <aside class="sidebar">
        <div class="brand">
          <img class="brand-logo" src="/assets/Logo%20Ainspecciona.png" alt="Ainspecciona" />
          <span class="brand-pill">Postventa</span>
        </div>
        <nav class="nav">${navHtml}</nav>
        ${projectBlock}
        <div class="theme-toggle" aria-label="Tema">
          <span>Tema</span>
          <span style="display:flex;gap:6px">
            <button type="button" data-theme-btn="dark" aria-pressed="${getTheme() === "dark" ? "true" : "false"}">Dark</button>
            <button type="button" data-theme-btn="light" aria-pressed="${getTheme() === "light" ? "true" : "false"}">Light</button>
          </span>
        </div>
        <div class="user-chip">
          <div class="avatar">${escapeHtml(initialsFromName(userName))}</div>
          <div>
            <div class="u-name">${escapeHtml(userName)}</div>
            <div class="u-mail">${escapeHtml(tenantName)}</div>
            <button type="button" class="u-logout" id="pvLogoutBtn">Cerrar sesión</button>
          </div>
        </div>
      </aside>`;
  }

  document.addEventListener("click", (e) => {
    const themeBtn = e.target && e.target.closest && e.target.closest("[data-theme-btn]");
    if (themeBtn) {
      e.preventDefault();
      applyTheme(themeBtn.getAttribute("data-theme-btn"));
      location.reload();
      return;
    }
    const btn = e.target && e.target.closest && e.target.closest("#pvLogoutBtn");
    if (btn) {
      e.preventDefault();
      logout();
    }
  });

  const TECH_PALETTE = [
    "#22D3EE",
    "#06B6D4",
    "#67E8F9",
    "#A5F3FC",
    "#FFFFFF",
    "#FB7185",
    "#FDE047",
    "#4ADE80",
    "#FB923C"
  ];

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  }

  function ensureChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = cssVar("--chart-tick", "#A1A1AA");
    Chart.defaults.borderColor = "rgba(34, 211, 238, 0.16)";
    Chart.defaults.font.family =
      '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    Chart.defaults.font.size = 10;
  }

  function safeChart(factory) {
    try {
      return factory();
    } catch (err) {
      console.warn("[PvPortal] chart render failed", err);
      return null;
    }
  }

  function techTooltip() {
    return {
      enabled: true,
      backgroundColor: "rgba(5, 5, 8, 0.94)",
      titleColor: "#22D3EE",
      bodyColor: "#F4F4F5",
      borderColor: "rgba(34, 211, 238, 0.55)",
      borderWidth: 1,
      padding: 10,
      cornerRadius: 0,
      displayColors: false,
      titleFont: { family: Chart.defaults.font.family, size: 11, weight: "700" },
      bodyFont: { family: Chart.defaults.font.family, size: 11 },
      callbacks: {
        title: (items) => {
          if (!items || !items.length) return "";
          return items[0].label || "";
        },
        // Importante: NO devolver null/undefined — Chart.js usa entonces el callback
        // por defecto (cuadrado de color + número). "" suprime la línea del cuerpo.
        label: (ctx) => {
          if (ctx.dataset && ctx.dataset.label) return " " + ctx.dataset.label;
          return "";
        },
        labelColor: () => ({
          borderColor: "transparent",
          backgroundColor: "transparent",
          borderWidth: 0
        })
      }
    };
  }

  function techLegend(show) {
    return {
      display: !!show,
      position: "bottom",
      labels: {
        boxWidth: 8,
        boxHeight: 8,
        usePointStyle: true,
        pointStyle: "rectRounded",
        padding: 14,
        font: { size: 10, family: Chart.defaults.font.family, weight: "600" },
        color: cssVar("--chart-tick", "#94A3B8")
      }
    };
  }

  function techGrid() {
    return {
      color: "rgba(255, 255, 255, 0.06)",
      borderDash: [2, 4]
    };
  }

  function techTicks() {
    return {
      precision: 0,
      font: { size: 10, family: Chart.defaults.font.family, weight: "500" },
      color: cssVar("--chart-tick", "#94A3B8"),
      padding: 6
    };
  }

  function withAlpha(hex, a) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return hex;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function donutChart(canvas, labels, data, colors) {
    if (!canvas || !window.Chart) return null;
    ensureChartDefaults();
    const palette = colors && colors.length ? colors : TECH_PALETTE;
    return safeChart(
      () =>
        new Chart(canvas, {
          type: "doughnut",
          data: {
            labels,
            datasets: [
              {
                data,
                backgroundColor: palette,
                borderColor: "#050508",
                borderWidth: 2,
                hoverOffset: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "72%",
            plugins: {
              legend: techLegend(true),
              tooltip: techTooltip()
            }
          }
        })
    );
  }

  function barChart(canvas, labels, data, color) {
    if (!canvas || !window.Chart) return null;
    ensureChartDefaults();
    const colors = Array.isArray(color) ? color : null;
    const solid = color || "#22D3EE";
    const bg = colors
      ? labels.map((_, i) => withAlpha(colors[i % colors.length], 0.55))
      : withAlpha(typeof solid === "string" ? solid : "#22D3EE", 0.55);
    return safeChart(
      () =>
        new Chart(canvas, {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                data,
                backgroundColor: bg,
                borderColor: colors || solid,
                borderWidth: 1.5,
                borderSkipped: false,
                borderRadius: 0,
                maxBarThickness: 18
              }
            ]
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: techTooltip() },
            scales: {
              x: {
                beginAtZero: true,
                grid: techGrid(),
                ticks: techTicks()
              },
              y: {
                grid: { display: false },
                ticks: techTicks()
              }
            }
          }
        })
    );
  }

  /** Barras apiladas horizontales: datasets = [{ label, data, color }]. */
  function stackedBarChart(canvas, labels, datasets) {
    if (!canvas || !window.Chart) return null;
    ensureChartDefaults();
    return safeChart(
      () =>
        new Chart(canvas, {
          type: "bar",
          data: {
            labels,
            datasets: (datasets || []).map((d) => ({
              label: d.label,
              data: d.data,
              backgroundColor: withAlpha(d.color, 0.55),
              borderColor: d.color,
              borderWidth: 1.25,
              borderSkipped: false,
              borderRadius: 0,
              maxBarThickness: 18
            }))
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: techLegend(true),
              tooltip: techTooltip()
            },
            scales: {
              x: {
                stacked: true,
                beginAtZero: true,
                grid: techGrid(),
                ticks: techTicks()
              },
              y: {
                stacked: true,
                grid: { display: false },
                ticks: techTicks()
              }
            }
          }
        })
    );
  }

  function lineChart(canvas, labels, opened, closed) {
    if (!canvas || !window.Chart) return null;
    ensureChartDefaults();
    return safeChart(
      () =>
        new Chart(canvas, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "Aperturas",
                data: opened,
                borderColor: "#22D3EE",
                backgroundColor: withAlpha("#22D3EE", 0.22),
                borderWidth: 2,
                tension: 0,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: "#22D3EE",
                pointHoverBorderColor: "#050508",
                pointHoverBorderWidth: 2
              },
              {
                label: "Cierres",
                data: closed,
                borderColor: "#FFFFFF",
                backgroundColor: withAlpha("#FFFFFF", 0.08),
                borderWidth: 1.5,
                tension: 0,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: "#FFFFFF",
                pointHoverBorderColor: "#050508",
                pointHoverBorderWidth: 2
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: techLegend(true),
              tooltip: techTooltip()
            },
            scales: {
              x: {
                grid: techGrid(),
                ticks: techTicks()
              },
              y: {
                beginAtZero: true,
                grid: techGrid(),
                ticks: techTicks()
              }
            }
          }
        })
    );
  }

  /** Mini gauge SVG HUD 0–100% (anillos concéntricos). */
  function miniGauge(pct, color) {
    const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    const accent = color || "#22D3EE";
    const r = 18;
    const c = 2 * Math.PI * r;
    const dash = (n / 100) * c;
    return `<div class="gauge" aria-label="${n}%">
      <svg viewBox="0 0 58 58" width="58" height="58" aria-hidden="true">
        <circle cx="29" cy="29" r="23" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        <circle cx="29" cy="29" r="20.5" fill="none" stroke="rgba(34,211,238,0.18)" stroke-width="1" stroke-dasharray="2 3"/>
        <circle cx="29" cy="29" r="${r}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
        <circle cx="29" cy="29" r="${r}" fill="none" stroke="${accent}" stroke-width="4"
          stroke-linecap="butt"
          stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}"
          transform="rotate(-90 29 29)"/>
      </svg>
      <div class="gauge-center">${n}%</div>
    </div>`;
  }

  function pctOf(part, whole) {
    const w = Number(whole) || 0;
    if (w <= 0) return 0;
    return Math.round(((Number(part) || 0) / w) * 100);
  }

  async function downloadOtPdf(shortId, filename) {
    const id = String(shortId || "").trim();
    if (!id) throw new Error("Falta el ticket");
    const res = await portalFetch(
      "/api/postventa/portal/tickets/" + encodeURIComponent(id) + "/ot.pdf"
    );
    const ct = String(res.headers.get("content-type") || "");
    if (!res.ok || !ct.includes("pdf")) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || "No se pudo generar la OT");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "OT-" + id + ".pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  applyTheme(getTheme());

  // En cualquier pantalla del portal (salvo login), no usar bfcache
  if (
    location.pathname !== "/postventa/login" &&
    location.pathname.indexOf("/postventa/portal/login") !== 0
  ) {
    disableBfCache();
  }

  window.PvPortal = {
    ensureAuth,
    portalFetch,
    setStoredToken,
    getStoredToken,
    markDataStale,
    consumeDataStale,
    rememberTicketStatus,
    applyStatusOverrides,
    destroyChartsIn,
    bindLiveReload,
    hardNavigate,
    appHref,
    base: PV_BASE,
    logout,
    qs,
    escapeHtml,
    fmt,
    dateChip,
    renderSidebar,
    statusPillClass,
    severityPillClass,
    donutChart,
    barChart,
    stackedBarChart,
    lineChart,
    miniGauge,
    pctOf,
    downloadOtPdf,
    getMe: () => ME
  };
})();
