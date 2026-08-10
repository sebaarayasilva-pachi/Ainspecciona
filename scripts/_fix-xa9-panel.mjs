import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shortId = 'XA9MDYIN';

const c = await prisma.case.findFirst({
  where: { shortId },
  select: { id: true, shortId: true }
});
if (!c) {
  console.error('CASE_NOT_FOUND');
  process.exit(1);
}

const slot = await prisma.slot.findFirst({
  where: { caseId: c.id, slotCode: 'ELECTRICAL_PANEL' }
});
if (!slot) {
  console.error('SLOT_NOT_FOUND');
  process.exit(1);
}

const review = await prisma.slotReview.findUnique({ where: { slotId: slot.id } });
if (!review || review.verdict !== 'corrected') {
  console.error('NO_CORRECTED_REVIEW', review);
  process.exit(1);
}

const humanCode = String(review.humanCode || 'OK').toUpperCase() || 'OK';
const humanSeverity =
  humanCode === 'OK'
    ? null
    : ['low', 'medium', 'high'].includes(String(review.humanSeverity || '').toLowerCase())
      ? String(review.humanSeverity).toLowerCase()
      : null;
const humanMessage =
  String(review.humanMessage || '').trim() ||
  'Tablero eléctrico con interruptor diferencial visible. Sin hallazgos relevantes.';

const prevDebug = slot.analysisDebug && typeof slot.analysisDebug === 'object' ? slot.analysisDebug : {};
const prevParsed = prevDebug?.openai?.parsed && typeof prevDebug.openai.parsed === 'object'
  ? prevDebug.openai.parsed
  : {};

const description =
  'El tablero eléctrico está visible con su tapa abierta. Se observan interruptores térmicos y diferenciales etiquetados (P/D). Las etiquetas indican la función de cada circuito. No se observan cables expuestos ni signos de sobrecalentamiento.';

const nextDebug = {
  ...prevDebug,
  aiBeforeHumanReview: {
    analysisCode: slot.analysisCode,
    analysisSeverity: slot.analysisSeverity,
    analysisMessage: slot.analysisMessage,
    openaiParsed: prevParsed
  },
  humanReviewApplied: {
    at: new Date().toISOString(),
    verdict: review.verdict,
    humanCode,
    humanSeverity,
    humanMessage,
    note: review.note || null,
    reviewerEmail: review.reviewerEmail || null
  },
  severitySource: 'human_review_correction',
  scorePenaltyApplied: 0,
  openai: {
    ...(prevDebug.openai || {}),
    parsed: {
      ...prevParsed,
      description,
      kpi_analysis: humanMessage,
      signals_detected: [],
      details: [],
      proposed_severity: 'none',
      severity_reason: 'Corrección ITO: se observa interruptor diferencial (etiquetas P/D).',
      final_severity: null,
      severity_source: 'human_review_correction',
      score_penalty_applied: 0
    }
  }
};

const updated = await prisma.slot.update({
  where: { id: slot.id },
  data: {
    analysisCode: humanCode,
    analysisSeverity: humanSeverity,
    analysisMessage: humanMessage,
    analysisDebug: nextDebug,
    analyzedAt: new Date()
  },
  select: {
    id: true,
    analysisCode: true,
    analysisSeverity: true,
    analysisMessage: true
  }
});

console.log('UPDATED', {
  case: c.shortId,
  slotId: updated.id,
  analysisCode: updated.analysisCode,
  analysisSeverity: updated.analysisSeverity,
  analysisMessage: updated.analysisMessage
});

await prisma.$disconnect();
