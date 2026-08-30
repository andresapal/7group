/**
 * MOCK TOOLS — Simulates backend responses
 *
 * This layer simulates the tools the agent uses.
 * It reads from mock-data.js (NOT from the conversation engine).
 *
 * In production, this file is replaced by HTTP calls
 * to the real backend API. The interface stays identical.
 *
 * FASE 4 additions:
 * - Idempotent create_order (idempotency key prevents duplicates)
 * - Backend-side validation for create_order (8 conditions)
 * - Order store for status/update/cancel
 * - Improved find_customer (multiple match handling)
 * - Improved create_customer (field validation)
 */

import { PRODUCTS, CATEGORIES, PROMOTIONS, DELIVERY_ZONES, CUSTOMERS, RESTAURANT_CONFIG } from './mock-data.js';

// --- In-memory order store (simulates DB) ---
const _orderStore = new Map();   // idempotency_key → order
const _orderById = new Map();    // order_id → order
let _orderSequence = 1847;       // next order number

/**
 * Normalize text for comparison (strip accents, lowercase)
 */
function _norm(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Search products by query string — fuzzy scoring
 */
export function search_product({ query, category, restaurant_id }) {
  const q = _norm(query);
  if (!q || q.length < 2) return { results: [], count: 0 };

  let scored = PRODUCTS.map(p => {
    const nName = _norm(p.name);
    const nShort = _norm(p.short_name);
    let score = 0;

    // Exact alias match (highest)
    const aliasExact = p.aliases.some(a => _norm(a) === q);
    if (aliasExact) score = 1.0;

    // Alias contains query or query contains alias
    if (!score) {
      const aliasPartial = p.aliases.some(a => {
        const na = _norm(a);
        return na.includes(q) || q.includes(na);
      });
      if (aliasPartial) score = 0.85;
    }

    // Short name exact
    if (!score && nShort === q) score = 0.95;

    // Short name contains
    if (!score && nShort.includes(q)) score = 0.80;

    // Name contains
    if (!score && nName.includes(q)) score = 0.75;

    // Query contains short name (user said more than product name)
    if (!score && q.includes(nShort) && nShort.length >= 3) score = 0.70;

    // Description contains
    if (!score) {
      const nDesc = _norm(p.description);
      if (nDesc.includes(q)) score = 0.40;
    }

    // Word overlap scoring (for multi-word queries)
    if (!score) {
      const qWords = q.split(/\s+/).filter(w => w.length > 2);
      const pWords = nName.split(/\s+/);
      const overlap = qWords.filter(qw => pWords.some(pw => pw.includes(qw) || qw.includes(pw)));
      if (overlap.length > 0) score = 0.30 + (overlap.length / qWords.length) * 0.3;
    }

    return { product: p, score };
  }).filter(s => s.score > 0);

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  if (category) {
    scored = scored.filter(s => s.product.category_name === category);
  }

  return {
    results: scored.map(s => ({
      id: s.product.id,
      name: s.product.name,
      category: s.product.category_name,
      price: s.product.price,
      available: s.product.available,
      short_desc: s.product.description,
      score: s.score
    })),
    count: scored.length
  };
}

/**
 * Get full product details
 */
export function get_product({ product_id }) {
  const product = PRODUCTS.find(p => p.id === product_id);
  if (!product) {
    return { error: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' };
  }
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    category: product.category_name,
    ingredients: product.ingredients,
    available_modifiers: product.available_modifiers,
    variants: product.variants || [],
    includes: product.includes || [],
    available: product.available
  };
}

/**
 * Check product availability
 */
export function check_availability({ product_id, quantity }) {
  const product = PRODUCTS.find(p => p.id === product_id);
  if (!product) {
    return { error: 'PRODUCT_NOT_FOUND' };
  }

  // In demo, all products with available=true are available
  if (!product.available) {
    // Find alternatives in same category
    const alternatives = PRODUCTS
      .filter(p => p.category_id === product.category_id && p.available && p.id !== product_id)
      .slice(0, 3)
      .map(p => ({ id: p.id, name: p.name, price: p.price }));

    return {
      available: false,
      reason: 'Producto agotado',
      alternatives
    };
  }

  return { available: true };
}

/**
 * Get menu (optionally filtered by category)
 */
export function get_menu({ category }) {
  let cats = CATEGORIES;
  if (category) {
    cats = cats.filter(c => c.name === category);
  }

  return {
    categories: cats.map(c => ({
      name: c.name,
      products: PRODUCTS
        .filter(p => p.category_id === c.id)
        .map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          available: p.available,
          short_desc: p.description
        }))
    }))
  };
}

