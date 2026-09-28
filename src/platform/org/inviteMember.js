/**
 * Invita a un miembro de la organización y lo provisiona en todos
 * los productos ENABLED (no salta si la org ya tenía links).
 */
import { hashPassword } from '../auth/passwords.js';
import { upsertPlatformUser, ensureMember } from '../auth/legacyBridge.js';
import { provisionProductAccess } from '../control/provisionProduct.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} orgId
 * @param {{ email: string, password: string, fullName?: string, role?: string }} input
 */
export async function inviteOrgMember(prisma, orgId, input) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    return { ok: false, error: 'NOT_FOUND', message: 'Organización no encontrada.' };
  }

  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const fullName = String(input.fullName || '').trim() || email.split('@')[0] || email;
  const role = String(input.role || 'MEMBER').toUpperCase();

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

  const existingUser = await prisma.platformUser.findUnique({
    where: { email },
    include: { memberships: { where: { status: 'ACTIVE' } } }
  });
  if (existingUser) {
    const other = (existingUser.memberships || []).filter((m) => m.organizationId !== orgId);
    if (other.length) {
      return {
        ok: false,
        error: 'OTHER_ORG',
        message: 'Ese email ya pertenece a otra organización. Pide a Control que lo mueva.'
      };
    }
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
    const result = await provisionProductAccess(prisma, org, row.product);
    provisioned.push(result);
  }

  const linkedNow = provisioned.filter((p) => p.ok).length;
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
        ? `Usuario agregado y habilitado en ${linkedNow} módulo(s).`
        : 'Usuario agregado. Si un módulo no aparece, pide a Control que lo vincule.'
  };
}
