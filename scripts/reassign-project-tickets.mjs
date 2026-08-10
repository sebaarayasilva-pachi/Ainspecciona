/**
 * Reasigna tickets abiertos del proyecto al defaultInspector actual.
 * Uso: node scripts/reassign-project-tickets.mjs --slug padre-mariano-87
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  return process.argv[i + 1] ?? def;
}

const slug = String(arg('--slug', 'padre-mariano-87')).trim();

async function main() {
  const project = await prisma.pvProject.findFirst({
    where: { slug },
    include: {
      defaultInspector: { select: { id: true, email: true, fullName: true } }
    }
  });
  if (!project) {
    console.error('Proyecto no encontrado:', slug);
    process.exit(1);
  }
  if (!project.defaultInspectorId || !project.defaultInspector) {
    console.error('El proyecto no tiene inspector default:', slug);
    process.exit(1);
  }

  const inspector = project.defaultInspector;
  const result = await prisma.pvTicket.updateMany({
    where: {
      tenantId: project.tenantId,
      OR: [{ projectId: project.id }, { unit: { projectId: project.id } }],
      status: { in: ['recibido', 'classified', 'asignada', 'programado', 'en_ejecucion'] }
    },
    data: {
      assignedToUserId: inspector.id,
      assignedAt: new Date(),
      status: 'asignada'
    }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: { slug: project.slug, name: project.name },
        inspector: { id: inspector.id, email: inspector.email, fullName: inspector.fullName },
        updated: result.count
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
