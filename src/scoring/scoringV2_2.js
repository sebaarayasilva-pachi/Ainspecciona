// src/scoring/scoringV2_2.js

export const SEVERITY_FACTOR_V22 = {
  low: 1.0,
  medium: 1.3,
  high: 1.5,
};

export const DEFAULT_SCORE_CONFIG = {
  kpis: {
    MUROS_PINTURA: { low: 5, medium: 15, high: 30 },
    HUMEDAD: { low: 5, medium: 15, high: 30 },
    PISOS: { low: 5, medium: 15, high: 30 },
    SANITARIOS: { low: 5, medium: 15, high: 30 },
    ELECTRICIDAD: { low: 5, medium: 15, high: 30 },
    VENTANAS_CERRAMIENTOS: { low: 5, medium: 15, high: 30 },
    PUERTAS_HERRAJES: { low: 5, medium: 15, high: 30 },
    MOBILIARIO_FIJO: { low: 5, medium: 15, high: 30 }
  },
  slotKpiMap: {
    BATHROOM_1_SHOWER: "SANITARIOS",
    BATHROOM_1_SINK: "SANITARIOS",
    BATHROOM_1_SINK_PIPES: "SANITARIOS",
    BATHROOM_1_WC: "SANITARIOS",
    BATHROOM_1_WC_PIPES: "SANITARIOS",
    BATHROOM_1_CEILING: "HUMEDAD",
    BATHROOM_1_OUTLETS: "ELECTRICIDAD",
    BATHROOM_2_SHOWER: "SANITARIOS",
    BATHROOM_2_SINK: "SANITARIOS",
    BATHROOM_2_SINK_PIPES: "SANITARIOS",
    BATHROOM_2_WC: "SANITARIOS",
    BATHROOM_2_WC_PIPES: "SANITARIOS",
    BATHROOM_2_CEILING: "HUMEDAD",
    BATHROOM_2_OUTLETS: "ELECTRICIDAD",
    KITCHEN_UNDER_SINK: "HUMEDAD",
    KITCHEN_SINK_WALL: "HUMEDAD",
    KITCHEN_COUNTERTOP: "MOBILIARIO_FIJO",
    KITCHEN_CABINETS: "MOBILIARIO_FIJO",
    KITCHEN_OUTLETS: "ELECTRICIDAD",
    KITCHEN_WINDOW: "VENTANAS_CERRAMIENTOS",
    LIVING_WALLS: "MUROS_PINTURA",
    LIVING_CEILING: "MUROS_PINTURA",
    LIVING_FLOOR: "PISOS",
    LIVING_WINDOWS: "VENTANAS_CERRAMIENTOS",
    LIVING_SWITCHES: "ELECTRICIDAD",
    BEDROOM_1_WALLS: "MUROS_PINTURA",
    BEDROOM_1_FLOOR: "PISOS",
    BEDROOM_1_CLOSET: "MOBILIARIO_FIJO",
    BEDROOM_1_WINDOWS: "VENTANAS_CERRAMIENTOS",
    BEDROOM_2_WALLS: "MUROS_PINTURA",
    BEDROOM_2_FLOOR: "PISOS",
    BEDROOM_2_CLOSET: "MOBILIARIO_FIJO",
    BEDROOM_2_WINDOWS: "VENTANAS_CERRAMIENTOS",
    BEDROOM_3_WALLS: "MUROS_PINTURA",
    BEDROOM_3_FLOOR: "PISOS",
    BEDROOM_3_CLOSET: "MOBILIARIO_FIJO",
    BEDROOM_3_WINDOWS: "VENTANAS_CERRAMIENTOS",
    LAUNDRY_WALLS_FLOOR: "HUMEDAD",
    ELECTRICAL_PANEL: "ELECTRICIDAD",
    PUERTA_ENTRADA: "PUERTAS_HERRAJES",
    ELEVATOR: "ELECTRICIDAD",
    ESTACIONAMIENTO: "PISOS",
    CERTIFICADO_VERDE: "ELECTRICIDAD"
  },
  aiPrompts: {
    GENERAL: [
      "Eres un inspector técnico profesional que realiza evaluaciones de inmuebles basadas exclusivamente en evidencia fotográfica.",
      "",
      "Analiza la imagen correspondiente al área: {{AREA_DESCRIPTION}}, bajo el criterio: {{CRITERIA_DESCRIPTION}}.",
      "",
      "Reglas generales obligatorias:",
      "- Analiza únicamente lo claramente visible en la imagen.",
      "- No infieras causas, origen, antigüedad ni condiciones internas no observables.",
      "- No evalúes elementos fuera del encuadre.",
      "- No utilices códigos internos ni etiquetas técnicas del sistema.",
      "- No entregues recomendaciones ni juicios legales o financieros.",
      "- Evita frases vagas como 'no se observan problemas' sin justificar visualmente.",
      "",
      "Estructura del análisis (obligatoria y detallada):",
      "1) Descripción objetiva del encuadre: Describe ambiente, superficies visibles, materialidad aparente, encuentros (esquinas, uniones, bordes), condiciones de iluminación y cualquier elemento que influya en la lectura visual. Indica limitaciones si hay zonas fuera de foco, sombras u obstrucciones.",
      "2) Análisis técnico respecto al criterio: Recorre visualmente el área en forma ordenada (ej: superior a inferior). Detalla de forma específica lo observado en relación al criterio. Si no existen señales visibles, explica qué evidencia visual permite descartarlas (uniformidad de superficie, continuidad, etc.).",
      "",
      "Redacta en lenguaje técnico, claro, objetivo y profesional."
    ].join("\n"),
    MUROS_PINTURA: [
      "Analiza la imagen correspondiente al slot {{SLOT_CODE}}",
      "bajo el contexto técnico del KPI: MUROS Y PINTURA.",
      "",
      "Paso 1 — Identificación de terminación:",
      "Determina si la superficie visible corresponde a:",
      "- Pintura",
      "- Papel mural (wallpaper)",
      "",
      "Indícalo explícitamente al inicio del análisis.",
      "",
      "Paso 2 — Descripción objetiva del encuadre:",
      "Describe detalladamente lo visible (mínimo 4 líneas):",
      "- Superficie observada",
      "- Color y textura aparente",
      "- Encuentros (esquinas, zócalos, cielo, marcos)",
      "- Iluminación y condiciones que afecten la lectura visual",
      "",
      "Paso 3 — Evaluación técnica según tipo de terminación:",
      "",
      "Distinción obligatoria (PINTURA):",
      "- Usa 'grieta' SOLO cuando haya una fisura o fractura clara en el material (línea oscura, profundidad aparente, quiebre del sustrato).",
      "- Si ves una línea lineal o banda en la superficie que corresponde a unión de placas, junta de aplicación, diferencia de capa de pintura o irregularidad del acabado (sin aspecto de fractura), NO la llames grieta. Descríbela como: 'discontinuidad en la pintura', 'irregularidad en el acabado', 'unión o junta visible', 'diferencia de aplicación' o 'línea de terminación' según corresponda.",
      "",
      "Si es PINTURA, analiza explícitamente:",
      "- Rayones o marcas lineales",
      "- Manchas o variaciones de tono",
      "- Descascaramiento o desprendimiento",
      "- Grietas (solo si hay fisura/fractura visible; si es solo línea de acabado, usa 'discontinuidad' o 'irregularidad')",
      "- Discontinuidades en la pintura, uniones visibles, diferencias de aplicación",
      "- Marcas visibles asociadas a humedad superficial",
      "",
      "Si es PAPEL MURAL, analiza explícitamente:",
      "- Rayones o manchas",
      "- Despegamiento en bordes o uniones",
      "- Burbujas o levantamientos",
      "- Grietas o rasgaduras",
      "- Desgaste o desteñido",
      "- Marcas visibles asociadas a humedad superficial",
      "",
      "Recorre visualmente el área en forma ordenada (por ejemplo: izquierda a derecha y de arriba hacia abajo).",
      "Para cada hallazgo detectado, especifica:",
      "- Tipo de señal",
      "- Ubicación aproximada (zona alta, baja, lateral, encuentro, etc.)",
      "- Extensión aproximada (puntual, lineal, sectorizado, paño completo)",
      "- Terminación afectada (pintura o papel mural)",
      "",
      "Si NO se observan señales visibles, debes indicarlo explícitamente describiendo qué evidencia visual permite descartarlas (uniformidad de superficie, continuidad, ausencia de cambios de tono, etc.).",
      "",
      "Reglas obligatorias:",
      "- Analiza únicamente lo claramente visible.",
      "- No infieras causas ni condiciones internas.",
      "- No evalúes estructura ni humedad no visible.",
      "- No emitas juicios de severidad.",
      "- No entregues recomendaciones.",
      "- Evita frases vagas sin respaldo visual."
    ].join("\n"),
    HUMEDAD: [
      "Analiza la imagen correspondiente al slot {{SLOT_CODE}} bajo el contexto técnico del KPI: HUMEDAD VISIBLE.",
      "",
      "Paso 1 — Descripción objetiva del encuadre:",
      "Describe superficie observada (muro, cielo, encuentros), color, terminación y condiciones de iluminación que afecten la lectura.",
      "",
      "Paso 2 — Señales de humedad que DEBES buscar y reportar si están presentes:",
      "- Pintura inflada, ampollada o con burbujas (levantamiento de la capa de pintura por humedad).",
      "- Pintura resquebrajada, descascarada o con desprendimiento asociable a humedad.",
      "- Pintura englobada (abultamiento o cambio de tono por absorción de humedad).",
      "- Eflorescencias (sales blancas en superficie).",
      "- Manchas de agua, aureolas o variaciones de tono en forma de mapa.",
      "- Hongos o moho visible.",
      "- Descascaramiento o desprendimiento en muros, cielos o alrededor de tuberías/duchas.",
      "",
      "Para cada señal detectada indica: ubicación aproximada en el encuadre, extensión (puntual, sectorizada, extendida) y si afecta pintura, revoque o encuentros.",
      "Solo reporta un hallazgo de humedad cuando la señal sea CLARA y fácilmente identificable en la imagen (el lector debe poder 'ver' lo que describes). No reportes 'marca leve', 'leve indicio' o 'podría ser indicativa de humedad' cuando la superficie se ve mayormente uniforme, sin manchas definidas ni pintura inflada. En ese caso concluye que no se observan hallazgos relevantes de humedad.",
      "Si NO observas ninguna de las señales listadas arriba, indícalo explícitamente describiendo qué evidencia visual permite descartarlas (superficie uniforme, sin abultamientos ni manchas, etc.).",
      "NUNCA concluyas 'no hay hallazgos relevantes' si ves pintura inflada, ampollada, resquebrajada o manchas/aureolas claras compatibles con humedad.",
      "",
      "Reglas: analiza solo lo visible; no asumas el origen de la fuga si no es evidente; no infieras humedad no visible."
    ].join("\n"),
    PISOS: [
      "Eres un inspector técnico profesional evaluando el estado de los pisos y revestimientos.",
      "Busca cerámicas quebradas, piso flotante levantado o separado, alfombras manchadas o gastadas, o guardapolvos desprendidos.",
      "Evalúa la continuidad y nivelación general visible en la imagen."
    ].join("\n"),
    SANITARIOS: [
      "Eres un inspector técnico profesional revisando artefactos sanitarios.",
      "Revisa la imagen en busca de tinas, WC, lavamanos o griferías con daños visibles como trizaduras, manchas de sarro extremo, falta de sellos (silicona) o piezas faltantes.",
      "Evalúa el estado de las conexiones visibles a la pared o piso."
    ].join("\n"),
    ELECTRICIDAD: [
      "Analiza la imagen correspondiente al slot {{SLOT_CODE}}",
      "bajo el contexto técnico del KPI: ELECTRICIDAD VISIBLE.",
      "",
      "Paso 1 — Descripción objetiva del encuadre:",
      "Describe detalladamente lo visible (mínimo 4 líneas):",
      "- Elementos eléctricos presentes (enchufes, interruptores, tablero, canalizaciones, cables, etc.)",
      "- Ubicación relativa dentro del encuadre",
      "- Condición general visible de las superficies circundantes",
      "- Iluminación o encuadre que pueda afectar la lectura visual",
      "",
      "Paso 2 — Evaluación específica del KPI:",
      "",
      "Evalúa EXCLUSIVAMENTE la condición visible de los elementos eléctricos accesibles en la imagen.",
      "",
      "Detecta únicamente la presencia visible de:",
      "",
      "- enchufes o interruptores rotos o quebrados",
      "- tapas faltantes o sueltas en enchufes, interruptores o tablero",
      "- cables visibles expuestos",
      "- signos visibles de sobrecalentamiento (quemaduras, derretimiento, decoloración localizada)",
      "- fijación deficiente visible de enchufes o interruptores (desplazamiento, separación del muro)",
      "- tablero eléctrico visible sin tapa o con elementos dañados",
      "- presencia visible de interruptor diferencial, solamente en el slot del tablero eléctrico",
      "- ausencia visible de interruptor diferencial (solo si el tablero completo es visible y no se observa dicho elemento)",
      "",
      "Interruptor diferencial (solo en slot de tablero eléctrico):",
      "El diferencial suele ser el primer breaker a la izquierda, de mayor tamaño (doble módulo o dos posiciones). Si ves un breaker ancho o doble al inicio de la fila, considéralo como posible diferencial y NO reportes 'ausencia de diferencial'. Solo reporta ausencia si el tablero se ve completo y no hay ningún elemento de ese tipo (breaker doble/general a la izquierda).",
      "",
      "Recorre visualmente los elementos eléctricos de forma ordenada y describe únicamente lo que sea claramente observable.",
      "",
      "Para cada señal detectada, especifica:",
      "- Tipo de señal",
      "- Elemento afectado",
      "- Ubicación aproximada",
      "- Condición observable",
      "",
      "Si NO se observan señales visibles, debes indicarlo explícitamente describiendo qué evidencia visual permite descartarlas (tapas íntegras, ausencia de cables expuestos, fijación alineada, etc.).",
      "",
      "Paso 3 — Limitaciones:",
      "Indica si el encuadre es parcial, si el tablero no es completamente visible o si existen zonas fuera de foco que limiten la evaluación.",
      "",
      "Reglas estrictas:",
      "- Analiza únicamente lo claramente visible.",
      "- No infieras funcionamiento.",
      "- No evalúes capacidad eléctrica.",
      "- No evalúes cumplimiento normativo.",
      "- No concluyas seguridad o inseguridad eléctrica.",
      "- No emitas juicios de severidad.",
      "- No entregues recomendaciones.",
      "- No utilices lenguaje interpretativo o alarmista."
    ].join("\n"),
    VENTANAS_CERRAMIENTOS: [
      "Eres un inspector técnico profesional evaluando ventanas y cerramientos.",
      "Revisa los vidrios buscando trizaduras o roturas. Revisa los marcos (aluminio, PVC, madera) buscando abolladuras, descuadres o falta de sellos visibles.",
      "Si hay rieles, evalúa si se observan limpios y continuos."
    ].join("\n"),
    PUERTAS_HERRAJES: [
      "Eres un inspector técnico profesional evaluando puertas y sus herrajes.",
      "Busca puertas descuadradas, raspadas, perforadas o con marcos desprendidos. Revisa visualmente el estado de las manillas, cerraduras y bisagras (si están presentes y en buena posición)."
    ].join("\n"),
    MOBILIARIO_FIJO: [
      "Analiza la imagen correspondiente al slot {{SLOT_CODE}} bajo el contexto técnico del KPI: MOBILIARIO FIJO (closets, muebles de cocina).",
      "",
      "Paso 1 — Verificación de correspondencia al slot:",
      "Si el slot es de COCINA (Cocina – Muebles), la imagen debe mostrar muebles de cocina (gabinetes, alacenas, puertas de cocina). Si en la imagen se ve claramente una puerta de habitación, puerta de baño u otro elemento que NO sea mueble de cocina, indícalo al inicio: 'El encuadre muestra [lo que se ve], no muebles de cocina.' Describe lo visible de forma objetiva y no inventes hallazgos de desalineación o daño en muebles si el elemento no corresponde al slot.",
      "Si el slot es de DORMITORIO (Clóset), la imagen debe mostrar el clóset del dormitorio. Si se ve otro tipo de mueble o puerta de otra habitación, indícalo y no apliques criterios de mobiliario fijo de forma forzada.",
      "",
      "Paso 2 — Evaluación solo cuando el contenido SÍ corresponde al slot:",
      "Revisa únicamente lo que sea claramente visible: puertas de gabinetes caídas o descuadradas, repisas pandeadas, cubiertas manchadas, quemadas o trizadas, daños en tiradores o tapacantos.",
      "Solo reporta desalineación, holgura o descuadre cuando sea CLARAMENTE OBSERVABLE en la imagen (por ejemplo: puerta que no cierra en el marco, hueco evidente, bisagra vista despegada). No reportes 'ligera desalineación' ni 'holgura moderada' si no hay evidencia visual clara; en ese caso indica que no se observan problemas relevantes en el mobiliario visible.",
      "",
      "Reglas: analiza solo lo visible; no infieras desalineación por sombras o ángulo de la foto; si el elemento no corresponde al slot esperado, describe sin inventar hallazgos."
    ].join("\n")
  },
  messages: {
    MUROS_PINTURA: {
      low: "Se observan imperfecciones menores en muros o pintura del área inspeccionada.",
      medium: "Se observan deterioros visibles en muros o pintura del área inspeccionada.",
      high: "Se observan deterioros relevantes en muros o pintura del área inspeccionada."
    },
    HUMEDAD: {
      low: "Se observan indicios leves de humedad superficial en el área inspeccionada.",
      medium: "Se observan señales visibles de humedad en el área inspeccionada.",
      high: "Se observan evidencias visibles de humedad extendida en el área inspeccionada."
    },
    PISOS: {
      low: "Se observan marcas o desgaste leve en el piso del área inspeccionada.",
      medium: "Se observan desgaste o daños visibles en el piso del área inspeccionada.",
      high: "Se observan daños visibles relevantes en el piso del área inspeccionada."
    },
    SANITARIOS: {
      low: "Se observan condiciones visibles menores en artefactos sanitarios del área inspeccionada.",
      medium: "Se observan condiciones visibles en artefactos sanitarios del área inspeccionada.",
      high: "Se observan condiciones visibles relevantes en artefactos sanitarios del área inspeccionada."
    },
    ELECTRICIDAD: {
      low: "Se observan condiciones visibles menores en elementos eléctricos del área inspeccionada.",
      medium: "Se observan condiciones visibles en elementos eléctricos del área inspeccionada.",
      high: "Se observan condiciones visibles relevantes en elementos eléctricos del área inspeccionada."
    },
    VENTANAS_CERRAMIENTOS: {
      low: "Se observan condiciones visibles menores en ventanas o cerramientos del área inspeccionada.",
      medium: "Se observan condiciones visibles en ventanas o cerramientos del área inspeccionada.",
      high: "Se observan condiciones visibles relevantes en ventanas o cerramientos del área inspeccionada."
    },
    PUERTAS_HERRAJES: {
      low: "Se observan condiciones visibles menores en puertas o herrajes del área inspeccionada.",
      medium: "Se observan condiciones visibles en puertas o herrajes del área inspeccionada.",
      high: "Se observan condiciones visibles relevantes en puertas o herrajes del área inspeccionada."
    },
    MOBILIARIO_FIJO: {
      low: "Se observan condiciones visibles menores en mobiliario fijo del área inspeccionada.",
      medium: "Se observan condiciones visibles en mobiliario fijo del área inspeccionada.",
      high: "Se observan condiciones visibles relevantes en mobiliario fijo del área inspeccionada."
    }
  },
  recommendations: {
    GREEN: "Se recomienda mantener seguimiento y control preventivo.",
    YELLOW: "Se recomienda revisar y monitorear el estado observado.",
    RED: "Se recomienda una revisión técnica detallada del hallazgo."
  },
  badge: { yellowFrom: 60, greenFrom: 85 },
  severityRules: {
    enforceFavorableOk: true,
    criticalKeywords: [
      "filtracion", "filtración", "fuga", "activo", "expuesto", "sobrecalent", "quemadura",
      "grieta estructural", "fractura", "desprendimiento", "moho extendido"
    ],
    mediumKeywords: [
      "desgaste", "mancha", "rayon", "rayón", "fisura", "levantamiento", "desalineacion", "desalineación"
    ]
  }
};

