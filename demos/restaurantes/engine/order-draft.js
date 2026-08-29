/**
 * ORDER DRAFT
 *
 * Pedido provisional que existe solo durante la conversación.
 * NO es un pedido real. No toca la base de datos.
 * Se puede modificar libremente hasta la confirmación.
 */

/**
 * Create a fresh order draft
 */
export function createOrderDraft() {
  return {
    items: [],
    deliveryType: null,       // 'delivery' | 'pickup' | null
    deliveryAddress: {
      raw: null,
      formatted: null,
      zoneId: null,
      isValid: null
    },
    paymentMethod: null,
    paymentDetails: null,

    // Calculated by backend (mock in this phase)
    subtotal: null,
    deliveryFee: null,
    discounts: [],
    tax: null,
    total: null,
    estimatedTime: null,

    confirmationStatus: 'building' // 'building' | 'reviewing' | 'confirmed' | 'cancelled'
  };
}

/**
 * Add an item to the order
 */
export function addItem(draft, item) {
  const errors = _validateItem(item);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Check if same product already exists (without modifications)
  const existingIdx = draft.items.findIndex(i =>
    i.productId === item.productId &&
    _sameMods(i.modifications, item.modifications || [])
  );

  if (existingIdx !== -1) {
    // Increase quantity
    draft.items[existingIdx].quantity += (item.quantity || 1);
    _recalcLineTotal(draft.items[existingIdx]);
    return { success: true, action: 'increased_quantity', index: existingIdx };
  }

  const newItem = {
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity || 1,
    unitPrice: item.unitPrice,
    modifications: item.modifications || [],
    lineTotal: (item.unitPrice + _modsDelta(item.modifications || [])) * (item.quantity || 1),
    notes: item.notes || '',
    addedAtTurn: item.turn || 0
  };

  draft.items.push(newItem);
  _invalidateCalculation(draft);
  return { success: true, action: 'added', index: draft.items.length - 1 };
}

/**
 * Remove an item by index
 */
export function removeItem(draft, index) {
  if (index < 0 || index >= draft.items.length) {
    return { success: false, errors: ['Índice inválido'] };
  }
  const removed = draft.items.splice(index, 1)[0];
  _invalidateCalculation(draft);
  return { success: true, removed };
}

/**
 * Remove item by product ID (removes first match)
 */
export function removeItemByProductId(draft, productId) {
  const index = draft.items.findIndex(i => i.productId === productId);
  if (index === -1) {
    return { success: false, errors: ['Producto no encontrado en el pedido'] };
  }
  return removeItem(draft, index);
}

/**
 * Remove item by product name (fuzzy match)
 */
export function removeItemByName(draft, name) {
  const lower = name.toLowerCase();
  const index = draft.items.findIndex(i =>
    i.productName.toLowerCase().includes(lower)
  );
  if (index === -1) {
    return { success: false, errors: ['No encontré ese producto en tu pedido'] };
  }
  return removeItem(draft, index);
}

/**
 * Update quantity for an item
 */
export function changeQuantity(draft, index, newQuantity) {
  if (index < 0 || index >= draft.items.length) {
    return { success: false, errors: ['Índice inválido'] };
  }
  if (newQuantity < 1 || newQuantity > 50) {
    return { success: false, errors: ['Cantidad debe ser entre 1 y 50'] };
  }
  draft.items[index].quantity = newQuantity;
  _recalcLineTotal(draft.items[index]);
  _invalidateCalculation(draft);
  return { success: true };
}

/**
 * Add a modification to an item
 */
export function addModification(draft, index, modification) {
  if (index < 0 || index >= draft.items.length) {
    return { success: false, errors: ['Índice inválido'] };
  }

  // Check if this modification already exists
  const exists = draft.items[index].modifications.find(m =>
    m.item === modification.item && m.type === modification.type
  );
  if (exists) {
    return { success: false, errors: ['Esa modificación ya está aplicada'] };
  }

  draft.items[index].modifications.push({
    type: modification.type || 'remove',
    item: modification.item,
    priceDelta: modification.priceDelta || 0
  });
  _recalcLineTotal(draft.items[index]);
  _invalidateCalculation(draft);
  return { success: true };
}

