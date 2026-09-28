/* Cliente de voz de la demo en vivo.
 *
 * Reusa window.PostventaVoice (el mismo envoltorio de @elevenlabs/client que usa postventa)
 * pero apunta al agente de demo, que tiene un prompt de cuatro pasos y solo client tools.
 * Nada de esto toca la base: el ticket se inventa aca, en el navegador.
 */
(function () {
  "use strict";

  // Interceptar getUserMedia para robar el stream de audio sin pedir permisos dos veces.
  // Esto asegura que el osciloscopio se mueva con la voz sin bloqueos del navegador.
  var interceptedMicStream = null;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    var origGUM = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = function (constraints) {
      return origGUM.call(navigator.mediaDevices, constraints).then(function (stream) {
        if (constraints && constraints.audio) interceptedMicStream = stream;
        return stream;
      });
    };
  }

  var AGENT_ENDPOINT = "/api/postventa/public/demo-expo-agent";

  var handlers = {};
  var agentId = null;
  var conversation = null;
  var starting = false;

  var state = {
    problema: null,
    categoria: null,
    direccion: null,
    ticket: null,
    plazo: null
  };

  function emit(name, payload) {
    var fn = handlers[name];
    if (typeof fn === "function") {
      try {
        fn(payload);
      } catch (e) {
        console.error("[demo-expo]", name, e);
      }
    }
  }

  function setStatus(text, kind) {
    emit("status", { text: text, kind: kind || "info" });
  }

  function ticketNumber() {
    // Mismo formato que generateTicketShortId del backend (PV- + 6 alfanumericos), pero
    // sin caracteres que se confunden al dictarlos en voz alta: 0/O, 1/I, 5/S, 2/Z.
    var chars = "34679ACDEFHJKLMNPQRTUVWXY";
    var s = "";
    for (var i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return "PV-" + s;
  }

  var clientTools = {
    demo_registrar_problema: function (args) {
      state.problema = String((args && args.descripcion) || "").trim();
      state.categoria = String((args && args.categoria) || "otro").trim();
      emit("state", state);
      return JSON.stringify({ ok: true, registrado: true });
    },

    demo_registrar_direccion: function (args) {
      state.direccion = String((args && args.direccion) || "").trim();
      emit("state", state);
      return JSON.stringify({ ok: true, registrado: true });
    },

    demo_crear_ticket: function () {
      state.ticket = ticketNumber();
      state.plazo = "48 horas hábiles";
      emit("state", state);
      return JSON.stringify({
        ok: true,
        ticket: state.ticket,
        plazo_visita: state.plazo,
        mensaje: "Ticket creado. Informa el numero y el plazo al cliente."
      });
    }
  };

  async function loadAgentId() {
    if (agentId) return agentId;
    var res = await fetch(AGENT_ENDPOINT, { cache: "no-store" });
    var data = await res.json();
    if (!data || !data.ok || !data.enabled || !data.agentId) {
      throw new Error("FALTA_AGENTE");
    }
    agentId = data.agentId;
    return agentId;
  }

  function reset() {
    state.problema = null;
    state.categoria = null;
    state.direccion = null;
    state.ticket = null;
    state.plazo = null;
    emit("state", state);
  }

  async function start() {
    if (starting || conversation) return;
    starting = true;
    setStatus("Conectando…", "busy");

    try {
      var id = await loadAgentId();
      if (!window.PostventaVoice) throw new Error("FALTA_SDK");

      conversation = await window.PostventaVoice.start({
        agentId: id,
        clientTools: clientTools,
        onConnect: function () {
          setStatus("En línea", "ok");
          emit("connected", true);
        },
        onDisconnect: function () {
          conversation = null;
          teardownAudio();
          setStatus("Llamada terminada", "info");
          emit("connected", false);
        },
        onError: function (err) {
          console.error("[demo-expo] error de conversacion", err);
          setStatus("Error de conexión", "error");
        },
        onModeChange: function (m) {
          var mode = (m && (m.mode || m)) || "listening";
          emit("mode", mode === "speaking" ? "speaking" : "listening");
        }
      });

      emit("mode", "listening");
      // El permiso ya lo pidio el SDK, asi que esta segunda captura no vuelve a preguntar.
      } catch (err) {
      conversation = null;
      var msg = String((err && err.message) || err);
      if (msg === "FALTA_AGENTE") {
        setStatus("Falta ELEVENLABS_DEMO_EXPO_AGENT_ID en el servidor", "error");
      } else if (/permission|denied|NotAllowed/i.test(msg)) {
        setStatus("Falta permiso del micrófono", "error");
      } else {
        setStatus("No se pudo iniciar: " + msg, "error");
      }
      emit("connected", false);
      throw err;
    } finally {
      starting = false;
    }
  }

  async function stop() {
    if (window.PostventaVoice) await window.PostventaVoice.stop();
    conversation = null;
    teardownAudio();
    emit("connected", false);
    setStatus("Llamada terminada", "info");
  }

  // --- analisis de audio ----------------------------------------------------------
  //
  // Montamos analizadores propios en vez de usar los del SDK por dos razones. Una, el SDK
  // solo entrega espectro de frecuencias, y la linea fina que queremos necesita dominio
  // temporal (osciloscopio). Dos, en modo WebRTC el analisis del microfono no esta
  // garantizado: hay una implementacion del SDK cuyos metodos de volumen devuelven 0. Con
  // analizadores propios el orbe reacciona siempre, y el SDK queda solo como respaldo.

  var audioCtx = null;
  var micAnalyser = null;
  var micStream = null;
  var micBuf = null;
  var agentAnalyser = null;
  var agentBuf = null;
  var agentTryAt = 0;

  function ensureCtx() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function makeAnalyser(ctx, sourceNode) {
    var an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.6;
    // Sin conectar a destination: solo queremos medir, no reproducir.
    sourceNode.connect(an);
    return an;
  }

  async function setupMicAnalyser() {
    if (micAnalyser) return;
    try {
      var ctx = ensureCtx();
      if (!ctx || !navigator.mediaDevices) return;
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micAnalyser = makeAnalyser(ctx, ctx.createMediaStreamSource(micStream));
      micBuf = new Uint8Array(micAnalyser.frequencyBinCount);
    } catch (e) {
      micAnalyser = null;
    }
  }

  function teardownAudio() {
    if (micStream) {
      try {
        micStream.getTracks().forEach(function (tr) { tr.stop(); });
      } catch (e) { /* noop */ }
    }
    micStream = null;
    micAnalyser = null;
    agentAnalyser = null;
    micBuf = null;
    agentBuf = null;
  }

  /** Busca la pista de audio remota en la sala de LiveKit que usa el SDK por debajo. */
  function remoteAudioTrack(conv) {
    var conn = conv && conv.connection;
    var room = conn && typeof conn.getRoom === "function" ? conn.getRoom() : null;
    if (!room) return null;
    var parts = room.remoteParticipants;
    var list = parts && typeof parts.values === "function" ? Array.prototype.slice.call(parts.values()) : [];
    for (var i = 0; i < list.length; i++) {
      var pubs = list[i].audioTrackPublications || list[i].trackPublications;
      var arr = pubs && typeof pubs.values === "function" ? Array.prototype.slice.call(pubs.values()) : [];
      for (var j = 0; j < arr.length; j++) {
        var tr = arr[j].track;
        if (tr && tr.kind === "audio" && tr.mediaStreamTrack) return tr.mediaStreamTrack;
      }
    }
    return null;
  }

  function maybeSetupAgentAnalyser(conv) {
    // La pista remota aparece despues de conectar, asi que reintentamos sin gastar CPU.
    if (agentAnalyser || Date.now() < agentTryAt) return;
    agentTryAt = Date.now() + 500;
    try {
      var track = remoteAudioTrack(conv);
      if (!track) return;
      var ctx = ensureCtx();
      if (!ctx) return;
      agentAnalyser = makeAnalyser(ctx, ctx.createMediaStreamSource(new MediaStream([track])));
      agentBuf = new Uint8Array(agentAnalyser.frequencyBinCount);
    } catch (e) {
      agentAnalyser = null;
    }
  }

  /** Volumen efectivo de una ventana de osciloscopio, realzado para voz normal. */
  function rms(buf) {
    var sum = 0;
    for (var i = 0; i < buf.length; i++) {
      var v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
  }

  function safeNumber(fn) {
    try {
      var v = fn();
      return isFinite(v) ? v : 0;
    } catch (e) {
      return 0;
    }
  }

  /** Niveles y ventana de osciloscopio para el orbe y la linea. */
  function levels() {
    var conv = conversation || (window.PostventaVoice && window.PostventaVoice.getConversation());

    if (!conv) {
      var left = pulseUntil - Date.now();
      if (left <= 0) return { user: 0, agent: 0, timeDomain: null };
      // Onda que decae: el respaldo por teclado se ve como voz sin audio real.
      var k = left / 1600;
      return { user: 0, agent: k * (0.55 + 0.45 * Math.sin(Date.now() / 90)), timeDomain: null };
    }

    maybeSetupAgentAnalyser(conv);

    if (!micAnalyser && interceptedMicStream) {
      try {
        var ctx = ensureCtx();
        if (ctx) {
          micAnalyser = makeAnalyser(ctx, ctx.createMediaStreamSource(interceptedMicStream));
          micBuf = new Uint8Array(micAnalyser.frequencyBinCount);
        }
      } catch (e) {
        micAnalyser = null;
      }
    }

    var user = 0;
    var agent = 0;
    var userTd = null;
    var agentTd = null;

    if (micAnalyser && micBuf) {
      try {
        micAnalyser.getByteTimeDomainData(micBuf);
        user = rms(micBuf);
        userTd = micBuf;
      } catch (e) { /* noop */ }
    } else if (typeof conv.getInputVolume === "function") {
      user = safeNumber(function () { return conv.getInputVolume(); });
    }

    if (agentAnalyser && agentBuf) {
      try {
        agentAnalyser.getByteTimeDomainData(agentBuf);
        agent = rms(agentBuf);
        agentTd = agentBuf;
      } catch (e) { /* noop */ }
    } else if (typeof conv.getOutputVolume === "function") {
      agent = safeNumber(function () { return conv.getOutputVolume(); });
    }

    // La linea sigue a quien este sonando mas fuerte.
    var td = agent >= user ? (agentTd || userTd) : (userTd || agentTd);
    return { user: user, agent: agent, timeDomain: td };
  }

  // Respaldo para presentar sin voz. Si el wifi de la expo se cae a mitad de la demo,
  // estos pasos se disparan por teclado y la pantalla avanza igual mientras se narra.
  var GUION = {
    1: function () {
      state.problema = "Filtración en el cielo del baño principal, aparece después de llover";
      state.categoria = "humedad_filtracion";
    },
    2: function () {
      state.direccion = "Las Condes, Av. Apoquindo 4501, depto 1203";
    },
    3: function () {
      state.ticket = ticketNumber();
      state.plazo = "48 horas hábiles";
    }
  };

  var pulseUntil = 0;
  var pulseTimer = 0;

  function simulate(step) {
    var fn = GUION[step];
    if (!fn) return false;
    fn();
    // Sin llamada activa el orbe estaria casi quieto y el respaldo se notaria. Le damos
    // un golpe de energia que decae, como si alguien acabara de hablar.
    if (!conversation) {
      pulseUntil = Date.now() + 1600;
      emit("mode", "speaking");
      clearTimeout(pulseTimer);
      pulseTimer = setTimeout(function () {
        if (!conversation) emit("mode", "listening");
      }, 1600);
    }
    emit("state", state);
    return true;
  }

  /** Resuelve el agentId antes del primer clic y avisa temprano si falta configurarlo. */
  function warmup() {
    return loadAgentId().then(
      function () { return true; },
      function () {
        setStatus("Falta configurar el agente de demo en el servidor", "error");
        return false;
      }
    );
  }

  window.DemoExpoVoice = {
    on: function (name, fn) {
      handlers[name] = fn;
      return this;
    },
    warmup: warmup,
    simulate: simulate,
    start: start,
    stop: stop,
    reset: reset,
    levels: levels,
    getState: function () { return state; },
    isActive: function () { return !!conversation; }
  };
})();

