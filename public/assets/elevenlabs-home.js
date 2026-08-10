(function () {
  var p = window.location.pathname.replace(/\/+$/, '') || '/';
  var isHome = p === '/' || p === '/index.html' || p === '/corredores.html';
  if (!isHome) return;

  fetch('/api/public/elevenlabs-agent')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.ok || !data.agentId) return;

      var el = document.createElement('elevenlabs-convai');
      el.setAttribute('agent-id', data.agentId);
      if (data.variant) el.setAttribute('variant', data.variant);
      if (data.dismissible !== false) el.setAttribute('dismissible', 'true');
      document.body.appendChild(el);

      var s = document.createElement('script');
      s.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed@0.14.2';
      s.async = true;
      s.type = 'text/javascript';
      document.body.appendChild(s);
    })
    .catch(function () {});
})();