export const PROBLEM_BASE_V22 = {
  HUMIDITY_FILTRATION: 20,
  PIPE_LEAK_CORROSION: 25,
  ELECTRICAL_RISK: 35,
  STRUCTURAL_CRACK: 40,
  MATERIAL_DETACHMENT: 30,
  SANITARY_RISK: 25,
  COSMETIC: 5,
};

// Context flags derived from slot/group
export function deriveContextFlags(slot) {
  const g = (slot.groupKey || "").toUpperCase();

  const isWetArea =
    g.startsWith("BATH") || g === "KITCHEN" || g === "LAUNDRY";

  const isElectricalContext =
    g === "ELECTRICAL" ||
    (slot.slotCode || "").toUpperCase().includes("ELECTRICAL") ||
    (slot.slotCode || "").toUpperCase().includes("PANEL");

  const isStructuralContext =
    g === "STRUCTURE" ||
    (slot.slotCode || "").toUpperCase().includes("STRUCTURE");

  return { isWetArea, isElectricalContext, isStructuralContext };
}

// Critical context penalties (fixed, no repetition logic)
export function contextPenalty(problemType, flags) {
  // Only two rules per your definition
  if (problemType === "ELECTRICAL_RISK" && flags.isWetArea) return 15;
  if (problemType === "HUMIDITY_FILTRATION" && flags.isElectricalContext) return 15;
  return 0;
}

