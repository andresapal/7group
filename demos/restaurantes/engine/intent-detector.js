/**
 * INTENT DETECTOR + ENTITY EXTRACTOR
 *
 * Classifies user messages into intents and extracts entities.
 * This is a heuristic/pattern-matching implementation for FASE 2.
 *
 * In production (FASE 4+), this is replaced by Claude LLM with
 * function calling. The interface (detectIntent) stays the same.
 */

import { INTENTS } from './conversation-state.js';

/**
 * Detect intent and extract entities from user message
 *
 * @param {string} message - The user's message
 * @param {object} state - Current conversation state
 * @param {object} orderDraft - Current order draft
 * @returns {{ intent: string, confidence: number, entities: object }}
 */
export function detectIntent(message, state, orderDraft) {
  const text = _normalize(message);
  const currentState = state.currentState;

  // --- Priority 1: Confirmation/Negation in WAITING_CONFIRMATION ---
  if (currentState === 'WAITING_CONFIRMATION') {
    if (_isConfirmation(text)) return _result(INTENTS.CONFIRM_YES, 0.95);
    if (_isNegation(text)) return _result(INTENTS.CONFIRM_NO, 0.90, { negationType: _classifyNegation(text) });
  }

  // --- Priority 2: Human request (always check) ---
  if (_matchesAny(text, HUMAN_PATTERNS)) {
    return _result(INTENTS.HUMAN_REQUEST, 0.95);
  }

  // --- Priority 3: Cancel ---
  if (_matchesAny(text, CANCEL_PATTERNS)) {
    return _result(INTENTS.CANCEL_ORDER, 0.90);
  }

  // --- Priority 4: Context-dependent responses ---
  // If agent asked "¿algo más?" and user says no
  if (state.pendingQuestion === 'anything_else' && _isNothingMore(text)) {
    return _result(INTENTS.NOTHING_MORE, 0.90);
  }
  // If agent asked "¿algo más?" and user says yes or adds item
  if (state.pendingQuestion === 'anything_else' && _isConfirmation(text)) {
    return _result(INTENTS.ADD_ITEM, 0.60, { needsClarification: true });
  }

  // --- Priority 5: Delivery/Pickup ---
  if (_matchesAny(text, PICKUP_PATTERNS)) {
    return _result(INTENTS.PICKUP, 0.90);
  }
  if (_matchesAny(text, DELIVERY_PATTERNS)) {
    return _result(INTENTS.DELIVERY, 0.85);
  }
  // If in DELIVERY_SELECTION or CUSTOMER_DATA and user gives an address
  if (currentState === 'DELIVERY_SELECTION' || currentState === 'CUSTOMER_DATA') {
    if (_looksLikeAddress(text)) {
      return _result(INTENTS.DELIVERY, 0.85, { address: message.trim() });
    }
    // If we asked for address, treat any response as address attempt
    if (state.pendingQuestion === 'address' && text.length > 3) {
      return _result(INTENTS.DELIVERY, 0.70, { address: message.trim() });
    }
  }

  // --- Priority 6: Payment ---
  if (state.pendingQuestion === 'payment_method') {
    const method = _extractPaymentMethod(text);
    if (method) {
      return _result(INTENTS.ORDER, 0.85, { paymentMethod: method, paymentDetails: _extractPaymentDetails(text) });
    }
  }

  // --- Priority 7: Price inquiry ---
  if (_matchesAny(text, PRICE_PATTERNS)) {
    const product = _extractProductReference(text, state);
    return _result(INTENTS.ASK_PRICE, 0.85, { productRef: product });
  }

  // --- Priority 8: Ask about products/menu ---
  if (_matchesAny(text, MENU_PATTERNS)) {
    const category = _extractCategory(text);
    return _result(INTENTS.ASK_PRODUCT, 0.85, { category });
  }

  // --- Priority 9: Promotions (before availability to avoid "tienen alguna promoción" matching availability) ---
  if (_matchesAny(text, PROMO_PATTERNS)) {
    return _result(INTENTS.PROMOTION, 0.85);
  }

  // --- Priority 9b: Product options ("¿qué le puedo quitar?", "¿puedo pedirla sin X?") ---
  if (_matchesAny(text, OPTIONS_PATTERNS)) {
    const product = _extractProductReference(text, state);
    return _result(INTENTS.ASK_OPTIONS, 0.85, { productRef: product });
  }

  // --- Priority 10: Availability ---
  if (_matchesAny(text, AVAILABILITY_PATTERNS)) {
    const product = _extractProductReference(text, state);
    return _result(INTENTS.ASK_AVAILABILITY, 0.80, { productRef: product });
  }

  // --- Priority 11: Order status ---
  if (_matchesAny(text, STATUS_PATTERNS)) {
    return _result(INTENTS.ORDER_STATUS, 0.85);
  }

  // --- Priority 12: Help ---
  if (_matchesAny(text, HELP_PATTERNS)) {
    return _result(INTENTS.HELP, 0.85);
  }

  // --- Priority 13: Remove item (before modifications — "quita la hawaiana" is remove, not modify) ---
  if (_matchesAny(text, REMOVE_PATTERNS)) {
    const product = _extractRemoveProductRef(text);
    return _result(INTENTS.REMOVE_ITEM, 0.80, { productRef: product });
  }

  // --- Priority 14: Modifications ---
  const modification = _extractModification(text);
  if (modification && orderDraft && orderDraft.items.length > 0) {
    return _result(INTENTS.MODIFY_ITEM, 0.80, {
      modification,
      targetProduct: _extractProductReference(text, state)
    });
  }

  // --- Priority 15: Change quantity ---
  const qtyChange = _extractQuantityChange(text, state);
  if (qtyChange && orderDraft && orderDraft.items.length > 0) {
    return _result(INTENTS.CHANGE_QUANTITY, 0.80, qtyChange);
  }

  // --- Priority 16: Add item / General order ---
  const orderEntities = _extractOrderEntities(text, state);
  if (orderEntities.items.length > 0 || orderEntities.hasOrderIntent) {
    return _result(
      orderDraft && orderDraft.items.length > 0 ? INTENTS.ADD_ITEM : INTENTS.ORDER,
      orderEntities.items.length > 0 ? 0.80 : 0.60,
      orderEntities
    );
  }

  // --- Priority 17: Simple quantity response (context-dependent) ---
  if (state.pendingQuestion === 'quantity') {
    const qty = _extractNumber(text);
    if (qty > 0) {
      return _result(INTENTS.CHANGE_QUANTITY, 0.85, { quantity: qty });
    }
  }

  // --- Priority 18: Simple product response (context-dependent) ---
  if (state.pendingQuestion === 'which_product' || state.pendingQuestion === 'which_burger' || state.pendingQuestion === 'which_pizza') {
    return _result(INTENTS.ADD_ITEM, 0.70, {
      items: [{ productRef: text.trim(), quantity: null }]
    });
  }

  // --- Priority 19: Greeting ---
  if (_matchesAny(text, GREETING_PATTERNS) && state.turnCount <= 1) {
    return _result(INTENTS.ORDER, 0.50, { isGreeting: true });
  }

  // --- Priority 20: Affirmation in context ---
  if (_isConfirmation(text)) {
    // Generic yes — meaning depends on context
    return _result(INTENTS.CONFIRM_YES, 0.70);
  }
  if (_isNegation(text)) {
    return _result(INTENTS.CONFIRM_NO, 0.70);
  }

  // --- Fallback: Unknown ---
  return _result(INTENTS.UNKNOWN, 0.30);
}

