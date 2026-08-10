#!/usr/bin/env node
/**
 * Crea/actualiza corredora REMAX PRINCIPAL, acredita créditos y carga agentes ejecutivos.
 *
 * Uso:
 *   node scripts/setup-remax-principal.mjs
 *   node scripts/setup-remax-principal.mjs --credits 50 --password "Remax2026"
 *
 * Producción: setup-remax-principal-prod.ps1
 */
import crypto from 'node:crypto';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

if (process.env.KICKOFF_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.KICKOFF_DATABASE_URL.trim();
}

const TENANT_NAME = 'REMAX PRINCIPAL';
const LEGAL_NAME = 'Inmobiliaria connection Spa';
const RUT = '77865198K';
const TENANT_EMAIL = 'r.ureta@remax-principal.cl';
const TENANT_PHONE = '+56994464804';

const AGENTS = [
  { fullName: 'Yuli Abreu Leon TEAM YOORDLIS', email: 'y.abreu@remax-principal.cl', phone: '+56931770361' },
  { fullName: 'Arnaud Koell TEAM YOORDLIS', email: 'a.koell@remax-principal.cl' },
  { fullName: 'Juanita Muñoz Riquelme TEAM YOORDLIS', email: 'j.munoz@remax-principal.cl' },
  { fullName: 'Luis Fernandez', email: 'l.fernandez@remax-principal.cl' },
  { fullName: 'Marco Iriarte Briceño TEAM INFINITY', email: 'm.iriarte@remax-principal.cl', phone: '+56984283781' },
  { fullName: 'Adriana Calcaño Bastidas', email: 'a.calcano@remax-principal.cl' },
  { fullName: 'Julio Seguic TEAM YOORDLIS', email: 'j.seguic@remax-principal.cl' },
  { fullName: 'Carlos Navarrete TEAM YOORDLIS', email: 'c.navarrete@remax-principal.cl' },
  { fullName: 'Rodrigo Perez TEAM YOORDLIS', email: 'r.perez@remax-principal.cl' },
  { fullName: 'Lorena Contreras Cisneros TEAM INFINITY', email: 'm.contreras@remax-principal.cl' },
  { fullName: 'Susan Benítez Hernández TEAM INFINITY', email: 's.benitez@remax-principal.cl' },
  { fullName: 'Pablo Jose Gariboldi', email: 'p.gariboldi@remax-principal.cl' },
  { fullName: 'Roxana Miranda TEAM YOORDLIS', email: 'r.miranda@remax-principal.cl' },
  { fullName: 'Heriberto Otaiza Parra TEAM YOORDLIS', email: 'h.otaiza@remax-principal.cl' },
  { fullName: 'Luis Bravo', email: 'lf.bravo@remax-principal.cl' },
  { fullName: 'Ramon Tineo Chahin', email: 'r.tineo@remax-principal.cl' },
  { fullName: 'Reina Peña TEAM YOORDLIS', email: 'reina.p@remax-principal.cl' },
  { fullName: 'Maria Fernanda Medina Roa TEAM YOORDLIS', email: 'm.medina@remax-principal.cl' },
  { fullName: 'Felipe Cuevas Quiroz TEAM YOORDLIS', email: 'f.cuevas@remax-principal.cl' },
  { fullName: 'Kattryn Basmadji', email: 'k.basmadji@remax-principal.cl' },
  { fullName: 'Guillermo Hernandez TEAM YOORDLIS', email: 'g.hernandez@remax-principal.cl' },
  { fullName: 'Felipe Levipan TEAM INFINITY', email: 'f.levipan@remax-principal.cl' },
  { fullName: 'Marco Vera Temer Broker Owner', email: 'mvera@remax-principal.cl', phone: '+56997421890', role: 'TENANT_ADMIN' },
  { fullName: 'Yoordlis Guerra Team Leader y Owner', email: 'yguerra@remax-principal.cl', phone: '+56942674002', role: 'TENANT_ADMIN' },
  { fullName: 'Rodolfo Cespedes Salazar TEAM YOORDLIS', email: 'r.cespedes@remax-principal.cl' },
  { fullName: 'Cristian Jerez TEAM YOORDLIS', email: 'c.jerez@remax-principal.cl' },
  { fullName: 'Karen Bitsch TEAM YOORDLIS', email: 'k.bitcsh@remax-principal.cl' },
  {
    fullName: 'Ronald Ureta Melgarejo',
    email: 'r.ureta@remax-principal.cl',
    phone: '+56994464804',
    role: 'TENANT_ADMIN',
  },
  { fullName: 'Christian Araya Carreño TEAM YOORDLIS', email: 'c.araya@remax-principal.cl' },
  { fullName: 'Eliana Yáñez Meneses', email: 'e.yanez@remax-principal.cl' },
  { fullName: 'Victor Becerra Vergara', email: 'a.becerra@remax-principal.cl' },
  { fullName: 'Julio Medina Rosales TEAM INFINITY', email: 'j.medina@remax-principal.cl' },
  { fullName: 'Rafael Guzmán Salazar TEAM YOORDLIS', email: 'r.guzman@remax-principal.cl' },
  { fullName: 'Cristian Silva Corrales', email: 'c.silva@remax-principal.cl' },
  { fullName: 'Luisa Gonzalez', email: 'l.gonzalez@remax-principal.cl', phone: '+56941444874' },
];

