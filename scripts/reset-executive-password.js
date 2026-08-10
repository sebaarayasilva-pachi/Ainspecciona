#!/usr/bin/env node
/**
 * Restablece la contraseña de un usuario ejecutivo (app Capture) por email.
 * Uso: node scripts/reset-executive-password.js <email> <nueva-clave> [--force]
 *   --force  omite la validación de fortaleza (solo uso operativo; claves débiles son riesgo).
 * Requiere: Cloud SQL Proxy corriendo y DATABASE_URL configurado.
 *
 * Si el usuario está PENDING, lo deja ACTIVE para que pueda iniciar sesión.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'node:crypto';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function validatePasswordStrength(pwd) {
  if (!pwd || pwd.length < 8) return { ok: false, msg: 'Mínimo 8 caracteres' };
  if (!/[A-Z]/.test(pwd)) return { ok: false, msg: 'Debe tener al menos 1 mayúscula' };
  if (!/[0-9]/.test(pwd)) return { ok: false, msg: 'Debe tener al menos 1 número' };
  return { ok: true };
}

const forceWeak = process.argv.includes('--force');
const args = process.argv.slice(2).filter((a) => a !== '--force');
const email = args[0]?.trim()?.toLowerCase();
const newPassword = args[1];

if (!email || !newPassword) {
  console.error('Uso: node scripts/reset-executive-password.js <email> <nueva-clave> [--force]');
  console.error('Ejemplo: node scripts/reset-executive-password.js benjamin@ejemplo.com MiClave1');
  process.exit(1);
}

const pwdCheck = validatePasswordStrength(newPassword);
if (!pwdCheck.ok && !forceWeak) {
  console.error(pwdCheck.msg);
  console.error('(Usa --force solo si aceptas una clave débil por política operativa.)');
  process.exit(1);
}
if (!pwdCheck.ok && forceWeak) {
  console.warn('Advertencia: clave sin requisitos de fortaleza (--force).');
}

const prisma = new PrismaClient();

/** Tabla `User` solo por SQL (evita desajuste Prisma/BD en columnas extra). */
async function resolveUserByEmail(e) {
  const rows = await prisma.$queryRaw`
    SELECT id, email, fullName, status, tenantId
    FROM ${Prisma.raw('`User`')}
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(${e}))
    LIMIT 1
  `;
  const row = Array.isArray(rows) && rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status,
    tenantId: row.tenantId
  };
}

async function main() {
  const user = await resolveUserByEmail(email);
  if (!user) {
    console.error(`No se encontró usuario ejecutivo con email: ${email}`);
    const total = await prisma.user.count();
    console.error(`En esta conexión, la tabla User tiene ${total} fila(s).`);
    if (total > 0) {
      const sample = await prisma.$queryRaw`
        SELECT email, fullName FROM ${Prisma.raw('`User`')} ORDER BY createdAt DESC LIMIT 30
      `;
      console.error('Muestra de correos en esta misma BD:');
      (Array.isArray(sample) ? sample : []).forEach((r) =>
        console.error(`  - "${r.email}" (${r.fullName})`)
      );
    } else {
      console.error(
        'Si en ainspecciona.com sí ves usuarios, esta URL no es la BD de producción (revisa proxy, nombre de base en DATABASE_URL y proyecto gcloud).'
      );
    }
    process.exit(1);
  }

  const passwordHash = hashPassword(newPassword);
  const userTable = Prisma.raw('`User`');
  if (user.status !== 'ACTIVE') {
    await prisma.$executeRaw`
      UPDATE ${userTable}
      SET
        passwordHash = ${passwordHash},
        mustChangePassword = false,
        status = 'ACTIVE',
        activatedAt = COALESCE(activatedAt, NOW(3)),
        invitedAt = COALESCE(invitedAt, NOW(3))
      WHERE id = ${user.id}
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE ${userTable}
      SET passwordHash = ${passwordHash}, mustChangePassword = false
      WHERE id = ${user.id}
    `;
  }

  const loginEmail = String(user.email || email).trim();
  console.log(
    `Clave actualizada para ${loginEmail} (${user.fullName}). Estado: ACTIVE. Puede entrar a Capture con ese correo y la nueva clave.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
