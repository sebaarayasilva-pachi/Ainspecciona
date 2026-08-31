/**
 * Analytics para Admin Dashboard: funnel Business, serie diaria, geo Chile (heurístico), heatmap hora/día.
 * @param {import('@prisma/client').PrismaClient} prisma
 */

/** @param {string | undefined} q @param {number} def @param {number} max */
export function clampDays(q, def = 30, max = 90) {
  const n = parseInt(String(q || ''), 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Heurística: dirección libre -> región (Chile) o null.
 * No geocodifica; prioriza coincidencias más específicas.
 */
const COMMUNE_TO_REGION = [
  // RM (muestra representativa; ampliar según datos reales)
  ['santiago', 'Región Metropolitana'],
  ['providencia', 'Región Metropolitana'],
  ['las condes', 'Región Metropolitana'],
  ['vitacura', 'Región Metropolitana'],
  ['nunoa', 'Región Metropolitana'],
  ['maipu', 'Región Metropolitana'],
  ['puente alto', 'Región Metropolitana'],
  ['la florida', 'Región Metropolitana'],
  ['penalolen', 'Región Metropolitana'],
  ['las rejas', 'Región Metropolitana'],
  ['cerrillos', 'Región Metropolitana'],
  ['estacion central', 'Región Metropolitana'],
  ['independencia', 'Región Metropolitana'],
  ['recoleta', 'Región Metropolitana'],
  ['quilicura', 'Región Metropolitana'],
  ['renca', 'Región Metropolitana'],
  ['conchali', 'Región Metropolitana'],
  ['huechuraba', 'Región Metropolitana'],
  ['quinta normal', 'Región Metropolitana'],
  ['lo prado', 'Región Metropolitana'],
  ['cerro navia', 'Región Metropolitana'],
  ['lo espejo', 'Región Metropolitana'],
  ['la pintana', 'Región Metropolitana'],
  ['san bernardo', 'Región Metropolitana'],
  ['calera de tango', 'Región Metropolitana'],
  ['buin', 'Región Metropolitana'],
  ['paine', 'Región Metropolitana'],
  ['melipilla', 'Región Metropolitana'],
  ['talagante', 'Región Metropolitana'],
  ['colina', 'Región Metropolitana'],
  ['lampa', 'Región Metropolitana'],
  ['til til', 'Región Metropolitana'],
  ['san jose de maipo', 'Región Metropolitana'],
  ['pirque', 'Región Metropolitana'],
  ['lo barnechea', 'Región Metropolitana'],
  ['la reina', 'Región Metropolitana'],
  ['macul', 'Región Metropolitana'],
  ['penaflor', 'Región Metropolitana'],
  ['curacavi', 'Región Metropolitana'],
  ['valdivia de pai', 'Región Metropolitana'],
  ['san pedro', 'Región Metropolitana'],
  ['alhue', 'Región Metropolitana'],
  ['maria pinto', 'Región Metropolitana'],
  ['el monte', 'Región Metropolitana'],
  ['isla de maipo', 'Región Metropolitana'],
  ['padre hurtado', 'Región Metropolitana'],
  ['peñaflor', 'Región Metropolitana'],
  ['peñalolen', 'Región Metropolitana'],
  ['ñuñoa', 'Región Metropolitana'],
  ['la granja', 'Región Metropolitana'],
  ['san miguel', 'Región Metropolitana'],
  ['la cisterna', 'Región Metropolitana'],
  ['el bosque', 'Región Metropolitana'],
  ['pedro aguirre cerda', 'Región Metropolitana'],
  ['lo espejo', 'Región Metropolitana'],
  ['san ramon', 'Región Metropolitana'],
  ['lo prado', 'Región Metropolitana'],
  ['valparaiso', 'Región de Valparaíso'],
  ['vina del mar', 'Región de Valparaíso'],
  ['viña del mar', 'Región de Valparaíso'],
  ['concon', 'Región de Valparaíso'],
  ['quilpue', 'Región de Valparaíso'],
  ['villa alemana', 'Región de Valparaíso'],
  ['casablanca', 'Región de Valparaíso'],
  ['san antonio', 'Región de Valparaíso'],
  ['los andes', 'Región de Valparaíso'],
  ['san felipe', 'Región de Valparaíso'],
  ['la ligua', 'Región de Valparaíso'],
  ['quillota', 'Región de Valparaíso'],
  ['concon', 'Región de Valparaíso'],
  ['antofagasta', 'Región de Antofagasta'],
  ['calama', 'Región de Antofagasta'],
  ['tocopilla', 'Región de Antofagasta'],
  ['iquique', 'Región de Tarapacá'],
  ['alto hospicio', 'Región de Tarapacá'],
  ['arica', 'Región de Arica y Parinacota'],
  ['copiapo', 'Región de Atacama'],
  ['la serena', 'Región de Coquimbo'],
  ['coquimbo', 'Región de Coquimbo'],
  ['ovalle', 'Región de Coquimbo'],
  ['rancagua', "Región del Libertador Bernardo O'Higgins"],
  ['curico', 'Región del Maule'],
  ['talca', 'Región del Maule'],
  ['linares', 'Región del Maule'],
  ['constitucion', 'Región del Maule'],
  ['chillan', 'Región de Ñuble'],
  ['concepcion', 'Región del Biobío'],
  ['los angeles', 'Región del Biobío'],
  ['temuco', 'Región de La Araucanía'],
  ['valdivia', 'Región de Los Ríos'],
  ['osorno', 'Región de Los Lagos'],
  ['puerto montt', 'Región de Los Lagos'],
  ['castro', 'Región de Los Lagos'],
  ['coyhaique', 'Región de Aysén'],
  ['punta arenas', 'Región de Magallanes'],
  ['puerto natales', 'Región de Magallanes']
];

const REGION_KEYWORDS = [
  ['metropolitana', 'Región Metropolitana'],
  ['region metropolitana', 'Región Metropolitana'],
  ['rm ', 'Región Metropolitana'],
  [' rm', 'Región Metropolitana'],
  ['valparaiso', 'Región de Valparaíso'],
  ['v region', 'Región de Valparaíso'],
  ['v región', 'Región de Valparaíso'],
  ['antofagasta', 'Región de Antofagasta'],
  ['ii region', 'Región de Antofagasta'],
  ['tarapaca', 'Región de Tarapacá'],
  ['i region', 'Región de Tarapacá'],
  ['arica y parinacota', 'Región de Arica y Parinacota'],
  ['xv region', 'Región de Arica y Parinacota'],
  ['atacama', 'Región de Atacama'],
  ['iii region', 'Región de Atacama'],
  ['coquimbo', 'Región de Coquimbo'],
  ['iv region', 'Región de Coquimbo'],
  ["o'higgins", "Región del Libertador Bernardo O'Higgins"],
  ['ohiggins', "Región del Libertador Bernardo O'Higgins"],
  ['vi region', "Región del Libertador Bernardo O'Higgins"],
  ['maule', 'Región del Maule'],
  ['vii region', 'Región del Maule'],
  ['nuble', 'Región de Ñuble'],
  ['biobio', 'Región del Biobío'],
  ['viii region', 'Región del Biobío'],
  ['araucania', 'Región de La Araucanía'],
  ['ix region', 'Región de La Araucanía'],
  ['los rios', 'Región de Los Ríos'],
  ['xiv region', 'Región de Los Ríos'],
  ['los lagos', 'Región de Los Lagos'],
  ['x region', 'Región de Los Lagos'],
  ['aysen', 'Región de Aysén'],
  ['xi region', 'Región de Aysén'],
  ['magallanes', 'Región de Magallanes'],
  ['xii region', 'Región de Magallanes']
];

/**
 * @param {string | null | undefined} address
 * @returns {{ region: string | null, communeGuess: string | null }}
 */
export function parseAddressToRegion(address) {
  const raw = String(address || '').trim();
  if (!raw) return { region: null, communeGuess: null };
  const n = stripAccents(raw);
  for (const [commune, region] of COMMUNE_TO_REGION) {
    if (n.includes(commune)) return { region, communeGuess: commune };
  }
  for (const [kw, region] of REGION_KEYWORDS) {
    if (n.includes(kw)) return { region, communeGuess: null };
  }
  return { region: null, communeGuess: null };
}

/**
 * @param {string[]} addresses
 */
export function aggregateGeo(addresses) {
  const byRegion = {};
  const byCommune = {};
  let parsed = 0;
  const total = addresses.length;
  for (const a of addresses) {
    const { region, communeGuess } = parseAddressToRegion(a);
    if (region) {
      parsed += 1;
      byRegion[region] = (byRegion[region] || 0) + 1;
      if (communeGuess) {
        const key = `${region} · ${communeGuess}`;
        byCommune[key] = (byCommune[key] || 0) + 1;
      }
    }
  }
  const regionsSorted = Object.entries(byRegion)
    .map(([region, count]) => ({ region, count }))
    .sort((x, y) => y.count - x.count);
  const communesSorted = Object.entries(byCommune)
    .map(([label, count]) => ({ label, count }))
    .sort((x, y) => y.count - x.count)
    .slice(0, 30);
  return { byRegion: regionsSorted, topCommunes: communesSorted, parsed, total, coverage: total ? Math.round((parsed / total) * 1000) / 10 : 0 };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} since
 * @param {string} starterTenantName
 */
export async function queryFunnelBusiness(prisma, since, starterTenantName) {
  const sinceArg = since;

  const visitorsRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(DISTINCT ip) AS c FROM PageView
     WHERE createdAt >= ?
       AND path IN ('/', '/corredores', '/precios', '/tenant', '/como-funciona.html', '/contacto.html', '/agendar.html')
       AND ip IS NOT NULL AND ip <> ''`,
    sinceArg
  );
  const visitors = Number(visitorsRows?.[0]?.c || 0);

  const trialRegistered = await prisma.tenant.count({
    where: {
      name: { not: starterTenantName },
      createdAt: { gte: since }
    }
  });

  const cardRegistered = await prisma.tenant.count({
    where: {
      name: { not: starterTenantName },
      OR: [{ trialSubscriptionId: { not: null } }, { mpSubscriptionId: { not: null } }],
      createdAt: { gte: since }
    }
  });

  const firstInspectionTenants = await prisma.$queryRawUnsafe(
    `SELECT COUNT(DISTINCT tenantId) AS c FROM \`Case\`
     WHERE createdAt >= ? AND tenantId IS NOT NULL
       AND tenantId IN (SELECT id FROM Tenant WHERE name <> ?)`,
    sinceArg,
    starterTenantName
  );
  const primeraInspeccion = Number(firstInspectionTenants?.[0]?.c || 0);

  const conversionRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(DISTINCT t.id) AS c FROM Tenant t
     WHERE t.name <> ? AND t.createdAt >= ? AND (
       t.trialConvertedAt IS NOT NULL
       OR EXISTS (SELECT 1 FROM \`Case\` c WHERE c.tenantId = t.id AND c.mercadopagoPaymentId IS NOT NULL AND c.mercadopagoPaymentId NOT LIKE 'demo_%')
       OR EXISTS (SELECT 1 FROM CreditTransaction ct WHERE ct.tenantId = t.id AND ct.type = 'PURCHASE' AND ct.createdAt >= ?)
     )`,
    starterTenantName,
    sinceArg,
    sinceArg
  );
  const conversionPago = Number(conversionRows?.[0]?.c || 0);

  const steps = [
    { key: 'visitantes', label: 'Visitantes (sitio B2B)', count: visitors },
    { key: 'registro_trial', label: 'Nuevas corredoras (periodo)', count: trialRegistered },
    { key: 'tarjeta_mp', label: 'Con trial MP / suscripción MP', count: cardRegistered },
    { key: 'primera_inspeccion', label: 'Con inspección en periodo', count: primeraInspeccion },
    { key: 'conversion', label: 'Conversión (pago / convertido)', count: conversionPago }
  ];

  const rates = [];
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].count || 0;
    const cur = steps[i].count || 0;
    rates.push({
      from: steps[i - 1].key,
      to: steps[i].key,
      pct: prev > 0 ? Math.round((cur / prev) * 1000) / 10 : null
    });
  }

  return { steps, rates, since: sinceArg.toISOString(), disclaimer: 'Funnel estimado: visitantes por IP en rutas B2B; direcciones y conversiones según datos en BD.' };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} since
 */
