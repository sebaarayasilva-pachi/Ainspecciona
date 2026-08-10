(function () {
  "use strict";

  var cfg = window.FOOTER_CONFIG;
  if (!cfg) return;

  var root = document.getElementById("site-footer-root");
  if (!root) return;

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function socialIcon(name) {
    if (name === "linkedin") {
      return (
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<path d="M20.45 20.45h-3.56v-5.59c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.69H9.34V9h3.42v1.56h.05c.47-.89 1.62-1.83 3.34-1.83 3.57 0 4.23 2.35 4.23 5.41v6.31zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/>' +
        "</svg>"
      );
    }
    if (name === "instagram") {
      return (
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<path d="M12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6zm0 7.92a3.12 3.12 0 1 1 0-6.24 3.12 3.12 0 0 1 0 6.24zM16.8 6.48a1.12 1.12 0 1 1-2.24 0 1.12 1.12 0 0 1 2.24 0zM12 2.16c-2.56 0-2.88.01-3.89.05-1 .05-1.68.22-2.28.47-.62.24-1.15.57-1.67 1.09-.52.52-.85 1.05-1.09 1.67-.25.6-.42 1.28-.47 2.28-.04 1.01-.05 1.33-.05 3.89s.01 2.88.05 3.89c.05 1 .22 1.68.47 2.28.24.62.57 1.15 1.09 1.67.52.52 1.05.85 1.67 1.09.6.25 1.28.42 2.28.47 1.01.04 1.33.05 3.89.05s2.88-.01 3.89-.05c1-.05 1.68-.22 2.28-.47.62-.24 1.15-.57 1.67-1.09.52-.52.85-1.05 1.09-1.67.25-.6.42-1.28.47-2.28.04-1.01.05-1.33.05-3.89s-.01-2.88-.05-3.89c-.05-1-.22-1.68-.47-2.28-.24-.62-.57-1.15-1.09-1.67-.52-.52-1.05-.85-1.67-1.09-.6-.25-1.28-.42-2.28-.47-1.01-.04-1.33-.05-3.89-.05zm0 17.64c-2.37 0-2.65-.01-3.58-.05-.86-.04-1.33-.18-1.64-.3-.41-.16-.7-.35-1.01-.66-.31-.31-.5-.6-.66-1.01-.12-.31-.26-.78-.3-1.64-.04-.93-.05-1.21-.05-3.58s.01-2.65.05-3.58c.04-.86.18-1.33.3-1.64.16-.41.35-.7.66-1.01.31-.31.6-.5 1.01-.66.31-.12.78-.26 1.64-.3.93-.04 1.21-.05 3.58-.05s2.65.01 3.58.05c.86.04 1.33.18 1.64.3.41.16.7.35 1.01.66.31.31.5.6.66 1.01.12.31.26.78.3 1.64.04.93.05 1.21.05 3.58s-.01 2.65-.05 3.58c-.04.86-.18 1.33-.3 1.64-.16.41-.35.7-.66 1.01-.31.31-.6.5-1.01.66-.31.12-.78.26-1.64.3-.93.04-1.21.05-3.58.05z"/>' +
        "</svg>"
      );
    }
    return "";
  }

  function renderNavColumns(columns) {
    return (columns || [])
      .map(function (col) {
        var links = (col.links || []).filter(function (link) {
          return link.visible !== false && link.href;
        });
        if (!links.length) return "";
        return (
          '<div class="site-footer__col">' +
          '<p class="site-footer__col-title">' +
          escapeHtml(col.title) +
          "</p>" +
          links
            .map(function (link) {
              var arrow = link.arrow ? ' <span class="site-footer__link-arrow" aria-hidden="true">→</span>' : "";
              var external = link.href.indexOf("http") === 0 ? ' target="_blank" rel="noopener noreferrer"' : "";
              return (
                '<a class="site-footer__link" href="' +
                escapeHtml(link.href) +
                '"' +
                external +
                ">" +
                escapeHtml(link.label) +
                arrow +
                "</a>"
              );
            })
            .join("") +
          "</div>"
        );
      })
      .join("");
  }

  function renderSocial(links) {
    var active = (links || []).filter(function (item) {
      return item.href && String(item.href).trim();
    });
    if (!active.length) return "";
    return (
      '<ul class="site-footer__social">' +
      active
        .map(function (item) {
          return (
            '<li><a class="site-footer__social-link" href="' +
            escapeHtml(item.href) +
            '" target="_blank" rel="noopener noreferrer" aria-label="' +
            escapeHtml(item.label) +
            '">' +
            socialIcon(item.icon) +
            "</a></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  var brand = cfg.brand || {};
  var year = new Date().getFullYear();
  var email = brand.email || "contacto@ainspecciona.com";

  root.innerHTML =
    '<div class="site-footer__inner">' +
    '<div class="site-footer__main">' +
    '<div class="site-footer__brand">' +
    '<a class="site-footer__brand-logo" href="' +
    escapeHtml(brand.href || "/") +
    '">' +
    '<img src="' +
    escapeHtml(brand.logo) +
    '" alt="' +
    escapeHtml(brand.alt || "Ainspecciona") +
    '" width="176" height="48" loading="lazy" decoding="async" />' +
    "</a>" +
    '<p class="site-footer__brand-desc">' +
    escapeHtml(brand.description) +
    "</p>" +
    '<span class="site-footer__brand-location">' +
    escapeHtml(brand.location) +
    "</span>" +
    '<a class="site-footer__brand-email" href="mailto:' +
    escapeHtml(email) +
    '">' +
    escapeHtml(email) +
    "</a>" +
    "</div>" +
    '<nav class="site-footer__nav" aria-label="Navegación del pie de página">' +
    renderNavColumns(cfg.footerNavigation) +
    "</nav>" +
    "</div>" +
    '<div class="site-footer__bottom">' +
    '<p class="site-footer__bottom-left">© ' +
    year +
    " Ainspecciona SpA. Todos los derechos reservados.</p>" +
    '<div class="site-footer__bottom-meta">' +
    renderSocial(cfg.socialLinks) +
    '<p class="site-footer__bottom-right">Desarrollado en Chile.</p>' +
    "</div>" +
    "</div>" +
    "</div>";
})();
