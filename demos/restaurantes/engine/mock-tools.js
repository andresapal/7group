/**
 * MOCK TOOLS — Simulates backend responses
 *
 * FASE 9: Multi-tenant aware.
 * Every function receives tenant context and returns ONLY data
 * belonging to that tenant. Isolation is enforced HERE (backend),
 * never trusted from the frontend.
 *
 * In production, this file is replaced by HTTP calls
 * to the real backend API. The interface stays identical.
 */

import { getTenantData, getTenantConfig, getDefaultTenantId } from './tenant-registry.js';

// --- Per-tenant order stores (simulates DB) ---
const _orderStores = new Map();    // tenantId → Map(idempotency_key → order)
const _orderByIdStores = new Map();// tenantId → Map(order_id → order)
const _orderSequences = new Map(); // tenantId → number

// --- KDS Bridge: Broadcast orders to dashboard ---
let _kdsChannel = null;
try { _kdsChannel = new BroadcastChannel('pedidoia_orders'); } catch (_e) { /* SSR/Node safe */ }

// ── HELPERS ──────────────────────────────────────────────────────────

/**
 * Resolve tenant data from context parameter.
 * Context is passed as second argument by tool-orchestrator.
 */
function _td(ctx) {
  const tenantId = (ctx && ctx.tenant_id) || getDefaultTenantId();
  const data = getTenantData(tenantId);
  if (!data) {
    throw new Error('TENANT_NOT_FOUND: ' + tenantId);
  }
  return data;
}

function _tenantId(ctx) {
  return (ctx && ctx.tenant_id) || getDefaultTenantId();
}

function _getOrderStore(tenantId) {
  if (!_orderStores.has(tenantId)) _orderStores.set(tenantId, new Map());
  return _orderStores.get(tenantId);
}

function _getOrderById(tenantId) {
  if (!_orderByIdStores.has(tenantId)) _orderByIdStores.set(tenantId, new Map());
  return _orderByIdStores.get(tenantId);
}

function _getOrderSeq(tenantId) {
  if (!_orderSequences.has(tenantId)) _orderSequences.set(tenantId, 1847);
  return _orderSequences.get(tenantId);
}

function _incOrderSeq(tenantId) {
  const seq = _getOrderSeq(tenantId) + 1;
  _orderSequences.set(tenantId, seq);
  return seq;
}

/**
 * Normalize text for comparison (strip accents, lowercase)
 */
