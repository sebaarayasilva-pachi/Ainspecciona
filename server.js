import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

import { createStorage } from './src/storage/storage.js';
import { registerCaptureRoutes } from './src/routes/capture.js';
import { getCaseSummary } from './src/routes/caseSummary.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();
const storage = createStorage();

const PORT = Number(process.env.PORT || 3000);

function safeExtFromMime(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };
  return map[String(mime || '').toLowerCase()] || null;
}

function slotGroupFromSlotCode(code = '') {
  const c = String(code || '').toUpperCase();
  if (c.startsWith('BATHROOM_')) return 'BATHROOM';
  return 'GENERAL';
}

async function analyzeImageBufferV1({ buffer }) {
  const meta = await sharp(buffer).metadata().catch(() => ({}));
  const width = meta.width || 0;
  const height = meta.height || 0;

  if (width < 800 || height < 600) {
    return {
      meta: { width, height },
      problem: {
        code: 'PHOTO_TOO_SMALL',
        severity: 'medium',
        confidence: 0.95,
        message: 'La imagen es demasiado pequeña. Se recomienda una resolución mínima de 800x600 píxeles.',
        debug: { width, height }
      }
    };
  }

  const stats = await sharp(buffer).stats().catch(() => null);
  const mean = stats?.channels?.[0]?.mean ?? 0;
  if (mean < 35) {
    return {
      meta: { width, height },
      problem: {
        code: 'PHOTO_TOO_DARK',
        severity: 'medium',
        confidence: 0.9,
        message: 'La imagen está muy oscura. Enciende luces o usa flash.',
        debug: { mean }
      }
    };
  }

  return {
    meta: { width, height },
    problem: {
      code: 'OK',
      severity: 'low',
      confidence: 0.9,
      message: 'Imagen válida.'
    }
  };
}

function slotGroupTitleFromCode(slotCode = '') {
  const code = String(slotCode || '').toUpperCase();
  if (code.startsWith('BATHROOM_1_')) return { groupKey: 'BATH_MAIN', groupTitle: 'Baño principal' };
  if (code.startsWith('BATHROOM_2_')) return { groupKey: 'BATH_SECONDARY', groupTitle: 'Baño secundario' };
  if (code.startsWith('KITCHEN_')) return { groupKey: 'KITCHEN', groupTitle: 'Cocina' };
  if (code.startsWith('LAUNDRY_')) return { groupKey: 'LAUNDRY', groupTitle: 'Loggia' };
  if (code.startsWith('LIVING_')) return { groupKey: 'LIVING', groupTitle: 'Living' };
  if (code.startsWith('BEDROOM_1_')) return { groupKey: 'BEDROOM_1', groupTitle: 'Dormitorio 1' };
  if (code.startsWith('BEDROOM_2_')) return { groupKey: 'BEDROOM_2', groupTitle: 'Dormitorio 2' };
  if (code.startsWith('BEDROOM_3_')) return { groupKey: 'BEDROOM_3', groupTitle: 'Dormitorio 3' };
  if (code.startsWith('ELECTRICAL_')) return { groupKey: 'ELECTRICAL', groupTitle: 'Electricidad' };
  return { groupKey: 'OTHER', groupTitle: 'Otros' };
}

function buildInstruction({ indicaciones, donde, que }) {
  return [
    `Indicaciones:`,
    `Dónde sacar la foto: ${donde}`,
    `Qué buscar: ${que}`
  ].join('\n');
}