export function badgeFromScore(score, scoreConfig) {
  const yellowFrom = scoreConfig?.badge?.yellowFrom ?? DEFAULT_SCORE_CONFIG.badge.yellowFrom;
  const greenFrom = scoreConfig?.badge?.greenFrom ?? DEFAULT_SCORE_CONFIG.badge.greenFrom;
  if (score < yellowFrom) return "RED";
  if (score < greenFrom) return "YELLOW";
  return "GREEN";
}

export function normalizeScoreConfig(input) {
  const base = structuredClone(DEFAULT_SCORE_CONFIG);
  if (!input || typeof input !== "object") return base;
  const next = { ...base, ...input };
  if (!next.kpis || typeof next.kpis !== "object") next.kpis = base.kpis;
  if (!next.messages || typeof next.messages !== "object") next.messages = base.messages;
  if (!next.recommendations || typeof next.recommendations !== "object") next.recommendations = base.recommendations;
  if (!next.slotKpiMap || typeof next.slotKpiMap !== "object") next.slotKpiMap = base.slotKpiMap;
  if (!next.aiPrompts || typeof next.aiPrompts !== "object") next.aiPrompts = base.aiPrompts;
  const kpiKeys = Object.keys(base.kpis);
  kpiKeys.forEach((k) => {
    const src = next.kpis[k] || {};
    next.kpis[k] = {
      low: Number.isFinite(Number(src.low)) ? Number(src.low) : base.kpis[k].low,
      medium: Number.isFinite(Number(src.medium)) ? Number(src.medium) : base.kpis[k].medium,
      high: Number.isFinite(Number(src.high)) ? Number(src.high) : base.kpis[k].high
    };
    const msgSrc = next.messages[k] || {};
    next.messages[k] = {
      low: String(msgSrc.low || base.messages[k].low),
      medium: String(msgSrc.medium || base.messages[k].medium),
      high: String(msgSrc.high || base.messages[k].high)
    };
  });
  next.recommendations = {
    GREEN: String(next.recommendations.GREEN || base.recommendations.GREEN),
    YELLOW: String(next.recommendations.YELLOW || base.recommendations.YELLOW),
    RED: String(next.recommendations.RED || base.recommendations.RED)
  };
  next.badge = {
    yellowFrom: Number.isFinite(Number(next.badge?.yellowFrom)) ? Number(next.badge.yellowFrom) : base.badge.yellowFrom,
    greenFrom: Number.isFinite(Number(next.badge?.greenFrom)) ? Number(next.badge.greenFrom) : base.badge.greenFrom
  };
  next.severityRules = {
    enforceFavorableOk: next.severityRules?.enforceFavorableOk !== undefined
      ? !!next.severityRules.enforceFavorableOk
      : base.severityRules.enforceFavorableOk,
    criticalKeywords: Array.isArray(next.severityRules?.criticalKeywords)
      ? next.severityRules.criticalKeywords.map((x) => String(x || "").trim()).filter(Boolean)
      : base.severityRules.criticalKeywords,
    mediumKeywords: Array.isArray(next.severityRules?.mediumKeywords)
      ? next.severityRules.mediumKeywords.map((x) => String(x || "").trim()).filter(Boolean)
      : base.severityRules.mediumKeywords
  };
  next.slotKpiMap = {
    ...base.slotKpiMap,
    ...Object.fromEntries(
      Object.entries(next.slotKpiMap || {}).map(([key, value]) => [String(key).toUpperCase(), String(value || "").toUpperCase()])
    )
  };
  next.aiPrompts = {
    ...base.aiPrompts,
    ...Object.fromEntries(
      Object.entries(next.aiPrompts || {}).map(([key, value]) => [String(key).toUpperCase(), String(value || "").trim()])
    )
  };
  return next;
}

