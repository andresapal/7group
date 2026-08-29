/**
 * RESPONSE GENERATOR
 *
 * Generates natural-language responses for the voice agent.
 * In FASE 2 this uses templates and light variation.
 * In FASE 4+ this will be replaced by Claude LLM generation.
 *
 * Design: responses are short, clear, colloquial-Colombian.
 * No emojis. No formal language. Like talking to a friendly
 * restaurant worker on the phone.
 */

// Response templates with variations
const TEMPLATES = {

  // === GREETINGS ===
  greeting_known: [
    'Hola {customer}, soy {agent}, asistente de {business}. ¿Qué vas a pedir hoy?',
    'Hola {customer}, hablas con {agent} de {business}. ¿Qué se te antoja?'
  ],
  greeting_unknown: [
    'Hola, buenas {timeOfDay}. Soy {agent}, asistente de {business}. ¿Qué te gustaría pedir?',
    'Buenas {timeOfDay}, hablas con {agent} de {business}. ¿Qué te puedo servir?'
  ],

  // === PRODUCT ADDED ===
  item_added_single: [
    '{qty}{product}. ¿Algo más?',
    'Listo, {qty}{product}. ¿Qué más te antoja?',
    'Perfecto, {qty}{product}. ¿Algo más?'
  ],
  item_added_multiple: [
    '{items}. ¿Algo más?',
    'Listo: {items}. ¿Necesitas algo más?'
  ],

  // === PRODUCT NOT FOUND ===
  product_not_found: [
    'No encontré "{query}" en el menú. Tenemos {categories}.',
    'No tenemos "{query}". ¿Quieres ver qué hay en {categories}?'
  ],

  // === UNAVAILABLE ===
  product_unavailable: [
    '{product} no está disponible en este momento.',
    '{product} se nos acabó por hoy.'
  ],
  product_unavailable_alt: [
    '{product} no está disponible. ¿Quieres {alternatives}?',
    '{product} se agotó. Te puedo ofrecer {alternatives}.'
  ],

  // === AMBIGUOUS ===
  product_ambiguous: [
    '¿Cuál quieres? {options}',
    'Tenemos varias opciones: {options}. ¿Cuál?'
  ],

  // === ITEM REMOVED ===
  item_removed: [
    'Listo, quité {product}. ¿Algo más?',
    'Ya quité {product} del pedido. ¿Necesitas algo más?'
  ],
  item_removed_empty: [
    'Quité {product}. Tu pedido quedó vacío. ¿Qué quieres pedir?'
  ],

  // === MODIFICATION ===
  mod_added: [
    '{product} {mod}. ¿Algo más?',
    'Perfecto, {product} {mod}. ¿Necesitas algo más?'
  ],

  // === QUANTITY CHANGED ===
  quantity_changed: [
    'Perfecto, {qty} {product}. ¿Algo más?',
    'Listo, cambié a {qty} {product}. ¿Algo más?'
  ],

  // === PRICE ===
  price_single: [
    '{product} está en {price}.',
    '{product}: {price}.'
  ],
  price_multiple: [
    'Tenemos: {list}.'
  ],

  // === MENU ===
  menu_category: [
    'En {category} tenemos: {list}. ¿Cuál te gustaría?'
  ],
  menu_general: [
    'Tenemos {categories}. ¿Qué se te antoja?'
  ],

  // === DELIVERY ===
  ask_address: [
    '¿Cuál es tu dirección?',
    '¿A dónde te lo envío?'
  ],
  confirm_saved_address: [
    '¿Te lo envío a {address}?'
  ],
  zone_not_covered: [
    'No cubrimos esa zona con domicilio. ¿Quieres dar otra dirección o prefieres recoger en el local?'
  ],

  // === PAYMENT ===
  ask_payment: [
    '¿Cómo vas a pagar? Aceptamos {methods}.',
    '¿Con qué método de pago? {methods}.'
  ],

  // === CONFIRMATION ===
  order_summary: [
    'Te confirmo el pedido:\n{items}\n{delivery}\n{payment}\nTotal: {total}.\n¿Confirmamos?'
  ],
  order_confirmed: [
    'Pedido confirmado. Tiempo estimado: {time}. ¡Buen provecho!',
    'Listo, ya quedó tu pedido. Te llega en {time}. ¡Que lo disfrutes!'
  ],

  // === CANCEL ===
  order_cancelled: [
    'Listo, cancelé el pedido. ¿Hay algo más en que te pueda ayudar?'
  ],
  what_to_change: [
    '¿Qué parte quieres cambiar?'
  ],

  // === MISUNDERSTANDING ===
  misunderstand_1: [
    'Perdón, no te entendí. ¿Me lo repites?',
    'Perdón, no alcancé a entenderte. ¿Me lo repites?'
  ],
  misunderstand_2: [
    'Creo que no te entendí bien. ¿Me dices nuevamente qué producto quieres?'
  ],
  misunderstand_3: [
    'No quiero equivocarme con tu pedido. ¿Quieres que te ayude de otra forma o prefieres hablar con una persona?'
  ],
  misunderstand_max: [
    'Parece que estamos teniendo dificultades. Te voy a pasar con una persona.'
  ],

  // === HUMAN ===
  human_available: [
    'Claro, te paso con una persona. Un momento.'
  ],
  human_unavailable: [
    'En este momento no hay una persona disponible. {alternative} ¿Puedo ayudarte yo con tu pedido?'
  ],

  // === HELP ===
  help: [
    'Puedo ayudarte a armar tu pedido, consultar precios, ver el menú, o pedir a domicilio. ¿Qué necesitas?'
  ],

  // === NO MORE ITEMS ===
  nothing_more_no_items: [
    '¿Qué te gustaría pedir?'
  ]
};

/**
 * Pick a random template and fill in variables
 */
export function generate(templateKey, vars) {
  const templates = TEMPLATES[templateKey];
  if (!templates || templates.length === 0) {
    return vars.fallback || '¿En qué te ayudo?';
  }

  const template = templates[Math.floor(Math.random() * templates.length)];
  return _fill(template, vars);
}

/**
 * Get time-of-day greeting word
 */
export function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'días';
  if (h < 18) return 'tardes';
  return 'noches';
}

/**
 * Format price in Colombian style
 */
export function formatPrice(amount) {
  if (amount === null || amount === undefined) return '$0';
  return '$' + Number(amount).toLocaleString('es-CO');
}

/**
 * Format a list of items for spoken output
 * ["pizza", "hamburguesa", "gaseosa"] → "pizza, hamburguesa y gaseosa"
 */
export function formatList(items) {
  if (!items || items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
}

/**
 * Format quantity prefix: "" for 1, "2 " for 2, etc.
 */
export function formatQty(qty) {
  return qty > 1 ? qty + ' ' : '';
}

// Internal: fill template variables
function _fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match;
  });
}
