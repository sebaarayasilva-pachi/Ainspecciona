/**
 * Agrega (o reasigna) un admin a una organización y re-provisiona productos ENABLED sin link.
 */
import { hashPassword } from '../auth/passwords.js';
import { upsertPlatformUser, ensureMember } from '../auth/legacyBridge.js';
import { provisionProductAccess } from './provisionProduct.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} orgId
 * @param {{ email: string, password: string, fullName?: string, role?: string }} input
 */
export async function addOrganizationMember(prisma, orgId, input) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return { ok: false, error: 'NOT_FOUND', message: 'Organización no encontrada.' };
  }

  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const fullName = String(input.fullName || '').trim() || email.split('@')[0] || email;
  const role = String(input.role || 'ORGANIZATION_ADMIN').toUpperCase();

  if (!email || !email.includes('@')) {
    return { ok: false, error: 'INVALID_EMAIL', message: 'Email inválido.' };
  }
  if (password.length < 8) {
    return {
      ok: false,
      error: 'WEAK_PASSWORD',
      message: 'La contraseña debe tener al menos 8 caracteres.'
    };
  }
  if (!['ORGANIZATION_ADMIN', 'MEMBER'].includes(role)) {
    return { ok: false, error: 'INVALID_ROLE', message: 'Rol inválido.' };
  }

  const passwordHash = hashPassword(password);
  const user = await upsertPlatformUser(prisma, {
    email,
    fullName,
    passwordHash,
    isPlatformAdmin: false
  });

  await ensureMember(prisma, org.id, user.id, role);

  const enabledProducts = await prisma.organizationProduct.findMany({
    where: { organizationId: org.id, status: 'ENABLED' }
  });

  const provisioned = [];
  for (const row of enabledProducts) {
    const linkCount = await prisma.legacyIdentityLink.count({
      where: { organizationId: org.id, product: row.product }
    });
    if (linkCount > 0) {
      provisioned.push({ product: row.product, ok: true, skipped: true, message: 'Ya tenía link' });
      continue;
    }
    const result = await provisionProductAccess(prisma, org, row.product);
    provisioned.push(result);
  }

  const linkedNow = provisioned.filter((p) => p.ok && p.skipped !== true).length;
  return {
    ok: true,
    member: {
      userId: user.id,
      email,
      fullName,
      role
    },
    provisioned,
    message:
      linkedNow > 0
        ? `Miembro agregado. Se vincularon ${linkedNow} producto(s).`
        : 'Miembro agregado. Si hay productos activos sin link, usa Vincular en cada uno.'
  };
}
