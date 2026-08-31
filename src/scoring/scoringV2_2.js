// src/scoring/scoringV2_2.js

export const SEVERITY_FACTOR_V22 = {
  low: 1.0,
  medium: 1.3,
  high: 1.5,
};

export const DEFAULT_SCORE_CONFIG = {
  kpis: {
    MUROS_PINTURA: { low: 30, medium: 50, high: 80 },
    HUMEDAD: { low: 30, medium: 50, high: 80 },
    PISOS: { low: 30, medium: 50, high: 80 },
    SANITARIOS: { low: 30, medium: 50, high: 80 },
    ELECTRICIDAD: { low: 30, medium: 50, high: 80 },
    VENTANAS_CERRAMIENTOS: { low: 30, medium: 50, high: 80 },
    PUERTAS_HERRAJES: { low: 30, medium: 50, high: 80 },
    MOBILIARIO_FIJO: { low: 30, medium: 50, high: 80 },
    DOCUMENTOS_CUMPLIMIENTO: { low: 30, medium: 50, high: 80 }
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
    ASCENSOR_CERTIFICADO_INSPECCION: "DOCUMENTOS_CUMPLIMIENTO",
    ASCENSOR_CABINA: "DOCUMENTOS_CUMPLIMIENTO",
    ELEVATOR: "DOCUMENTOS_CUMPLIMIENTO",
    ESTACIONAMIENTO: "PISOS",
    CERTIFICADO_VERDE: "DOCUMENTOS_CUMPLIMIENTO"
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
      "Eres un inspector técnico profesional evaluando el estado de los pisos y revestimientos (cerámica, madera, laminado, flotante, vinílico, etc.).",
      "",
      "En pisos laminados o flotante de tablones largos, revisa con atención los ENCUENTROS y las JUNTAS (incluidos los cabezales de los tablones):",
      "- levantamiento, escalonamiento, hinchazón localizada o ondulación en la línea de junta;",
      "- bordes de tablón más altos que el resto (efecto “peaking” / cabeceo en juntas), separación visible entre lengüeta y ranura si aplica;",
      "- cambios de brillo o color solo a lo largo de la junta que sugieran hinchamiento por humedad.",
      "Esto NO es equivalente a un simple rayón o desgaste superficial del barniz: si ves deformación en juntas, descríbela y en signals_detected usa redacción explícita (ej.: “levantamiento o hinchazón en juntas de cabezales”, “deformación en encuentros de tablones compatible con exposición a humedad”).",
      "Si la evidencia es clara, proposed_severity debe ser al menos medium; reserva low solo para marcas leves sin deformación en juntas.",
      "",
      "También busca: cerámicas quebradas, piso flotante separado del zócalo, alfombras manchadas o gastadas, guardapolvos desprendidos.",
      "Evalúa la continuidad y nivelación general visible en la imagen.",
      "Coherencia del texto: la conclusión (kpi_analysis) no debe contradecir la descripción. No afirmes «no se detectan hallazgos relevantes» o equivalente si al mismo tiempo describes desgaste, deformación o levantamiento en juntas que amerite registro; unifica criterio. Si solo hay desgaste cosmético mínimo sin relevancia técnica, concluye en consecuencia y ajusta proposed_severity."
    ].join("\n"),
    SANITARIOS: [
      "Eres un inspector técnico profesional revisando artefactos sanitarios y cañerías visibles (bajo lavamanos, WC, ducha, etc.).",
      "",
      "Reglas estrictas sobre HUMEDAD y FILTRACIONES (evitar falsos positivos):",
      "- No uses las palabras «humedad», «húmedo», «filtración activa» ni «fuga» salvo que en la imagen haya señales CLARAS y localizables: por ejemplo gotas o brillo de agua reciente, charco, goteo visible, aureola húmeda reciente muy definida, eflorescencia blanca clara, pintura/capa sobre azulejo claramente inflada por capilaridad, u hongo filamentoso evidente.",
      "- Manchas marrones/amarillentas fijas, lechada oscura, polvo en tubos o suciedad acumulada NO bastan para afirmar «humedad superficial visible»; descríbelas como manchas o decoloración / suciedad o lechada deteriorada y explica la ubicación.",
      "- No concluyas «no hay filtración activa» ni «no hay daños severos» como si pudieras ver el interior de la pared o tuberías: solo lo visible en el encuadre.",
      "",
      "Cañerías pintadas (práctica muy frecuente en departamentos y entregas inmobiliarias):",
      "- Una capa de pintura sobre PVC o metal visible, uniforme o con retoques, NO es por sí sola un hallazgo técnico: no la confundas con corrosión, desgaste de tubo, humedad, filtración ni «material deteriorado».",
      "- Si solo observas color distinto al plástico «natural», textura mate o irregularidades propias de la pintura, descríbelo como cañería pintada o acabado estético; no uses signals_detected ni subas proposed_severity solo por eso.",
      "- Sí registra defecto cuando exista otra evidencia clara y localizable: grieta o quebradura en tubo, abultamiento, goteo u húmedo reciente, óxido laminar en metal realmente expuesto (no interpretes manchas bajo pintura homogénea), sellos de silicona cortados o faltantes, conexiones con patrón claro de goteo frecuente bajo la unión.",
      "",
      "«Intervención no estándar» en grifería o desagüe (evitar falsos positivos):",
      "- No uses esa etiqueta salvo que veas evidencia CLARA de chapuza o modificación: por ejemplo cinta aislante o huincha en empalmes, teflón excesivo y desordenado en roscas visibles, soldadura fría o irregular en cobre, abrazaderas improvisadas, mezcla brusca PVC–metal a la vista, manguera tipo «perico» sustituyendo tramo rígido, roscas destrozadas o piezas claramente no originales mal acopladas.",
      "- Una grifería bimando o monomando clásica sobre lavamanos de pedestal, corrosión/sarro en cuerpos o manijas, o acabado antiguo NO constituyen por sí «intervención no estándar». En ese caso limita el hallazgo a corrosión, desgaste del cromado o sarro según corresponda.",
      "",
      "Lavamanos y piletas (encuadre sobre el artefacto): antes de concluir, inspecciona con atención el desagüe visible (aro, tapón o rejilla cromada), el rebosadero si aparece y la unión grifería–porcelana.",
      "- Cromado del desagüe: busca descascarado, desconchado, levantamiento o pérdida localizada del baño cromado que deja ver metal más oscuro, mate o cobrizo; manchas o velos rojizo-marrón compatibles con óxido (incluso leve) en el metal expuesto. Eso SÍ es hallazgo de desgaste/corrosión superficial en sanitarios: descríbelo en description (ubicación exacta) y en kpi_analysis o signals_detected (ej. «desconchado del cromado y óxido en aro del desagüe»). No lo atribuyas a sombra del encuadre si el patrón sigue alrededor del círculo del desagüe.",
      "- Pie de la grifería: sarro o mineralización amarillenta-marrón acumulada en la junta con la porcelana es hallazgo menor; menciónalo si es visible.",
      "- Si cualquiera de lo anterior es claramente visible, no afirmes que el área está «en buen estado» ni cierres con «sin hallazgos»; proposed_severity al menos «low» y señales concretas.",
      "",
      "Severidad (óxido / corrosión en metal): sube a `high` solo cuando en la imagen haya **oxidación ferrosa clara** (tonalidad rojiza/cobriza en metal expuesto, pérdida o desconchado del cromado dejando metal oscuro, óxido laminar, corrosión marcada en conexiones). No uses `high` si solo ves **sarro, mineralización, pintura sobre cañería, suciedad acumulada o acabado mate** sin evidencia clara de óxido. La palabra «corrosión» sola o en forma dudosa («posible corrosión») no basta: confirma con descripción visual concreta o usa `medium`/`low`.",
      "",
      "Sí revisa: trizaduras en porcelana o artefactos, sarro o corrosión marcada en grifería (metal expuesto), sellos de silicona faltantes o cortados, piezas flojas, conexiones visiblemente corroídas o con depósitos que sugieran goteo frecuente (solo si se ve patrón claro bajo la conexión).",
      "En signals_detected usa redacción objetiva (ej. «mancha en junta vertical junto a cañería», «posible sellado deficiente en empotramiento») en lugar de etiquetas vagas."
    ].join("\n"),
    ELECTRICIDAD: [
      "Analiza la imagen correspondiente al slot {{SLOT_CODE}}",
      "bajo el contexto técnico del KPI: ELECTRICIDAD VISIBLE.",
      "",
      "IMPORTANTE: distingue el tipo de slot. Si es interruptores o enchufes de pared, no exijas tablero ni interruptor diferencial. Esas reglas aplican solo al slot de tablero (ELECTRICAL_PANEL).",
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
      "- [SOLO slot tablero ELECTRICAL_PANEL] tablero eléctrico visible sin tapa o con elementos dañados",
      "- [SOLO slot tablero] presencia o ausencia de interruptor diferencial (solo si el tablero completo es visible; el diferencial suele ser breaker ancho/doble al inicio)",
      "",
      "[SOLO slot tablero / interior de tablero abierto] No uses «desgaste superficial» ni «desgaste en la parte inferior» para polvo, suciedad, manchas oscuras o residuos en el fondo, riel DIN o marco metálico si no hay evidencia clara de deterioro mecánico (rayones profundos, pintura removida por roce, plástico trizado o partido, corrosión que altere visiblemente el metal). En ese caso descríbelo como suciedad acumulada, manchas o residuos. Si únicamente observas suciedad o manchas sin ninguno de los defectos eléctricos listados arriba, usa proposed_severity \"none\" y no inventes hallazgos técnicos.",
      "En tablero abierto, la zona baja del chasis o riel suele acumular polvo y residuos oscuros: eso NO es desgaste del tablero salvo que veas además trizaduras, corrosión activa marcada en bornes o carcasas, o daño mecánico claro. No mezcles «diferencial y térmicos en buen estado» con una supuesta «parte inferior desgastada» por suciedad.",
      "",
      "Si el slot es de INTERRUPTORES o ENCHUFES de pared (p.ej. LIVING_SWITCHES, *_OUTLETS): NO evalúes tablero ni diferencial; NO pongas matches_slot=false por no ver el panel.",
      "",
      "[SOLO slots *_SWITCHES] No confundas con interruptores: conectores coaxiales (tipo F, rosca central, salida TV/audio-video/antena), tomas de corriente tipo L (3 orificios) y placas ciegas son instalaciones normales. NO uses «interruptores sin tapas» ni «mecanismos expuestos» para describir salidas AV o enchufes. Solo reporta defecto si hay apagador/interruptor real dañado, sin placa, cable expuesto o sobrecalentamiento.",
      "",
      "Interruptor diferencial (únicamente cuando el slot es tablero eléctrico):",
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
      "Indica si el encuadre es parcial o hay zonas fuera de foco. Menciona visibilidad del tablero solo cuando el slot sea de tablero.",
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
      "Clósets con varias hojas batientes: la altura de los pomos/tiradores puede variar levemente por instalación de herrajes o tolerancia de fábrica; eso NO demuestra por sí solo que las hojas estén desalineadas respecto al marco. No confundas suciedad o rozaduras en el borde inferior de las hojas con desalineación. Un entrehoja algo distinto entre un par de hojas puede deberse a perspectiva de la cámara (encuadre no perfectamente perpendicular): solo afirma «desalineamiento entre puertas» o «puertas desalineadas» si se ve claramente hoja torcida respecto al marco, folio que sobresale de forma asimétrica respecto al coplanado, o desajuste obvio entre hoja y zócalo. Si solo ves rayones o marcas en el zócalo inferior, descríbelo así; proposed_severity no debe ser medium solo por eso.",
      "",
      "Reglas: analiza solo lo visible; no infieras desalineación por sombras o ángulo de la foto; si el elemento no corresponde al slot esperado, describe sin inventar hallazgos."
    ].join("\n"),
    DOCUMENTOS_CUMPLIMIENTO: [
      "Analiza la imagen del slot {{SLOT_CODE}} bajo el KPI: DOCUMENTOS Y CUMPLIMIENTO REGULATORIO.",
      "",
      "Este slot es un DOCUMENTO (certificado verde, certificado de inspección de ascensor u otro certificado visible), NO una foto de terminaciones, cabina de ascensor sin placa, ni otra habitación.",
      "",
      "Paso 1 — Correspondencia:",
      "Indica si el encuadre muestra el documento solicitado en el título del slot. Si no corresponde, matches_slot=false.",
      "",
      "Paso 2 — Legibilidad:",
      "¿Se leen identificación, fechas, organismo emisor y resultado? Si el texto es ilegible por desenfoque, recorte o reflejo, indícalo.",
      "",
      "Paso 3 — Vigencia (obligatorio si hay fechas legibles):",
      "Compara fechas de vencimiento o próxima inspección con la fecha actual implícita de la inspección. Si el certificado está vencido o la fecha de vencimiento es pasada, proposed_severity=\"high\" y describe «vencido» o «no vigente». Si está vigente, proposed_severity=\"none\". Si no hay fechas legibles, proposed_severity=\"medium\" por no poder confirmar vigencia.",
      "",
      "Para ASCENSOR / certificado de inspección: NO evalúes estado de cabina, botonera ni puertas; solo el documento o placa de inspección.",
      "",
      "Reglas: no infieras cumplimiento normativo más allá de lo legible; no inventes fechas que no se vean."
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
    },
    DOCUMENTOS_CUMPLIMIENTO: {
      low: "Se observan observaciones menores en documentación del área inspeccionada.",
      medium: "No fue posible confirmar plenamente la vigencia o legibilidad del documento registrado.",
      high: "El certificado o documento registrado no se encuentra vigente o presenta incumplimiento relevante."
    }
  },
  recommendations: {
    GREEN: "Se recomienda mantener seguimiento y control preventivo.",
    YELLOW: "Se recomienda revisar y monitorear el estado observado.",
    RED: "Se recomienda una revisión técnica detallada del hallazgo."
  },
  badge: { yellowFrom: 60, greenFrom: 86 },
  kpiWeights: {
    HUMEDAD: 2,
    SANITARIOS: 2,
    ELECTRICIDAD: 2
  },
  severityRules: {
    enforceFavorableOk: true,
    criticalKeywords: [
      "filtracion", "filtración", "fuga", "activo", "expuesto", "sobrecalent", "quemadura",
      "grieta estructural", "fractura", "desprendimiento", "moho extendido"
    ],
    mediumKeywords: [
      "desgaste", "mancha", "rayon", "rayón", "fisura", "levantamiento", "desalineacion", "desalineación"
    ],
    byKpi: {
      DOCUMENTOS_CUMPLIMIENTO: {
        criticalKeywords: ["vencido", "no vigente", "expirado", "caducado", "fuera de plazo", "certificado vencido"]
      }
    }
  },
  /** Ejemplos enseñados desde admin (Intelligence); se inyectan en prompts sin redeploy. */
  aiFindingExamples: []
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

