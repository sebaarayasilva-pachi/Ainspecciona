import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { sendExpoReportEmail } from '../../email.js';

const prisma = new PrismaClient();

// Helper para hashear tokens públicos (no guardamos el token en texto plano)
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Genera un token aleatorio seguro
export function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

import { createStorage } from '../../storage/storage.js';

export async function registerExpoRoutes(app) {
  const storage = createStorage();
  // 1. Crear sesión (Registro)
  app.post('/api/expo/sessions', async (request, reply) => {
    const { campaignSlug, firstName, lastName, email, company, roleType, privacyConsent, marketingConsent } = request.body;

    if (!campaignSlug || !firstName || !lastName || !email || privacyConsent !== true) {
      return reply.status(400).send({ error: 'Faltan datos obligatorios o consentimiento de privacidad.' });
    }

    const campaign = await prisma.expoCampaign.findUnique({
      where: { slug: campaignSlug }
    });

    if (!campaign || !campaign.isActive) {
      return reply.status(404).send({ error: 'Campaña no encontrada o inactiva.' });
    }

    const emailNormalized = email.toLowerCase().trim();

    // Crear o buscar lead
    let lead = await prisma.expoLead.findFirst({
      where: { campaignId: campaign.id, emailNormalized }
    });

    if (!lead) {
      lead = await prisma.expoLead.create({
        data: {
          campaignId: campaign.id,
          firstName,
          lastName,
          emailNormalized,
          company,
          roleType,
          privacyConsentAt: new Date(),
          marketingConsentAt: marketingConsent ? new Date() : null
        }
      });
    } else if (marketingConsent && !lead.marketingConsentAt) {
      // Actualizar consentimiento si ahora lo dio
      await prisma.expoLead.update({
        where: { id: lead.id },
        data: { marketingConsentAt: new Date() }
      });
    }

    // Crear sesión
    const token = generateToken();
    const tokenHash = hashToken(token);

    const session = await prisma.expoSession.create({
      data: {
        campaignId: campaign.id,
        leadId: lead.id,
        publicTokenHash: tokenHash,
        userAgent: request.headers['user-agent']
      }
    });

    await prisma.expoEvent.create({
      data: {
        campaignId: campaign.id,
        sessionId: session.id,
        leadId: lead.id,
        eventName: 'expo_registration_completed'
      }
    });

    return {
      sessionToken: token,
      progress: {
        completed: 0,
        total: 4
      }
    };
  });

  // 2. Recuperar sesión
  app.get('/api/expo/sessions/:sessionToken', async (request, reply) => {
    const { sessionToken } = request.params;
    const tokenHash = hashToken(sessionToken);

    const session = await prisma.expoSession.findUnique({
      where: { publicTokenHash: tokenHash },
      include: {
        lead: true,
        completions: {
          include: { mission: true }
        }
      }
    });

    if (!session) {
      return reply.status(404).send({ error: 'Sesión no encontrada.' });
    }

    return {
      status: session.status,
      lead: {
        firstName: session.lead.firstName,
        lastName: session.lead.lastName
      },
      completions: session.completions.map(c => ({
        missionCode: c.mission.code,
        completedAt: c.completedAt
      })),
      progress: {
        completed: session.completions.length,
        total: 4
      }
    };
  });

  // 3. Obtener URL de subida para la foto
  app.post('/api/expo/sessions/:sessionToken/photos/upload-url', async (request, reply) => {
    const { sessionToken } = request.params;
    const tokenHash = hashToken(sessionToken);

    const session = await prisma.expoSession.findUnique({
      where: { publicTokenHash: tokenHash }
    });

    if (!session) return reply.status(404).send({ error: 'Sesión no encontrada.' });

    const fakeKey = `expo/${session.campaignId}/${session.id}/${Date.now()}.jpg`;
    
    // Usar la infraestructura existente de Storage (GCS)
    const signed = await storage.createSignedUploadUrl({
      object: fakeKey,
      contentType: 'image/jpeg',
      expiresSeconds: 15 * 60 // 15 minutos
    });
    
    return {
      uploadUrl: signed.uploadUrl,
      storageKey: fakeKey
    };
  });

  // 4.5 Validar misión (Código Manual)
  app.post('/api/expo/sessions/:sessionToken/completions/manual', async (request, reply) => {
    const { sessionToken } = request.params;
    const { shortCode } = request.body;
    const tokenHash = hashToken(sessionToken);

    const session = await prisma.expoSession.findUnique({
      where: { publicTokenHash: tokenHash },
      include: { completions: true }
    });

    if (!session) return reply.status(404).send({ error: 'Sesión no encontrada.' });

    const mission = await prisma.expoMission.findFirst({
      where: { 
        campaignId: session.campaignId,
        shortCode: String(shortCode || '').trim().toUpperCase()
      }
    });

    if (!mission) {
      return reply.status(400).send({ error: 'Código inválido o no encontrado.' });
    }

    const alreadyCompleted = session.completions.some(c => c.missionId === mission.id);
    if (alreadyCompleted) {
      return reply.status(400).send({ code: 'DUPLICATE', error: 'Ya encontraste este problema. ¡Busca uno diferente!' });
    }

    await prisma.expoCompletion.create({
      data: {
        sessionId: session.id,
        missionId: mission.id,
        photoStorageKey: '',
        qrPayloadHash: 'MANUAL',
        validationMethod: 'MANUAL_CODE'
      }
    });

    const newCompletedCount = session.completions.length + 1;

    if (session.status === 'STARTED') {
      await prisma.expoSession.update({
        where: { id: session.id },
        data: { status: 'IN_PROGRESS', lastActivityAt: new Date() }
      });
    }

    await prisma.expoEvent.create({
      data: {
        campaignId: session.campaignId,
        sessionId: session.id,
        eventName: 'expo_mission_completed',
        metadata: { missionCode: mission.code, method: 'MANUAL_CODE' }
      }
    });

    return {
      mission,
      progress: {
        completed: newCompletedCount,
        total: 4
      },
      challengeCompleted: newCompletedCount >= 4
    };
  });

  // 4. Validar misión (QR)
  app.post('/api/expo/sessions/:sessionToken/completions', async (request, reply) => {
    const { sessionToken } = request.params;
    const { qrPayload, photoStorageKey, validationMethod } = request.body;
    const tokenHash = hashToken(sessionToken);

    const session = await prisma.expoSession.findUnique({
      where: { publicTokenHash: tokenHash },
      include: { completions: true }
    });

    if (!session) return reply.status(404).send({ error: 'Sesión no encontrada.' });

    // Parsear payload (AINS-EXPO|v1|campaignSlug|missionCode|nonce|signature)
    const parts = String(qrPayload || '').split('|');
    if (parts.length < 6 || parts[0] !== 'AINS-EXPO') {
      return reply.status(400).send({ error: 'QR inválido o no reconocido.' });
    }

    const [header, version, campaignSlug, missionCode, nonce, signature] = parts;

    // TODO: Validar firma HMAC aquí
    const SECRET = process.env.EXPO_QR_SIGNING_SECRET || 'secret-local-desarrollo-expo-2026';
    const basePayload = `AINS-EXPO|v1|${campaignSlug}|${missionCode}|${nonce}`;
    const expectedSignature = crypto.createHmac('sha256', SECRET).update(basePayload).digest('hex').substring(0, 16);
    
    if (signature !== expectedSignature) {
      return reply.status(400).send({ error: 'Firma de QR inválida.' });
    }

    const mission = await prisma.expoMission.findFirst({
      where: {
        campaign: { slug: campaignSlug },
        code: missionCode
      }
    });

    if (!mission || !mission.isActive) {
      return reply.status(400).send({ error: 'Misión no encontrada o inactiva.' });
    }

    // Idempotencia: ¿Ya la completó?
    const alreadyCompleted = session.completions.find(c => c.missionId === mission.id);
    
    if (alreadyCompleted) {
      return reply.status(400).send({ error: 'Ya encontraste este problema. Busca una lámina diferente.', code: 'DUPLICATE' });
    }

    // Guardar completion
    await prisma.expoCompletion.create({
      data: {
        sessionId: session.id,
        missionId: mission.id,
        photoStorageKey: photoStorageKey || '',
        qrPayloadHash: hashToken(qrPayload),
        validationMethod: validationMethod || 'QR_IMAGE'
      }
    });

    const newCompletedCount = session.completions.length + 1;

    // Actualizar estado de sesión si es necesario
    if (session.status === 'STARTED') {
      await prisma.expoSession.update({
        where: { id: session.id },
        data: { status: 'IN_PROGRESS', lastActivityAt: new Date() }
      });
    }

    await prisma.expoEvent.create({
      data: {
        campaignId: session.campaignId,
        sessionId: session.id,
        eventName: 'expo_mission_completed',
        metadata: { missionCode, progress: newCompletedCount }
      }
    });

    return {
      mission: {
        id: mission.id,
        title: mission.title,
        category: mission.category,
        severity: mission.severity,
        finding: mission.finding,
        probableCause: mission.probableCause,
        recommendation: mission.recommendation
      },
      progress: {
        completed: newCompletedCount,
        total: 4
      },
      challengeCompleted: newCompletedCount >= 4
    };
  });

  // 5. Completar desafío
  app.post('/api/expo/sessions/:sessionToken/complete', async (request, reply) => {
    const { sessionToken } = request.params;
    const tokenHash = hashToken(sessionToken);

    const session = await prisma.expoSession.findUnique({
      where: { publicTokenHash: tokenHash },
      include: { 
        completions: true,
        lead: true,
        campaign: true
      }
    });

    if (!session) return reply.status(404).send({ error: 'Sesión no encontrada.' });

    if (session.completions.length < 4) {
      return reply.status(400).send({ error: 'Aún no has completado las 4 misiones.' });
    }

    if (session.status !== 'COMPLETED') {
      await prisma.expoSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', completedAt: new Date(), lastActivityAt: new Date() }
      });

      await prisma.expoEvent.create({
        data: {
          campaignId: session.campaignId,
          sessionId: session.id,
          eventName: 'expo_challenge_completed'
        }
      });

      // Crear reporte
      const reportToken = generateToken();
      const reportTokenHash = hashToken(reportToken);
      
      await prisma.expoReport.create({
        data: {
          sessionId: session.id,
          publicTokenHash: reportTokenHash,
          status: 'READY'
        }
      });

      // TODO: Enviar correo aquí
      const baseUrl = process.env.EXPO_PUBLIC_BASE_URL || 'https://ainspecciona.web.app/expo';
      const reportUrl = `${baseUrl}/report.html?t=${reportToken}`;
      
      try {
        await sendExpoReportEmail(session.lead.emailNormalized, {
          name: session.lead.firstName,
          eventName: session.campaign.eventName,
          reportUrl
        });
      } catch (err) {
        console.error('Error enviando email de reporte expo:', err);
      }
      
      return { success: true, reportToken };
    }

    return { success: true };
  });

  // 6. Ver informe
  app.get('/api/expo/reports/:reportToken', async (request, reply) => {
    const { reportToken } = request.params;
    const tokenHash = hashToken(reportToken);

    const report = await prisma.expoReport.findUnique({
      where: { publicTokenHash: tokenHash },
      include: {
        session: {
          include: {
            lead: true,
            campaign: true,
            completions: {
              include: { mission: true },
              orderBy: { completedAt: 'asc' }
            }
          }
        }
      }
    });

    if (!report) return reply.status(404).send({ error: 'Reporte no encontrado.' });

    // Firmar URLs de las fotos para lectura temporal
    const completionsWithUrls = await Promise.all(report.session.completions.map(async (c) => {
      let url = '';
      if (c.photoStorageKey) {
        if (storage.createSignedReadUrl) {
          url = await storage.createSignedReadUrl({ object: c.photoStorageKey, expiresSeconds: 60 * 60 });
        } else {
          url = storage.publicUrl(c.photoStorageKey);
        }
      }
      return {
        mission: c.mission,
        photoUrl: url
      };
    }));

    return {
      lead: {
        firstName: report.session.lead.firstName,
        lastName: report.session.lead.lastName,
        company: report.session.lead.company
      },
      campaign: {
        name: report.session.campaign.name,
        eventName: report.session.campaign.eventName
      },
      completions: completionsWithUrls
    };
  });

  // 7. Registrar interés (CTA)
  app.post('/api/expo/sessions/:sessionToken/interest', async (request, reply) => {
    const { sessionToken } = request.params;
    const { type } = request.body;
    const tokenHash = hashToken(sessionToken);

    const session = await prisma.expoSession.findUnique({
      where: { publicTokenHash: tokenHash }
    });

    if (session) {
      await prisma.expoEvent.create({
        data: {
          campaignId: session.campaignId,
          sessionId: session.id,
          eventName: 'expo_demo_cta_clicked',
          metadata: { type }
        }
      });
    }
    return { success: true };
  });

  // 8. CSV Export (Admin)
  app.get('/api/admin/expo/export', async (request, reply) => {
    const campaignSlug = 'expo-real-estate-2026';
    
    const leads = await prisma.expoLead.findMany({
      where: { campaign: { slug: campaignSlug } },
      include: {
        sessions: {
          include: { completions: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    let csv = 'Fecha,Nombre,Apellido,Correo,Empresa,Perfil,Progreso,Completado,Consentimiento_Comercial\n';
    
    for (const lead of leads) {
      const session = lead.sessions[0];
      const progress = session ? session.completions.length : 0;
      const completed = session?.status === 'COMPLETED' ? 'Si' : 'No';
      const mkt = lead.marketingConsentAt ? 'Si' : 'No';
      
      const row = [
        lead.createdAt.toISOString(),
        `'${lead.firstName}`, // Evitar inyección CSV
        `'${lead.lastName}`,
        lead.emailNormalized,
        `'${lead.company || ''}`,
        lead.roleType || '',
        progress,
        completed,
        mkt
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      
      csv += row + '\n';
    }

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="expo_leads.csv"');
    return reply.send(csv);
  });

  // 9. Admin: Listar Leads (JSON)
  app.get('/api/admin/expo/leads', async (request, reply) => {
    const campaignSlug = 'expo-real-estate-2026';
    
    const leads = await prisma.expoLead.findMany({
      where: { campaign: { slug: campaignSlug } },
      include: {
        sessions: {
          include: { completions: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const data = leads.map(lead => {
      const session = lead.sessions[0];
      return {
        id: lead.id,
        createdAt: lead.createdAt,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.emailNormalized,
        company: lead.company,
        roleType: lead.roleType,
        progress: session ? session.completions.length : 0,
        status: session?.status || 'PENDING',
        marketingConsent: !!lead.marketingConsentAt
      };
    });

    return { ok: true, leads: data };
  });
}