function buildPhotoPlanV1(input) {
  const plan = [];
  const bathCount = Math.max(1, Number(input.bathroomsCount || 1));
  const bedCount = Math.max(0, Number(input.bedroomsCount || 0));

  for (let i = 1; i <= Math.min(bathCount, 2); i++) {
    const label = i === 1 ? 'Baño principal' : 'Baño secundario';
    plan.push(
      { slotCode: `BATHROOM_${i}_SHOWER`, title: `${label} – Interior tina / ducha`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Zona de ducha/tina y muro cercano.',
        que: 'Sellos, juntas, humedad o manchas alrededor de la tina/ducha.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_SINK`, title: `${label} – Lavamanos`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Lavamanos y cubierta, vista frontal.',
        que: 'Grifería, sellos, manchas en cubierta.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_SINK_PIPES`, title: `${label} – Cañerías lavamanos`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Bajo lavamanos mostrando sifón y conexiones.',
        que: 'Fugas, óxido, humedad en sifón y conexiones.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_WC`, title: `${label} – WC`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'WC y base, vista frontal.',
        que: 'Base, sellos y manchas alrededor del WC.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_WC_PIPES`, title: `${label} – Cañerías WC`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Conexión de agua y base del WC.',
        que: 'Conexión de agua y posibles fugas.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_CEILING`, title: `${label} – Cielo`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Cielo del baño con buena iluminación.',
        que: 'Humedad, moho o manchas en cielo.'
      }), required: true },
      { slotCode: `BATHROOM_${i}_OUTLETS`, title: `${label} – Enchufes`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Enchufes y entorno cercano.',
        que: 'Estado de enchufes/placas y fijación.'
      }), required: true }
    );
  }

  plan.push(
    { slotCode: 'KITCHEN_UNDER_SINK', title: 'Cocina – Bajo lavaplatos', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Bajo lavaplatos mostrando conexiones y sifón.',
      que: 'Fugas, humedad y estado de conexiones.'
    }), required: true },
    { slotCode: 'KITCHEN_SINK_WALL', title: 'Cocina – Muro lavaplatos', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Muro/encuentro lavaplatos.',
      que: 'Manchas, sellos o humedad en muro.'
    }), required: true },
    { slotCode: 'KITCHEN_OUTLETS', title: 'Cocina – Enchufes', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Enchufes y entorno.',
      que: 'Estado de enchufes/placas.'
    }), required: true },
    { slotCode: 'KITCHEN_WINDOW', title: 'Cocina – Ventana', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Ventana completa, marcos y sello.',
      que: 'Sellos, marcos y humedad en ventana.'
    }), required: true }
  );

  plan.push(
    { slotCode: 'LIVING_WALLS', title: 'Living – Muros', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Muros del living con pintura visible.',
      que: 'Pintura, fisuras o manchas.'
    }), required: true },
    { slotCode: 'LIVING_CEILING', title: 'Living – Cielo', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Cielo del living y terminaciones.',
      que: 'Terminaciones y humedad en cielo.'
    }), required: true },
    { slotCode: 'LIVING_FLOOR', title: 'Living – Piso', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Piso del living, terminaciones visibles.',
      que: 'Estado de piso/terminación.'
    }), required: true },
    { slotCode: 'LIVING_WINDOWS', title: 'Living – Ventanas', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Ventanas completas, marcos y sello.',
      que: 'Sellos, marcos o filtraciones.'
    }), required: true },
    { slotCode: 'LIVING_SWITCHES', title: 'Living – Interruptores', instructions: buildInstruction({
      indicaciones: '',
      donde: 'Interruptores y placas.',
      que: 'Estado de interruptores/placas.'
    }), required: true }
  );

  for (let i = 1; i <= Math.min(bedCount, 3); i++) {
    plan.push(
      { slotCode: `BEDROOM_${i}_WALLS`, title: `Dormitorio ${i} – Muros`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Muros del dormitorio con pintura visible.',
        que: 'Pintura, fisuras o manchas.'
      }), required: true },
      { slotCode: `BEDROOM_${i}_FLOOR`, title: `Dormitorio ${i} – Piso`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Piso del dormitorio, terminaciones visibles.',
        que: 'Estado de piso/terminación.'
      }), required: true },
      { slotCode: `BEDROOM_${i}_WINDOWS`, title: `Dormitorio ${i} – Ventanas`, instructions: buildInstruction({
        indicaciones: '',
        donde: 'Ventanas completas, marcos y sello.',
        que: 'Sellos, marcos o filtraciones.'
      }), required: true }
    );
  }

  if (input.hasLaundry) {
    plan.push(
      { slotCode: 'LAUNDRY_WALLS_FLOOR', title: 'Loggia – Muros y piso', instructions: buildInstruction({
        indicaciones: '',
        donde: 'Muros y piso de la loggia.',
        que: 'Humedad, fisuras o daños.'
      }), required: true }
    );
  }

  plan.push({ slotCode: 'ELECTRICAL_PANEL', title: 'Tablero eléctrico', instructions: buildInstruction({
    indicaciones: '',
    donde: 'Tablero frontal, sin manipular.',
    que: 'Estado visual del tablero.'
  }), required: true });

  return plan;
}

async function queueOpenAiSlotAnalysis() {
  // Placeholder - async OpenAI not enabled in local.
}

fastify.register(multipart, {
  limits: { fileSize: 8 * 1024 * 1024 }
});
fastify.register(staticPlugin, {
  root: path.join(__dirname, 'public'),
  prefix: '/'
});

fastify.get('/', (req, reply) => reply.sendFile('index.html'));
fastify.get('/formulario', (req, reply) => reply.sendFile('formulario.html'));
fastify.get('/dashboard', (req, reply) => reply.sendFile('dashboard.html'));
fastify.get('/cases/:caseId/report', (req, reply) => reply.sendFile('report.html'));

await registerCaptureRoutes(fastify, {
  prisma,
  storage,
  safeExtFromMime,
  analyzeImageBufferV1,
  slotGroupFromSlotCode,
  queueOpenAiSlotAnalysis
});