/**
 * Extract quantity from natural language
 */
export function extractQuantity(text) {
  return _extractNumber(_normalize(text));
}

// ================== PATTERNS ==================

const HUMAN_PATTERNS = [
  /hablar con (una |alguien|persona|humano)/,
  /pas[ae]me con (alguien|una persona)/,
  /comuni(ca|que)me/,
  /quiero (hablar|una persona)/,
  /no quiero hablar con (una )?ia/,
  /no quiero hablar con (un )?robot/,
  /no quiero (la|una) maquina/,
  /atiendame (un|una) persona/
];

const CANCEL_PATTERNS = [
  /cancela(r)? (todo|el pedido)/,
  /ya no quiero/,
  /olvida(r)? (todo|el pedido)/,
  /no quiero (nada|pedir)/,
  /borra todo/,
  /deja(lo)? asi no/
];

const PICKUP_PATTERNS = [
  /recog(er|o|erlo|emos)/,
  /pas(o|ar) a recog/,
  /para llevar/,
  /voy (a|por)/,
  /yo (voy|paso)/,
  /lo recojo/,
  /en el local/,
  /en el restaurante/
];

const DELIVERY_PATTERNS = [
  /domicilio/,
  /a domicilio/,
  /envía(r|me|lo)/,
  /manda(r|me|lo)/,
  /lleva(r|me|lo)/,
  /que (me )?lo (lleven|traigan|manden)/,
  /a (mi |la )?(casa|dirección|oficina)/
];