/**
 * Remove a modification from an item
 */
export function removeModification(draft, itemIndex, modItem) {
  if (itemIndex < 0 || itemIndex >= draft.items.length) {
    return { success: false, errors: ['Índice inválido'] };
  }
  const modIdx = draft.items[itemIndex].modifications.findIndex(m =>
    m.item.toLowerCase() === modItem.toLowerCase()
  );
  if (modIdx === -1) {
    return { success: false, errors: ['Modificación no encontrada'] };
  }
  draft.items[itemIndex].modifications.splice(modIdx, 1);
  _recalcLineTotal(draft.items[itemIndex]);
  _invalidateCalculation(draft);
  return { success: true };
}

/**
 * Clear all items
 */
export function clearOrder(draft) {
  draft.items = [];
  draft.deliveryType = null;
  draft.deliveryAddress = { raw: null, formatted: null, zoneId: null, isValid: null };
  draft.paymentMethod = null;
  draft.paymentDetails = null;
  _invalidateCalculation(draft);
  draft.confirmationStatus = 'building';
  return { success: true };
}

/**
 * Set delivery type
 */
export function setDeliveryType(draft, type) {
  if (!['delivery', 'pickup'].includes(type)) {
    return { success: false, errors: ['Tipo de entrega inválido'] };
  }
  draft.deliveryType = type;
  if (type === 'pickup') {
    draft.deliveryAddress = { raw: null, formatted: null, zoneId: null, isValid: null };
    draft.deliveryFee = 0;
  }
  _invalidateCalculation(draft);
  return { success: true };
}

/**
 * Set delivery address
 */
export function setDeliveryAddress(draft, address) {
  draft.deliveryAddress = {
    raw: address.raw || address,
    formatted: address.formatted || null,
    zoneId: address.zoneId || null,
    isValid: address.isValid !== undefined ? address.isValid : null
  };
  return { success: true };
}

/**
 * Set payment method
 */
export function setPaymentMethod(draft, method) {
  draft.paymentMethod = method;
  return { success: true };
}

/**
 * Set payment details (e.g., needs change for cash)
 */
export function setPaymentDetails(draft, details) {
  draft.paymentDetails = details;
  return { success: true };
}

/**
 * Set customer info on draft (for reference)
 */
export function setCustomer(draft, customer) {
  draft.customer = customer;
  return { success: true };
}

/**
 * Update calculation results (from backend/mock)
 */
export function setCalculation(draft, calc) {
  draft.subtotal = calc.subtotal;
  draft.deliveryFee = calc.deliveryFee;
  draft.discounts = calc.discounts || [];
  draft.tax = calc.tax || 0;
  draft.total = calc.total;
  draft.estimatedTime = calc.estimatedTime || null;
  return { success: true };
}

/**
 * Get list of missing required info
 */
export function getMissingInfo(draft) {
  const missing = [];
  if (draft.items.length === 0) missing.push('items');
  if (!draft.deliveryType) missing.push('delivery_type');
  if (draft.deliveryType === 'delivery' && !draft.deliveryAddress.raw) missing.push('delivery_address');
  if (draft.deliveryType === 'delivery' && draft.deliveryAddress.raw && draft.deliveryAddress.isValid === false) missing.push('valid_delivery_address');
  if (!draft.paymentMethod) missing.push('payment_method');
  return missing;
}

/**
 * Get the next required question
 */
export function getNextRequiredInfo(draft) {
  const missing = getMissingInfo(draft);
  if (missing.length === 0) return null;

  // Priority order
  const priority = ['items', 'delivery_type', 'delivery_address', 'valid_delivery_address', 'payment_method'];
  for (const field of priority) {
    if (missing.includes(field)) return field;
  }
  return missing[0];
}

