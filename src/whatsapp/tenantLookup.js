/**
 * Intenta vincular waId (solo dígitos, ej. 569...) con Tenant.phone almacenado.
 */

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

export async function findTenantIdByWaId(prisma, waId) {
  const d = digitsOnly(waId);
  if (d.length < 8) return null;

  const tenants = await prisma.tenant.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true, name: true, status: true }
  });

  for (const t of tenants) {
    const tp = digitsOnly(t.phone);
    if (!tp) continue;
    if (d === tp || d.endsWith(tp) || tp.endsWith(d)) {
      return { tenantId: t.id, tenantName: t.name, tenantStatus: t.status };
    }
  }
  return null;
}
