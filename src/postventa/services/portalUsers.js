/**
 * Mantenedor de usuarios del portal Postventa (inspectores / ops).
 */
import { hashPassword } from '../auth/portalAuth.js';

const ROLES = ['ADMIN', 'EXECUTIVE', 'OPERATOR', 'INSPECTOR'];
const ROLE_LABELS = {
  ADMIN: 'Administrador',
  EXECUTIVE: 'Ejecutivo',
  OPERATOR: 'Operador',
  INSPECTOR: 'Inspector'
};

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role] || u.role,
    status: u.status,
    createdAt: u.createdAt?.toISOString?.() || null
  };
}

function normalizeRole(role) {
  const r = String(role || '').trim().toUpperCase();
  return ROLES.includes(r) ? r : null;
}

function canManageUsers(role) {
  return role === 'ADMIN' || role === 'EXECUTIVE';
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} tenantId
 */
export async function listPortalUsers(prisma, tenantId) {
  const users = await prisma.pvUser.findMany({
    where: { tenantId },
    orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      createdAt: true
    }
  });
  return {
    ok: true,
    roles: ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r] })),
    users: users.map(publicUser)
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} tenantId
 * @param {{ email?: string, fullName?: string, role?: string, password?: string }} body
 * @param {{ actorRole?: string }} [opts]
 */
export async function createPortalUser(prisma, tenantId, body, opts = {}) {
  if (!canManageUsers(opts.actorRole)) {
    return {
      ok: false,
      status: 403,
      error: 'FORBIDDEN',
      message: 'Solo un administrador o ejecutivo puede crear usuarios.'
    };
  }

  const email = String(body?.email || '').trim().toLowerCase();
  const fullName = String(body?.fullName || '').trim();
  const password = String(body?.password || '');
  const role = normalizeRole(body?.role) || 'INSPECTOR';

  if (!email || !fullName || !password) {
    return {
      ok: false,
      status: 400,
      error: 'MISSING_FIELDS',
      message: 'Nombre, email y clave son obligatorios.'
    };
  }
  if (password.length < 8) {
    return {
      ok: false,
      status: 400,
      error: 'WEAK_PASSWORD',
      message: 'La clave debe tener al menos 8 caracteres.'
    };
  }
  if (!normalizeRole(role)) {
    return { ok: false, status: 400, error: 'INVALID_ROLE', message: 'Rol inválido.' };
  }

  const exists = await prisma.pvUser.findUnique({ where: { email } });
  if (exists) {
    return {
      ok: false,
      status: 409,
      error: 'EMAIL_EXISTS',
      message: 'Ya existe un usuario con ese email.'
    };
  }

  const user = await prisma.pvUser.create({
    data: {
      tenantId,
      email,
      fullName,
      role,
      status: 'ACTIVE',
      passwordHash: hashPassword(password)
    }
  });

  return { ok: true, user: publicUser(user) };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} tenantId
 * @param {string} userId
 * @param {{ fullName?: string, role?: string, status?: string, password?: string }} body
 * @param {{ actorRole?: string, actorUserId?: string }} [opts]
 */
export async function updatePortalUser(prisma, tenantId, userId, body, opts = {}) {
  if (!canManageUsers(opts.actorRole)) {
    return {
      ok: false,
      status: 403,
      error: 'FORBIDDEN',
      message: 'Solo un administrador o ejecutivo puede editar usuarios.'
    };
  }

  const id = String(userId || '').trim();
  const target = await prisma.pvUser.findFirst({ where: { id, tenantId } });
  if (!target) {
    return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Usuario no encontrado.' };
  }

  const isSelf = opts.actorUserId && opts.actorUserId === target.id;
  /** @type {Record<string, unknown>} */
  const data = {};

  if (body?.fullName != null) {
    const fullName = String(body.fullName).trim();
    if (!fullName) {
      return { ok: false, status: 400, error: 'INVALID_NAME', message: 'Nombre inválido.' };
    }
    data.fullName = fullName;
  }

  if (body?.role != null) {
    if (isSelf) {
      return {
        ok: false,
        status: 400,
        error: 'SELF_ROLE',
        message: 'No puedes cambiar tu propio rol.'
      };
    }
    const role = normalizeRole(body.role);
    if (!role) {
      return { ok: false, status: 400, error: 'INVALID_ROLE', message: 'Rol inválido.' };
    }
    data.role = role;
  }

  if (body?.status != null) {
    if (isSelf) {
      return {
        ok: false,
        status: 400,
        error: 'SELF_STATUS',
        message: 'No puedes desactivar tu propia cuenta.'
      };
    }
    const status = String(body.status).trim().toUpperCase();
    if (status !== 'ACTIVE' && status !== 'DISABLED') {
      return { ok: false, status: 400, error: 'INVALID_STATUS', message: 'Estado inválido.' };
    }
    if (status === 'DISABLED' && target.role === 'ADMIN') {
      const otherAdmins = await prisma.pvUser.count({
        where: { tenantId, role: 'ADMIN', status: 'ACTIVE', NOT: { id: target.id } }
      });
      if (otherAdmins === 0) {
        return {
          ok: false,
          status: 400,
          error: 'LAST_ADMIN',
          message: 'No puedes desactivar al único administrador activo.'
        };
      }
    }
    data.status = status;
  }

  if (body?.password != null && String(body.password).length) {
    const password = String(body.password);
    if (password.length < 8) {
      return {
        ok: false,
        status: 400,
        error: 'WEAK_PASSWORD',
        message: 'La clave debe tener al menos 8 caracteres.'
      };
    }
    data.passwordHash = hashPassword(password);
  }

  if (!Object.keys(data).length) {
    return { ok: false, status: 400, error: 'NO_CHANGES', message: 'Sin cambios.' };
  }

  const user = await prisma.pvUser.update({ where: { id: target.id }, data });
  return { ok: true, user: publicUser(user) };
}

export { ROLES, ROLE_LABELS, canManageUsers };
