/**
 * Cliente mínimo SimpleFactura (API REST).
 * Formato de cuerpo alineado al SDK oficial (RequestDTE / Documento).
 * Documentación: https://www.simplefactura.cl/Soluciones/Desarrolladores
 */

const DEFAULT_BASE = 'https://api.simplefactura.cl';

/** @type {{ token: string | null, expiresAtMs: number }} */
const tokenCache = { token: null, expiresAtMs: 0 };

function envBool(name, defaultVal = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultVal;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

export function isSimpleFacturaConfigured() {
  if (envBool('SIMPLEFACTURA_DISABLED', false)) return false;
  const email = process.env.SIMPLEFACTURA_EMAIL || process.env.SF_USERNAME;
  const password = process.env.SIMPLEFACTURA_PASSWORD || process.env.SF_PASSWORD;
  const rut = process.env.SIMPLEFACTURA_RUT_EMISOR;
  const rzn = process.env.SIMPLEFACTURA_RZN_SOC;
  const giro = process.env.SIMPLEFACTURA_GIRO_EMIS;
  const dir = process.env.SIMPLEFACTURA_DIR_ORIGEN;
  const cmna = process.env.SIMPLEFACTURA_CMNA_ORIGEN;
  return !!(email && password && rut && rzn && giro && dir && cmna);
}

function baseUrl() {
  return (process.env.SIMPLEFACTURA_BASE_URL || process.env.SF_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

function sucursal() {
  return process.env.SIMPLEFACTURA_SUCURSAL || process.env.SF_SUCURSAL || 'Casa Matriz';
}

/** Segmento de URL para `invoiceV2/{sucursal}`: la doc indica espacios → `_` (ej. Casa_Matriz). */
function sucursalPathSegment() {
  return sucursal().trim().replace(/\s+/g, '_');
}

/** 0 = certificación/QA, 1 = producción (SimpleFactura `dteReferenciadoExterno.ambiente`). */
function ambienteDte() {
  const v = process.env.SIMPLEFACTURA_AMBIENTE;
  if (v === '1' || v === 'PROD' || v === 'production') return 1;
  return 0;
}

/** RUT chileno sin puntos, con guión antes del DV */
export function normalizeRutForDte(rut) {
  const s = String(rut || '')
    .trim()
    .replace(/\./g, '')
    .replace(/-/g, '');
  if (s.length < 2) return String(rut || '').trim();
  const body = s.slice(0, -1);
  const dv = s.slice(-1);
  return `${body}-${dv}`;
}

function splitIvaFromTotal(montoTotalClp) {
  const total = Math.max(0, Math.round(Number(montoTotalClp)));
  const neto = Math.round(total / 1.19);
  const iva = total - neto;
  return { total, neto, iva };
}

function buildEmisor() {
  const actecoRaw = process.env.SIMPLEFACTURA_ACTECO || '';
  const acteco = actecoRaw
    ? actecoRaw
        .split(/[,;\s]+/)
        .map((x) => parseInt(x, 10))
        .filter((n) => !Number.isNaN(n))
    : [];
  return {
    RUTEmisor: normalizeRutForDte(process.env.SIMPLEFACTURA_RUT_EMISOR),
    RznSoc: process.env.SIMPLEFACTURA_RZN_SOC || '',
    GiroEmis: process.env.SIMPLEFACTURA_GIRO_EMIS || '',
    Telefono: [],
    CorreoEmisor: process.env.SIMPLEFACTURA_CORREO_EMISOR || '',
    Acteco: acteco,
    DirOrigen: process.env.SIMPLEFACTURA_DIR_ORIGEN || '',
    CmnaOrigen: process.env.SIMPLEFACTURA_CMNA_ORIGEN || '',
    CiudadOrigen: process.env.SIMPLEFACTURA_CIUDAD_ORIGEN || ''
  };
}

/**
 * tipoDte en JSON del cliente (33 factura, 39 boleta) gana sobre `opts.tipoDte` / env.
 * @param {object} [opts] — { tipoDte?: number, indServicio?: number }
 */
export function buildBoletaRequestDte(
  facturacion,
  montoTotalClp,
  lineDescription = 'Suscripción / plan Business Ainspecciona',
  opts = {}
) {
  const { total, neto, iva } = splitIvaFromTotal(montoTotalClp);
  const hoy = new Date();
  const fch = hoy.toISOString().slice(0, 10);
  const tipoDte = Number(
    facturacion?.tipoDte ?? facturacion?.tipoDTE ?? opts.tipoDte ?? process.env.SIMPLEFACTURA_TIPO_DTE ?? 39
  );
  const indServicio = Number(opts.indServicio ?? process.env.SIMPLEFACTURA_IND_SERVICIO ?? 3);

  const receptor = {
    RUTRecep: normalizeRutForDte(facturacion.rut),
    RznSocRecep: String(facturacion.razonSocial || '').slice(0, 100),
    CorreoRecep: String(facturacion.email || '').slice(0, 80),
    DirRecep: String(facturacion.direccion || '').slice(0, 80),
    CmnaRecep: String(facturacion.comuna || '').slice(0, 20),
    CiudadRecep: String(facturacion.ciudad || '').slice(0, 20),
    GiroRecep: String(facturacion.giro || '').slice(0, 40)
  };

  const detalle = [
    {
      NroLinDet: 1,
      NmbItem: lineDescription.slice(0, 80),
      CdgItem: [{ TpoCodigo: 'INT', VlrCodigo: '1' }],
      QtyItem: 1,
      UnmdItem: 'UN',
      PrcItem: neto,
      MontoItem: neto
    }
  ];

  const totales = {
    TpoMoneda: 200,
    MntNeto: neto,
    TasaIVA: '19',
    IVA: iva,
    MntTotal: total
  };

  return {
    Documento: {
      Encabezado: {
        IdDoc: {
          TipoDTE: tipoDte,
          FchEmis: fch,
          FchVenc: fch,
          IndServicio: indServicio,
          // Doc: montos netos en detalle/totales → IndMntNeto = 2 (por defecto API asume bruto)
          IndMntNeto: 2
        },
        Emisor: buildEmisor(),
        Receptor: receptor,
        Totales: totales
      },
      Detalle: detalle
    }
  };
}

async function getAccessToken(log) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAtMs > now + 60_000) {
    return tokenCache.token;
  }
  const email = process.env.SIMPLEFACTURA_EMAIL || process.env.SF_USERNAME;
  const password = process.env.SIMPLEFACTURA_PASSWORD || process.env.SF_PASSWORD;
  const res = await fetch(`${baseUrl()}/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText;
    throw new Error(`SimpleFactura token ${res.status}: ${msg}`);
  }
  // API oficial (documentación): access_token, expires_at, expires_in · SDK Python: accessToken, expiresAt
  const accessToken = data.access_token ?? data.accessToken;
  const expiresAtStr = data.expires_at ?? data.expiresAt;
  const expiresInSec = data.expires_in != null ? Number(data.expires_in) : null;
  if (!accessToken) {
    throw new Error('SimpleFactura token: respuesta sin access_token / accessToken');
  }
  let expiresAtMs;
  if (expiresAtStr) {
    expiresAtMs = Date.parse(String(expiresAtStr).replace('Z', '+00:00'));
  } else if (expiresInSec != null && !Number.isNaN(expiresInSec)) {
    expiresAtMs = now + expiresInSec * 1000;
  } else {
    expiresAtMs = now + 24 * 3600_000;
  }
  if (Number.isNaN(expiresAtMs)) {
    expiresAtMs = now + 24 * 3600_000;
  }
  tokenCache.token = accessToken;
  tokenCache.expiresAtMs = expiresAtMs;
  log?.info?.('simplefactura-token-ok');
  return accessToken;
}

/**
 * Emite boleta/factura electrónica (invoiceV2).
 * @param {number} [tipoDteDefault] — si `facturacion` no trae tipoDte (p. ej. 39 boleta, 33 factura).
 * @returns {{ ok: boolean, tipoDte: number, folio: number | null, raw: object }}
 */
export async function emitBoletaElectronica({
  log,
  facturacion,
  montoTotalClp,
  lineDescription,
  tipoDteDefault = 39
}) {
  if (!isSimpleFacturaConfigured()) {
    throw new Error('SimpleFactura no configurado');
  }
  const resolvedTipoDte = Number(facturacion?.tipoDte ?? facturacion?.tipoDTE ?? tipoDteDefault);
  const body = buildBoletaRequestDte(facturacion, montoTotalClp, lineDescription, { tipoDte: resolvedTipoDte });
  const token = await getAccessToken(log);
  const branchSeg = sucursalPathSegment();
  let path = `${baseUrl()}/invoiceV2/${encodeURIComponent(branchSeg)}`;
  if (envBool('SIMPLEFACTURA_INVOICE_VALIDA_MONTOS', false)) {
    path += '/validaMontos';
  }
  const url = path;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { parseError: true, text: text.slice(0, 500) };
  }
  if (!res.ok) {
    const msg = json?.message || json?.Message || text.slice(0, 500);
    const detail =
      json?.detail ??
      json?.details ??
      json?.error ??
      json?.errors ??
      json?.data?.errors ??
      null;
    const detailTxt = detail ? ` | detail=${JSON.stringify(detail).slice(0, 1200)}` : '';
    throw new Error(`SimpleFactura invoiceV2 ${res.status}: ${msg}${detailTxt}`);
  }
  const data = json?.data ?? json;
  const folio = data?.folio ?? data?.Folio ?? null;
  const tipoDte = data?.tipoDTE ?? data?.TipoDTE ?? resolvedTipoDte;
  log?.info?.({ folio, tipoDte, branch: branchSeg }, 'simplefactura-emission-ok');
  return { ok: true, tipoDte, folio: folio != null ? Number(folio) : null, raw: json };
}

/**
 * PDF del DTE ya emitido.
 * Documentación oficial: POST /dte/pdf con `credenciales` + `dteReferenciadoExterno` (folio, codigoTipoDte, ambiente).
 * Los parámetros facturacion/montoTotalClp/lineDescription se ignoran (compat. con llamadas existentes).
 */
export async function fetchDtePdfBuffer({
  log,
  facturacion: _f,
  montoTotalClp: _m,
  folio,
  tipoDte,
  lineDescription: _l
}) {
  if (!isSimpleFacturaConfigured()) return null;
  if (folio == null || Number.isNaN(Number(folio))) return null;
  if (envBool('SIMPLEFACTURA_SKIP_PDF', false)) return null;

  const codigoTipoDte = Number(
    tipoDte ?? process.env.SIMPLEFACTURA_TIPO_DTE ?? 39
  );
  const rutEmisor = normalizeRutForDte(process.env.SIMPLEFACTURA_RUT_EMISOR);
  const nombreSucursal = sucursal();

  const body = {
    credenciales: {
      rutEmisor,
      nombreSucursal
    },
    dteReferenciadoExterno: {
      folio: Number(folio),
      codigoTipoDte,
      ambiente: ambienteDte()
    }
  };

  const token = await getAccessToken(log);
  const res = await fetch(`${baseUrl()}/dte/pdf`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/pdf, application/json'
    },
    body: JSON.stringify(body)
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const looksPdf = buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

  if (!res.ok) {
    const errText = buf.length ? buf.toString('utf8').slice(0, 500) : res.statusText;
    throw new Error(`SimpleFactura dte/pdf ${res.status}: ${errText}`);
  }
  if (!looksPdf && (ct.includes('application/json') || (buf.length && buf[0] === 0x7b))) {
    let j;
    try {
      j = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new Error('SimpleFactura dte/pdf: respuesta no PDF');
    }
    throw new Error(`SimpleFactura dte/pdf: ${j?.message || JSON.stringify(j).slice(0, 300)}`);
  }
  return buf;
}
