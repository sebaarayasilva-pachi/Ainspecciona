/**
 * Alta de Organization desde Control (+ admin opcional + productos).
 */
import { hashPassword } from '../auth/passwords.js';
import {
  upsertOrg,
  ensureProduct,
  ensureMember,
  upsertPlatformUser,
  ensureLink
} from '../auth/legacyBridge.js';
import { PLATFORM_PRODUCTS } from '../products.js';
import { provisionProductAccess } from './provisionProduct.js';

const ORG_TYPES = new Set([
  'DEVELOPER',
  'BROKER',
  'PROPERTY_MANAGER',
  'INTERNAL',
  'OTHER'
]);

export function slugifyOrgName(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || `org-${Date.now().toString(36)}`;
}

async function uniqueSlug(prisma, desired) {
  let slug = slugifyOrgName(desired).slice(0, 64);
  if (!slug) slug = `org-${Date.now().toString(36)}`;
  let candidate = slug;
  let n = 0;
  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    n += 1;
    const suffix = `-${n}`;
    candidate = (slug.slice(0, 64 - suffix.length) + suffix).slice(0, 64);
  }
  return candidate;
}

async function ensureCaptureTenant(prisma, { name, email, passwordHash, rut }) {
  let tenant = email
    ? await prisma.tenant.findFirst({ where: { email } })
    : null;
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name,
        email: email || null,
        rut: rut || null,
        passwordHash: passwordHash || null,
        status: 'ACTIVE',
        mustChangePassword: false
      }
    });
  } else {
    tenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        name: tenant.name || name,
        status: 'ACTIVE',
        passwordHash: passwordHash || tenant.passwordHash,
        rut: rut || tenant.rut,
        mustChangePassword: false
      }
    });
  }
  const credit = await prisma.tenantCredit.findUnique({ where: { tenantId: tenant.id } });
  if (!credit) {
    await prisma.tenantCredit.create({ data: { tenantId: tenant.id, balance: 0 } });
  }
  return tenant;
}

/**
 * @param {object} body
 * @returns {Promise<{ ok: true, organization: object, admin?: object, provisioned: object[] } | { ok: false, error: string, message: string }>}
 */
export async function createOrganizationFromControl(prisma, body = {}) {
  const name = String(body.name || '').trim();
  if (!name) {
    return { ok: false, error: 'MISSING_NAME', message: 'Nombre de organización requerido.' };
  }

  let type = String(body.type || 'BROKER').toUpperCase();
  if (!ORG_TYPES.has(type)) type = 'BROKER';

  const rut = body.rut != null ? String(body.rut).trim() || null : null;
  const slug = body.slug
    ? await uniqueSlug(prisma, String(body.slug).trim())
    : await uniqueSlug(prisma, name);

  const products = Array.isArray(body.products)
    ? [...new Set(body.products.map((p) => String(p).toUpperCase()).filter((p) => PLATFORM_PRODUCTS[p]))]
    : [];

  const adminEmail = body.adminEmail
    ? String(body.adminEmail).trim().toLowerCase()
    : '';
  const adminName = String(body.adminName || name).trim() || name;
  const adminPassword = body.adminPassword != null ? String(body.adminPassword) : '';

  if (adminEmail && !adminPassword) {
    return {
      ok: false,
      error: 'MISSING_ADMIN_PASSWORD',
      message: 'Si indicas email de admin, también debes indicar contraseña.'
    };
  }
  if (adminPassword && adminPassword.length < 8) {
    return {
      ok: false,
      error: 'WEAK_PASSWORD',
      message: 'La contraseña del admin debe tener al menos 8 caracteres.'
    };
  }

  const org = await upsertOrg(prisma, { slug, name, type });
  if (rut) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { rut, status: 'ACTIVE' }
    });
  } else {
    await prisma.organization.update({
      where: { id: org.id },
      data: { status: 'ACTIVE' }
    });
  }

  let admin = null;
  let passwordHash = null;
  if (adminEmail) {
    passwordHash = hashPassword(adminPassword);
    admin = await upsertPlatformUser(prisma, {
      email: adminEmail,
      fullName: adminName,
      passwordHash,
      isPlatformAdmin: false
    });
    await ensureMember(prisma, org.id, admin.id, 'ORGANIZATION_ADMIN');
  }

  const provisioned = [];

  // Capture primero si aplica (otros productos reutilizan members).
  if (products.includes('INSPECTION') && admin && passwordHash) {
    const tenant = await ensureCaptureTenant(prisma, {
      name,
      email: adminEmail,
      passwordHash,
      rut
    });
    await ensureProduct(prisma, org.id, 'INSPECTION');
    let captureUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (captureUser) {
      captureUser = await prisma.user.update({
        where: { id: captureUser.id },
        data: {
          tenantId: tenant.id,
          fullName: adminName,
          passwordHash,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
          mustChangePassword: false,
          activatedAt: captureUser.activatedAt || new Date()
        }
      });
    } else {
      captureUser = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: adminEmail,
          fullName: adminName,
          passwordHash,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
          mustChangePassword: false,
          activatedAt: new Date()
        }
      });
    }
    await ensureLink(prisma, {
      platformUserId: admin.id,
      organizationId: org.id,
      product: 'INSPECTION',
      legacyTenantId: tenant.id,
      legacyUserId: captureUser.id
    });
    provisioned.push({ product: 'INSPECTION', ok: true, legacyTenantId: tenant.id });
  } else if (products.includes('INSPECTION')) {
    await ensureProduct(prisma, org.id, 'INSPECTION');
    provisioned.push({
      product: 'INSPECTION',
      ok: false,
      message: 'Producto ENABLED; falta admin para crear Tenant Capture y link.'
    });
  }

  for (const product of products) {
    if (product === 'INSPECTION') continue;
    await ensureProduct(prisma, org.id, product);
    if (!admin) {
      provisioned.push({
        product,
        ok: false,
        message: 'Producto ENABLED; falta admin para crear link legacy.'
      });
      continue;
    }
    const result = await provisionProductAccess(prisma, org, product);
    provisioned.push(result);
  }

  const fresh = await prisma.organization.findUnique({
    where: { id: org.id },
    include: {
      products: true,
      _count: { select: { members: true, links: true } }
    }
  });

  return {
    ok: true,
    organization: {
      id: fresh.id,
      slug: fresh.slug,
      name: fresh.name,
      type: fresh.type,
      status: fresh.status,
      rut: fresh.rut,
      memberCount: fresh._count.members,
      linkCount: fresh._count.links,
      products: fresh.products.map((p) => ({
        product: p.product,
        status: p.status
      }))
    },
    admin: admin
      ? { id: admin.id, email: admin.email, fullName: admin.fullName }
      : null,
    provisioned
  };
}
