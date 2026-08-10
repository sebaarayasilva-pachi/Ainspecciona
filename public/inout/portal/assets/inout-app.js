/* Helpers compartidos portal In & Out. */
(function () {
  "use strict";

  const IO_BASE = "/inout/portal";
  const IO_LOGIN = "/inout/portal/login";
  const IO_TOKEN_KEY = "inout_session";

  function getStoredToken() {
    try {
      return sessionStorage.getItem(IO_TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setStoredToken(token) {
    try {
      if (token) sessionStorage.setItem(IO_TOKEN_KEY, token);
      else sessionStorage.removeItem(IO_TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  const STATUS_LABELS = {
    draft: "Borrador",
    in_in_progress: "IN en curso",
    in_completed: "IN completada",
    out_ready: "Listo para OUT",
    out_in_progress: "OUT en curso",
    out_completed: "OUT completada",
    analyzing: "Generando informe",
    under_review: "En revisión",
    closed: "Cerrado"
  };

  function capturaHubHref() {
    return "/inout/captura";
  }

  function captureRuntimeUrl(token) {
    return "/inout/capture/" + encodeURIComponent(token || "");
  }

  function appHref(path) {
    let raw = String(path || "");
    if (!raw || raw.startsWith("#") || raw.startsWith("/api/") || raw.startsWith("http") || raw.startsWith("/inout/capture")) {
      return raw;
    }
    try {
      const u = new URL(raw, location.origin);
      let pathname = u.pathname;
      if (pathname === "/inout/captura" || pathname === "/inout/captura/") {
        pathname = capturaHubHref();
      } else if (pathname.startsWith("/inout/portal")) {
        pathname = IO_BASE + pathname.slice("/inout/portal".length);
      } else if (pathname === "/inout" || pathname === "/inout/") {
        pathname = IO_BASE;
      } else if (pathname.startsWith("/")) {
        pathname = IO_BASE + pathname;
      }
      return pathname + u.search + u.hash;
    } catch {
      return raw;
    }
  }

  function statusLabel(st) {
    return STATUS_LABELS[st] || st || "—";
  }

  function badgeClass(st) {
    if (st === "closed" || st === "in_completed" || st === "out_ready") return "ok";
    if (st === "under_review" || st === "analyzing" || String(st || "").includes("progress")) return "warn";
    if (st === "draft") return "";
    return "";
  }

  function computeKpis(leases) {
    const list = Array.isArray(leases) ? leases : [];
    const kpi = {
      total: list.length,
      inProgress: 0,
      outReady: 0,
      outProgress: 0,
      underReview: 0,
      closed: 0
    };
    list.forEach((l) => {
      const st = String(l.cycleStatus || "");
      if (st === "in_in_progress" || st === "draft") kpi.inProgress += 1;
      else if (st === "out_ready" || st === "in_completed") kpi.outReady += 1;
      else if (st === "out_in_progress" || st === "out_completed" || st === "analyzing") kpi.outProgress += 1;
      else if (st === "under_review") kpi.underReview += 1;
      else if (st === "closed") kpi.closed += 1;
    });
    return kpi;
  }

  async function ioFetch(url, opts) {
    opts = opts || {};
    const headers = new Headers(opts.headers || {});
    const token = getStoredToken();
    if (token) headers.set("x-inout-session", token);
    return fetch(url, {
      ...opts,
      credentials: "same-origin",
      cache: opts.cache || "no-store",
      headers
    });
  }

  let ME = null;

  async function ensureAuth() {
    if (ME) return ME;
    if (location.pathname.indexOf("/inout/portal/login") === 0) {
      return null;
    }
    try {
      const res = await ioFetch("/api/inout/auth/me");
      if (res.status === 401) {
        setStoredToken("");
        location.replace(IO_LOGIN);
        return null;
      }
      const data = await res.json();
      if (!data || !data.ok) {
        location.replace(IO_LOGIN);
        return null;
      }
      ME = data;
      return ME;
    } catch {
      location.replace(IO_LOGIN);
      return null;
    }
  }

  async function logout() {
    try {
      await ioFetch("/api/inout/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    location.replace("/inout/portal/login");
  }

  function renderShell(activeKey, me) {
    const tenant = (me && me.tenant && me.tenant.name) || "In & Out";
    const user = (me && me.user && (me.user.fullName || me.user.email)) || "";
    const nav = [
      { key: "overview", href: appHref("/inout/portal"), label: "Dashboard" },
      { key: "captura", href: capturaHubHref(), label: "Captura" }
    ];
    const navHtml = nav
      .map(
        (n) =>
          `<a href="${n.href}" class="${n.key === activeKey ? "active" : ""}">${n.label}</a>`
      )
      .join("");
    return `
      <aside class="io-aside">
        <div class="io-brand">Ainspecciona <span>In &amp; Out</span></div>
        <div class="io-tenant">${escapeHtml(tenant)}</div>
        <nav class="io-nav">${navHtml}</nav>
        <div class="io-user">
          <div class="io-user-name">${escapeHtml(user)}</div>
          <button type="button" class="btn secondary" id="ioLogoutBtn">Salir</button>
        </div>
      </aside>`;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindShell() {
    const btn = document.getElementById("ioLogoutBtn");
    if (btn) btn.onclick = () => logout();
  }

  window.IoPortal = {
    IO_BASE,
    appHref,
    capturaHubHref,
    captureRuntimeUrl,
    statusLabel,
    badgeClass,
    computeKpis,
    ioFetch,
    ensureAuth,
    logout,
    renderShell,
    bindShell,
    escapeHtml,
    getMe: () => ME
  };
})();
