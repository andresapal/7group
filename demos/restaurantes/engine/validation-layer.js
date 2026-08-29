/**
 * VALIDATION LAYER
 *
 * Validates data at each stage of the conversation pipeline.
 * Catches problems BEFORE they reach tools or the order draft.
 *
 * Rules:
 * - Agent NEVER invents prices (backend is source of truth)
 * - Agent NEVER allows negative quantities
 * - Agent NEVER adds unavailable products
 * - Agent NEVER confirms without all required info
 * - Agent NEVER creates order without explicit confirmation
 */

/**
 * Validate an item before adding to draft
 */
export function validateItemForDraft(product, quantity) {
  const errors = [];

  if (!product) {
    errors.push({ field: 'product', code: 'MISSING', message: 'Producto no identificado' });
    return { valid: false, errors };
  }

  if (!product.id) {
    errors.push({ field: 'product.id', code: 'MISSING', message: 'ID de producto faltante' });
  }

  if (!product.name) {
    errors.push({ field: 'product.name', code: 'MISSING', message: 'Nombre de producto faltante' });
  }

  if (product.price === undefined || product.price === null || product.price < 0) {
    errors.push({ field: 'product.price', code: 'INVALID', message: 'Precio inválido' });
  }

  if (!product.available) {
    errors.push({ field: 'product.available', code: 'UNAVAILABLE', message: `${product.name} no está disponible` });
  }

  if (!quantity || quantity < 1 || quantity > 99) {
    errors.push({ field: 'quantity', code: 'INVALID', message: `Cantidad inválida: ${quantity}` });
  }

  if (!Number.isInteger(quantity)) {
    errors.push({ field: 'quantity', code: 'NOT_INTEGER', message: 'La cantidad debe ser entera' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a modification before applying
 */
export function validateModification(mod, product) {
  const errors = [];

  if (!mod || !mod.item) {
    errors.push({ field: 'mod.item', code: 'MISSING', message: 'Modificación no especificada' });
    return { valid: false, errors };
  }

  if (!mod.type || !['add', 'remove'].includes(mod.type)) {
    errors.push({ field: 'mod.type', code: 'INVALID', message: 'Tipo de modificación inválido' });
  }

  // Check if modifier is valid for the product
  if (product && product.available_modifiers) {
    const validNames = product.available_modifiers.map(m => m.name.toLowerCase());
    const modLower = mod.item.toLowerCase();
    const isValid = validNames.some(n =>
      n.includes(modLower) || modLower.includes(n.replace(/^(sin |extra |doble |con )/, ''))
    );
    if (!isValid) {
      errors.push({
        field: 'mod.item',
        code: 'NOT_AVAILABLE',
        message: `${mod.item} no está disponible para ${product.name}`,
        validOptions: product.available_modifiers.map(m => m.name)
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate order draft before confirmation review
 */
export function validateDraftForReview(draft) {
  const errors = [];

  if (!draft.items || draft.items.length === 0) {
    errors.push({ field: 'items', code: 'EMPTY', message: 'El pedido está vacío' });
    return { valid: false, errors };
  }

  // Each item must have valid data
  for (let i = 0; i < draft.items.length; i++) {
    const item = draft.items[i];
    if (!item.productId) {
      errors.push({ field: `items[${i}].productId`, code: 'MISSING', message: 'Producto sin ID' });
    }
    if (!item.unitPrice || item.unitPrice < 0) {
      errors.push({ field: `items[${i}].unitPrice`, code: 'INVALID', message: 'Precio unitario inválido' });
    }
    if (!item.quantity || item.quantity < 1) {
      errors.push({ field: `items[${i}].quantity`, code: 'INVALID', message: 'Cantidad inválida' });
    }
  }

  // Delivery type must be set
  if (!draft.deliveryType) {
    errors.push({ field: 'deliveryType', code: 'MISSING', message: 'Tipo de entrega no seleccionado' });
  }

  // If delivery, address must be set and valid
  if (draft.deliveryType === 'delivery') {
    if (!draft.deliveryAddress || !draft.deliveryAddress.raw) {
      errors.push({ field: 'deliveryAddress', code: 'MISSING', message: 'Dirección de entrega faltante' });
    }
    if (draft.deliveryAddress && !draft.deliveryAddress.isValid) {
      errors.push({ field: 'deliveryAddress', code: 'INVALID', message: 'Dirección fuera de cobertura' });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate order draft before creating the actual order
 */
export function validateDraftForOrder(draft) {
  const reviewErrors = validateDraftForReview(draft);
  if (!reviewErrors.valid) return reviewErrors;

  const errors = [];

  if (draft.confirmationStatus !== 'confirmed') {
    errors.push({ field: 'confirmationStatus', code: 'NOT_CONFIRMED', message: 'Pedido no confirmado por el cliente' });
  }

  if (!draft.total || draft.total <= 0) {
    errors.push({ field: 'total', code: 'INVALID', message: 'Total no calculado' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a price came from backend, not from agent memory
 */
export function validatePriceSource(price, calculatedPrice) {
  if (price === undefined || price === null) return false;
  if (calculatedPrice === undefined || calculatedPrice === null) return false;
  return price === calculatedPrice;
}

/**
 * Sanitize user input — remove potential injection patterns
 * This is defense-in-depth; the main protection is that
 * user messages are always treated as DATA, never instructions.
 */
export function sanitizeInput(text) {
  if (!text) return '';

  // Remove control characters
  let clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Trim to reasonable length (voice messages are short)
  clean = clean.slice(0, 500);

  return clean.trim();
}