/**
 * Get active promotions
 */
export function get_promotions() {
  // Only return active promotions with customer-facing info (no internal data)
  return {
    promotions: PROMOTIONS.filter(p => p.active).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      conditions: p.conditions
    }))
  };
}

/**
 * Get product options — modifiers, variants, ingredients (customer-facing only)
 * Filters out internal data (costs, margins, provider info)
 */
export function get_product_options({ product_id }) {
  const product = PRODUCTS.find(p => p.id === product_id);
  if (!product) {
    return { error: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' };
  }

  // Build removable items from ingredients
  const removable = product.ingredients
    .filter(i => i.length > 2)
    .map(i => ({ name: i, type: 'remove' }));

  // Build addable items from available_modifiers
  const addable = product.available_modifiers
    .filter(m => m.type === 'add' || m.type === 'substitute')
    .map(m => ({
      name: m.name,
      type: m.type,
      extra_cost: m.price_delta
    }));

  return {
    product_id: product.id,
    product_name: product.name,
    ingredients: product.ingredients,
    removable,
    addable,
    variants: product.variants || [],
    includes: product.includes || [],
    available_modifiers: product.available_modifiers.map(m => ({
      name: m.name,
      type: m.type,
      extra_cost: m.price_delta
    }))
  };
}

/**
 * Validate if a modification is allowed for a product
 */
export function validate_modification({ product_id, modification_type, modification_item }) {
  const product = PRODUCTS.find(p => p.id === product_id);
  if (!product) {
    return { error: 'PRODUCT_NOT_FOUND' };
  }

  const modItem = _norm(modification_item);

  // Check explicit modifiers list
  const explicitMod = product.available_modifiers.find(m => {
    const mName = _norm(m.name);
    return mName.includes(modItem) || modItem.includes(mName.replace(/^(sin |extra |doble |con )/, ''));
  });

  if (explicitMod) {
    return {
      valid: true,
      modifier_name: explicitMod.name,
      type: explicitMod.type,
      price_delta: explicitMod.price_delta
    };
  }

  // For remove type, check if the ingredient exists
  if (modification_type === 'remove') {
    const ingredient = product.ingredients.find(i =>
      _norm(i).includes(modItem) || modItem.includes(_norm(i))
    );
    if (ingredient) {
      return {
        valid: true,
        modifier_name: `sin ${ingredient}`,
        type: 'remove',
        price_delta: 0
      };
    }
  }

  // Not valid — return available options
  return {
    valid: false,
    reason: `"${modification_item}" no es una modificacion disponible para ${product.name}`,
    available_modifications: product.available_modifiers.map(m => ({
      name: m.name,
      type: m.type,
      extra_cost: m.price_delta
    }))
  };
}

/**
 * Find customer by phone
 * Returns: found (single) | multiple | not_found | error
 */
export function find_customer({ phone }) {
  if (!phone) return { error: 'MISSING_PHONE', message: 'Teléfono requerido' };

  const normalized = (phone || '').replace(/\D/g, '').slice(-10);
  if (normalized.length < 7) return { error: 'INVALID_PHONE', message: 'Número de teléfono inválido' };

  const matches = CUSTOMERS.filter(c =>
    c.phone.replace(/\D/g, '').slice(-10) === normalized
  );

  if (matches.length === 0) {
    return { found: false };
  }

  if (matches.length > 1) {
    return {
      found: true,
      multiple: true,
      count: matches.length,
      customers: matches.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone
      }))
    };
  }

  const customer = matches[0];
  return {
    found: true,
    multiple: false,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      addresses: customer.addresses,
      order_count: customer.order_count,
      last_order_date: customer.last_order_date
    }
  };
}

