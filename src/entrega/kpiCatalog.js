/**
 * Catálogo KPI Entrega (alineado con seed.json y taxonomía aliasEntregaKpi).
 */

export const ENTREGA_KPIS = [
  'Terminaciones',
  'Instalaciones Sanitarias',
  'Instalaciones Eléctricas',
  'Instalaciones de Gas',
  'Fachadas y Terminaciones Exteriores',
  'Estructura Visible',
  'Climatización',
  'Ventanas y Cerramientos',
  'Áreas Verdes y Exteriores'
];

export const CATALOGO_KPI_ESPECIALIDAD = {
  Terminaciones: ['Pintor', 'Yesero', 'Instalador de cerámica', 'Instalador de porcelanato', 'Instalador de piso flotante', 'Instalador de piso SPC/Vinílico', 'Instalador de alfombra', 'Carpintero terminaciones', 'Instalador de guardapolvos', 'Instalador de papel mural', 'Instalador de cubiertas', 'Mueblista', 'Vidriero', 'Instalador de quincallería', 'Sellador de juntas y silicona', 'Ceramista', 'Instalador Ceramica', 'Instalador pisos', 'Papelero', 'pintor', 'CARPINTERO', 'YESERO', 'PINTOR'],
  'Instalaciones Sanitarias': ['Gasfiter', 'Destapador sanitario', 'Técnico de bombas', 'Técnico de presurización', 'Técnico de aguas lluvias', 'GASFITER'],
  'Instalaciones Eléctricas': ['Electricista', 'Técnico corrientes débiles', 'Técnico iluminación', 'Técnico citofonía/intercom', 'Electrico'],
  'Instalaciones de Gas': ['Instalador autorizado SEC gas', 'Técnico calefont', 'Técnico caldera', 'Técnico cocina y horno', 'Instalador de gas'],
  'Fachadas y Terminaciones Exteriores': ['Fachadista', 'Pintor exterior', 'Impermeabilizador', 'Instalador EIFS', 'Instalador siding', 'Hojalatero', 'Techumbre'],
  'Estructura Visible': ['Constructor', 'ITO', 'Ingeniero estructural', 'Especialista en reparación de hormigón', 'estructural', 'Albañil'],
  Climatización: ['Técnico aire acondicionado', 'Técnico ventilación', 'Técnico extracción'],
  'Ventanas y Cerramientos': ['Aluminiero', 'Instalador PVC', 'Técnico de cierres y herrajes', 'VENTANERO', 'Sellador'],
  'Áreas Verdes y Exteriores': ['Jardinero', 'Técnico riego', 'Paisajista']
};

const ESPECIALIDAD_TO_KPI = Object.entries(CATALOGO_KPI_ESPECIALIDAD).reduce((acc, [kpi, oficios]) => {
  oficios.forEach((oficio) => {
    acc[oficio] = kpi;
    acc[oficio.toLowerCase()] = kpi;
  });
  return acc;
}, {});

const KPI_LOOKUP = ENTREGA_KPIS.reduce((acc, k) => {
  acc[k.toLowerCase()] = k;
  return acc;
}, {});

export const DEFAULT_KPI = 'Terminaciones';

export function normalizeKpiName(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return KPI_LOOKUP[s.toLowerCase()] || s;
}

export function resolveKpi({ kpi, especialidad } = {}) {
  const explicit = normalizeKpiName(kpi);
  if (explicit && ENTREGA_KPIS.includes(explicit)) return explicit;
  const esp = String(especialidad || '').trim();
  if (esp && ESPECIALIDAD_TO_KPI[esp]) return ESPECIALIDAD_TO_KPI[esp];
  if (esp && ESPECIALIDAD_TO_KPI[esp.toLowerCase()]) return ESPECIALIDAD_TO_KPI[esp.toLowerCase()];
  return DEFAULT_KPI;
}

export function getPublicKpiCatalog() {
  return {
    kpis: ENTREGA_KPIS,
    catalogoEspecialidades: CATALOGO_KPI_ESPECIALIDAD
  };
}