function parseArgs() {
  const argv = process.argv.slice(2);
  let credits = 50;
  let password = process.env.REMAX_DEFAULT_PASSWORD || 'Remax2026';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--credits' && argv[i + 1]) credits = Math.floor(Number(argv[++i]));
    if (argv[i] === '--password' && argv[i + 1]) password = argv[++i];
  }
  return { credits, password };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

const prisma = new PrismaClient();

async function upsertTenant(password) {
  let tenant = await prisma.tenant.findFirst({
    where: { OR: [{ name: TENANT_NAME }, { rut: RUT }] },
  });
  const data = {
    name: TENANT_NAME,
    legalName: LEGAL_NAME,
    rut: RUT,
    email: TENANT_EMAIL,
    phone: TENANT_PHONE,
    status: 'ACTIVE',
    passwordHash: hashPassword(password),
  };
  if (tenant) {
    tenant = await prisma.tenant.update({ where: { id: tenant.id }, data });
    console.log(`Tenant actualizado: ${tenant.name} (${tenant.id})`);
  } else {
    tenant = await prisma.tenant.create({ data });
    console.log(`Tenant creado: ${tenant.name} (${tenant.id})`);
  }
  return tenant;
}

async function grantCredits(tenantId, amount) {
  const balance = await prisma.$transaction(async (tx) => {
    await tx.tenantCredit.upsert({
      where: { tenantId },
      create: { tenantId, balance: 0 },
      update: {},
    });
    await tx.tenantCredit.update({
      where: { tenantId },
      data: { balance: { increment: amount } },
    });
    await tx.creditTransaction.create({
      data: {
        tenantId,
        amount,
        type: 'ADJUSTMENT',
        description: `Admin script REMAX PRINCIPAL: +${amount} créditos`,
      },
    });
    const updated = await tx.tenantCredit.findUnique({ where: { tenantId } });
    return updated?.balance ?? amount;
  });
  console.log(`Créditos: +${amount} → balance ${balance}`);
  return balance;
}

async function upsertAgents(tenantId, password) {
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const agent of AGENTS) {
    const email = String(agent.email).trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.tenantId && existing.tenantId !== tenantId) {
      throw new Error(`Email ${email} ya pertenece a otro tenant (${existing.tenantId})`);
    }
    const userData = {
      tenantId,
      email,
      fullName: agent.fullName,
      phone: agent.phone || null,
      role: agent.role || 'TENANT_USER',
      status: 'ACTIVE',
      activatedAt: now,
      invitedAt: now,
      passwordHash: hashPassword(password),
    };
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: userData });
      updated++;
    } else {
      await prisma.user.create({ data: userData });
      created++;
    }
  }
  console.log(`Agentes: ${created} creados, ${updated} actualizados (${AGENTS.length} total)`);
}

async function main() {
  const { credits, password } = parseArgs();
  if (!Number.isFinite(credits) || credits < 1) {
    console.error('Créditos inválidos');
    process.exit(1);
  }
  if (!password || password.length < 6) {
    console.error('La clave debe tener al menos 6 caracteres');
    process.exit(1);
  }

  const tenant = await upsertTenant(password);
  await grantCredits(tenant.id, credits);
  await upsertAgents(tenant.id, password);

  console.log('\n=== REMAX PRINCIPAL listo ===');
  console.log(`Panel corredora: ${TENANT_EMAIL} / ${password}`);
  console.log(`App ejecutivos: mismo email + clave por agente`);
  console.log(`Créditos acreditados: ${credits}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