function _norm(text) {
  return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── CATALOG TOOLS ────────────────────────────────────────────────────

/**
 * Search products by query string — fuzzy scoring
 */
export function search_product(args, ctx) {
  const { query, category } = args;
  const PRODUCTS = _td(ctx).products;

  const q = _norm(query);
  if (!q || q.length < 2) return { results: [], count: 0 };

  let scored = PRODUCTS.map(p => {
    const nName = _norm(p.name);
    const nShort = _norm(p.short_name);
    let score = 0;

    const aliasExact = p.aliases.some(a => _norm(a) === q);
    if (aliasExact) score = 1.0;

    if (!score) {
      const aliasPartial = p.aliases.some(a => {
        const na = _norm(a);
        return na.includes(q) || q.includes(na);
      });
      if (aliasPartial) score = 0.85;
    }

    if (!score && nShort === q) score = 0.95;
    if (!score && nShort.includes(q)) score = 0.80;
    if (!score && nName.includes(q)) score = 0.75;
    if (!score && q.includes(nShort) && nShort.length >= 3) score = 0.70;

    if (!score) {
      const nDesc = _norm(p.description);
      if (nDesc.includes(q)) score = 0.40;
    }

    if (!score) {
      const qWords = q.split(/\s+/).filter(w => w.length > 2);
      const pWords = nName.split(/\s+/);
      const overlap = qWords.filter(qw => pWords.some(pw => pw.includes(qw) || qw.includes(pw)));
      if (overlap.length > 0) score = 0.30 + (overlap.length / qWords.length) * 0.3;
    }

    return { product: p, score };
  }).filter(s => s.score > 0);

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
export function get_product(args, ctx) {
  const PRODUCTS = _td(ctx).products;
  const product = PRODUCTS.find(p => p.id === args.product_id);
  if (!product) {
    return { error: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' };
  }
  return {
    id: product.id, name: product.name, description: product.description,
    price: product.price, category: product.category_name,
    ingredients: product.ingredients,
    available_modifiers: product.available_modifiers,
    variants: product.variants || [], includes: product.includes || [],
    available: product.available
  };
}

/**
 * Check product availability
 */
export function check_availability(args, ctx) {
  const PRODUCTS = _td(ctx).products;
  const product = PRODUCTS.find(p => p.id === args.product_id);
  if (!product) return { error: 'PRODUCT_NOT_FOUND' };

  if (!product.available) {
    const alternatives = PRODUCTS
      .filter(p => p.category_id === product.category_id && p.available && p.id !== args.product_id)
      .slice(0, 3)
      .map(p => ({ id: p.id, name: p.name, price: p.price }));
    return { available: false, reason: 'Producto agotado', alternatives };
  }

  return { available: true };
}

/**
 * Get menu (optionally filtered by category)
 */
export function get_menu(args, ctx) {
  const data = _td(ctx);
  let cats = data.categories;
  if (args.category) {
    cats = cats.filter(c => c.name === args.category);
  }

  return {
    categories: cats.map(c => ({
      name: c.name,
      products: data.products
        .filter(p => p.category_id === c.id)
        .map(p => ({ id: p.id, name: p.name, price: p.price, available: p.available, short_desc: p.description }))
    }))
  };
}

/**
 * Get active promotions
 */
export function get_promotions(args, ctx) {
  const PROMOTIONS = _td(ctx).promotions;
  return {
    promotions: PROMOTIONS.filter(p => p.active).map(p => ({
      id: p.id, name: p.name, description: p.description, conditions: p.conditions
    }))
  };
}

/**
 * Get product options
 */
export function get_product_options(args, ctx) {
  const PRODUCTS = _td(ctx).products;
  const product = PRODUCTS.find(p => p.id === args.product_id);
  if (!product) return { error: 'PRODUCT_NOT_FOUND', message: 'Producto no encontrado' };

  const removable = product.ingredients.filter(i => i.length > 2).map(i => ({ name: i, type: 'remove' }));
  const addable = product.available_modifiers
    .filter(m => m.type === 'add' || m.type === 'substitute')
    .map(m => ({ name: m.name, type: m.type, extra_cost: m.price_delta }));

  return {
    product_id: product.id, product_name: product.name,
    ingredients: product.ingredients, removable, addable,
    variants: product.variants || [], includes: product.includes || [],
    available_modifiers: product.available_modifiers.map(m => ({ name: m.name, type: m.type, extra_cost: m.price_delta }))
  };
}

/**
 * Validate if a modification is allowed
 */
export function validate_modification(args, ctx) {
  const PRODUCTS = _td(ctx).products;
  const product = PRODUCTS.find(p => p.id === args.product_id);
  if (!product) return { error: 'PRODUCT_NOT_FOUND' };

  const modItem = _norm(args.modification_item);

  const explicitMod = product.available_modifiers.find(m => {
    const mName = _norm(m.name);
    return mName.includes(modItem) || modItem.includes(mName.replace(/^(sin |extra |doble |con )/, ''));
  });

  if (explicitMod) {
    return { valid: true, modifier_name: explicitMod.name, type: explicitMod.type, price_delta: explicitMod.price_delta };
  }

  if (args.modification_type === 'remove') {
    const ingredient = product.ingredients.find(i => _norm(i).includes(modItem) || modItem.includes(_norm(i)));
    if (ingredient) {
      return { valid: true, modifier_name: `sin ${ingredient}`, type: 'remove', price_delta: 0 };
    }
  }

  return {
    valid: false,
    reason: `"${args.modification_item}" no es una modificacion disponible para ${product.name}`,
    available_modifications: product.available_modifiers.map(m => ({ name: m.name, type: m.type, extra_cost: m.price_delta }))
  };
}

// ── CUSTOMER TOOLS ───────────────────────────────────────────────────

/**
 * Find customer by phone (within tenant)
 */
export function find_customer(args, ctx) {
  if (!args.phone) return { error: 'MISSING_PHONE', message: 'Teléfono requerido' };

  const CUSTOMERS = _td(ctx).customers;
  const normalized = (args.phone || '').replace(/\D/g, '').slice(-10);
  if (normalized.length < 7) return { error: 'INVALID_PHONE', message: 'Número de teléfono inválido' };

  const matches = CUSTOMERS.filter(c => c.phone.replace(/\D/g, '').slice(-10) === normalized);

  if (matches.length === 0) return { found: false };

  if (matches.length > 1) {
    return { found: true, multiple: true, count: matches.length, customers: matches.map(c => ({ id: c.id, name: c.name, phone: c.phone })) };
  }

  const customer = matches[0];
  return {
    found: true, multiple: false,
    customer: { id: customer.id, name: customer.name, phone: customer.phone, addresses: customer.addresses, order_count: customer.order_count, last_order_date: customer.last_order_date }
  };
}

/**
 * Create a new customer (within tenant)
 */
export function create_customer(args, ctx) {
  if (!args.name || typeof args.name !== 'string' || args.name.trim().length < 2) {
    return { error: 'INVALID_NAME', message: 'Nombre requerido (mínimo 2 caracteres)' };
  }
  if (!args.phone) return { error: 'MISSING_PHONE', message: 'Teléfono requerido' };

  const CUSTOMERS = _td(ctx).customers;
  const normalized = (args.phone || '').replace(/\D/g, '').slice(-10);
  if (normalized.length < 7) return { error: 'INVALID_PHONE', message: 'Número de teléfono inválido' };

  const existing = CUSTOMERS.find(c => c.phone.replace(/\D/g, '').slice(-10) === normalized);
  if (existing) return { error: 'CUSTOMER_EXISTS', message: 'Ya existe un cliente con ese teléfono', customer_id: existing.id };

  const newId = 'cust_' + Date.now().toString(36);
  return { customer_id: newId, name: args.name.trim(), phone: normalized };
}

/**
 * Get customer saved addresses
 */
export function get_customer_addresses(args, ctx) {
  const CUSTOMERS = _td(ctx).customers;
  const customer = CUSTOMERS.find(c => c.id === args.customer_id);
  if (!customer) return { addresses: [] };
  return { addresses: customer.addresses };
}

// ── DELIVERY TOOLS ───────────────────────────────────────────────────

/**
 * Validate if address is in delivery zone
 */
export function validate_delivery_zone(args, ctx) {
  const addr = (args.address || '').toLowerCase();

  if (/vereda|kilómetro|km|vía|rural|finca/.test(addr)) {
    return { covered: false, zone_id: null, zone_name: 'Fuera de cobertura' };
  }
  if (/sur|restrepo|rafael uribe|tunjuelito|bosa|kennedy|fontibón/.test(addr)) {
    return { covered: true, zone_id: 'zone_sur', zone_name: 'Zona Sur', estimated_time: '30-40 min' };
  }
  if (/68|américas|engativá|occidente/.test(addr)) {
    return { covered: true, zone_id: 'zone_occidente', zone_name: 'Occidente', estimated_time: '25-35 min' };
  }
  return { covered: true, zone_id: 'zone_norte', zone_name: 'Zona Norte', estimated_time: '20-30 min' };
}

/**
 * Calculate delivery fee and time
 */
export function calculate_delivery(args, ctx) {
  const data = _td(ctx);
  const ZONES = data.zones;
  const config = data.config;

  const zone = ZONES.find(z => z.id === args.zone_id) || ZONES[0];
  return {
    delivery_fee: config.delivery.base_fee + zone.extra_fee,
    estimated_time_min: config.delivery.estimated_time_min,
    estimated_time_max: config.delivery.estimated_time_max
  };
}

// ── ORDER TOOLS ──────────────────────────────────────────────────────

/**
 * Calculate order totals
 */
export function calculate_order(args, ctx) {
  const data = _td(ctx);
  const PRODUCTS = data.products;
  const config = data.config;

  let subtotal = 0;
  const itemsDetail = [];
  const errors = [];

  for (const item of args.items) {
    const product = PRODUCTS.find(p => p.id === item.product_id);
    if (!product) { errors.push({ product_id: item.product_id, error: 'PRODUCT_NOT_FOUND' }); continue; }
    if (!product.available) { errors.push({ product_id: item.product_id, error: 'PRODUCT_UNAVAILABLE' }); continue; }

    let modPrice = 0;
    for (const mod of (item.modifications || [])) {
      const validMod = product.available_modifiers.find(m =>
        m.name.toLowerCase().includes(mod.item.toLowerCase()) ||
        mod.item.toLowerCase().includes(m.name.toLowerCase().replace('sin ', '').replace('extra ', '').replace('doble ', '').replace('con ', ''))
      );
      if (validMod) modPrice += validMod.price_delta;
    }

    const lineTotal = (product.price + modPrice) * item.quantity;
    subtotal += lineTotal;
    itemsDetail.push({ product_id: product.id, name: product.name, quantity: item.quantity, unit_price: product.price, modifications_price: modPrice, line_total: lineTotal });
  }

  if (errors.length > 0) return { error: 'INVALID_ITEMS', details: errors };

  let deliveryFee = 0;
  let estimatedTime = '15-20 min';

  if (args.delivery_type === 'delivery' && args.delivery_address) {
    const zone = validate_delivery_zone({ address: args.delivery_address }, ctx);
    if (!zone.covered) return { error: 'ZONE_NOT_COVERED' };
    const delCalc = calculate_delivery({ address: args.delivery_address, zone_id: zone.zone_id }, ctx);
    deliveryFee = delCalc.delivery_fee;
    estimatedTime = `${delCalc.estimated_time_min}-${delCalc.estimated_time_max} min`;

    if (subtotal >= config.delivery.free_delivery_above) deliveryFee = 0;
  }

  const discounts = [];
  const total = subtotal + deliveryFee - discounts.reduce((s, d) => s + d.amount, 0);

  return { subtotal, items_detail: itemsDetail, delivery_fee: deliveryFee, discounts, tax: 0, total, estimated_time: estimatedTime };
}

/**
 * Create order — TRANSACTIONAL with backend validation + idempotency
 * FASE 9: Order is scoped to tenant. A conversation from Tenant A
 * CANNOT create an order in Tenant B's store.
 */
export function create_order(args, ctx) {
  const tenantId = _tenantId(ctx);
  const data = _td(ctx);
  const PRODUCTS = data.products;
  const config = data.config;
  const orderStore = _getOrderStore(tenantId);
  const orderById = _getOrderById(tenantId);

  const { items, customer_name, customer_phone, delivery_type, delivery_address, payment_method, total, idempotency_key, confirmation_status } = args;

  // --- Idempotency check ---
  if (idempotency_key && orderStore.has(idempotency_key)) {
    const existing = orderStore.get(idempotency_key);
    return { order_id: existing.order_id, order_number: existing.order_number, status: existing.status, total: existing.total, estimated_time: existing.estimated_time, created_at: existing.created_at, idempotent: true };
  }

  // --- Condition 8: Explicit confirmation ---
  if (confirmation_status !== 'confirmed') return { error: 'CONFIRMATION_REQUIRED', message: 'El cliente no ha confirmado el pedido' };

  // --- Condition 1: Items present ---
  if (!items || !Array.isArray(items) || items.length === 0) return { error: 'NO_ITEMS', message: 'El pedido no tiene productos' };

  // --- Conditions 2, 3, 4: Validate each item against THIS TENANT'S catalog ---
  const validatedItems = [];
  let backendSubtotal = 0;

  for (const item of items) {
    if (!item.product_id) return { error: 'INVALID_ITEM', message: 'Producto sin ID' };
    const product = PRODUCTS.find(p => p.id === item.product_id);
    if (!product) return { error: 'PRODUCT_NOT_FOUND', message: `Producto ${item.product_id} no existe en este restaurante` };
    if (!product.available) return { error: 'PRODUCT_UNAVAILABLE', message: `${product.name} no está disponible` };
    const qty = item.quantity;
    if (!qty || qty < 1 || qty > 50 || !Number.isInteger(qty)) return { error: 'INVALID_QUANTITY', message: `Cantidad inválida para ${product.name}` };

    let modPrice = 0;
    for (const mod of (item.modifications || [])) {
      const validMod = product.available_modifiers.find(m =>
        m.name.toLowerCase().includes((mod.item || '').toLowerCase()) ||
        (mod.item || '').toLowerCase().includes(m.name.toLowerCase().replace(/^(sin |extra |doble |con )/, ''))
      );
      if (validMod) modPrice += validMod.price_delta;
    }

    const lineTotal = (product.price + modPrice) * qty;
    backendSubtotal += lineTotal;
    validatedItems.push({ product_id: product.id, name: product.name, quantity: qty, unit_price: product.price, modifications_price: modPrice, line_total: lineTotal });
  }

  // --- Condition 5: Delivery zone valid ---
  let deliveryFee = 0;
  let estimatedTime = '15-20 min';

  if (delivery_type === 'delivery') {
    if (!delivery_address) return { error: 'MISSING_ADDRESS', message: 'Dirección requerida para domicilio' };
    const zone = validate_delivery_zone({ address: delivery_address }, ctx);
    if (!zone.covered) return { error: 'ZONE_NOT_COVERED', message: 'Dirección fuera de cobertura' };
    const delCalc = calculate_delivery({ address: delivery_address, zone_id: zone.zone_id }, ctx);
    deliveryFee = delCalc.delivery_fee;
    estimatedTime = `${delCalc.estimated_time_min}-${delCalc.estimated_time_max} min`;
    if (backendSubtotal >= config.delivery.free_delivery_above) deliveryFee = 0;
  } else if (delivery_type !== 'pickup') {
    return { error: 'INVALID_DELIVERY_TYPE', message: 'Tipo de entrega inválido' };
  }

  // --- Condition 6: Recalculate total ---
  const backendTotal = backendSubtotal + deliveryFee;
  if (total !== undefined && total !== null && Math.abs(backendTotal - total) > 100) {
    return { error: 'TOTAL_MISMATCH', message: `Total enviado ($${total}) no coincide con cálculo ($${backendTotal})`, expected_total: backendTotal };
  }

  // --- Condition 7: Customer info ---
  if (!customer_name || customer_name.trim().length < 2) {
    if (delivery_type === 'delivery') return { error: 'MISSING_CUSTOMER', message: 'Nombre del cliente requerido para domicilio' };
  }
  if (!payment_method) return { error: 'MISSING_PAYMENT', message: 'Método de pago requerido' };

  // --- All validations passed: create the order ---
  const orderNumber = _incOrderSeq(tenantId);
  // FASE 9: include tenant short code so IDs are globally unique
  const tenantCode = tenantId ? tenantId.replace('tenant_', '').substring(0, 3).toUpperCase() : 'DEF';
  const orderId = `P-${tenantCode}-${orderNumber}`;
  const now = new Date().toISOString();

  const order = {
    order_id: orderId, order_number: orderNumber,
    tenant_id: tenantId,          // FASE 9: tenant association
    status: 'confirmado',
    items: validatedItems, subtotal: backendSubtotal,
    delivery_fee: deliveryFee, total: backendTotal,
    delivery_type, delivery_address: delivery_address || null,
    customer_name: (customer_name || 'Cliente').trim(),
    customer_phone: customer_phone || null,
    payment_method, estimated_time: estimatedTime,
    created_at: now, updated_at: now,
    idempotency_key: idempotency_key || null,
    call_id: null, conversation_id: null,
    confirmation_id: idempotency_key || null,
    source: 'voice_agent',
    status_history: [{ status: 'confirmado', timestamp: now, actor: 'voice_agent' }]
  };

  if (idempotency_key) orderStore.set(idempotency_key, order);
  orderById.set(orderId, order);

  // KDS Bridge
  if (_kdsChannel) {
    try {
      _kdsChannel.postMessage({
        type: 'new_order',
        tenant_id: tenantId,
        order: {
          id: orderId, hora: new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
          cliente: order.customer_name, tel: order.customer_phone || '',
          canal: 'Llamada IA',
          items: validatedItems.map(vi => ({ nombre: vi.name, qty: vi.quantity, precio: vi.unit_price })),
          total: backendTotal, dir: order.delivery_address || 'Recoger en local',
          pago: payment_method.charAt(0).toUpperCase() + payment_method.slice(1),
          estado: 'nuevo', minutos: 0
        }
      });
    } catch (_e) { /* broadcast failed, non-critical */ }
  }

  return { order_id: orderId, order_number: orderNumber, status: 'confirmado', total: backendTotal, estimated_time: estimatedTime, created_at: now, idempotent: false };
}

/**
 * Get order status (within tenant)
 */
export function get_order_status(args, ctx) {
  const tenantId = _tenantId(ctx);
  const orderById = _getOrderById(tenantId);

  if (args.order_id) {
    const order = orderById.get(args.order_id);
    if (order) {
      return { order_id: order.order_id, order_number: order.order_number, status: order.status, total: order.total, estimated_time: order.estimated_time, delivery_type: order.delivery_type, created_at: order.created_at };
    }
  }

  if (args.customer_phone) {
    const normalized = (args.customer_phone || '').replace(/\D/g, '').slice(-10);
    for (const [, order] of orderById) {
      if ((order.customer_phone || '').replace(/\D/g, '').slice(-10) === normalized) {
        return { order_id: order.order_id, order_number: order.order_number, status: order.status, total: order.total, estimated_time: order.estimated_time, delivery_type: order.delivery_type, created_at: order.created_at };
      }
    }
  }

  return { error: 'ORDER_NOT_FOUND', message: 'No se encontró un pedido reciente con ese número' };
}

/**
 * Update order (within tenant)
 */
export function update_order(args, ctx) {
  const tenantId = _tenantId(ctx);
  const orderById = _getOrderById(tenantId);

  if (!args.order_id) return { error: 'MISSING_ORDER_ID', message: 'ID de pedido requerido' };
  const order = orderById.get(args.order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado' };
  if (order.status !== 'confirmado') return { error: 'ORDER_NOT_MODIFIABLE', message: `No se puede modificar un pedido en estado "${order.status}"`, current_status: order.status };
  if (!args.changes || typeof args.changes !== 'object') return { error: 'INVALID_CHANGES', message: 'Cambios requeridos' };

  if (args.changes.payment_method) order.payment_method = args.changes.payment_method;
  if (args.changes.delivery_address) order.delivery_address = args.changes.delivery_address;
  if (args.changes.notes !== undefined) order.notes = args.changes.notes;
  order.updated_at = new Date().toISOString();

  return { success: true, order_id: order.order_id, status: order.status, updated_at: order.updated_at };
}

/**
 * Cancel order (within tenant)
 */
export function cancel_order(args, ctx) {
  const tenantId = _tenantId(ctx);
  const orderById = _getOrderById(tenantId);

  if (!args.order_id) return { error: 'MISSING_ORDER_ID', message: 'ID de pedido requerido' };
  const order = orderById.get(args.order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado' };

  const cancellableStates = ['confirmado', 'en_preparacion'];
  if (!cancellableStates.includes(order.status)) {
    return { error: 'ORDER_NOT_CANCELLABLE', message: `No se puede cancelar un pedido en estado "${order.status}".`, current_status: order.status };
  }

  order.status = 'cancelado';
  order.cancel_reason = args.reason || 'Cancelado por cliente';
  order.cancelled_at = new Date().toISOString();
  order.updated_at = order.cancelled_at;
  if (order.status_history) {
    order.status_history.push({ status: 'cancelado', timestamp: order.cancelled_at, actor: 'cliente', reason: order.cancel_reason });
  }

  return { success: true, order_id: order.order_id, status: 'cancelado', cancelled_at: order.cancelled_at };
}

// ── FASE 8: Order lifecycle and audit ────────────────────────────────

const ORDER_STATES = {
  confirmado:      { next: ['en_preparacion', 'cancelado'] },
  en_preparacion:  { next: ['listo', 'cancelado'] },
  listo:           { next: ['despachado'] },
  despachado:      { next: ['entregado'] },
  entregado:       { next: [] },
  cancelado:       { next: [] }
};

export function set_order_audit(args, ctx) {
  const tenantId = _tenantId(ctx);
  const order = _getOrderById(tenantId).get(args.order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND' };
  if (args.call_id) order.call_id = args.call_id;
  if (args.conversation_id) order.conversation_id = args.conversation_id;
  return { success: true };
}

export function advance_order_status(args, ctx) {
  const tenantId = _tenantId(ctx);
  const order = _getOrderById(tenantId).get(args.order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado' };

  const currentConfig = ORDER_STATES[order.status];
  if (!currentConfig || !currentConfig.next.includes(args.new_status)) {
    return { error: 'INVALID_TRANSITION', message: `No se puede cambiar de "${order.status}" a "${args.new_status}"`, current_status: order.status, allowed: currentConfig?.next || [] };
  }

  order.status = args.new_status;
  order.updated_at = new Date().toISOString();
  order.status_history.push({ status: args.new_status, timestamp: order.updated_at, actor: args.actor || 'system' });

  return { success: true, order_id: order.order_id, status: order.status, updated_at: order.updated_at };
}

export function verify_order(args, ctx) {
  const tenantId = _tenantId(ctx);
  const orderStore = _getOrderStore(tenantId);
  const orderById = _getOrderById(tenantId);

  if (args.idempotency_key && orderStore.has(args.idempotency_key)) {
    const order = orderStore.get(args.idempotency_key);
    return { exists: true, order_id: order.order_id, order_number: order.order_number, status: order.status, total: order.total, created_at: order.created_at };
  }
  if (args.order_id && orderById.has(args.order_id)) {
    const order = orderById.get(args.order_id);
    return { exists: true, order_id: order.order_id, order_number: order.order_number, status: order.status, total: order.total, created_at: order.created_at };
  }
  return { exists: false };
}

export function get_active_orders(args, ctx) {
  const tenantId = _tenantId(ctx);
  const orderById = _getOrderById(tenantId);
  const active = [];
  for (const [, order] of orderById) {
    if (!['cancelado', 'entregado'].includes(order.status)) {
      active.push({
        order_id: order.order_id, order_number: order.order_number, status: order.status,
        items: order.items, total: order.total, delivery_type: order.delivery_type,
        delivery_address: order.delivery_address, customer_name: order.customer_name,
        payment_method: order.payment_method, estimated_time: order.estimated_time,
        created_at: order.created_at, source: order.source
      });
    }
  }
  return { orders: active, count: active.length };
}

export function get_order_full(args, ctx) {
  const tenantId = _tenantId(ctx);
  const order = _getOrderById(tenantId).get(args.order_id);
  if (!order) return { error: 'ORDER_NOT_FOUND' };
  return { ...order };
}

// ── OTHER TOOLS ──────────────────────────────────────────────────────

export function request_human(args, ctx) {
  return {
    transfer_available: false,
    estimated_wait: null,
    alternative_contact: 'WhatsApp: 314 309 5194'
  };
}

export function get_restaurant_config(args, ctx) {
  const config = _td(ctx).config;
  return { ...config };
}

// ── RESET (testing) ──────────────────────────────────────────────────

export function _resetOrderStore() {
  _orderStores.clear();
  _orderByIdStores.clear();
  _orderSequences.clear();
}