export function classifyKpiFromSlot(slot, slotKpiMap) {
  const rawCode = String(slot.slotCode || "");
  let mapKey = String(slotKpiMap?.[rawCode] || "").toUpperCase();
  if (!mapKey && slotKpiMap) {
    const bathMatch = rawCode.match(/^bathroom_(\d+)_/);
    if (bathMatch) mapKey = String(slotKpiMap[`BATHROOM_1_${rawCode.replace(/^bathroom_\d+_/, '')}`] || "").toUpperCase();
    const bedMatch = rawCode.match(/^bedroom_(\d+)_/);
    if (!mapKey && bedMatch) mapKey = String(slotKpiMap[`BEDROOM_1_${rawCode.replace(/^bedroom_\d+_/, '')}`] || "").toUpperCase();
  }
  if (mapKey) return mapKey;

  const code = rawCode.toLowerCase();
  const title = String(slot.title || "").toLowerCase();
  const msg = String(slot.message || "").toLowerCase();

  const has = (txt) => title.includes(txt) || code.includes(txt);
  const hasAny = (arr) => arr.some(has);

  if (msg && ["humedad", "moho", "filtr", "water", "mold"].some((w) => msg.includes(w))) return "HUMEDAD";
  if (hasAny(["muros", "pintura", "pared", "cielo", "paint"])) return "MUROS_PINTURA";
  if (hasAny(["piso", "pisos", "floor"])) return "PISOS";
  if (hasAny(["wc", "lavamanos", "lavaplatos", "grifer", "ducha", "tina", "sanitario", "sifon", "cañer", "baño", "baño"])) return "SANITARIOS";
  if (hasAny(["electrical", "tablero", "enchufe", "interruptor"])) return "ELECTRICIDAD";
  if (hasAny(["ventana", "vidrio", "marco", "cerramiento"])) return "VENTANAS_CERRAMIENTOS";
  if (hasAny(["puerta", "cerradura", "bisagra", "manilla", "herraje"])) return "PUERTAS_HERRAJES";
  if (hasAny(["mueble", "mobiliario", "closet", "clóset", "clósets", "gabinete", "cajon", "alacena"])) return "MOBILIARIO_FIJO";
  return null;
}

