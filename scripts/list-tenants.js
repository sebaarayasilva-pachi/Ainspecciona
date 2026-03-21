#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
console.log('Tenants en la base de datos:');
tenants.forEach(t => console.log(`  - ${t.email || '(sin email)'} | ${t.name} | id: ${t.id}`));
await prisma.$disconnect();
