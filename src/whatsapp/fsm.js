/**
 * FSM ligero para menú, derivación a humano y estados conversacionales.
 */

import { getPublicSiteBase } from './conversationFacts.js';

export const WA_STATES = {
  DEFAULT: 'default',
  MENU: 'menu',
  HUMAN_HANDOFF: 'human_handoff'
};

export function normalizeUserText(t) {
  return String(t || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function detectHandoffIntent(text) {
  const n = normalizeUserText(text);
  const keys = ['humano', 'agente', 'persona', 'operador', 'asesor', 'hablar con alguien', 'ejecutivo'];
  return keys.some((k) => n.includes(k));
}

export function detectMenuIntent(text) {
  const n = normalizeUserText(text);
  return (
    n === 'menu' ||
    n === 'ayuda' ||
    n === 'opciones' ||
    n === 'inicio' ||
    n === 'volver'
  );
}

export function getStaticMenuText() {
  return (
    `*Ainspecciona*\n\n` +
    `1️⃣ Precios y planes\n` +
    `2️⃣ Cuenta y estado\n` +
    `3️⃣ Hablar con un humano\n\n` +
    `Responde con el número o escribe tu consulta.`
  );
}

/**
 * Preguntas sobre si hace falta registrarse / tener cuenta (no son el ítem 2 del menú).
 * Antes `n.includes('cuenta')` disparaba el texto de login ante "¿debo tener una cuenta?".
 */
export function isQuestionAboutNeedingAccount(text) {
  const n = normalizeUserText(text);
  return (
    /\bdebo tener (una )?cuenta/.test(n) ||
    /\btengo que tener (una )?cuenta/.test(n) ||
    /\bhay que tener (una )?cuenta/.test(n) ||
    /\bnecesito (una )?cuenta/.test(n) ||
    /\bnecesita (una )?cuenta/.test(n) ||
    /\bes obligatorio tener (una )?cuenta/.test(n) ||
    /\bhace falta (una )?cuenta/.test(n) ||
    /\brequiere (una )?cuenta/.test(n) ||
    /\b(puedo|se puede|pueden) .{0,30}(sin|sin tener) (una )?cuenta\b/.test(n) ||
    /\bcuenta (es )?(obligatoria|necesaria|opcional)\b/.test(n) ||
    /\b(crear una cuenta|registrarme|registrarse|darme de alta)\b/.test(n)
  );
}

/** Texto libre que implica “ir al portal” (no incluye el dígito suelto 2). */
function wantsMenuPortalLoginPhrases(text) {
  const n = normalizeUserText(text);
  if (n.includes('cuenta y estado')) return true;
  if (n.includes('iniciar sesion') || n.includes('ingresar al portal') || n.includes('entrar al portal'))
    return true;
  if (/\b(ver|mis) (mis )?(casos|inspecciones)\b/i.test(n)) return true;
  if (n.includes('tenant') && (n.includes('login') || n.includes('sesion') || n.includes('entrar'))) return true;
  return false;
}

const replyPrecios = (base) =>
  `Puedes ver precios y planes en ${base}/precios\n\n` +
  `¿Necesitas algo más? Escribe *menú* para ver opciones.`;

const replyPortalTenant = (base) =>
  `Para ver tu cuenta e inspecciones, inicia sesión en ${base}/tenant\n\n` +
  `Si no recuerdas tu acceso, escribe *humano* para ayuda personalizada.`;

/**
 * Respuestas fijas del menú estático (*menú* → 1/2/3).
 * Los dígitos sueltos 1/2/3 solo aplican si `state === menu` (si no, “2” puede ser elección en listas del LLM).
 * @param {string} text
 * @param {{ state?: string }} [options]
 */
export function replyForMenuChoice(text, options = {}) {
  const base = getPublicSiteBase();
  const n = normalizeUserText(text);
  const state = options.state || WA_STATES.DEFAULT;
  const menuActive = state === WA_STATES.MENU;
  const onlyDigit = /^[123]$/.test(n.trim());

  if (isQuestionAboutNeedingAccount(text)) {
    return null;
  }

  if (onlyDigit && menuActive) {
    if (n === '1') return replyPrecios(base);
    if (n === '2') return replyPortalTenant(base);
    if (n === '3') return null;
  }

  if (onlyDigit && !menuActive) {
    return null;
  }

  if (n.includes('precio') || n.includes('plan')) {
    return replyPrecios(base);
  }

  if (wantsMenuPortalLoginPhrases(text)) {
    return replyPortalTenant(base);
  }

  return null;
}

/**
 * @param {string} currentState
 * @param {string} text
 * @returns {string} next state key
 */
export function nextStateFromInput(currentState, text) {
  if (detectMenuIntent(text)) return WA_STATES.MENU;
  if (detectHandoffIntent(text)) return WA_STATES.HUMAN_HANDOFF;
  const n = normalizeUserText(text);
  if (currentState === WA_STATES.MENU && /^[123]$/.test(n)) {
    if (n === '3') return WA_STATES.HUMAN_HANDOFF;
    return WA_STATES.DEFAULT;
  }
  return currentState;
}

export function handoffAckText() {
  return (
    `Entendido. Derivamos tu conversación a un ejecutivo. ` +
    `Te contactaremos por este mismo canal cuando haya disponibilidad.\n\n` +
    `Mientras tanto, puedes escribir *menú* para ver opciones automáticas.`
  );
}
