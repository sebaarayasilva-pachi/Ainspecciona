/**
 * Lightbox con zoom/pan para fotos de revisión e informe.
 */
(function (global) {
  function ensureOverlay() {
    let el = document.getElementById('ainspecciona-photo-zoom');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ainspecciona-photo-zoom';
    el.innerHTML =
      '<div class="pz-backdrop"></div>' +
      '<div class="pz-toolbar">' +
      '<button type="button" class="pz-btn" data-act="out">−</button>' +
      '<button type="button" class="pz-btn" data-act="in">+</button>' +
      '<button type="button" class="pz-btn" data-act="reset">1:1</button>' +
      '<button type="button" class="pz-btn" data-act="close">Cerrar</button>' +
      '</div>' +
      '<div class="pz-stage"><img alt="Evidencia" /></div>';
    const css = document.createElement('style');
    css.textContent =
      '#ainspecciona-photo-zoom{display:none;position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,.92);}' +
      '#ainspecciona-photo-zoom.open{display:block;}' +
      '#ainspecciona-photo-zoom .pz-toolbar{position:absolute;top:12px;right:12px;display:flex;gap:8px;z-index:2;}' +
      '#ainspecciona-photo-zoom .pz-btn{padding:8px 12px;border-radius:8px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;cursor:pointer;font-weight:700;}' +
      '#ainspecciona-photo-zoom .pz-stage{position:absolute;inset:0;overflow:hidden;cursor:grab;}' +
      '#ainspecciona-photo-zoom .pz-stage img{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(1);max-width:none;max-height:none;user-select:none;-webkit-user-drag:none;}';
    document.head.appendChild(css);
    document.body.appendChild(el);
    return el;
  }

  function openPhotoZoom(src) {
    if (!src) return;
    const root = ensureOverlay();
    const img = root.querySelector('img');
    const stage = root.querySelector('.pz-stage');
    let scale = 1;
    let x = 0;
    let y = 0;
    let drag = null;

    function apply() {
      img.style.transform = 'translate(calc(-50% + ' + x + 'px), calc(-50% + ' + y + 'px)) scale(' + scale + ')';
    }
    function close() {
      root.classList.remove('open');
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    img.src = src;
    scale = 1;
    x = 0;
    y = 0;
    apply();
    root.classList.add('open');
    document.addEventListener('keydown', onKey);

    root.onclick = (e) => {
      const act = e.target.getAttribute('data-act');
      if (act === 'close' || e.target.classList.contains('pz-backdrop')) close();
      if (act === 'in') { scale = Math.min(6, scale * 1.25); apply(); }
      if (act === 'out') { scale = Math.max(0.4, scale / 1.25); apply(); }
      if (act === 'reset') { scale = 1; x = 0; y = 0; apply(); }
    };
    stage.onwheel = (e) => {
      e.preventDefault();
      scale = e.deltaY < 0 ? Math.min(6, scale * 1.12) : Math.max(0.4, scale / 1.12);
      apply();
    };
    stage.onpointerdown = (e) => {
      drag = { x: e.clientX - x, y: e.clientY - y };
      stage.setPointerCapture(e.pointerId);
      stage.style.cursor = 'grabbing';
    };
    stage.onpointermove = (e) => {
      if (!drag) return;
      x = e.clientX - drag.x;
      y = e.clientY - drag.y;
      apply();
    };
    stage.onpointerup = () => { drag = null; stage.style.cursor = 'grab'; };
    stage.ondblclick = () => { scale = 1; x = 0; y = 0; apply(); };

    let pinch = null;
    stage.ontouchstart = (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinch = { dist: Math.hypot(dx, dy), scale };
      }
    };
    stage.ontouchmove = (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      scale = Math.min(6, Math.max(0.4, pinch.scale * (Math.hypot(dx, dy) / pinch.dist)));
      apply();
    };
    stage.ontouchend = () => { pinch = null; };
  }

  global.openPhotoZoom = openPhotoZoom;
})(window);
