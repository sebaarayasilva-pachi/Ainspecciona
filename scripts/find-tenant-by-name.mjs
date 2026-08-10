#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

if (process.env.KICKOFF_DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = process.env.KICKOFF_DATABASE_URL.trim();
}

const q = (process.argv[2] || '').trim().toLowerCase();
const prisma = new PrismaClient();

const rows = await prisma.tenant.findMany({
  select: { id: true, name: true, status: true, email: true },
  orderBy: { createdAt: 'desc' },
  take: 200
});
const hit = rows.filter((t) => String(t.name || '').toLowerCase().includes(q));
console.log(JSON.stringify(hit, null, 2));
await prisma.$disconnect();
