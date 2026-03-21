(function() {
  try {
    if (!document.querySelector("link[rel='icon'], link[rel='shortcut icon']")) {
      var favicon = document.createElement('link');
      favicon.rel = 'icon';
      favicon.type = 'image/x-icon';
      favicon.href = '/icons/favicon.ico';
      document.head.appendChild(favicon);
    }
  } catch (e) {}
})();

(function() {
  try {
    var d = { path: location.pathname + location.search, referrer: document.referrer || null };
    navigator.sendBeacon('/api/track', new Blob([JSON.stringify(d)], { type: 'application/json' }));
  } catch(e) {}
})();

(function() {
  var CONSENT_KEY = 'ainspecta_cookie_notice_accepted_v1';
  try {
    if (window.localStorage && window.localStorage.getItem(CONSENT_KEY) === '1') return;
  } catch (e) {}

  function closeBanner() {
    var banner = document.getElementById('cookie-banner');
    if (!banner) return;
    banner.remove();
  }

  function acceptCookies() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(CONSENT_KEY, '1');
      }
    } catch (e) {}
    closeBanner();
  }

  function renderBanner() {
    if (document.getElementById('cookie-banner')) return;

    var style = document.createElement('style');
    style.id = 'cookie-banner-style';
    style.textContent =
      '#cookie-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;box-shadow:0 10px 30px rgba(2,6,23,.45);padding:14px 16px;font-family:Inter,Arial,sans-serif;}' +
      '#cookie-banner p{margin:0;font-size:14px;line-height:1.5;color:#cbd5e1;}' +
      '#cookie-banner .cookie-banner-actions{margin-top:10px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;}' +
      '#cookie-banner button{appearance:none;border:0;background:#2563eb;color:#fff;font-weight:600;border-radius:10px;padding:8px 14px;cursor:pointer;}' +
      '#cookie-banner button:hover{background:#1d4ed8;}' +
      '#cookie-banner a{color:#93c5fd;text-decoration:underline;font-size:14px;}' +
      '@media (min-width: 900px){#cookie-banner{left:24px;right:24px;max-width:920px;margin:0 auto;}}';
    if (!document.getElementById('cookie-banner-style')) {
      document.head.appendChild(style);
    }

    var banner = document.createElement('section');
    banner.id = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML =
      '<p>Utilizamos cookies estrictamente necesarias y tecnologías de medición de navegación para el funcionamiento del sitio y nuestras métricas internas. Más información en nuestra Política de Cookies.</p>' +
      '<div class="cookie-banner-actions">' +
      '<button id="cookie-banner-accept" type="button">Entendido</button>' +
      '<a href="/cookies">Política de Cookies</a>' +
      '</div>';
    document.body.appendChild(banner);

    var acceptButton = document.getElementById('cookie-banner-accept');
    if (acceptButton) acceptButton.addEventListener('click', acceptCookies);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderBanner);
  } else {
    renderBanner();
  }
})();
