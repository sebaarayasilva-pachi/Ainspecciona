(function () {
  "use strict";

  var CONFIG = null;

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pathMatches(href) {
    if (!href) return false;
    try {
      var u = new URL(href, location.origin);
      if (u.origin !== location.origin) return false;
      var path = u.pathname.replace(/\/$/, "") || "/";
      var cur = location.pathname.replace(/\/$/, "") || "/";
      return path === cur;
    } catch (_) {
      return false;
    }
  }

  function isProductActive(product) {
    if (!product || !product.href) return false;
    if (pathMatches(product.href)) return true;
    var prefixes = {
      inspeccion: ["/inspeccionar", "/photoplan", "/demo", "/formulario", "/tenant", "/cases/", "/precios"],
      postventa: ["/postventa"],
      entrega: ["/entrega"],
      propertycheck: []
    };
    var list = prefixes[product.id] || [];
    var cur = location.pathname;
    return list.some(function (p) {
      return cur === p || cur.indexOf(p + "/") === 0;
    });
  }

  function renderProductsPanel(products) {
    return (products || [])
      .map(function (p) {
        var active = isProductActive(p) ? " is-active" : "";
        var badge = p.badge ? '<span class="navProductBadge">' + escapeHtml(p.badge) + "</span>" : "";
        return (
          '<a class="navProductLink' +
          active +
          '" href="' +
          escapeHtml(p.href) +
          '" role="menuitem">' +
          '<span class="navProductTop">' +
          '<span class="navProductLabel">' +
          escapeHtml(p.label) +
          "</span>" +
          badge +
          "</span>" +
          '<span class="navProductDesc">' +
          escapeHtml(p.description) +
          "</span>" +
          "</a>"
        );
      })
      .join("");
  }

  function renderNavItem(item, cfg, index) {
    if (item.type === "dropdown") {
      var products = cfg.products || [];
      var anyActive = products.some(isProductActive);
      var toggleActive = anyActive ? " is-active" : "";
      return (
        '<div class="navDropdown">' +
        '<button type="button" class="navDropdownToggle' +
        toggleActive +
        '" id="navDropdown' +
        index +
        '" aria-expanded="false" aria-haspopup="true">' +
        escapeHtml(item.label) +
        '<svg class="navChevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
        "</button>" +
        '<div class="navDropdownPanel" id="navPanel' +
        index +
        '" role="menu">' +
        renderProductsPanel(products) +
        "</div>" +
        "</div>"
      );
    }
    var active = pathMatches(item.href) ? " is-active" : "";
    return (
      '<a class="navTopLink' +
      active +
      '" href="' +
      escapeHtml(item.href) +
      '">' +
      escapeHtml(item.label) +
      "</a>"
    );
  }

  function renderHeader(cfg) {
    var brand = cfg.brand || {};
    var nav = cfg.nav || [];
    var access = cfg.access || { label: "Iniciar sesión", loginHref: "/?login=1" };
    var demo = cfg.demoCta || { label: "Solicitar demostración", href: "/contacto.html" };
    var external = demo.external ? ' target="_blank" rel="noopener noreferrer"' : "";

    var navHtml = nav.map(function (item, i) {
      return renderNavItem(item, cfg, i);
    }).join("");

    return (
      '<header class="site-header site-header-v2">' +
      '<div class="nav">' +
      '<a class="brand" href="' +
      escapeHtml(brand.href || "/") +
      '">' +
      '<img src="' +
      escapeHtml(brand.logo) +
      '" alt="' +
      escapeHtml(brand.alt || "Ainspecciona") +
      '" />' +
      "</a>" +
      '<button type="button" class="navToggle" id="navToggle" aria-label="Abrir menú" aria-expanded="false">' +
      '<span></span><span></span><span></span>' +
      "</button>" +
      '<div class="navMain" id="navMain">' +
      '<nav class="navLinks" aria-label="Principal">' +
      navHtml +
      "</nav>" +
      '<div class="topActions">' +
      '<button class="navLoginLink" id="loginBtn" type="button">' +
      escapeHtml(access.label) +
      "</button>" +
      '<a class="navDemoCta" href="' +
      escapeHtml(demo.href) +
      '"' +
      external +
      ">" +
      escapeHtml(demo.label) +
      '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8M8 4l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "</a>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</header>"
    );
  }

  function openLoginModal() {
    var modal = document.getElementById("loginModal");
    if (modal) {
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      return true;
    }
    return false;
  }

  function bindDropdown(toggle, panel, navMain, navToggle) {
    if (!toggle || !panel) return;
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      document.querySelectorAll(".navDropdownPanel.open").forEach(function (p) {
        if (p !== panel) p.classList.remove("open");
      });
      document.querySelectorAll(".navDropdownToggle[aria-expanded='true']").forEach(function (t) {
        if (t !== toggle) t.setAttribute("aria-expanded", "false");
      });
      var open = panel.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (!panel.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
        panel.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        panel.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        if (navMain) navMain.classList.remove("open");
        if (navToggle) navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  function bindHeader() {
    var navToggle = document.getElementById("navToggle");
    var navMain = document.getElementById("navMain");
    var loginBtn = document.getElementById("loginBtn");

    if (navToggle && navMain) {
      navToggle.addEventListener("click", function () {
        var open = navMain.classList.toggle("open");
        navToggle.setAttribute("aria-expanded", open ? "true" : "false");
        navToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
      });
    }

    document.querySelectorAll(".navDropdown").forEach(function (wrap, i) {
      bindDropdown(
        wrap.querySelector(".navDropdownToggle"),
        wrap.querySelector(".navDropdownPanel"),
        navMain,
        navToggle
      );
    });

    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
        if (!openLoginModal()) {
          var href = (CONFIG && CONFIG.access && CONFIG.access.loginHref) || "/?login=1";
          location.href = href;
        }
      });
    }

    if (new URLSearchParams(location.search).get("login") === "1") {
      setTimeout(function () {
        openLoginModal();
      }, 0);
    }
  }

  function mount(cfg) {
    CONFIG = cfg;
    var html = renderHeader(cfg);
    var existing = document.querySelector("header.site-header");
    if (existing) {
      existing.outerHTML = html;
    } else {
      var mountEl = document.getElementById("site-header-root");
      if (mountEl) mountEl.innerHTML = html;
      else document.body.insertAdjacentHTML("afterbegin", html);
    }
    bindHeader();
  }

  function loadConfig() {
    return fetch("/assets/site-config.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("config");
        return r.json();
      })
      .catch(function () {
        return {
          brand: { href: "/", logo: "/assets/Logo Ainspecciona.png", alt: "Ainspecciona" },
          nav: [{ label: "Plataforma", href: "/" }],
          products: [],
          access: { label: "Iniciar sesión", loginHref: "/?login=1" },
          demoCta: { label: "Solicitar demostración", href: "/contacto.html" }
        };
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      loadConfig().then(mount);
    });
  } else {
    loadConfig().then(mount);
  }
})();