function kpiTitleFromKey(key) {
  const map = {
    MUROS_PINTURA: "Muros y pintura",
    HUMEDAD: "Humedad visible",
    PISOS: "Pisos",
    SANITARIOS: "Sanitarios",
    ELECTRICIDAD: "Electricidad visible",
    VENTANAS_CERRAMIENTOS: "Ventanas y cerramientos",
    PUERTAS_HERRAJES: "Puertas y herrajes",
    MOBILIARIO_FIJO: "Mobiliario fijo"
  };
  return map[key] || key[0] + key.slice(1).toLowerCase();
}

function computeScoringByKpi(slots, scoreConfig) {
  const cfg = normalizeScoreConfig(scoreConfig || {});
  const byGroup = new Map();
  let totalPenalty = 0;

  slots.forEach((s) => {
    const key = classifyKpiFromSlot(s, cfg.slotKpiMap);
    if (!key || !cfg.kpis?.[key]) return;
    if (!byGroup.has(key)) {
      byGroup.set(key, { groupKey: key, title: kpiTitleFromKey(key), impact: 0, slotsCount: 0 });
    }
    const group = byGroup.get(key);
    group.slotsCount += 1;
    if (!s.severity) return;
    const sev = String(s.severity || "").toLowerCase();
    const penalty = Number(cfg.kpis[key][sev] ?? 0);
    totalPenalty += penalty;
    group.impact += penalty;
  });

  const byGroupArr = Array.from(byGroup.values())
    .map(g => ({
      ...g,
      scoreIfOnlyGroup: Math.max(0, Math.min(100, 100 - g.impact)),
    }));

  const scoredGroups = byGroupArr.filter(g => g.slotsCount > 0);
  const avgScore = scoredGroups.length
    ? scoredGroups.reduce((acc, g) => acc + g.scoreIfOnlyGroup, 0) / scoredGroups.length
    : 0;
  const score = Math.max(0, Math.min(100, Math.round(avgScore)));
  const badge = badgeFromScore(score, cfg);

  return {
    scoreVersion: "SCORING_V2_2_KPI",
    score,
    badge,
    totalImpact: totalPenalty,
    byGroup: byGroupArr,
  };
}