/** 1–5 estrellas alineadas con rangos de badge (rojo=1, amarillo=2–3, verde=4–5). */
export function starsFromScore(score, scoreConfig) {
  const cfg = normalizeScoreConfig(scoreConfig || {});
  const yellowFrom = cfg.badge.yellowFrom;
  const greenFrom = cfg.badge.greenFrom;
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  if (n >= greenFrom) {
    const topTier = greenFrom + Math.max(1, Math.round((100 - greenFrom) * 0.33));
    return n >= topTier ? 5 : 4;
  }
  if (n >= yellowFrom) {
    const midYellow = yellowFrom + Math.round((greenFrom - yellowFrom) * 0.5);
    return n >= midYellow ? 3 : 2;
  }
  return 1;
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
  next.kpiWeights = {
    ...base.kpiWeights,
    ...Object.fromEntries(
      Object.entries(next.kpiWeights || {})
        .map(([key, value]) => [String(key).toUpperCase(), Number(value)])
        .filter(([, value]) => Number.isFinite(value) && value > 0)
    )
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
  const validSeverity = new Set(["low", "medium", "high", "none", ""]);
  next.aiFindingExamples = Array.isArray(next.aiFindingExamples)
    ? next.aiFindingExamples
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const kpiKey = String(row.kpiKey || "").toUpperCase().trim();
        const signal = String(row.signal || "").trim();
        if (!kpiKey || !signal) return null;
        const severity = String(row.severity || "").toLowerCase().trim();
        return {
          id: String(row.id || `ex_${Date.now()}`),
          kpiKey,
          signal,
          severity: validSeverity.has(severity) ? severity : "",
          guidance: String(row.guidance || "").trim(),
          active: row.active !== false,
          createdAt: row.createdAt ? String(row.createdAt) : null
        };
      })
      .filter(Boolean)
      .slice(0, 200)
    : [];
  return next;
}