export async function queryInspectionsDaily(prisma, since) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT DATE(createdAt) AS day,
            COUNT(*) AS total,
            SUM(status = 'DONE') AS doneN
     FROM \`Case\`
     WHERE createdAt >= ?
     GROUP BY DATE(createdAt)
     ORDER BY day ASC`,
    since
  );
  return (rows || []).map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
    total: Number(r.total || 0),
    done: Number(r.doneN || 0)
  }));
}

/**
 * Cantidad de inspecciones (casos) por corredora en el periodo.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} since
 * @param {{ limit?: number }} [opts]
 */
export async function queryInspectionsByTenant(prisma, since, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 100);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT
       c.tenantId AS tenantId,
       COALESCE(NULLIF(TRIM(t.name), ''), '(Sin nombre)') AS tenantName,
       COUNT(*) AS total,
       SUM(c.status = 'DONE') AS doneN,
       SUM(c.status = 'PENDING_APPROVAL') AS pendingN
     FROM \`Case\` c
     LEFT JOIN Tenant t ON t.id = c.tenantId
     WHERE c.createdAt >= ?
       AND c.tenantId IS NOT NULL
     GROUP BY c.tenantId, t.name
     ORDER BY total DESC
     LIMIT ${limit}`,
    since
  );
  return (rows || []).map((r) => ({
    tenantId: r.tenantId ? String(r.tenantId) : null,
    tenantName: String(r.tenantName || '(Sin nombre)'),
    total: Number(r.total || 0),
    done: Number(r.doneN || 0),
    pendingApproval: Number(r.pendingN || 0)
  }));
}