const PRICE_PATTERNS = [
  /cuanto (vale|cuesta|es)/,
  /que precio/,
  /a como (esta|sale|es)/,
  /precio de/,
  /cuanto (me )?sale/
];

const MENU_PATTERNS = [
  /que tienen/,
  /que hay/,
  /que (me )?recomiend/,
  /dime (el )?menu/,
  /que opciones/,
  /que pizzas/,
  /que hamburguesas/,
  /que combos/,
  /que bebidas/,
  /que acompan/,
  /tienen algo de/,
  /que mas hay/,
  /muestrame/
];

const AVAILABILITY_PATTERNS = [
  /tienen (?:la |el |una |un )?\w{3,}/,
  /hay (?:de )?\w{3,}/,
  /esta disponible/,
  /se puede pedir/,
  /todavia tienen/
];

const PROMO_PATTERNS = [
  /promocion|promoci/,
  /descuento/,
  /oferta/,
  /especial de hoy/,
  /2x1|dos por uno|2 por 1/,
  /algo en oferta/,
  /algo barato/,
  /combo.*oferta/
];

const OPTIONS_PATTERNS = [
  /que (le )?(puedo|se le puede) (quitar|agregar|cambiar|poner|modificar)/,
  /que opciones tiene/,
  /que modificaciones/,
  /que variantes/,
  /que tamanos/,
  /puedo pedirl[ao] sin/,
  /se puede sin/,
  /que trae|que incluye|que lleva/,
  /que ingredientes/,
  /con que viene/,
  /se le puede quitar/,
  /se puede cambiar/
];

const STATUS_PATTERNS = [
  /como va (mi )?pedido/,
  /ya esta listo/,
  /cuanto (falta|demora)/,
  /donde (esta|va) (mi )?pedido/,
  /estado (del|de mi) pedido/,
  /hice un pedido/
];

const HELP_PATTERNS = [
  /no se que pedir/,
  /ayudame/,
  /es mi primera vez/,
  /como (hago|pido|funciona)/,
  /no (se|entiendo)/
];

const REMOVE_PATTERNS = [
  /quit(a|ar|e|ame)(me|le)?/,
  /sac(a|ar)(me|le)?/,
  /elimina(r)?/,
  /borra(r)?/,
  /ya no quiero (la|el|las|los|una|un)/,
  /no (quiero|va) (la|el|las|los)/
];

const GREETING_PATTERNS = [
  /^hola$/,
  /^buenas$/,
  /^buenas (tardes|noches|días)/,
  /^buenos días/,
  /^qué tal/,
  /^hey/,
  /^alo$/,
  /^aló$/
];

const MODIFICATION_PATTERNS = [
  { pattern: /sin ([\w\s]+)/i, type: 'remove' },
  { pattern: /quit(a|e|ar)(le|me)?\s+(la |el |los |las )?([\w\s]+)/i, type: 'remove', group: 4 },
  { pattern: /con (extra |doble |mas )?([\w\s]+)/i, type: 'add' },
  { pattern: /extra ([\w\s]+)/i, type: 'add' },
  { pattern: /doble ([\w\s]+)/i, type: 'add' },
  { pattern: /agrega(le|me)? ([\w\s]+)/i, type: 'add', group: 2 },
  { pattern: /pon(le|me|ga) ([\w\s]+)/i, type: 'add', group: 2 }
];

