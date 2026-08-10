/**
 * Configuración de soluciones — referencia para migración React (SolutionsSection).
 * El home estático usa navegación por etapas con edificio fijo (building-visual-state-01.png)
 * y overlays por estado en index.html + solutions-section.js.
 */
window.SOLUTIONS_CONFIG = [
  {
    number: "01",
    name: "Recepción técnica",
    title: "Reciba proyectos con evidencia, no con supuestos.",
    description:
      "Ainspecciona permite registrar hallazgos por unidad, organizar evidencia fotográfica y controlar su corrección antes de que la inmobiliaria reciba el proyecto.",
    audience: "Inmobiliarias y constructoras",
    outcomes: [
      "Hallazgos por unidad",
      "Evidencia fotográfica",
      "Seguimiento de correcciones",
      "Órdenes de trabajo",
      "Estado del proyecto"
    ],
    href: "/entrega",
    cta: "Conocer Recepción Técnica →",
    reverse: false
  },
  {
    number: "02",
    name: "Postventa",
    title: "De un reclamo desordenado a un caso estructurado.",
    description:
      "Ainspecciona recibe el problema, guía la captura de evidencia y genera un ticket clasificado y trazable para el equipo de postventa.",
    audience: "Inmobiliarias y equipos de postventa",
    outcomes: [
      "Captura guiada",
      "Evidencia fotográfica",
      "Clasificación del problema",
      "Tickets estructurados",
      "Seguimiento del caso"
    ],
    href: "/postventa/captura",
    cta: "Conocer Postventa →",
    reverse: true
  },
  {
    number: "03",
    name: "Inspección pre-arriendo",
    title: "Documente el estado antes de entregar una propiedad.",
    description:
      "Ainspecciona registra la condición visible de la propiedad antes del arriendo y crea una base objetiva para futuras comparaciones.",
    audience: "Corredores, administradores y propietarios",
    outcomes: [
      "Inspección guiada",
      "Fotografías por ambiente",
      "Hallazgos visibles",
      "Informe digital",
      "Registro previo a la entrega"
    ],
    href: "/#contacto",
    cta: "Conocer Inspección pre-arriendo →",
    reverse: false
  },
  {
    number: "04",
    name: "Inspección pre-venta",
    title: "Más información antes de comprar o vender.",
    description:
      "Inspección presencial ejecutada por Property-CHK y respaldada por tecnología Ainspecciona para documentar hallazgos y apoyar una decisión informada.",
    audience: "Compradores, vendedores e inversionistas",
    outcomes: [
      "Inspección presencial",
      "Hallazgos priorizados",
      "Evidencia fotográfica",
      "Informe técnico",
      "Resumen ejecutivo"
    ],
    href: "/#contacto",
    cta: "Solicitar inspección pre-venta →",
    note: "Servicio ejecutado por Property-CHK sobre tecnología Ainspecciona.",
    reverse: true
  }
];