/**
 * Create a new customer — validates required fields
 */
export function create_customer({ name, phone, address }) {
  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return { error: 'INVALID_NAME', message: 'Nombre requerido (mínimo 2 caracteres)' };
  }
  if (!phone) {
    return { error: 'MISSING_PHONE', message: 'Teléfono requerido' };
  }
  const normalized = (phone || '').replace(/\D/g, '').slice(-10);
  if (normalized.length < 7) {
    return { error: 'INVALID_PHONE', message: 'Número de teléfono inválido' };
  }

  // Check if customer already exists
  const existing = CUSTOMERS.find(c =>
    c.phone.replace(/\D/g, '').slice(-10) === normalized
  );
  if (existing) {
    return { error: 'CUSTOMER_EXISTS', message: 'Ya existe un cliente con ese teléfono', customer_id: existing.id };
  }

  const newId = 'cust_' + Date.now().toString(36);
  return {
    customer_id: newId,
    name: name.trim(),
    phone: normalized
  };
}

/**
 * Get customer saved addresses
 */
export function get_customer_addresses({ customer_id }) {
  const customer = CUSTOMERS.find(c => c.id === customer_id);
  if (!customer) return { addresses: [] };
  return { addresses: customer.addresses };
}

/**
 * Validate if address is in delivery zone
 */
export function validate_delivery_zone({ address }) {
  const addr = (address || '').toLowerCase();

  // Simple heuristic for demo — match zone by keywords
  if (/vereda|kilómetro|km|vía|rural|finca/.test(addr)) {
    return { covered: false, zone_id: null, zone_name: 'Fuera de cobertura' };
  }
  if (/sur|restrepo|rafael uribe|tunjuelito|bosa|kennedy|fontibón/.test(addr)) {
    return { covered: true, zone_id: 'zone_sur', zone_name: 'Zona Sur', estimated_time: '30-40 min' };
  }
  if (/68|américas|engativá|occidente/.test(addr)) {
    return { covered: true, zone_id: 'zone_occidente', zone_name: 'Occidente', estimated_time: '25-35 min' };
  }
  // Default: covered (norte/centro)
  return { covered: true, zone_id: 'zone_norte', zone_name: 'Zona Norte', estimated_time: '20-30 min' };
}

/**
 * Calculate delivery fee and time
 */
export function calculate_delivery({ address, zone_id }) {
  const zone = DELIVERY_ZONES.find(z => z.id === zone_id) || DELIVERY_ZONES[0];
  const config = RESTAURANT_CONFIG.delivery;

  return {
    delivery_fee: config.base_fee + zone.extra_fee,
    estimated_time_min: config.estimated_time_min,
    estimated_time_max: config.estimated_time_max
  };
}

/**
 * Calculate order totals (THIS is the source of truth for prices)
 */