const AI_FINDING_EXAMPLES_PER_KPI_LIMIT = 20;

/** Bloque de few-shot desde admin Intelligence → prompt de visión. */
export function formatAiFindingExamplesBlock(kpiKey, scoreConfig) {
  const key = String(kpiKey || "").toUpperCase();
  if (!key) return "";
  const rows = (normalizeScoreConfig(scoreConfig || {}).aiFindingExamples || [])
    .filter((e) => e.active !== false && String(e.kpiKey).toUpperCase() === key)
    .slice(-AI_FINDING_EXAMPLES_PER_KPI_LIMIT);
  if (!rows.length) return "";
  const lines = rows.map((e, i) => {
    const sev = e.severity ? ` → severidad sugerida: ${e.severity}` : "";
    const guide = e.guidance ? ` ${e.guidance}` : "";
    return `${i + 1}. Si observas «${e.signal}»${sev}.${guide}`.trim();
  });
  return [
    "",
    "Criterios aprendidos del equipo (aplicar al analizar este KPI; priorizar sobre suposiciones genéricas):",
    ...lines
  ].join("\n");
}

export function classifyKpiFromSlot(slot, slotKpiMap) {
  const rawCode = String(slot.slotCode || "");
  const codeUpper = rawCode.toUpperCase();
  let mapKey = String(slotKpiMap?.[codeUpper] || slotKpiMap?.[rawCode] || "").toUpperCase();
  if (!mapKey && slotKpiMap) {
    const bathMatch = codeUpper.match(/^BATHROOM_\d+_(.+)$/);
    if (bathMatch) {
      const suffix = bathMatch[1];
      mapKey = String(
        slotKpiMap[`BATHROOM_1_${suffix}`]
        || slotKpiMap[`BATHROOM_2_${suffix}`]
        || ""
      ).toUpperCase();
    }
    const bedMatch = codeUpper.match(/^BEDROOM_\d+_(.+)$/);
    if (!mapKey && bedMatch) {
      const suffix = bedMatch[1];
      mapKey = String(
        slotKpiMap[`BEDROOM_1_${suffix}`]
        || slotKpiMap[`BEDROOM_2_${suffix}`]
        || slotKpiMap[`BEDROOM_3_${suffix}`]
        || ""
      ).toUpperCase();
    }
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
  if (code.includes("_outlets") || code.includes("_switches") || hasAny(["electrical", "tablero", "enchufe", "interruptor"])) return "ELECTRICIDAD";
  if (hasAny(["wc", "lavamanos", "lavaplatos", "grifer", "ducha", "tina", "sanitario", "sifon", "cañer", "baño", "baño"])) return "SANITARIOS";
  if (hasAny(["ascensor", "certificado", "inspeccion", "inspección", "certificacion", "certificación"])) return "DOCUMENTOS_CUMPLIMIENTO";
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
    MOBILIARIO_FIJO: "Mobiliario fijo",
    DOCUMENTOS_CUMPLIMIENTO: "Documentos y cumplimiento"
  };
  return map[key] || key[0] + key.slice(1).toLowerCase();
}

