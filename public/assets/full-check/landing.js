(function () {
  var money = new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  });

  fetch('/api/booking?action=tiers')
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (json) {
      if (!json || !json.tiers) return;
      json.tiers.forEach(function (tier) {
        document.querySelectorAll('[data-tier="' + tier.tier + '"]').forEach(function (el) {
          el.textContent = money.format(tier.totalClp);
        });
      });
    })
    .catch(function () {});

  var toggle = document.getElementById('fc-nav-toggle');
  var nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  var label = toggle.querySelector('.site-header__sr-only');

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    nav.classList.toggle('is-open', open);
    if (label) label.textContent = open ? 'Cerrar menú' : 'Abrir menú';
  }

  toggle.addEventListener('click', function () {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  nav.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      setOpen(false);
    });
  });
})();