/**
 * Check if order is ready for confirmation
 */
export function isReadyForConfirmation(draft) {
  return getMissingInfo(draft).length === 0;
}

/**
 * Generate summary text
 */
export function getSummary(draft, formatPrice) {
  const fmt = formatPrice || (n => '$' + Number(n).toLocaleString('es-CO'));

  if (draft.items.length === 0) {
    return { text: 'Pedido vacío', items: [] };
  }

  const itemLines = draft.items.map(item => {
    let line = `${item.quantity}x ${item.productName}`;
    if (item.modifications.length > 0) {
      const modStr = item.modifications.map(m =>
        m.type === 'remove' ? `sin ${m.item}` :
        m.type === 'add' ? `con ${m.item}` :
        m.item
      ).join(', ');
      line += ` (${modStr})`;
    }
    line += ` — ${fmt(item.lineTotal)}`;
    return line;
  });

  let text = itemLines.join('\n');

  if (draft.deliveryType === 'delivery') {
    text += `\nDomicilio a ${draft.deliveryAddress.raw || '(sin dirección)'}`;
  } else if (draft.deliveryType === 'pickup') {
    text += '\nPara recoger en local';
  }

  if (draft.paymentMethod) {
    text += `\nPago: ${draft.paymentMethod}`;
  }

  if (draft.total !== null) {
    if (draft.subtotal !== null && draft.subtotal !== draft.total) {
      text += `\nSubtotal: ${fmt(draft.subtotal)}`;
    }
    if (draft.deliveryFee > 0) {
      text += `\nDomicilio: ${fmt(draft.deliveryFee)}`;
    }
    if (draft.discounts.length > 0) {
      draft.discounts.forEach(d => {
        text += `\nDescuento (${d.name}): -${fmt(d.amount)}`;
      });
    }
    text += `\nTotal: ${fmt(draft.total)}`;
  }

  if (draft.estimatedTime) {
    text += `\nTiempo estimado: ${draft.estimatedTime}`;
  }

  return {
    text,
    items: draft.items,
    deliveryType: draft.deliveryType,
    deliveryAddress: draft.deliveryAddress.raw,
    paymentMethod: draft.paymentMethod,
    subtotal: draft.subtotal,
    deliveryFee: draft.deliveryFee,
    discounts: draft.discounts,
    total: draft.total,
    estimatedTime: draft.estimatedTime
  };
}

/**
 * Find item index by name (fuzzy)
 */
export function findItemByName(draft, name) {
  const lower = name.toLowerCase();
  return draft.items.findIndex(i =>
    i.productName.toLowerCase().includes(lower)
  );
}

/**
 * Find item index by product ID
 */
export function findItemByProductId(draft, productId) {
  return draft.items.findIndex(i => i.productId === productId);
}

// --- Internal helpers ---

function _validateItem(item) {
  const errors = [];
  if (!item.productId) errors.push('productId requerido');
  if (!item.productName) errors.push('productName requerido');
  if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) errors.push('unitPrice inválido');
  if (item.quantity !== undefined && (item.quantity < 1 || item.quantity > 50)) errors.push('Cantidad debe ser entre 1 y 50');
  return errors;
}

function _modsDelta(mods) {
  return mods.reduce((sum, m) => sum + (m.priceDelta || 0), 0);
}

function _sameMods(a, b) {
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.item === b[i]?.item && m.type === b[i]?.type);
}

function _recalcLineTotal(item) {
  item.lineTotal = (item.unitPrice + _modsDelta(item.modifications)) * item.quantity;
}

function _invalidateCalculation(draft) {
  // When items change, server-calculated totals are stale
  draft.subtotal = null;
  draft.total = null;
  draft.deliveryFee = null;
  draft.discounts = [];
  draft.tax = null;
  draft.confirmationStatus = 'building';
}