export function calculate_order({ items, delivery_type, delivery_address, promotion_code }) {
  let subtotal = 0;
  const itemsDetail = [];
  const errors = [];

  for (const item of items) {
    const product = PRODUCTS.find(p => p.id === item.product_id);
    if (!product) {
      errors.push({ product_id: item.product_id, error: 'PRODUCT_NOT_FOUND' });
      continue;
    }
    if (!product.available) {
      errors.push({ product_id: item.product_id, error: 'PRODUCT_UNAVAILABLE' });
      continue;
    }

    let modPrice = 0;
    const validMods = [];
    for (const mod of (item.modifications || [])) {
      const validMod = product.available_modifiers.find(m =>
        m.name.toLowerCase().includes(mod.item.toLowerCase()) ||
        mod.item.toLowerCase().includes(m.name.toLowerCase().replace('sin ', '').replace('extra ', '').replace('doble ', '').replace('con ', ''))
      );
      if (validMod) {
        modPrice += validMod.price_delta;
        validMods.push({ name: validMod.name, price_delta: validMod.price_delta });
      }
      // If modifier not found, ignore (don't fail — just won't be applied)
    }

    const lineTotal = (product.price + modPrice) * item.quantity;
    subtotal += lineTotal;

    itemsDetail.push({
      product_id: product.id,
      name: product.name,
      quantity: item.quantity,
      unit_price: product.price,
      modifications_price: modPrice,
      line_total: lineTotal
    });
  }

  if (errors.length > 0) {
    return { error: 'INVALID_ITEMS', details: errors };
  }

  let deliveryFee = 0;
  let estimatedTime = '15-20 min';

  if (delivery_type === 'delivery' && delivery_address) {
    const zone = validate_delivery_zone({ address: delivery_address });
    if (!zone.covered) {
      return { error: 'ZONE_NOT_COVERED' };
    }
    const delCalc = calculate_delivery({ address: delivery_address, zone_id: zone.zone_id });
    deliveryFee = delCalc.delivery_fee;
    estimatedTime = `${delCalc.estimated_time_min}-${delCalc.estimated_time_max} min`;

    // Free delivery above threshold
    if (subtotal >= RESTAURANT_CONFIG.delivery.free_delivery_above) {
      deliveryFee = 0;
    }
  }

  const discounts = [];
  // Promotion handling would go here

  const total = subtotal + deliveryFee - discounts.reduce((s, d) => s + d.amount, 0);

  return {
    subtotal,
    items_detail: itemsDetail,
    delivery_fee: deliveryFee,
    discounts,
    tax: 0,
    total,
    estimated_time: estimatedTime
  };
}

/**
 * Create order — TRANSACTIONAL with backend validation + idempotency
 *
 * 8 conditions MUST be met (validated here, not trusted from agent):
 * 1. Items present and non-empty
 * 2. All products exist in catalog
 * 3. All prices match system prices (not agent-supplied)
 * 4. All products available
 * 5. Delivery zone valid (when delivery)
 * 6. Total calculated by backend (recalculated here)
 * 7. Customer info present
 * 8. Explicit confirmation received (confirmationStatus === 'confirmed')
 *
 * Idempotency: same idempotency_key returns same order, never creates duplicate.
 */