/**
 * findingsNormalized item:
 * {
 *  slotId, severity, confidence, findingCode, message, problemType
 * }
 */
export function computeScoringV2_2(findingsNormalized, slots, scoreConfig) {
  if (scoreConfig?.kpis) {
    return computeScoringByKpi(slots, scoreConfig);
  }

  const slotById = new Map(slots.map(s => [s.id, s]));

  let totalImpact = 0;

  // optional breakdown by group for UI (informativo, no manda)
  const byGroup = new Map(); // groupKey -> { title, impact }

  for (const f of findingsNormalized) {
    const slot = slotById.get(f.slotId);
    if (!slot) continue;

    const sev = (f.severity || "").toLowerCase();
    const sevFactor = SEVERITY_FACTOR_V22[sev] ?? 1.0;

    const base = PROBLEM_BASE_V22[f.problemType] ?? 0;
    if (!base) continue;

    const flags = deriveContextFlags(slot);
    const ctx = contextPenalty(f.problemType, flags);

    const impact = Math.round(base * sevFactor + ctx);
    totalImpact += impact;

    const gk = (slot.groupKey || "OTHER").toUpperCase();
    const gt = slot.groupTitle || "Otros";
    if (!byGroup.has(gk)) byGroup.set(gk, { groupKey: gk, title: gt, impact: 0 });
    byGroup.get(gk).impact += impact;
  }

  let score = 100 - totalImpact;
  score = Math.max(0, Math.min(100, score));

  const badge = badgeFromScore(score, scoreConfig);

  const byGroupArr = Array.from(byGroup.values())
    .map(g => ({
      ...g,
      // Informativo: "score estimado si solo existiera este grupo"
      scoreIfOnlyGroup: Math.max(0, Math.min(100, 100 - g.impact)),
    }));

  return {
    scoreVersion: "SCORING_V2_2",
    score,
    badge,
    totalImpact,
    byGroup: byGroupArr,
  };
}