/**
 * Heatmap: día de semana (0=lun ... 6=dom) x hora Chile aprox. (UTC-4 fijo en SQL).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} since
 */
export async function queryInspectionsHeatmap(prisma, since) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT
       (WEEKDAY(CONVERT_TZ(createdAt, '+00:00', '-04:00')) + 7) % 7 AS dow0,
       HOUR(CONVERT_TZ(createdAt, '+00:00', '-04:00')) AS hr,
       COUNT(*) AS c
     FROM \`Case\`
     WHERE createdAt >= ?
     GROUP BY dow0, hr
     ORDER BY dow0, hr`,
    since
  );
  const matrix = {};
  for (let d = 0; d < 7; d++) {
    matrix[d] = {};
    for (let h = 0; h < 24; h++) matrix[d][h] = 0;
  }
  let max = 0;
  for (const r of rows || []) {
    const d = Number(r.dow0);
    const h = Number(r.hr);
    const c = Number(r.c || 0);
    if (d >= 0 && d <= 6 && h >= 0 && h <= 23) {
      matrix[d][h] += c;
      if (matrix[d][h] > max) max = matrix[d][h];
    }
  }
  return {
    matrix,
    max,
    tzNote: 'Hora aproximada Chile (UTC-4 en SQL; puede variar con horario de verano).'
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} since
 */
export async function queryInspectionAddresses(prisma, since) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT p.address AS address
     FROM \`Case\` c
     INNER JOIN Property p ON c.propertyId = p.id
     WHERE c.createdAt >= ? AND p.address IS NOT NULL AND TRIM(p.address) <> ''`,
    since
  );
  return (rows || []).map((r) => String(r.address || '').trim()).filter(Boolean);
}