export function create_order({ items, customer_name, customer_phone, delivery_type, delivery_address, payment_method, total, idempotency_key, confirmation_status }) {
  // --- Idempotency check ---
  if (idempotency_key && _orderStore.has(idempotency_key)) {
    const existing = _orderStore.get(idempotency_key);
    return {
      order_id: existing.order_id,
      order_number: existing.order_number,
      status: existing.status,
      total: existing.total,
      estimated_time: existing.estimated_time,
      created_at: existing.created_at,
      idempotent: true   // signal: this was NOT a new creation
    };
  }

  // --- Condition 8: Explicit confirmation ---
  if (confirmation_status !== 'confirmed') {
    return { error: 'CONFIRMATION_REQUIRED', message: 'El cliente no ha confirmado el pedido' };
  }

  // --- Condition 1: Items present ---
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { error: 'NO_ITEMS', message: 'El pedido no tiene productos' };
  }

  // --- Conditions 2, 3, 4: Validate each item against catalog ---
  const validatedItems = [];
  let backendSubtotal = 0;

  for (const item of items) {
    if (!item.product_id) {
      return { error: 'INVALID_ITEM', message: 'Producto sin ID' };
    }
    const product = PRODUCTS.find(p => p.id === item.product_id);
    if (!product) {
      return { error: 'PRODUCT_NOT_FOUND', message: `Producto ${item.product_id} no existe` };
    }
    if (!product.available) {
      return { error: 'PRODUCT_UNAVAILABLE', message: `${product.name} no está disponible` };
    }
    const qty = item.quantity;
    if (!qty || qty < 1 || qty > 50 || !Number.isInteger(qty)) {
      return { error: 'INVALID_QUANTITY', message: `Cantidad inválida para ${product.name}` };
    }

    // Validate modifications and calculate mod price from system
    let modPrice = 0;
    for (const mod of (item.modifications || [])) {
      const validMod = product.available_modifiers.find(m =>
        m.name.toLowerCase().includes((mod.item || '').toLowerCase()) ||
        (mod.item || '').toLowerCase().includes(m.name.toLowerCase().replace(/^(sin |extra |doble |con )/, ''))
      );
      if (validMod) {
        modPrice += validMod.price_delta;
      }
      // Unknown mods silently ignored (don't fail the order)
    }

    const lineTotal = (product.price + modPrice) * qty;
    backendSubtotal += lineTotal;

    validatedItems.push({
      product_id: product.id,
      name: product.name,
      quantity: qty,
      unit_price: product.price,
      modifications_price: modPrice,
      line_total: lineTotal
    });
  }

  // --- Condition 5: Delivery zone valid ---
  let deliveryFee = 0;
  let estimatedTime = '15-20 min';

  if (delivery_type === 'delivery') {
    if (!delivery_address) {
      return { error: 'MISSING_ADDRESS', message: 'Dirección requerida para domicilio' };
    }
    const zone = validate_delivery_zone({ address: delivery_address });
    if (!zone.covered) {
      return { error: 'ZONE_NOT_COVERED', message: 'Dirección fuera de cobertura' };
    }
    const delCalc = calculate_delivery({ address: delivery_address, zone_id: zone.zone_id });
    deliveryFee = delCalc.delivery_fee;
    estimatedTime = `${delCalc.estimated_time_min}-${delCalc.estimated_time_max} min`;

    if (backendSubtotal >= RESTAURANT_CONFIG.delivery.free_delivery_above) {
      deliveryFee = 0;
    }
  } else if (delivery_type !== 'pickup') {
    return { error: 'INVALID_DELIVERY_TYPE', message: 'Tipo de entrega inválido' };
  }

  // --- Condition 6: Recalculate total from backend ---
  const backendTotal = backendSubtotal + deliveryFee;

  // If agent sent a total, verify it matches (tolerance $100 for rounding)
  if (total !== undefined && total !== null && Math.abs(backendTotal - total) > 100) {
    return {
      error: 'TOTAL_MISMATCH',
      message: `Total enviado ($${total}) no coincide con cálculo ($${backendTotal})`,
      expected_total: backendTotal
    };
  }

  // --- Condition 7: Customer info ---
  if (!customer_name || customer_name.trim().length < 2) {
    // Allow anonymous for pickup, but always try to have a name
    if (delivery_type === 'delivery') {
      return { error: 'MISSING_CUSTOMER', message: 'Nombre del cliente requerido para domicilio' };
    }
  }

  if (!payment_method) {
    return { error: 'MISSING_PAYMENT', message: 'Método de pago requerido' };
  }

  // --- All validations passed: create the order atomically ---
  const orderNumber = ++_orderSequence;
  const orderId = 'P-' + orderNumber;
  const now = new Date().toISOString();

  const order = {
    order_id: orderId,
    order_number: orderNumber,
    status: 'confirmado',
    items: validatedItems,
    subtotal: backendSubtotal,
    delivery_fee: deliveryFee,
    total: backendTotal,
    delivery_type,
    delivery_address: delivery_address || null,
    customer_name: (customer_name || 'Cliente').trim(),
    customer_phone: customer_phone || null,
    payment_method,
    estimated_time: estimatedTime,
    created_at: now,
    updated_at: now,
    idempotency_key: idempotency_key || null,
    // FASE 8: Audit trail
    call_id: null,            // set by caller via set_order_audit
    conversation_id: null,    // set by caller via set_order_audit
    confirmation_id: idempotency_key || null,
    source: 'voice_agent',
    // FASE 8: Order lifecycle history
    status_history: [
      { status: 'confirmado', timestamp: now, actor: 'voice_agent' }
    ]
  };

  // Store for idempotency and future lookups
  if (idempotency_key) {
    _orderStore.set(idempotency_key, order);
  }
  _orderById.set(orderId, order);

  // Return only customer-facing info
  return {
    order_id: orderId,
    order_number: orderNumber,
    status: 'confirmado',
    total: backendTotal,
    estimated_time: estimatedTime,
    created_at: now,
    idempotent: false
  };
}