export function kpiWeightForKey(key, scoreConfig) {
  const cfg = normalizeScoreConfig(scoreConfig || {});
  const k = String(key || "").toUpperCase();
  const w = Number(cfg.kpiWeights?.[k]);
  return Number.isFinite(w) && w > 0 ? w : 1;
}

/** Penalización por slot según KPI + severidad y score-config vigente (admin). */
export function kpiPenaltyFromSeverity(kpiKey, severity, scoreConfig) {
  const sev = String(severity || "").toLowerCase();
  if (!sev || !kpiKey) return 0;
  const cfg = normalizeScoreConfig(scoreConfig || {});
  const kpiCfg = cfg.kpis?.[String(kpiKey).toUpperCase()];
  if (!kpiCfg) return 0;
  return Number(kpiCfg[sev] ?? 0);
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
    // Solo contar slots con severity (no omitidos ni OK)
    if (!s.severity) return;
    group.slotsCount += 1;
    const penalty = kpiPenaltyFromSeverity(key, s.severity, cfg);
    totalPenalty += penalty;
    group.impact += penalty;
  });

  const byGroupArr = Array.from(byGroup.values()).map((g) => {
    const avgPenalty = g.slotsCount > 0 ? g.impact / g.slotsCount : 0;
    const stiWeight = kpiWeightForKey(g.groupKey, cfg);
    return {
      ...g,
      stiWeight,
      scoreIfOnlyGroup: Math.max(0, Math.min(100, Math.round(100 - avgPenalty)))
    };
  });

  const scoredGroups = byGroupArr.filter(g => g.slotsCount > 0);
  const weightedScoreSum = scoredGroups.reduce(
    (acc, g) => acc + g.scoreIfOnlyGroup * kpiWeightForKey(g.groupKey, cfg),
    0
  );
  const weightedTotal = scoredGroups.reduce(
    (acc, g) => acc + kpiWeightForKey(g.groupKey, cfg),
    0
  );
  const avgScore = weightedTotal > 0 ? weightedScoreSum / weightedTotal : 0;
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
  const byGroup = new Map(); // groupKey -> { title, impact, findingCount }

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
    if (!byGroup.has(gk)) byGroup.set(gk, { groupKey: gk, title: gt, impact: 0, findingCount: 0 });
    const grp = byGroup.get(gk);
    grp.impact += impact;
    grp.findingCount += 1;
  }

  let score = 100 - totalImpact;
  score = Math.max(0, Math.min(100, score));

  const badge = badgeFromScore(score, scoreConfig);

  const byGroupArr = Array.from(byGroup.values()).map((g) => {
    const avgImpact = g.findingCount > 0 ? g.impact / g.findingCount : 0;
    return {
      ...g,
      scoreIfOnlyGroup: Math.max(0, Math.min(100, Math.round(100 - avgImpact)))
    };
  });

  return {
    scoreVersion: "SCORING_V2_2",
    score,
    badge,
    totalImpact,
    byGroup: byGroupArr,
  };
}
