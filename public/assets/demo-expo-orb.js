/* Orbe de voz + linea de sonido para la demo en vivo.
 *
 * Nuevo diseño basado en la referencia etérea: Esfera de cristal con cintas de energía
 * (ribbons) fluidas, gruesas y suaves, partículas orbitando y un núcleo profundo.
 * Colores principales en cian y verde lima.
 *
 * Uso:
 *   var orb = DemoExpoOrb.create({ orb: canvasOrbe, wave: canvasLinea });
 *   orb.setInput(function () {
 *     return { user: 0..1, agent: 0..1, timeDomain: Uint8Array|null };
 *   });
 *   orb.setMode('idle' | 'listening' | 'speaking' | 'thinking');
 *   orb.start();
 */
(function () {
  "use strict";

  // Paletas basadas en la nueva referencia (cian y verde).
  var STATES = {
    listening: {
      core: ["#000711", "#021626", "#042a42", "#084b75"],
      plasma: ["#00e5ff", "#a3e635", "#00aaff", "#4ade80"],
      glow: "#00e5ff",
      line: "#00e5ff",
      speed: 1.5
    },
    speaking: {
      core: ["#001105", "#022610", "#04421a", "#087530"],
      plasma: ["#4ade80", "#a3e635", "#22c55e", "#bef264"],
      glow: "#4ade80",
      line: "#4ade80",
      speed: 2.2
    },
    thinking: {
      core: ["#0a0011", "#1a0226", "#2a0442", "#4b0875"],
      plasma: ["#a855f7", "#00e5ff", "#d946ef", "#3b82f6"],
      glow: "#a855f7",
      line: "#a855f7",
      speed: 1.2
    },
    idle: {
      core: ["#00050a", "#01101a", "#022033", "#043554"],
      plasma: ["#0284c7", "#0369a1", "#0ea5e9", "#38bdf8"],
      glow: "#0284c7",
      line: "#38bdf8",
      speed: 0.8
    }
  };

  // Alfa en hexadecimal, que es como el original tiñe los trazos.
  function hexAlpha(a) {
    var v = Math.max(0, Math.min(255, Math.round(a * 255)));
    return v.toString(16).padStart(2, "0");
  }

  function fitCanvas(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w: rect.width, h: rect.height, dpr: dpr };
  }

  function create(els) {
    els = els || {};
    var orbCanvas = els.orb;
    var waveCanvas = els.wave || null;
    if (!orbCanvas) throw new Error("DemoExpoOrb: falta el canvas del orbe");

    var octx = orbCanvas.getContext("2d");
    var wctx = waveCanvas ? waveCanvas.getContext("2d") : null;

    var input = function () { return { user: 0, agent: 0, timeDomain: null }; };
    var mode = "idle";
    var running = false;
    var raf = 0;
    var t = 0;
    var lastNow = 0;

    var energy = 0;
    var userLevel = 0;
    var agentLevel = 0;
    var timeDomain = null;

    // Cintas de luz (ribbons) más finas y definidas.
    var curves = [];
    for (var i = 0; i < 8; i++) {
      curves.push({
        phase: Math.random() * Math.PI * 2,
        speed: 0.002 + Math.random() * 0.003,
        amp: 0.25 + Math.random() * 0.4,
        freq: 1 + Math.random() * 1.5,
        offset: Math.random() * Math.PI * 2,
        alpha: 0.3 + Math.random() * 0.4,
        width: 1.2 + Math.random() * 1.5
      });
    }

    // Partículas orbitando.
    var particles = [];
    for (var p = 0; p < 40; p++) {
      particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.3 + Math.random() * 0.65,
        speed: (Math.random() - 0.5) * 0.005,
        size: 0.5 + Math.random() * 1.5,
        alpha: 0.2 + Math.random() * 0.6
      });
    }

    function drawOrb() {
      var box = fitCanvas(orbCanvas);
      var ctx = octx;
      ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
      ctx.clearRect(0, 0, box.w, box.h);

      var cx = box.w / 2;
      var cy = box.h / 2;
      // El orbe respira y crece con la voz, de forma muy agresiva.
      // Usamos 0.215 porque el canvas ahora es 150% más grande que su contenedor,
      // así el orbe mantiene su tamaño visual pero el resplandor tiene espacio de sobra sin cortarse.
      var baseR = Math.min(box.w, box.h) * 0.215; 
      var R = baseR * (1 + agentLevel * 0.55); // El orbe solo crece con la voz del agente
      var s = R / 108;
      var st = STATES[mode] || STATES.idle;
      var active = mode !== "idle";
      var step = Math.min(0.04, 0.04 * (108 / R));

      // Halo exterior suave.
      var glowR = R + (12 + Math.sin(t * 1.2) * 6) * s + R * 0.5 * energy;
      var outer = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, glowR + 20 * s);
      outer.addColorStop(0, "transparent");
      outer.addColorStop(0.5, st.glow + hexAlpha(0.15 + energy * 0.6));
      outer.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(cx, cy, glowR + 20 * s, 0, Math.PI * 2);
      ctx.fillStyle = outer;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      // Fondo profundo del orbe.
      var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      grad.addColorStop(0, st.core[0]);
      grad.addColorStop(0.4, st.core[1]);
      grad.addColorStop(0.7, st.core[2]);
      grad.addColorStop(1, st.core[3]);
      ctx.fillStyle = grad;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      ctx.globalCompositeOperation = "lighter";

      // Cintas de energía (ribbons) fluidas.
      for (var ci = 0; ci < curves.length; ci++) {
        var cv = curves[ci];
        // Aceleramos la rotación con la energía
        var phase = cv.phase + t * cv.speed * 40 * (1 + energy * 3);
        var color = st.plasma[ci % st.plasma.length];
        
        ctx.beginPath();
        // Cintas que explotan con la voz
        ctx.lineWidth = cv.width * (active ? 1.4 : 1) * s * (1 + energy * 1.5);
        ctx.strokeStyle = color + hexAlpha(Math.min(1, cv.alpha * (0.7 + energy * 0.8)));
        ctx.shadowBlur = (8 + energy * 15) * Math.sqrt(s);
        ctx.shadowColor = color;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        
        for (var a = 0; a <= Math.PI * 2; a += step) {
          var wave = Math.sin(a * cv.freq + phase) * cv.amp * (1 + energy * 0.5) +
            Math.sin(a * 0.5 + cv.offset + t * 0.2) * 0.4;
          var r2 = R * (0.65 + wave * 0.25 * (1 + energy * 1.2));
          var x = cx + r2 * Math.cos(a + cv.offset * 0.2 + t * cv.speed * (15 + energy * 20));
          var y = cy + r2 * Math.sin(a + cv.offset * 0.2 + t * cv.speed * (10 + energy * 15)) *
            (0.7 + Math.abs(Math.sin(t * 0.3 + ci)) * 0.3);
          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        
        // Segunda pasada más fina y brillante en el centro de la cinta.
        ctx.lineWidth *= 0.3;
        ctx.strokeStyle = "#ffffff" + hexAlpha(cv.alpha * 0.5);
        ctx.shadowBlur = 0;
        ctx.stroke();
      }

      // Brillo central etéreo.
      var coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
      coreGlow.addColorStop(0, st.glow + hexAlpha(0.4 + energy * 0.6));
      coreGlow.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = coreGlow;
      ctx.fill();

      // Partículas de polvo brillante.
      for (var p = 0; p < particles.length; p++) {
        var pt = particles[p];
        var pAngle = pt.angle + t * pt.speed;
        var pRad = R * pt.radius * (1 + energy * 0.25);
        var px = cx + Math.cos(pAngle) * pRad;
        var py = cy + Math.sin(pAngle) * pRad;
        var pSize = pt.size * s * (1 + energy * 1.5);
        
        ctx.beginPath();
        ctx.arc(px, py, pSize, 0, Math.PI * 2);
        ctx.fillStyle = st.plasma[p % st.plasma.length] + hexAlpha(pt.alpha);
        ctx.fill();
      }

      ctx.restore();

      // Aro de cristal exterior (borde muy definido y brillante).
      ctx.save();
      var rim = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R);
      rim.addColorStop(0, "transparent");
      rim.addColorStop(0.92, st.glow + hexAlpha(0.2));
      rim.addColorStop(1, st.glow + hexAlpha(0.8 + energy * 0.2));
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = rim;
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = st.glow + hexAlpha(0.9);
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();
      ctx.restore();
    }

    function drawWave() {
      if (!wctx) return;
      var box = fitCanvas(waveCanvas);
      var ctx = wctx;
      ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
      ctx.clearRect(0, 0, box.w, box.h);

      var st = STATES[mode] || STATES.idle;
      var mid = box.h / 2;

      ctx.lineWidth = 2 + energy * 2;
      ctx.strokeStyle = st.line;
      ctx.shadowBlur = 8 + energy * 10;
      ctx.shadowColor = st.line;
      ctx.beginPath();

      if (timeDomain && timeDomain.length) {
        // Osciloscopio: el dato ya viene centrado en 128, asi que la linea es plana en
        // silencio y se abre sola con la voz.
        var n = timeDomain.length;
        var step = box.w / n;
        for (var i = 0; i < n; i++) {
          var v = (timeDomain[i] - 128) / 128;
          var x = i * step;
          var y = mid + v * mid * 0.92;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        // Sin analizador: onda suave que respira, con algo de amplitud si hay volumen.
        var amp = 2.5 + energy * mid * 0.5;
        for (var x2 = 0; x2 <= box.w; x2 += 4) {
          var y2 = mid + Math.sin(x2 * 0.05 + t * 2) * amp;
          if (x2 === 0) ctx.moveTo(x2, y2);
          else ctx.lineTo(x2, y2);
        }
      }

      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    function frame(now) {
      if (!running) return;

      // El original avanza 0.016 por fotograma asumiendo 60fps. Usamos el reloj real para
      // que la animacion no se acelere en pantallas de 120Hz.
      var dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016;
      lastNow = now;
      var st = STATES[mode] || STATES.idle;
      t += dt * st.speed;

      var data = null;
      try {
        data = input() || null;
      } catch (e) {
        data = null;
      }
      var u = data && isFinite(data.user) ? Math.max(0, Math.min(1, data.user)) : 0;
      var a = data && isFinite(data.agent) ? Math.max(0, Math.min(1, data.agent)) : 0;
      timeDomain = (data && data.timeDomain) || null;

      userLevel += (u - userLevel) * (u > userLevel ? 0.9 : 0.2);
      agentLevel += (a - agentLevel) * (a > agentLevel ? 0.9 : 0.2);

      var raw = agentLevel; // La energía del orbe ahora ignora al usuario y solo responde al agente
      // Curva de respuesta hiper-sensible: cualquier sonido dispara la energía.
      var shaped = Math.pow(Math.min(1, raw * 2.5), 0.4);
      energy += (shaped - energy) * (shaped > energy ? 0.85 : 0.15);
      if (energy < 0.02) energy = 0.02;

      drawOrb();
      drawWave();
      raf = requestAnimationFrame(frame);
    }

    return {
      setInput: function (fn) {
        if (typeof fn === "function") input = fn;
      },
      setMode: function (next) {
        if (STATES[next]) mode = next;
      },
      getMode: function () { return mode; },
      getEnergy: function () { return energy; },
      start: function () {
        if (running) return;
        running = true;
        lastNow = 0;
        raf = requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      }
    };
  }

  window.DemoExpoOrb = { create: create };
})();