fastify.post('/api/cases', async (req, reply) => {
  if (!prisma) return reply.code(500).send({ ok: false, error: 'DATABASE_NOT_CONFIGURED' });

  const payload = req.body || {};
  const bathroomsCount = Number(payload.bathroomsCount || payload.bathrooms || 1);
  const bedroomsCount = Number(payload.bedroomsCount || payload.bedrooms || 1);
  const bedrooms = Number(payload.bedrooms || bedroomsCount || 0);
  const bathrooms = Number(payload.bathrooms || bathroomsCount || 1);

  const planSlots = buildPhotoPlanV1({
    ...payload,
    bathroomsCount,
    bedroomsCount
  });

  const token = crypto.randomUUID();
  const captureExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  const result = await prisma.$transaction(async (tx) => {
    let ownerId = null;
    if (payload.ownerRut) {
      const existing = await tx.owner.findUnique({ where: { rut: payload.ownerRut } });
      if (existing) ownerId = existing.id;
      if (!ownerId && payload.ownerName) {
        const created = await tx.owner.create({ data: { fullName: payload.ownerName, rut: payload.ownerRut } });
        ownerId = created.id;
      }
    } else if (payload.ownerName) {
      const created = await tx.owner.create({ data: { fullName: payload.ownerName } });
      ownerId = created.id;
    }

    const property = await tx.property.create({
      data: {
        ownerId,
        rol: payload.propertyRol || null,
        address: payload.propertyAddress || null,
        operationType: payload.propertyOperationType || null,
        surface: payload.propertySurface || null
      }
    });

    const c = await tx.case.create({
      data: {
        property: { connect: { id: property.id } },
        propertyType: payload.propertyType || 'DEPARTMENT',
        bathroomsCount,
        bedroomsCount,
        propertyAgeRange: payload.propertyAgeRange || null,
        bedrooms,
        bathrooms,
        yearBuilt: payload.yearBuilt || null,
        floorType: payload.floorType || 'CONCRETE',
        hasPatio: !!payload.hasPatio,
        hasAttic: !!payload.hasAttic,
        hasLaundry: !!payload.hasLaundry,
        planVersion: 'v1',
        status: 'DRAFT'
      }
    });

    const slots = await tx.slot.createMany({
      data: planSlots.map((s, idx) => ({
        caseId: c.id,
        slotCode: s.slotCode,
        title: s.title,
        instructions: s.instructions,
        required: s.required ?? true,
        orderIndex: idx + 1,
        status: 'PENDING'
      }))
    });

    await tx.captureToken.create({
      data: {
        caseId: c.id,
        token,
        expiresAt: captureExpires
      }
    });

    return { caseId: c.id, slotsCreated: slots.count };
  });

  const captureUrl = `/capture/${token}`;
  const reportUrl = `/cases/${encodeURIComponent(result.caseId)}/report`;

  return reply.send({
    ok: true,
    caseId: result.caseId,
    captureUrl,
    reportUrl,
    slots: planSlots
  });
});

fastify.get('/api/cases', async (req, reply) => {
  const cases = await prisma.case.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      property: true,
      slots: { include: { photo: true } },
      captureTokens: { orderBy: { createdAt: 'desc' } }
    }
  });

  const rows = cases.map((c) => {
    const slots = c.slots || [];
    const uploaded = slots.filter(s => ['UPLOADED', 'ANALYZED', 'REJECTED'].includes(String(s.status || '').toUpperCase())).length;
    const analyzed = slots.filter(s => String(s.status || '').toUpperCase() === 'ANALYZED').length;
    const rejected = slots.filter(s => String(s.status || '').toUpperCase() === 'REJECTED').length;
    const total = slots.length;
    const pct = total ? Math.round((uploaded / total) * 100) : 0;
    const captureToken = c.captureTokens?.[0]?.token || null;
    const captureUrl = captureToken ? `/capture/${captureToken}` : null;
    const firstPhoto = slots.find(s => s.photo?.filePath)?.photo?.filePath || null;

    return {
      id: c.id,
      createdAt: c.createdAt,
      propertyType: c.propertyType,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      progress: { uploaded, analyzed, rejected, total, pct },
      captureUrl,
      firstPhotoUrl: firstPhoto ? storage.publicUrl(firstPhoto) : null
    };
  });

  return reply.send({ ok: true, cases: rows });
});

fastify.get('/api/cases/:caseId/summary', async (req, reply) => {
  const caseId = String(req.params.caseId || '');
  const summary = await getCaseSummary({ prisma, storage, caseId, slotGroupTitleFromCode });
  if (!summary.ok) return reply.code(404).send(summary);
  return reply.send(summary);
});

fastify.listen({ port: PORT, host: '0.0.0.0' });
