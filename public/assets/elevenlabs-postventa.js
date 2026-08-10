(function () {

  var p = window.location.pathname.replace(/\/+$/, '') || '/';

  if (p !== '/postventa/captura') return;



  var params = new URLSearchParams(window.location.search);

  var tenant = params.get('tenant') || '';

  var autoStart = params.get('start') === '1' || params.get('iniciar') === '1';

  var url = '/api/postventa/public/elevenlabs-agent';

  if (tenant) url += '?tenant=' + encodeURIComponent(tenant);



  var ctaBtn = null;

  var ctaStatus = null;

  var voiceStatusEl = null;

  var voiceDotEl = null;

  var agentReady = false;

  var agentConfig = null;

  var sessionStarting = false;

  var captureEmbedInstance = null;

  var lastNotifiedStepKey = '';

  var reconnectingVoice = false;

  var voiceDesiredInCapture = true;

  var voiceMode = 'listening';



  function setTrackedVoiceMode(mode) {

    var m = mode && (mode.mode || mode);

    if (m === 'speaking' || m === 'listening') voiceMode = m;

    return m;

  }



  function waitUntilSafeToOpenCapture() {

    // Espera a que el agente termine de hablar (intro / "voy a abrir la cámara")
    // antes de montar la captura. Evita abrir la cámara a mitad de la prevalidación.
    return new Promise(function (resolve) {

      var started = Date.now();

      var heardSpeaking = voiceMode === 'speaking';

      var graceMs = 2800;

      var maxMs = 22000;

      function finish() {

        setTimeout(resolve, 400);

      }

      function check() {

        var t = Date.now() - started;

        if (voiceMode === 'speaking') heardSpeaking = true;

        if (heardSpeaking && voiceMode !== 'speaking') {

          finish();

          return;

        }

        if (!heardSpeaking && t >= graceMs) {

          finish();

          return;

        }

        if (t >= maxMs) {

          resolve();

          return;

        }

        setTimeout(check, 80);

      }

      check();

    });

  }



  function bindCta() {

    ctaBtn = document.getElementById('pv-start-cta');

    ctaStatus = document.getElementById('pv-cta-status');

    voiceStatusEl = document.getElementById('pv-voice-status');

    voiceDotEl = document.getElementById('pv-voice-dot');

    var endBtn = document.getElementById('pv-voice-end');

    if (endBtn) {

      endBtn.addEventListener('click', function () {

        stopAssistantSession();

      });

    }

    restoreContactForm();

    if (!ctaBtn) return;

    ctaBtn.addEventListener('click', function () {

      startAssistantFromCta();

    });

  }



  function setCtaReady(label) {

    agentReady = true;

    if (ctaBtn) {

      ctaBtn.disabled = false;

      if (label && ctaBtn.querySelector('.pv-cta-label')) {

        ctaBtn.querySelector('.pv-cta-label').textContent = label;

      }

    }

    if (ctaStatus) {

      ctaStatus.textContent = 'Completa tu nombre y celular, luego toca el botón.';

      ctaStatus.classList.remove('is-error');

    }

    if (autoStart && ctaStatus) {

      ctaStatus.textContent = 'Completa tus datos y toca el botón azul para iniciar.';

    }

  }



  function primeAudioOutput(ctx) {

    try {

      var seconds = 0.2;

      var frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));

      var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);

      var src = ctx.createBufferSource();

      src.buffer = buffer;

      var gain = ctx.createGain();

      gain.gain.value = 0.0001;

      src.connect(gain);

      gain.connect(ctx.destination);

      src.start(0);

    } catch (e) {}

  }



  function warmAudioForConversation() {

    try {

      var Ctx = window.AudioContext || window.webkitAudioContext;

      if (!Ctx) return Promise.resolve();

      if (!window.__pvAudioCtx) window.__pvAudioCtx = new Ctx();

      var ctx = window.__pvAudioCtx;

      if (ctx.state === 'suspended') {

        return ctx

          .resume()

          .then(function () { primeAudioOutput(ctx); })

          .catch(function () {});

      }

      primeAudioOutput(ctx);

    } catch (e) {}

    return Promise.resolve();

  }



  function primeAssistantVisibility() {

    document.body.classList.add('pv-assistant-active');

    var shell = document.getElementById('pv-voice-shell');

    if (shell) shell.setAttribute('aria-hidden', 'false');

  }



  function ensureMicForVoice() {

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {

      return Promise.resolve(true);

    }

    if (window.__pvMicStream && window.__pvMicStream.active) {

      return Promise.resolve(true);

    }

    return navigator.mediaDevices

      .getUserMedia({ audio: true })

      .then(function (stream) {

        window.__pvMicStream = stream;

        return true;

      })

      .catch(function () {

        return false;

      });

  }



  function setVoiceState(live, text) {

    if (voiceDotEl) voiceDotEl.className = 'pv-voice-dot' + (live ? ' live' : '');

    if (voiceStatusEl && text) voiceStatusEl.textContent = text;

  }



  function firstNameFrom(full) {
    var w = String(full || '').trim().split(/\s+/)[0] || '';
    if (!w) return '';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }

  function readContactForm() {
    var nameEl = document.getElementById('pv-contact-name');
    var phoneEl = document.getElementById('pv-contact-phone');
    var name = nameEl ? String(nameEl.value || '').trim() : '';
    var phone = phoneEl ? String(phoneEl.value || '').trim() : '';
    return { name: name, phone: phone, firstName: firstNameFrom(name) };
  }

  function validateContactForm() {
    var errEl = document.getElementById('pv-contact-err');
    var c = readContactForm();
    if (!c.name || c.name.length < 2) {
      if (errEl) errEl.textContent = 'Indica tu nombre.';
      return null;
    }
    var digits = c.phone.replace(/\D/g, '');
    if (digits.length < 8) {
      if (errEl) errEl.textContent = 'Indica un celular válido.';
      return null;
    }
    if (errEl) errEl.textContent = '';
    try {
      sessionStorage.setItem('pv_contact_name', c.name);
      sessionStorage.setItem('pv_contact_phone', c.phone);
      sessionStorage.setItem('pv_contact_first_name', c.firstName);
    } catch (e) {}
    window.__pvContact = c;
    return c;
  }

  function restoreContactForm() {
    try {
      var name = sessionStorage.getItem('pv_contact_name') || '';
      var phone = sessionStorage.getItem('pv_contact_phone') || '';
      var nameEl = document.getElementById('pv-contact-name');
      var phoneEl = document.getElementById('pv-contact-phone');
      if (nameEl && name) nameEl.value = name;
      if (phoneEl && phone) phoneEl.value = phone;
      if (name || phone) {
        window.__pvContact = {
          name: name,
          phone: phone,
          firstName: firstNameFrom(name)
        };
      }
    } catch (e) {}
  }

  function buildDynamicVariables() {

    var vars = {};

    if (tenant) vars.tenant_slug = tenant;

    if (agentConfig && agentConfig.tenantSlug) vars.tenant_slug = agentConfig.tenantSlug;

    if (agentConfig && agentConfig.tenantName) vars.tenant_name = agentConfig.tenantName;

    var c = window.__pvContact || readContactForm();
    if (c && c.name) {
      vars.contact_name = c.name;
      vars.contact_first_name = c.firstName || firstNameFrom(c.name);
    }
    if (c && c.phone) vars.contact_phone = c.phone;

    return vars;

  }



  async function startAssistantFromCta() {

    if (sessionStarting || (window.PostventaVoice && window.PostventaVoice.isActive())) return;

    if (!validateContactForm()) {
      var nameEl = document.getElementById('pv-contact-name');
      var phoneEl = document.getElementById('pv-contact-phone');
      var c = readContactForm();
      if ((!c.name || c.name.length < 2) && nameEl) nameEl.focus();
      else if (phoneEl) phoneEl.focus();
      return;
    }

    if (!agentConfig || !agentConfig.agentId) {

      setCtaError('El asistente no está disponible en este momento.');

      return;

    }

    if (!window.PostventaVoice) {

      setCtaError('No se pudo cargar el cliente de voz. Recarga la página.');

      return;

    }



    sessionStarting = true;

    primeAssistantVisibility();

    setVoiceState(false, 'Conectando…');



    await warmAudioForConversation();

    var micOk = await ensureMicForVoice();

    if (!micOk && ctaStatus) {

      ctaStatus.textContent = 'Permite el micrófono cuando el navegador lo pida para hablar con el asistente.';

      ctaStatus.classList.remove('is-error');

    }



    try {

      var conv = await window.PostventaVoice.start({

        agentId: agentConfig.agentId,

        dynamicVariables: buildDynamicVariables(),

        clientTools: buildClientTools(),

        onConnect: function (conversation) {

          sessionStarting = false;

          window.__pvConvaiConversation = conversation || conv;

          setVoiceState(true, 'Escuchando');

          if (ctaStatus) {

            ctaStatus.textContent = 'Asistente activo — habla con naturalidad.';

            ctaStatus.classList.remove('is-error');

          }

        },

        onDisconnect: function () {

          sessionStarting = false;

          window.__pvConvaiConversation = null;

          var inCapture = document.body.classList.contains('pv-capture-mode');

          setVoiceState(false, inCapture ? 'Voz pausada — reconectando…' : 'Sesión finalizada');

          if (ctaStatus) {

            ctaStatus.textContent = inCapture

              ? 'La cámara puede pausar la voz. Reconectando el asistente…'

              : 'Sesión pausada. Toca Iniciar asistente para continuar.';

            ctaStatus.classList.remove('is-error');

          }

          if (inCapture && voiceDesiredInCapture) {

            setTimeout(function () {

              ensureVoiceDuringCapture('despues_desconexion');

            }, 700);

          }

        },

        onError: function () {

          sessionStarting = false;

          setVoiceState(false, 'Error de conexión');

          if (ctaStatus) {

            ctaStatus.textContent = 'No se pudo conectar la voz. Toca otra vez el botón o permite el micrófono.';

            ctaStatus.classList.add('is-error');

          }

        },

        onModeChange: function (mode) {

          var m = setTrackedVoiceMode(mode);

          if (m === 'speaking') setVoiceState(true, 'El asistente habla…');

          else if (m === 'listening') setVoiceState(true, 'Escuchando');

        },

      });

      window.__pvConvaiConversation = conv;

    } catch (e) {

      sessionStarting = false;

      setVoiceState(false, 'No se pudo conectar');

      if (ctaStatus) {

        ctaStatus.textContent = 'No se pudo conectar la voz. Toca otra vez el botón azul o permite el micrófono.';

        ctaStatus.classList.add('is-error');

      }

    }

  }



  async function stopAssistantSession() {

    sessionStarting = false;

    voiceDesiredInCapture = false;

    reconnectingVoice = false;

    try {

      if (window.PostventaVoice) await window.PostventaVoice.stop();

    } catch (e) {}

    window.__pvConvaiConversation = null;

    setVoiceState(false, 'Sesión finalizada');

    document.body.classList.remove('pv-assistant-active');

    var shell = document.getElementById('pv-voice-shell');

    if (shell) shell.setAttribute('aria-hidden', 'true');

  }



  function setCtaError(message) {

    agentReady = false;

    if (ctaBtn) ctaBtn.disabled = true;

    if (ctaStatus) {

      ctaStatus.textContent = message;

      ctaStatus.classList.add('is-error');

    }

  }



  window.__pvStartAssistant = startAssistantFromCta;



  function isAllowedCaptureUrl(raw) {

    var value = String(raw || '').trim();

    if (!value) return null;

    try {

      var parsed = value.startsWith('http')

        ? new URL(value)

        : new URL(value, window.location.origin);

      var path = parsed.pathname.replace(/\/+$/, '');

      var m = path.match(/\/postventa\/capture\/([^/]+)$/);

      if (!m) return null;

      return window.location.origin + '/postventa/capture/' + encodeURIComponent(m[1]);

    } catch (e) {

      return null;

    }

  }



  function tokenFromCaptureUrl(captureUrl) {

    try {

      var parsed = captureUrl.startsWith('http')

        ? new URL(captureUrl)

        : new URL(captureUrl, window.location.origin);

      var parts = parsed.pathname.replace(/\/+$/, '').split('/');

      return parts[parts.length - 1] || null;

    } catch (e) {

      return null;

    }

  }



  function resolveCaptureUrl(params) {

    if (!params) return null;

    return (

      isAllowedCaptureUrl(params.url) ||

      isAllowedCaptureUrl(params.captureUrl) ||

      isAllowedCaptureUrl(params.capture_url)

    );

  }



  function sendToAgent(msg, opts) {

    var forceTurn = !opts || opts.forceTurn !== false;

    var conv = window.__pvConvaiConversation;

    if (!conv && window.PostventaVoice) conv = window.PostventaVoice.getConversation();

    if (!conv) return false;



    if (forceTurn && typeof conv.sendUserMessage === 'function') {

      try { conv.sendUserMessage(msg); return true; } catch (e) {}

    }

    if (!forceTurn && typeof conv.sendContextualUpdate === 'function') {

      try { conv.sendContextualUpdate(msg); return true; } catch (e) {}

    }

    if (typeof conv.sendUserMessage === 'function') {

      try { conv.sendUserMessage(msg); return true; } catch (e) {}

    }

    return false;

  }



  function notifyAgentCaptureStep(payload, kind) {

    if (!payload) return;

    var stepKey = (kind || 'slot') + ':' + payload.step + ':' + payload.title;

    if (kind !== 'uploaded' && kind !== 'skipped' && stepKey === lastNotifiedStepKey) return;

    if (kind === 'uploaded' || kind === 'skipped') {

      lastNotifiedStepKey = stepKey;

    } else {

      lastNotifiedStepKey = stepKey;

    }



    var spoken = payload.spoken || payload.instructions || '';

    var completed = payload.completedStep || Math.max(1, (payload.step || 1) - 1);

    var msg;

    if (kind === 'uploaded') {

      msg =

        '[CAPTURA SUBIDA] La foto fue recibida y guardada en el servidor. ';

      if (payload.canFinish || payload.total === 1) {

        msg +=

          'Indica que pulse Enviar solicitud en pantalla y luego pedirá el correo. NO cuelgues hasta [CAPTURA FIN].';

      } else if (payload.nextSpoken || spoken) {

        msg +=

          'Ahora indica en voz el siguiente paso (paso ' +

          payload.step +

          ' de ' +

          payload.total +

          '): ' +

          (payload.nextSpoken || spoken);

      } else if (payload.canFinish) {

        msg +=

          'Todas las fotos obligatorias están en el servidor. Indica que pulse Enviar solicitud y luego pedirá el correo.';

      } else {

        msg += 'Todas las fotos obligatorias están listas. Indica que pulse Enviar solicitud y luego pedirá el correo.';

      }

    } else if (kind === 'skipped') {

      msg =

        '[CAPTURA OMITIDA] El propietario omitió el paso ' +

        completed +

        '. ';

      if (payload.nextSpoken || spoken) {

        msg +=

          'Continúa con el paso ' +

          payload.step +

          ' de ' +

          payload.total +

          ': ' +

          (payload.nextSpoken || spoken);

      } else {

        msg += 'Indica que pulse Enviar solicitud si ya completó lo necesario.';

      }

    } else if (kind === 'open') {

      var subject = payload.captureLabel || payload.title || 'la evidencia';

      msg =

        '[CAPTURA INICIO] Pantalla de cámara abierta. Vas a fotografiar: ' +

        subject +

        '. ' +

        spoken +

        ' Indica al propietario qué foto tomar y dónde, en español claro y breve. ' +

        'NO pidas otra foto hasta recibir [CAPTURA SUBIDA] confirmando que la subida llegó al servidor.';

    } else {

      msg =

        '[CAPTURA PASO ' +

        payload.step +

        ' de ' +

        payload.total +

        '] ' +

        (payload.title ? payload.title + '. ' : '') +

        spoken +

        ' Indica al propietario qué capturar y dónde, en español claro. ' +

        'Espera [CAPTURA SUBIDA] del paso anterior antes de pedir la siguiente.';

    }



    var sent = sendToAgent(msg, { forceTurn: true });

    if (window.console && typeof console.debug === 'function') {

      console.debug('[pv-capture] notify ' + kind + ' sent=' + sent, msg);

    }

    document.dispatchEvent(

      new CustomEvent('pv-capture-agent-notify', { detail: { message: msg, payload: payload, kind: kind } })

    );

  }



  function softenAssistantForCapture() {

    try {

      var conv = window.__pvConvaiConversation || (window.PostventaVoice && window.PostventaVoice.getConversation());

      if (conv) {

        // Mantener micrófono activo: el propietario sigue hablando con el asistente durante la captura.

        if (typeof conv.setMicMuted === 'function') conv.setMicMuted(false);

        if (typeof conv.setVolume === 'function') conv.setVolume({ volume: 0.85 });

      }

    } catch (e) {}

  }



  async function ensureVoiceDuringCapture(reason) {

    if (!voiceDesiredInCapture) return;

    if (!document.body.classList.contains('pv-capture-mode')) return;

    if (document.visibilityState && document.visibilityState !== 'visible') return;

    if (window.PostventaVoice && window.PostventaVoice.isActive()) {

      softenAssistantForCapture();

      return;

    }

    if (reconnectingVoice || sessionStarting) return;

    if (!agentConfig || !agentConfig.agentId || !window.PostventaVoice) return;

    reconnectingVoice = true;

    sessionStarting = true;

    setVoiceState(false, 'Reconectando voz…');

    if (ctaStatus) {

      ctaStatus.textContent = 'Reconectando el asistente para seguir guiando las fotos…';

      ctaStatus.classList.remove('is-error');

    }

    try {

      await warmAudioForConversation();

      await ensureMicForVoice();

      var conv = await window.PostventaVoice.start({

        agentId: agentConfig.agentId,

        dynamicVariables: buildDynamicVariables(),

        clientTools: buildClientTools(),

        onConnect: function (conversation) {

          sessionStarting = false;

          reconnectingVoice = false;

          window.__pvConvaiConversation = conversation || conv;

          softenAssistantForCapture();

          setVoiceState(true, 'Escuchando');

          if (ctaStatus) {

            ctaStatus.textContent = 'Asistente reconectado — sigue las fotos abajo.';

            ctaStatus.classList.remove('is-error');

          }

          sendToAgent(

            '[SISTEMA] Voz reconectada durante la captura' +

              (reason ? ' (' + reason + ')' : '') +

              '. NO te despidas. Continúa guiando foto a foto. Espera [CAPTURA PASO] / [CAPTURA SUBIDA] / [CAPTURA FIN].',

            { forceTurn: true }

          );

        },

        onDisconnect: function () {

          sessionStarting = false;

          window.__pvConvaiConversation = null;

          setVoiceState(false, 'Voz pausada');

          if (document.body.classList.contains('pv-capture-mode') && voiceDesiredInCapture) {

            setTimeout(function () {

              ensureVoiceDuringCapture('retry_disconnect');

            }, 1200);

          }

        },

        onError: function () {

          sessionStarting = false;

          reconnectingVoice = false;

          setVoiceState(false, 'Error de voz');

        },

        onModeChange: function (mode) {

          var m = setTrackedVoiceMode(mode);

          if (m === 'speaking') setVoiceState(true, 'El asistente habla…');

          else if (m === 'listening') setVoiceState(true, 'Escuchando');

        }

      });

      window.__pvConvaiConversation = conv;

    } catch (e) {

      sessionStarting = false;

      reconnectingVoice = false;

      setVoiceState(false, 'Sin voz');

      if (ctaStatus) {

        ctaStatus.textContent = 'No se pudo reconectar la voz. Toca Iniciar asistente arriba si quieres seguir con audio.';

        ctaStatus.classList.add('is-error');

      }

    }

  }



  window.__pvEnsureVoiceDuringCapture = ensureVoiceDuringCapture;



  document.addEventListener('visibilitychange', function () {

    if (document.visibilityState !== 'visible') return;

    if (!document.body.classList.contains('pv-capture-mode')) return;

    setTimeout(function () {

      ensureVoiceDuringCapture('visibility_visible');

    }, 400);

  });



  function enterCaptureMode() {

    voiceDesiredInCapture = true;

    softenAssistantForCapture();

    document.body.classList.add('pv-capture-mode');

    var shell = document.getElementById('pv-capture-shell');

    if (shell) {

      shell.setAttribute('aria-hidden', 'false');

      shell.style.display = 'flex';

    }

    var banner = document.getElementById('pv-capture-banner');

    if (banner) banner.style.display = 'none';

    setTimeout(function () {

      softenAssistantForCapture();

      ensureVoiceDuringCapture('enter_capture');

    }, 500);

  }



  function openEmbeddedCapture(target, ticketShortId) {

    var token = tokenFromCaptureUrl(target);

    if (!token) return false;

    var panel = document.getElementById('pv-capture-panel');

    if (!panel) return false;



    lastNotifiedStepKey = '';

    enterCaptureMode();



    try {

      sessionStorage.setItem('pv_last_capture_url', target);

    } catch (e) {}



    if (window.PostventaCaptureEmbed && typeof window.PostventaCaptureEmbed.mount === 'function') {

      if (captureEmbedInstance && typeof captureEmbedInstance.destroy === 'function') {

        captureEmbedInstance.destroy();

      }

      captureEmbedInstance = window.PostventaCaptureEmbed.mount(panel, token, {

        onSlotChange: function (payload) {

          notifyAgentCaptureStep(payload, payload.kind === 'open' || payload.step === 1 ? 'open' : 'slot');

        },

        onUploaded: function (payload) {

          notifyAgentCaptureStep(payload, 'uploaded');

        },

        onSkipped: function (payload) {

          notifyAgentCaptureStep(payload, 'skipped');

        },

        onComplete: function (data) {

          var finishMsg =

            '[CAPTURA FIN] Todas las fotos enviadas. Solicitud ' +

            (data.ticketShortId || ticketShortId || '') +

            '. Pide al propietario su correo en la pantalla de abajo para enviar la copia y despídete brevemente.';

          sendToAgent(finishMsg, { forceTurn: true });

        },

        onError: function () {

          if (window.PostventaVoice && window.PostventaVoice.isActive()) {

            if (ctaStatus) {

              ctaStatus.textContent = 'No se pudo cargar la captura embebida. Usa Tomar fotos ahora si aparece el botón.';

              ctaStatus.classList.add('is-error');

            }

            return;

          }

          window.location.assign(target);

        }

      });

    } else {

      var src =

        '/postventa/capture/' +

        encodeURIComponent(token) +

        '?embed=1' +

        (ticketShortId ? '&ticket=' + encodeURIComponent(ticketShortId) : '');



      panel.innerHTML =

        '<iframe id="pv-capture-frame" title="Captura de fotos postventa" src="' +

        src +

        '" allow="camera *; microphone *; fullscreen *" allowfullscreen></iframe>';

    }



    if (ctaStatus) {

      ctaStatus.textContent = 'Captura activa abajo — toca Tomar foto y sigue las instrucciones del asistente.';

      ctaStatus.classList.remove('is-error');

    }



    return true;

  }



  function ensureCaptureBanner() {

    var existing = document.getElementById('pv-capture-banner');

    if (existing) return existing;



    var banner = document.createElement('div');

    banner.id = 'pv-capture-banner';

    banner.style.cssText =

      'display:none;position:fixed;left:0;right:0;bottom:0;z-index:99999;' +

      'background:#0b1220;color:#fff;padding:16px 16px max(16px,env(safe-area-inset-bottom));' +

      'box-shadow:0 -8px 32px rgba(0,0,0,.35);font-family:Inter,system-ui,sans-serif;';

    banner.innerHTML =

      '<p style="margin:0 0 8px;font-size:14px;color:#94a3b8">Solicitud registrada</p>' +

      '<p id="pv-capture-banner-text" style="margin:0 0 12px;font-size:16px;font-weight:700;line-height:1.4">' +

      'Continúa con las fotos guiadas</p>' +

      '<button type="button" id="pv-capture-banner-btn" style="width:100%;padding:14px;border:none;border-radius:12px;' +

      'background:#2563eb;color:#fff;font-size:16px;font-weight:700;cursor:pointer">' +

      'Tomar fotos ahora</button>';

    document.body.appendChild(banner);



    banner.querySelector('#pv-capture-banner-btn').addEventListener('click', function () {

      var t = banner.getAttribute('data-capture-url');

      if (t) navigateToCapture({ url: t });

    });

    return banner;

  }



  function showCaptureBanner(target, ticketShortId) {

    var banner = ensureCaptureBanner();

    banner.setAttribute('data-capture-url', target);

    var text = document.getElementById('pv-capture-banner-text');

    if (text) {

      text.textContent = ticketShortId

        ? 'Solicitud ' + ticketShortId + ': toca el botón para las fotos guiadas'

        : 'Toca el botón para continuar con las fotos guiadas';

    }

    banner.style.display = 'block';

  }



  async function navigateToCapture(params) {

    var target = resolveCaptureUrl(params);

    if (!target) {

      return { success: false, error: 'invalid_url' };

    }

    var ticketShortId =

      (params && (params.ticketShortId || params.ticket_short_id)) || '';



    if (ctaStatus) {

      ctaStatus.textContent = 'El asistente explica la captura… la cámara abrirá al terminar.';

      ctaStatus.classList.remove('is-error');

    }

    setVoiceState(true, 'Esperando fin de la explicación…');

    await waitUntilSafeToOpenCapture();



    if (openEmbeddedCapture(target, ticketShortId)) {

      return {

        success: true,

        message: 'embedded_capture_opened',

        embedded: true,

        url: target,

        session_must_continue: true,

        end_call: false,

        agent_instruction:

          'NO cuelgues ni te despidas. La llamada sigue activa. Espera [CAPTURA INICIO] y guía cada foto hasta [CAPTURA FIN].',

        hint: 'Cámara embebida abajo; el asistente guía cada foto por voz.'

      };

    }



    showCaptureBanner(target, ticketShortId);

    if (window.PostventaVoice && window.PostventaVoice.isActive()) {

      return {

        success: true,

        message: 'capture_banner_shown',

        embedded: false,

        url: target,

        session_must_continue: true,

        end_call: false,

        agent_instruction: 'NO cuelgues. Indica que toque Tomar fotos ahora en pantalla.'

      };

    }

    window.location.assign(target);

    return { success: true, message: 'opening_capture_fullpage', url: target, embedded: false };

  }



  function buildClientTools() {

    function wrap(fn) {

      return function (params) {

        try {

          return Promise.resolve(fn(params));

        } catch (e) {

          return Promise.resolve({ success: false, error: String(e && e.message ? e.message : e) });

        }

      };

    }

    return {

      open_capture: wrap(navigateToCapture),

      openCapture: wrap(navigateToCapture),

      redirectToExternalURL: wrap(function (params) {

        return navigateToCapture({ url: params && params.url });

      })

    };

  }



  window.addEventListener('message', function (event) {

    if (event.origin !== window.location.origin) return;

    var data = event.data;

    if (!data || data.source !== 'pv-capture') return;



    if (data.type === 'slot' && data.payload) {

      notifyAgentCaptureStep(data.payload, data.payload.kind || 'slot');

    } else if (data.type === 'uploaded' && data.payload) {

      notifyAgentCaptureStep(data.payload, 'uploaded');

    } else if (data.type === 'skipped' && data.payload) {

      notifyAgentCaptureStep(data.payload, 'skipped');

    } else if (data.type === 'complete' && data.payload) {

      var finishMsg =

        '[CAPTURA FIN] Todas las fotos enviadas. Solicitud ' +

        (data.payload.ticketShortId || '') +

        '. Pide al propietario su correo en la pantalla de abajo para enviar la copia y despídete brevemente.';

      sendToAgent(finishMsg, { forceTurn: true });

    }

  });



  window.__pvPostventaClientTools = buildClientTools();

  window.__pvNotifyCaptureStep = notifyAgentCaptureStep;

  window.__pvOpenCapture = navigateToCapture;



  if (document.readyState === 'loading') {

    document.addEventListener('DOMContentLoaded', bindCta);

  } else {

    bindCta();

  }



  fetch(url)

    .then(function (r) {

      return r.json();

    })

    .then(function (data) {

      if (!data || !data.ok || !data.enabled || !data.agentId) {

        setCtaError('El asistente no está disponible en este momento. Intenta más tarde.');

        return;

      }

      agentConfig = data;

      setCtaReady('Iniciar asistente');

    })

    .catch(function () {

      setCtaError('No se pudo conectar con el asistente. Revisa tu conexión.');

    });

})();