const QUANTITY_WORDS = {
  'un': 1, 'uno': 1, 'una': 1,
  'dos': 2, 'un par': 2, 'par': 2,
  'tres': 3, 'cuatro': 4, 'cinco': 5,
  'seis': 6, 'media docena': 6,
  'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
  'once': 11, 'doce': 12, 'docena': 12
};

const PAYMENT_KEYWORDS = {
  'efectivo': 'efectivo',
  'cash': 'efectivo',
  'plata': 'efectivo',
  'billetes': 'efectivo',
  'nequi': 'nequi',
  'daviplata': 'daviplata',
  'davi': 'daviplata',
  'tarjeta': 'tarjeta',
  'débito': 'tarjeta',
  'crédito': 'tarjeta',
  'visa': 'tarjeta',
  'mastercard': 'tarjeta'
};

// ================== EXTRACTORS ==================

function _extractOrderEntities(text, state) {
  const items = [];
  let hasOrderIntent = false;

  // Detect ordering intent (text is already de-accented)
  if (/quiero|dame|deme|pon(me|ga)|trae(me)?|me (da|trae)|necesito|pido|voy a pedir/.test(text)) {
    hasOrderIntent = true;
  }

  // Try to extract "N product" patterns
  // Pattern: (quantity)? (product reference)
  const quantityProductPattern = /(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?([\wáéíóúñ][\wáéíóúñ\s]*)/gi;

  // Simpler approach: look for known keywords
  const words = text.split(/[\s,]+/).filter(w => w.length > 2);

  // Extract quantities and product references
  let currentQty = null;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const twoWords = i < words.length - 1 ? word + ' ' + words[i + 1] : '';
    const threeWords = i < words.length - 2 ? twoWords + ' ' + words[i + 2] : '';

    // Check if it's a quantity
    const num = QUANTITY_WORDS[word] || QUANTITY_WORDS[twoWords] || parseInt(word);
    if (num && num > 0 && num <= 50) {
      currentQty = num;
      continue;
    }

    // Check if following words form a product reference
    // We let the tool orchestrator resolve actual products
    if (hasOrderIntent || currentQty) {
      // Skip filler words
      if (/^(y|con|de|la|el|las|los|unas|unos|para|por|que|más|también|eso|todo|quiero|dame|deme|ponme|una?)$/.test(word)) {
        continue;
      }

      // Build product reference from remaining words
      let productRef = '';
      for (let j = i; j < words.length && j < i + 4; j++) {
        if (/^(y|con|sin|para|por|que|más|también|unas?|unos?|la|el|las|los)$/.test(words[j])) break;
        productRef += (productRef ? ' ' : '') + words[j];
      }

      if (productRef.length > 2) {
        items.push({
          productRef,
          quantity: currentQty || 1
        });
        currentQty = null;
        i += productRef.split(' ').length - 1; // skip words we consumed
      }
    }
  }

  return { items, hasOrderIntent };
}

function _extractRemoveProductRef(text) {
  // Strip remove verbs and articles to get the product name
  let ref = text
    .replace(/^(quit(a|ar|e|ame)(me|le)?\s*)/i, '')
    .replace(/^(sac(a|ar)(me|le)?\s*)/i, '')
    .replace(/^(elimina(r)?\s*)/i, '')
    .replace(/^(borra(r)?\s*)/i, '')
    .replace(/^(ya no quiero\s*)/i, '')
    .replace(/^(no (quiero|va)\s*)/i, '')
    .replace(/^(la|el|una|un|las|los|unas|unos)\s+/i, '')
    .trim();
  return ref || null;
}

function _extractProductReference(text, state) {
  // Remove common prefixes (already de-accented by _normalize)
  let ref = text
    .replace(/^(cuanto (vale|cuesta)|que precio tiene|a como (esta|sale)|tienen|hay)\s*/i, '')
    .replace(/^(la|el|una|un|las|los|unas|unos)\s+/i, '')
    .replace(/[?]/g, '')
    .trim();
  return ref || null;
}

function _extractModification(text) {
  for (const { pattern, type, group } of MODIFICATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const itemText = (match[group || 1] || '').trim();
      // Filter out product names that aren't modifications
      if (itemText.length > 1 && itemText.length < 30) {
        return { type, item: itemText };
      }
    }
  }
  return null;
}