/**
 * Get order status — looks up in order store
 */
export function get_order_status({ order_id, customer_phone }) {
  // Lookup by order_id first
  if (order_id) {
    const order = _orderById.get(order_id);
    if (order) {
      return {
        order_id: order.order_id,
        order_number: order.order_number,
        status: order.status,
        total: order.total,
        estimated_time: order.estimated_time,
        delivery_type: order.delivery_type,
        created_at: order.created_at
      };
    }
  }

  // Lookup by phone (most recent)
  if (customer_phone) {
    const normalized = (customer_phone || '').replace(/\D/g, '').slice(-10);
    for (const [, order] of _orderById) {
      if ((order.customer_phone || '').replace(/\D/g, '').slice(-10) === normalized) {
        return {
          order_id: order.order_id,
          order_number: order.order_number,
          status: order.status,
          total: order.total,
          estimated_time: order.estimated_time,
          delivery_type: order.delivery_type,
          created_at: order.created_at
        };
      }
    }
  }

  return {
    error: 'ORDER_NOT_FOUND',
    message: 'No se encontró un pedido reciente con ese número'
  };
}

/**
 * Update order — only allowed in certain states
 */
export function update_order({ order_id, changes }) {
  if (!order_id) return { error: 'MISSING_ORDER_ID', message: 'ID de pedido requerido' };

  const order = _orderById.get(order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado' };

  // Only allow updates in 'confirmado' status (before preparation)
  if (order.status !== 'confirmado') {
    return {
      error: 'ORDER_NOT_MODIFIABLE',
      message: `No se puede modificar un pedido en estado "${order.status}"`,
      current_status: order.status
    };
  }

  if (!changes || typeof changes !== 'object') {
    return { error: 'INVALID_CHANGES', message: 'Cambios requeridos' };
  }

  // Apply allowed changes
  if (changes.payment_method) order.payment_method = changes.payment_method;
  if (changes.delivery_address) order.delivery_address = changes.delivery_address;
  if (changes.notes !== undefined) order.notes = changes.notes;
  order.updated_at = new Date().toISOString();

  return {
    success: true,
    order_id: order.order_id,
    status: order.status,
    updated_at: order.updated_at
  };
}

/**
 * Cancel order — validates status before cancelling
 */
export function cancel_order({ order_id, reason }) {
  if (!order_id) return { error: 'MISSING_ORDER_ID', message: 'ID de pedido requerido' };

  const order = _orderById.get(order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado' };

  // Only allow cancellation in certain states (FASE 8: confirmado or en_preparacion)
  const cancellableStates = ['confirmado', 'en_preparacion'];
  if (!cancellableStates.includes(order.status)) {
    return {
      error: 'ORDER_NOT_CANCELLABLE',
      message: `No se puede cancelar un pedido en estado "${order.status}". Solo se puede cancelar antes de que salga a despacho.`,
      current_status: order.status
    };
  }

  order.status = 'cancelado';
  order.cancel_reason = reason || 'Cancelado por cliente';
  order.cancelled_at = new Date().toISOString();
  order.updated_at = order.cancelled_at;
  if (order.status_history) {
    order.status_history.push({ status: 'cancelado', timestamp: order.cancelled_at, actor: 'cliente', reason: order.cancel_reason });
  }

  return {
    success: true,
    order_id: order.order_id,
    status: 'cancelado',
    cancelled_at: order.cancelled_at
  };
}

/**
 * Reset order store (for testing)
 */
export function _resetOrderStore() {
  _orderStore.clear();
  _orderById.clear();
  _orderSequence = 1847;
}

// ── FASE 8: Order lifecycle and audit ──────────────────

/**
 * Valid order states and transitions
 */
const ORDER_STATES = {
  confirmado:      { next: ['en_preparacion', 'cancelado'] },
  en_preparacion:  { next: ['listo', 'cancelado'] },
  listo:           { next: ['despachado'] },
  despachado:      { next: ['entregado'] },
  entregado:       { next: [] },
  cancelado:       { next: [] }
};

/**
 * Set audit info on a created order
 */
export function set_order_audit({ order_id, call_id, conversation_id }) {
  const order = _orderById.get(order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND' };
  if (call_id) order.call_id = call_id;
  if (conversation_id) order.conversation_id = conversation_id;
  return { success: true };
}

/**
 * Advance order status (for KDS / operations)
 */
export function advance_order_status({ order_id, new_status, actor }) {
  const order = _orderById.get(order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado' };

  const currentConfig = ORDER_STATES[order.status];
  if (!currentConfig || !currentConfig.next.includes(new_status)) {
    return {
      error: 'INVALID_TRANSITION',
      message: `No se puede cambiar de "${order.status}" a "${new_status}"`,
      current_status: order.status,
      allowed: currentConfig?.next || []
    };
  }

  order.status = new_status;
  order.updated_at = new Date().toISOString();
  order.status_history.push({
    status: new_status,
    timestamp: order.updated_at,
    actor: actor || 'system'
  });

  return {
    success: true,
    order_id: order.order_id,
    status: order.status,
    updated_at: order.updated_at
  };
}

/**
 * Verify if an order exists (for uncertain state recovery)
 */
export function verify_order({ idempotency_key, order_id }) {
  // Check by idempotency key first (most reliable)
  if (idempotency_key && _orderStore.has(idempotency_key)) {
    const order = _orderStore.get(idempotency_key);
    return {
      exists: true,
      order_id: order.order_id,
      order_number: order.order_number,
      status: order.status,
      total: order.total,
      created_at: order.created_at
    };
  }

  // Check by order_id
  if (order_id && _orderById.has(order_id)) {
    const order = _orderById.get(order_id);
    return {
      exists: true,
      order_id: order.order_id,
      order_number: order.order_number,
      status: order.status,
      total: order.total,
      created_at: order.created_at
    };
  }

  return { exists: false };
}

/**
 * Get all active orders (for KDS dashboard)
 */
export function get_active_orders() {
  const active = [];
  for (const [, order] of _orderById) {
    if (!['cancelado', 'entregado'].includes(order.status)) {
      active.push({
        order_id: order.order_id,
        order_number: order.order_number,
        status: order.status,
        items: order.items,
        total: order.total,
        delivery_type: order.delivery_type,
        delivery_address: order.delivery_address,
        customer_name: order.customer_name,
        payment_method: order.payment_method,
        estimated_time: order.estimated_time,
        created_at: order.created_at,
        source: order.source
      });
    }
  }
  return { orders: active, count: active.length };
}

/**
 * Get full order with audit trail (for monitoring)
 */
export function get_order_full({ order_id }) {
  const order = _orderById.get(order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND' };
  return { ...order };
}

/**
 * Request human transfer (mock)
 */
export function request_human({ call_id, reason }) {
  return {
    transfer_available: false,
    estimated_wait: null,
    alternative_contact: 'WhatsApp: 314 309 5194'
  };
}

/**
 * Get restaurant config
 */
export function get_restaurant_config() {
  return { ...RESTAURANT_CONFIG };
}
