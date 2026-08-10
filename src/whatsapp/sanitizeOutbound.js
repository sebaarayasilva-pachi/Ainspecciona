/**
 * WhatsApp solo enlaza URLs en texto plano. El modelo a veces devuelve **https://...**
 * o *https://...*, y dejan de ser clickeables. Quita marcado alrededor de http(s).
 * @param {string} text
 * @returns {string}
 */
export function sanitizeWhatsAppOutboundText(text) {
  let s = String(text || '');
  // **https://...** o **http://...** (WhatsApp no enlaza si hay markdown)
  s = s.replace(/\*\*(https?:\/\/[^\s*]+)\*\*/g, '$1');
  // *https://...* una sola capa (evitar *menú*: las URLs llevan ://)
  s = s.replace(/\*(https?:\/\/[^\s*]+)\*/g, '$1');
  // enlace seguido de ** pegado
  s = s.replace(/(https?:\/\/[^\s*]+?)\*\*(?=\s|$)/g, '$1');
  return s.trim();
}