function _extractQuantityChange(text, state) {
  // "que sean N" or "que sean una docena"
  let m = text.match(/que sean (?:una )?(docena|media docena|\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)/i);
  if (m) {
    return { quantity: _extractNumber(m[1]), quantityType: 'absolute' };
  }
  // "mejor N"
  m = text.match(/mejor (?:una )?(docena|media docena|\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)/i);
  if (m) {
    return { quantity: _extractNumber(m[1]), quantityType: 'absolute' };
  }
  // "otra más" / "agrega otra"
  if (/otra más|agrega otra|una más|ponme otra/.test(text)) {
    return { quantity: 1, quantityType: 'relative' };
  }
  // "no, N" when pending question is about quantity
  if (state.pendingQuestion === 'quantity' || /^(no,?\s*)?(\d+|dos|tres|cuatro|cinco)\.?$/.test(text)) {
    const qty = _extractNumber(text);
    if (qty > 0) return { quantity: qty, quantityType: 'absolute' };
  }
  return null;
}

function _extractPaymentMethod(text) {
  for (const [keyword, method] of Object.entries(PAYMENT_KEYWORDS)) {
    if (text.includes(keyword)) return method;
  }
  return null;
}

function _extractPaymentDetails(text) {
  // "billete de 100" or "con 200"
  const m = text.match(/billete de (\d+)|con (\d+(?:\.\d{3})*)/i);
  if (m) {
    const amount = parseInt((m[1] || m[2]).replace(/\./g, '')) * (m[1] || m[2]).length <= 3 ? 1000 : 1;
    return { needsChange: true, changeFrom: amount > 1000 ? amount : amount * 1000 };
  }
  return null;
}

function _extractCategory(text) {
  if (/pizza/.test(text)) return 'Pizzas';
  if (/hamburguesa|burger/.test(text)) return 'Hamburguesas';
  if (/bebida|tomar|gaseosa/.test(text)) return 'Bebidas';
  if (/acompan|papas|aros/.test(text)) return 'Acompañantes';
  if (/combo/.test(text)) return 'Combos';
  return null;
}

function _isConfirmation(text) {
  return /^(si|sep|eso|dale|va|claro|correcto|listo|confirmo|esta bien|perfecto|eso es|si senor|si senora|ok|okay|afirmativo|asi es|por favor|hazlo|si hazlo|confirma|si confirma|si confirmo)\.?$/i.test(text.trim());
}

function _isNegation(text) {
  return /^(no|nel|nop|nah|para nada|espera|corrige|cambia|no esa no|mejor no|todavia no|aun no|no estoy seguro|no se)\.?/i.test(text.trim());
}

function _isNothingMore(text) {
  return /^(no,? (eso es todo|ya|nada mas|eso|mas nada)|eso es todo|nada mas|ya esta|ya|no mas|listo|eso|no nada mas|no gracias|con eso)\.?$/i.test(text.trim());
}

function _classifyNegation(text) {
  if (/cancel|olvida|borra|no quiero nada/.test(text)) return 'cancel_all';
  if (/cambia|corrige|modifica/.test(text)) return 'wants_change';
  if (/espera|todavia|aun|no se/.test(text)) return 'hesitating';
  return 'generic_no';
}

function _looksLikeAddress(text) {
  return /calle|carrera|cra|cr |cl |avenida|av |diagonal|transversal|#|\d+-\d+|apartamento|apto|casa |edificio|torre/i.test(text);
}

function _extractNumber(text) {
  // Try numeric
  const num = parseInt(text.replace(/[^\d]/g, ''));
  if (num > 0 && num <= 50) return num;
  // Try word
  for (const [word, val] of Object.entries(QUANTITY_WORDS)) {
    if (text.includes(word)) return val;
  }
  return 0;
}

function _normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove accents for matching
    .replace(/[¿¡!?.;:,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _matchesAny(text, patterns) {
  return patterns.some(p => p.test(text));
}

function _result(intent, confidence, entities) {
  return { intent, confidence, entities: entities || {} };
}
