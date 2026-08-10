/* Captura por voz con el SDK @elevenlabs/client (conversación WebRTC + client tools). */
(function () {
  "use strict";

  var SDK_URL = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.0.0/+esm";
  var sdkPromise = null;
  var conversation = null;

  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = import(SDK_URL).catch(function (e) {
        sdkPromise = null;
        throw e;
      });
    }
    return sdkPromise;
  }

  function primeAudioOutput(ctx) {
    try {
      var seconds = 0.2;
      var frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
      var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {
      /* noop */
    }
  }

  function warmAudioForConversation() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return Promise.resolve();
      if (!window.__entregaAudioCtx) window.__entregaAudioCtx = new Ctx();
      var ctx = window.__entregaAudioCtx;
      if (ctx.state === "suspended") {
        return ctx
          .resume()
          .then(function () {
            primeAudioOutput(ctx);
          })
          .catch(function () {});
      }
      primeAudioOutput(ctx);
    } catch (e) {
      /* noop */
    }
    return Promise.resolve();
  }

  function ensureMicForVoice() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve(true);
    }
    if (window.__entregaMicStream && window.__entregaMicStream.active) {
      return Promise.resolve(true);
    }
    return navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        window.__entregaMicStream = stream;
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function wrapClientTools(tools) {
    var wrapped = {};
    Object.keys(tools || {}).forEach(function (name) {
      var fn = tools[name];
      wrapped[name] = function (params) {
        try {
          return Promise.resolve(fn(params)).then(function (result) {
            if (result == null) return "Listo.";
            return typeof result === "string" ? result : JSON.stringify(result);
          }).catch(function (err) {
            console.error("[EntregaVoice] tool error:", name, err);
            return "Error en la herramienta: " + (err && err.message ? err.message : String(err));
          });
        } catch (err) {
          console.error("[EntregaVoice] tool throw:", name, err);
          return Promise.resolve("Error en la herramienta: " + (err && err.message ? err.message : String(err)));
        }
      };
    });
    return wrapped;
  }

  async function fetchConversationToken(agentId) {
    try {
      var fetchFn = (window.Entrega && window.Entrega.entregaFetch) || fetch;
      var res = await fetchFn("/api/entrega/public/conversation-token", { cache: "no-store" });
      var data = await res.json().catch(function () {
        return {};
      });
      if (res.ok && data && data.token) return data.token;
    } catch (e) {
      console.warn("[EntregaVoice] conversation-token failed", e);
    }
    return null;
  }

  /**
   * Inicia la conversación de voz. Debe llamarse desde un gesto del usuario
   * (un toque) para que el navegador permita el micrófono.
   */
  async function start(opts) {
    opts = opts || {};
    await warmAudioForConversation();
    await ensureMicForVoice();

    var mod = await loadSdk();
    var Conversation = mod.Conversation;
    var conversationToken = await fetchConversationToken(opts.agentId);
    var sessionOpts = {
      connectionType: "webrtc",
      dynamicVariables: opts.dynamicVariables || {},
      clientTools: wrapClientTools(opts.clientTools || {}),
      onConnect: opts.onConnect || function () {},
      onDisconnect: opts.onDisconnect || function () {},
      onError: function (err) {
        console.error("[EntregaVoice] onError", err);
        if (opts.onError) opts.onError(err);
      },
      onModeChange: opts.onModeChange || function () {},
      onStatusChange: opts.onStatusChange || function () {},
    };

    if (conversationToken) {
      sessionOpts.conversationToken = conversationToken;
    } else if (opts.agentId) {
      sessionOpts.agentId = opts.agentId;
    } else {
      throw new Error("Falta agentId o token de conversación");
    }

    conversation = await Conversation.startSession(sessionOpts);
    return conversation;
  }

  async function stop() {
    if (!conversation) return;
    try {
      await conversation.endSession();
    } catch (e) {
      /* noop */
    }
    conversation = null;
  }

  function isActive() {
    return !!conversation;
  }

  window.EntregaVoice = {
    start: start,
    stop: stop,
    isActive: isActive,
    warmAudioForConversation: warmAudioForConversation,
    ensureMicForVoice: ensureMicForVoice,
  };
})();
