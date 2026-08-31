/**
 * Captura postventa embebida en /postventa (panel inferior; asistente arriba).
 * window.PostventaCaptureEmbed.mount(container, token, callbacks)
 */
(function (global) {
  function mount(container, token, callbacks) {
    callbacks = callbacks || {};
    var API = '/api/postventa/capture/' + encodeURIComponent(token);
    var currentSlot = null;
    var currentSlotId = null;
    var capturedBlob = null;
    var captureCategory = '';
    var earlyFinishAllowed = false;
    var cameraStream = null;
    var liveMode = false;

    container.innerHTML =
      '<div class="pv-cap-root">' +
      '  <div class="pv-cap-scroll">' +
      '  <div class="pv-cap-head">' +
      '    <p class="pv-cap-ticket" id="pvCapTicket">Postventa</p>' +
      '    <div class="pv-cap-progress"><div id="pvCapBar"></div></div>' +
      '    <p class="pv-cap-progress-text" id="pvCapProgressText"></p>' +
      '  </div>' +
      '  <div id="pvCapError" class="pv-cap-card hidden">' +
      '    <p class="pv-cap-title">Link no disponible</p>' +
      '    <p class="pv-cap-muted" id="pvCapErrorText"></p>' +
      '  </div>' +
      '  <div id="pvCapSlot" class="pv-cap-card hidden">' +
      '    <p class="pv-cap-step" id="pvCapStep"></p>' +
      '    <p class="pv-cap-label" id="pvCapLabel"></p>' +
      '    <p class="pv-cap-title" id="pvCapTitle"></p>' +
      '    <p class="pv-cap-muted" id="pvCapInstructions"></p>' +
      '    <p class="pv-cap-status" id="pvCapStatus"></p>' +
      '    <video id="pvCapVideo" class="pv-cap-media hidden" playsinline autoplay muted></video>' +
      '    <img id="pvCapPreview" class="pv-cap-media hidden" alt="Vista previa" />' +
      '    <p id="pvCapReject" class="pv-cap-error hidden"></p>' +
      '  </div>' +
      '  <div id="pvCapDone" class="pv-cap-card hidden">' +
      '    <p class="pv-cap-title" id="pvCapDoneTitle">¡Listo!</p>' +
      '    <p class="pv-cap-muted" id="pvCapDoneText"></p>' +
      '    <p class="pv-cap-ok" id="pvCapTicketDone"></p>' +
      '    <div id="pvCapEmail" class="pv-cap-email hidden">' +
      '      <input type="email" id="pvCapEmailInput" placeholder="tu@correo.com" autocomplete="email" />' +
      '      <button type="button" class="pv-cap-btn primary" id="pvCapSendEmail">Enviar copia</button>' +
      '      <p id="pvCapEmailErr" class="pv-cap-error hidden"></p>' +
      '    </div>' +
      '    <p id="pvCapFarewell" class="pv-cap-ok hidden"></p>' +
      '  </div>' +
      '  </div>' +
      '  <div class="pv-cap-actions" id="pvCapActions">' +
      '    <button type="button" class="pv-cap-btn primary hidden" id="pvCapTake">Abrir cámara</button>' +
      '    <button type="button" class="pv-cap-btn primary hidden" id="pvCapCapture">Capturar</button>' +
      '    <button type="button" class="pv-cap-btn primary hidden" id="pvCapUpload">Subir foto</button>' +
      '    <button type="button" class="pv-cap-btn outline hidden" id="pvCapLive">Vista en vivo</button>' +
      '    <button type="button" class="pv-cap-btn outline hidden" id="pvCapGallery">Galería</button>' +
      '    <button type="button" class="pv-cap-btn primary hidden" id="pvCapRecord">Grabar video</button>' +
      '    <button type="button" class="pv-cap-btn outline hidden" id="pvCapVidGallery">Video galería</button>' +
      '    <input type="file" id="pvCapCamIn" accept="image/*" capture="environment" class="hidden" />' +
      '    <input type="file" id="pvCapGalIn" accept="image/*" class="hidden" />' +
      '    <input type="file" id="pvCapVidIn" accept="video/*" capture="environment" class="hidden" />' +
      '    <input type="file" id="pvCapVidGalIn" accept="video/*" class="hidden" />' +
      '    <button type="button" class="pv-cap-btn ghost hidden" id="pvCapRetry">Repetir</button>' +
      '    <button type="button" class="pv-cap-btn ghost hidden" id="pvCapOmit">Omitir</button>' +
      '    <button type="button" class="pv-cap-btn primary hidden" id="pvCapFinish">Enviar solicitud</button>' +
      '  </div>' +
      '</div>';

    var $ = function (id) {
      return container.querySelector('#' + id);
    };
    var show = function (el) {
      if (el) el.classList.remove('hidden');
    };
    var hide = function (el) {
      if (el) el.classList.add('hidden');
    };

    function isVideoSlot(slot) {
      return slot && (slot.mediaType === 'video' || slot.isVideo);
    }

    function stopCamera() {
      if (cameraStream) {
        cameraStream.getTracks().forEach(function (t) {
          t.stop();
        });
        cameraStream = null;
      }
      hide($('pvCapVideo'));
      hide($('pvCapCapture'));
    }

    function setProgress(p) {
      if (!p) return;
      $('pvCapBar').style.width = (p.pct || 0) + '%';
      var unit = captureCategory === 'sanitarios' ? 'evidencias' : 'fotos';
      $('pvCapProgressText').textContent = (p.done || 0) + ' de ' + (p.total || 0) + ' ' + unit;
    }

    function slotPayload(data, kind, completedStep) {
      var progress = data.progress || {};
      var done = typeof progress.done === 'number' ? progress.done : 0;
      var total = progress.total || 0;
      var slot = data.slot;
      var spoken =
        (slot && slot.spokenHint) ||
        (slot && slot.instructions) ||
        '';
      var nextStep = slot ? done + 1 : Math.max(1, done);
      return {
        kind: kind || (done === 0 ? 'open' : 'slot'),
        step: Math.max(1, nextStep),
        total: total,
        completedStep: completedStep != null ? completedStep : done,
        title: (slot && slot.title) || 'Foto',
        captureLabel: (slot && slot.captureLabel) || null,
        instructions: (slot && slot.instructions) || '',
        spoken: spoken,
        nextSpoken: kind === 'uploaded' || kind === 'skipped' ? spoken : undefined,
        progress: progress,
        ticketShortId: data.ticketShortId || '',
        canFinish: !!(data.canFinish && !slot)
      };
    }

    function notifySlot(data, slot, kind) {
      if (typeof callbacks.onSlotChange === 'function' && slot) {
        callbacks.onSlotChange(slotPayload(data, kind || 'open', null));
      }
    }

    function notifyUploaded(data, completedStep) {
      if (typeof callbacks.onUploaded === 'function') {
        callbacks.onUploaded(slotPayload(data, 'uploaded', completedStep));
      }
    }

    function notifySkipped(data, completedStep) {
      if (typeof callbacks.onSkipped === 'function') {
        callbacks.onSkipped(slotPayload(data, 'skipped', completedStep));
      } else if (typeof callbacks.onUploaded === 'function') {
        callbacks.onUploaded(slotPayload(data, 'skipped', completedStep));
      }
    }

    function isMobileCapture() {
      return (
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && window.innerWidth < 900)
      );
    }

    function voiceSessionActive() {
      try {
        return !!(window.PostventaVoice && window.PostventaVoice.isActive());
      } catch (e) {
        return false;
      }
    }

    function requestVoiceReconnect(reason) {
      try {
        if (typeof window.__pvEnsureVoiceDuringCapture === 'function') {
          window.__pvEnsureVoiceDuringCapture(reason || '');
        }
      } catch (e) {}
    }

    function hidePhotoControls() {
      hide($('pvCapTake'));
      hide($('pvCapGallery'));
      hide($('pvCapLive'));
      hide($('pvCapRecord'));
      hide($('pvCapVidGallery'));
    }

    function resetCaptureUi() {
      capturedBlob = null;
      liveMode = false;
      hide($('pvCapPreview'));
      $('pvCapPreview').removeAttribute('src');
      hide($('pvCapUpload'));
      hide($('pvCapRetry'));
      hide($('pvCapCapture'));
      hide($('pvCapReject'));
      hide($('pvCapVideo'));
      $('pvCapStatus').textContent = '';
      hidePhotoControls();
      if (!currentSlot) return;
      if (isVideoSlot(currentSlot)) {
        show($('pvCapRecord'));
        show($('pvCapVidGallery'));
        $('pvCapUpload').textContent = 'Subir video';
      } else {
        // Con voz activa: priorizar vista en vivo (la cámara nativa pausa el WebRTC)
        show($('pvCapLive'));
        show($('pvCapGallery'));
        $('pvCapUpload').textContent = 'Subir foto';
        if (voiceSessionActive()) {
          $('pvCapLive').textContent = 'Tomar foto (cámara web)';
          $('pvCapLive').classList.remove('outline');
          $('pvCapLive').classList.add('primary');
          hide($('pvCapTake'));
          $('pvCapStatus').textContent =
            'Usa Tomar foto (cámara web) para no cortar la voz del asistente.';
        } else {
          show($('pvCapTake'));
          $('pvCapTake').textContent = 'Abrir cámara';
        }
      }
      show($('pvCapActions'));
      if (currentSlot.optional) {
        show($('pvCapOmit'));
      } else {
        hide($('pvCapOmit'));
      }
    }

    function applyCapturedBlob(blob) {
      capturedBlob = blob;
      stopCamera();
      hidePhotoControls();
      var url = URL.createObjectURL(blob);
      var isVideo = blob.type && blob.type.indexOf('video/') === 0;
      if (isVideo) {
        var vid = $('pvCapVideo');
        vid.src = url;
        vid.muted = false;
        vid.controls = true;
        vid.loop = true;
        show(vid);
        hide($('pvCapPreview'));
      } else {
        hide($('pvCapVideo'));
        $('pvCapPreview').src = url;
        show($('pvCapPreview'));
      }
      show($('pvCapUpload'));
      show($('pvCapRetry'));
      $('pvCapStatus').textContent = isVideo
        ? 'Revisa el video y súbelo, o repite.'
        : 'Revisa la foto y súbela, o repite.';
    }

    async function startLiveCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        $('pvCapStatus').textContent = 'Usa Galería si la vista en vivo no está disponible.';
        return;
      }
      try {
        liveMode = true;
        // Solo video: no pedir audio para no pelear con el mic del asistente
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false
        });
        var vid = $('pvCapVideo');
        vid.srcObject = cameraStream;
        vid.controls = false;
        vid.loop = false;
        vid.muted = true;
        show(vid);
        hidePhotoControls();
        show($('pvCapCapture'));
        $('pvCapStatus').textContent = 'Encuadra y toca Capturar. La voz del asistente sigue activa.';
        // requestVoiceReconnect('camara_en_vivo'); // Desactivado para evitar reinicios
      } catch (e) {
        liveMode = false;
        $('pvCapStatus').textContent =
          'No se pudo abrir la vista en vivo. Usa Galería, o Cámara nativa (puede pausar la voz).';
        show($('pvCapTake'));
        show($('pvCapGallery'));
        show($('pvCapLive'));
        $('pvCapTake').textContent = 'Cámara nativa';
      }
    }

    function takeLivePhoto() {
      var vid = $('pvCapVideo');
      if (!vid.videoWidth) return;
      var canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth;
      canvas.height = vid.videoHeight;
      canvas.getContext('2d').drawImage(vid, 0, 0);
      canvas.toBlob(function (blob) {
        if (blob) applyCapturedBlob(blob);
      }, 'image/jpeg', 0.88);
    }

    async function uploadBlob(blob) {
      if (!currentSlotId || !blob) return;
      hide($('pvCapReject'));
      $('pvCapUpload').disabled = true;
      $('pvCapStatus').textContent = 'Subiendo... El asistente continuará cuando la foto llegue al servidor.';
      var fd = new FormData();
      var isVideo = blob.type && blob.type.indexOf('video/') === 0;
      var file = blob;
      if (!(blob instanceof File)) {
        file = new File([blob], isVideo ? 'capture.mp4' : 'capture.jpg', {
          type: blob.type || (isVideo ? 'video/mp4' : 'image/jpeg')
        });
      }
      fd.append('photo', file, file.name);
      var res;
      try {
        res = await fetch(API + '/slots/' + encodeURIComponent(currentSlotId) + '/capture', {
          method: 'POST',
          body: fd
        });
      } catch (e) {
        $('pvCapUpload').disabled = false;
        show($('pvCapReject'));
        $('pvCapReject').textContent = 'Sin conexión. Intenta de nuevo.';
        return;
      }
      var data = await res.json().catch(function () {
        return {};
      });
      $('pvCapUpload').disabled = false;
      if (!data.ok) {
        show($('pvCapReject'));
        $('pvCapReject').textContent = data.message || 'Repite la captura.';
        if (data.slot && data.slot.id) {
          currentSlotId = data.slot.id;
          currentSlot = data.slot;
        }
        return;
      }
      if (data.earlyFinishAllowed) earlyFinishAllowed = true;
      var completedStep = (data.progress && data.progress.done) || 0;
      notifyUploaded(data, completedStep);
      await showSlot(data, { skipNotify: true });
    }

    async function omitSlot() {
      if (!currentSlotId) return;
      var res = await fetch(API + '/slots/' + encodeURIComponent(currentSlotId) + '/omit', {
        method: 'POST'
      });
      var data = await res.json();
      if (!data.ok) {
        show($('pvCapReject'));
        $('pvCapReject').textContent = data.message || 'No se puede omitir.';
        return;
      }
      var completedStep = (data.progress && data.progress.done) || 0;
      notifySkipped(data, completedStep);
      await showSlot(data, { skipNotify: true });
    }

    function showDoneState(data) {
      stopCamera();
      hide($('pvCapSlot'));
      hide($('pvCapActions'));
      show($('pvCapDone'));
      $('pvCapDoneTitle').textContent = '¡Solicitud terminada!';
      $('pvCapDoneText').textContent = 'Todas las evidencias fueron enviadas.';
      $('pvCapTicketDone').textContent = 'N° solicitud: ' + (data.ticketShortId || '');
      show($('pvCapEmail'));
      if (data.ownerEmail) $('pvCapEmailInput').value = data.ownerEmail;
      if (typeof callbacks.onComplete === 'function') {
        callbacks.onComplete(data);
      }
    }

    async function finishCapture() {
      $('pvCapFinish').disabled = true;
      var res = await fetch(API + '/finish', { method: 'POST' });
      var data = await res.json();
      $('pvCapFinish').disabled = false;
      if (!data.ok) {
        $('pvCapStatus').textContent = 'Aún faltan fotos por completar.';
        return;
      }
      showDoneState(data);
    }

    async function showSlot(data, options) {
      options = options || {};
      setProgress(data.progress);
      if (data.category) captureCategory = data.category;
      if (data.ticketShortId) {
        $('pvCapTicket').textContent = 'Solicitud ' + data.ticketShortId;
      }

      stopCamera();
      $('pvCapVideo').removeAttribute('src');

      if (data.canFinish && !data.slot) {
        hide($('pvCapSlot'));
        show($('pvCapDone'));
        show($('pvCapFinish'));
        hidePhotoControls();
        $('pvCapDoneTitle').textContent = 'Evidencias completas';
        $('pvCapDoneText').textContent = earlyFinishAllowed
          ? 'Con lo enviado alcanza. Presiona Enviar solicitud.'
          : 'Presiona Enviar solicitud para confirmar.';
        return;
      }

      if (!data.slot) {
        hide($('pvCapSlot'));
        show($('pvCapDone'));
        return;
      }

      show($('pvCapSlot'));
      hide($('pvCapDone'));
      currentSlot = data.slot;
      currentSlotId = data.slot.id;
      var stepNum = ((data.progress && data.progress.done) || 0) + 1;
      var total = (data.progress && data.progress.total) || 1;
      $('pvCapStep').textContent = total > 1 ? 'Paso ' + stepNum + ' de ' + total : 'Foto de evidencia';
      var labelEl = $('pvCapLabel');
      if (data.slot.captureLabel) {
        labelEl.textContent = 'Vas a fotografiar:';
        show(labelEl);
        $('pvCapTitle').textContent = data.slot.captureLabel;
      } else {
        hide(labelEl);
        $('pvCapTitle').textContent = data.slot.title || 'Foto';
      }
      $('pvCapInstructions').textContent = data.slot.instructions || '';
      resetCaptureUi();
      if (!options.skipNotify && data.slot) {
        var kind = (data.progress && data.progress.done === 0) ? 'open' : 'slot';
        notifySlot(data, data.slot, kind);
      }
      if (data.canFinish || data.earlyFinishAllowed) {
        earlyFinishAllowed = earlyFinishAllowed || !!data.earlyFinishAllowed;
        show($('pvCapFinish'));
      } else {
        hide($('pvCapFinish'));
      }
    }

    async function loadNext() {
      var res = await fetch(API + '/next');
      if (!res.ok) {
        hide($('pvCapSlot'));
        hide($('pvCapActions'));
        show($('pvCapError'));
        $('pvCapErrorText').textContent = 'El enlace expiró o no es válido.';
        if (typeof callbacks.onError === 'function') {
          callbacks.onError('invalid_token');
        }
        return;
      }
      var data = await res.json();
      if (data.category) captureCategory = data.category;
      await showSlot(data);
    }

    function openNativeCamera() {
      $('pvCapCamIn').value = '';
      $('pvCapCamIn').click();
    }

    function openNativeVideo() {
      $('pvCapVidIn').value = '';
      $('pvCapVidIn').click();
    }

    function openCameraPrimary() {
      if (currentSlot && isVideoSlot(currentSlot)) {
        openNativeVideo();
        return;
      }
      // Preferir cámara en página: input capture nativo suspende la pestaña y corta la voz
      startLiveCamera().then(function () {
        if (cameraStream) return;
        if (!voiceSessionActive()) openNativeCamera();
      });
    }

    $('pvCapTake').addEventListener('click', openCameraPrimary);
    $('pvCapGallery').addEventListener('click', function () {
      $('pvCapGalIn').value = '';
      $('pvCapGalIn').click();
    });
    $('pvCapRecord').addEventListener('click', openNativeVideo);
    $('pvCapVidGallery').addEventListener('click', function () {
      $('pvCapVidGalIn').value = '';
      $('pvCapVidGalIn').click();
    });
    $('pvCapLive').addEventListener('click', startLiveCamera);
    $('pvCapCapture').addEventListener('click', takeLivePhoto);
    $('pvCapUpload').addEventListener('click', function () {
      uploadBlob(capturedBlob);
    });
    $('pvCapRetry').addEventListener('click', resetCaptureUi);
    $('pvCapOmit').addEventListener('click', omitSlot);
    $('pvCapFinish').addEventListener('click', finishCapture);
    $('pvCapCamIn').addEventListener('change', function () {
      var f = $('pvCapCamIn').files && $('pvCapCamIn').files[0];
      if (f) applyCapturedBlob(f);
      requestVoiceReconnect('vuelve_camara_nativa');
    });
    $('pvCapGalIn').addEventListener('change', function () {
      var f = $('pvCapGalIn').files && $('pvCapGalIn').files[0];
      if (f) applyCapturedBlob(f);
      requestVoiceReconnect('vuelve_galeria');
    });
    $('pvCapVidIn').addEventListener('change', function () {
      var f = $('pvCapVidIn').files && $('pvCapVidIn').files[0];
      if (f) applyCapturedBlob(f);
      requestVoiceReconnect('vuelve_video');
    });
    $('pvCapVidGalIn').addEventListener('change', function () {
      var f = $('pvCapVidGalIn').files && $('pvCapVidGalIn').files[0];
      if (f) applyCapturedBlob(f);
      requestVoiceReconnect('vuelve_video_galeria');
    });
    $('pvCapSendEmail').addEventListener('click', async function () {
      var email = ($('pvCapEmailInput').value || '').trim();
      hide($('pvCapEmailErr'));
      if (!email) {
        show($('pvCapEmailErr'));
        $('pvCapEmailErr').textContent = 'Ingresa tu correo.';
        return;
      }
      $('pvCapSendEmail').disabled = true;
      var res = await fetch(API + '/send-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      var data = await res.json().catch(function () {
        return {};
      });
      $('pvCapSendEmail').disabled = false;
      if (!res.ok || !data.ok) {
        show($('pvCapEmailErr'));
        $('pvCapEmailErr').textContent = data.message || 'No se pudo enviar.';
        return;
      }
      hide($('pvCapEmail'));
      show($('pvCapFarewell'));
      $('pvCapFarewell').textContent = data.message || 'Copia enviada a ' + email + '.';
    });

    loadNext();

    return {
      destroy: function () {
        stopCamera();
        container.innerHTML = '';
      }
    };
  }

  global.PostventaCaptureEmbed = { mount: mount };
})(window);
