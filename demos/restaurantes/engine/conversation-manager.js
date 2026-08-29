/**
 * CONVERSATION MANAGER
 *
 * Central coordinator for the voice agent's brain.
 * Receives user messages, processes them through the pipeline:
 *   Message → Context → Intent → State → Tools → Response
 *
 * Does NOT handle audio/voice/telephony. Works with text in FASE 2.
 * Designed so STT output plugs in as input and TTS takes the output.
 */

import { STATES, INTENTS, createConversationState, transitionState, recordMessage, recordProductMention, getLastMentionedProduct, recordError, isTerminal, getStateSnapshot } from './conversation-state.js';
import { createOrderDraft, addItem, removeItem, removeItemByName, changeQuantity, addModification, removeModification, clearOrder, setDeliveryType, setDeliveryAddress, setPaymentMethod, setCalculation, getMissingInfo, getNextRequiredInfo, isReadyForConfirmation, getSummary, findItemByName, findItemByProductId } from './order-draft.js';
import { detectIntent, extractQuantity } from './intent-detector.js';
import { executeTool } from './tool-orchestrator.js';
import * as Logger from './logger.js';

/**
 * Create a new conversation engine instance
 */
export function createConversation(restaurantId, callerPhone) {
  const state = createConversationState(restaurantId, callerPhone);
  const draft = createOrderDraft();

  // Load restaurant config
  const configResult = executeTool('get_restaurant_config', {}, {});
  const config = configResult.success ? configResult.data : {};

  // Try to find existing customer
  if (callerPhone) {
    const custResult = executeTool('find_customer', { phone: callerPhone }, {});
    if (custResult.success && custResult.data.found) {
      state.customer.id = custResult.data.customer.id;
      state.customer.name = custResult.data.customer.name;
      state.customer.isNew = false;
      state.customer.addresses = custResult.data.customer.addresses || [];
    } else {
      state.customer.isNew = true;
    }
  }

  return {
    state,
    draft,
    config
  };
}

/**
 * Generate the initial greeting
 */
export function getGreeting(conv) {
  const { state, config } = conv;
  const name = config.agent_name || 'Ana';
  const business = config.name || 'el restaurante';

  let greeting;
  if (state.customer.name) {
    greeting = `Hola ${state.customer.name}, soy ${name}, asistente virtual de ${business}. ¿Qué vas a pedir hoy?`;
  } else {
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? 'días' : hour < 18 ? 'tardes' : 'noches';
    greeting = `Hola, buenas ${timeGreeting}. Soy ${name}, asistente virtual de ${business}. ¿Qué te gustaría pedir?`;
  }

  transitionState(state, STATES.UNDERSTANDING);
  recordMessage(state, 'agent', greeting);
  Logger.logAgentMessage(state.conversationId, greeting);
  Logger.logStateChange(state.conversationId, STATES.GREETING, STATES.UNDERSTANDING, 'greeting sent');

  return greeting;
}

/**
 * Process a user message and return the agent's response
 *
 * Input contract: { conversationId, channel, userInput, timestamp }
 * Output contract: { conversationId, response, state, intent, needsTool, needsConfirmation }
 *
 * @param {object} conv - Conversation context { state, draft, config }
 * @param {string} userInput - The user's message text
 * @returns {{ response: string, state: string, intent: string, debug: object }}
 */
export function processMessage(conv, userInput) {
  const { state, draft, config } = conv;
  const prevState = state.currentState;

  // 1. Record user message
  recordMessage(state, 'user', userInput);
  Logger.logUserMessage(state.conversationId, userInput);

  // 2. Check if conversation is already terminal
  if (isTerminal(state)) {
    return _response(conv, 'Esta conversación ya finalizó. Puedes llamar de nuevo cuando quieras.');
  }

  // 3. Detect intent
  const { intent, confidence, entities } = detectIntent(userInput, state, draft);
  state.currentIntent = intent;
  Logger.logIntent(state.conversationId, intent, confidence, entities);

  // 4. Reset misunderstanding counter on successful detection
  if (intent !== INTENTS.UNKNOWN) {
    state.misunderstandingCount = 0;
  }

  // 5. Route by intent
  let response;
  try {
    response = _routeIntent(conv, intent, confidence, entities);
  } catch (err) {
    Logger.logError(state.conversationId, err, { intent, entities });
    recordError(state, 'conversation_manager', err, true);
    response = 'Estoy teniendo un problema. ¿Me repites lo que necesitas?';
  }

  // 6. Log state change if it happened
  if (state.currentState !== prevState) {
    Logger.logStateChange(state.conversationId, prevState, state.currentState, intent);
  }

  // 7. Record agent response
  recordMessage(state, 'agent', response);
  Logger.logAgentMessage(state.conversationId, response);

  return _response(conv, response);
}

// ==================== INTENT ROUTING ====================

function _routeIntent(conv, intent, confidence, entities) {
  const { state, draft } = conv;

  // Low confidence — ask for clarification
  if (confidence < 0.5 && intent === INTENTS.UNKNOWN) {
    return _handleUnknown(conv);
  }

  // Intercept: ORDER intent with paymentMethod goes to payment handler
  if ((intent === INTENTS.ORDER || intent === INTENTS.ADD_ITEM) && entities.paymentMethod) {
    return _handlePayment(conv, entities);
  }

  switch (intent) {
    case INTENTS.ORDER:
    case INTENTS.ADD_ITEM:
      return _handleAddItem(conv, entities);

    case INTENTS.REMOVE_ITEM:
      return _handleRemoveItem(conv, entities);

    case INTENTS.MODIFY_ITEM:
      return _handleModifyItem(conv, entities);

    case INTENTS.CHANGE_QUANTITY:
      return _handleChangeQuantity(conv, entities);

    case INTENTS.ASK_PRICE:
      return _handleAskPrice(conv, entities);

    case INTENTS.ASK_PRODUCT:
      return _handleAskProduct(conv, entities);

    case INTENTS.ASK_AVAILABILITY:
      return _handleAskAvailability(conv, entities);

    case INTENTS.ASK_OPTIONS:
      return _handleAskOptions(conv, entities);

    case INTENTS.PROMOTION:
      return _handlePromotion(conv);

    case INTENTS.DELIVERY:
      return _handleDelivery(conv, entities);

    case INTENTS.PICKUP:
      return _handlePickup(conv);

    case INTENTS.ORDER_STATUS:
      return _handleOrderStatus(conv);

    case INTENTS.CANCEL_ORDER:
      return _handleCancel(conv);

    case INTENTS.HELP:
      return _handleHelp(conv);

    case INTENTS.HUMAN_REQUEST:
      return _handleHumanRequest(conv);

    case INTENTS.CONFIRM_YES:
      return _handleConfirmYes(conv);

    case INTENTS.CONFIRM_NO:
      return _handleConfirmNo(conv, entities);

    case INTENTS.NOTHING_MORE:
      return _handleNothingMore(conv);

    case INTENTS.UNKNOWN:
    default:
      return _handleUnknown(conv);
  }
}

// ==================== HANDLERS ====================

function _handleAddItem(conv, entities) {
  const { state, draft } = conv;
  transitionState(state, STATES.COLLECTING_ORDER);

  // If greeting with no product info
  if (entities.isGreeting || (entities.items && entities.items.length === 0 && entities.hasOrderIntent)) {
    state.pendingQuestion = 'which_product';
    return '¿Qué te gustaría pedir?';
  }

  // If we need clarification
  if (entities.needsClarification) {
    state.pendingQuestion = 'which_product';
    return '¿Qué más quieres agregar?';
  }

  // Process each item
  const addedItems = [];
  const failedItems = [];

  const items = entities.items || [];
  if (items.length === 0 && entities.productRef) {
    items.push({ productRef: entities.productRef, quantity: 1 });
  }

  for (const itemRef of items) {
    const result = _resolveAndAddProduct(conv, itemRef.productRef, itemRef.quantity || 1);
    if (result.success) {
      addedItems.push(result);
    } else {
      failedItems.push(result);
    }
  }

  // Build response
  let response = '';

  if (addedItems.length > 0) {
    if (addedItems.length === 1) {
      const a = addedItems[0];
      response = `${a.quantity > 1 ? a.quantity + ' ' : ''}${a.productName}. `;
    } else {
      response = addedItems.map(a =>
        `${a.quantity > 1 ? a.quantity + ' ' : ''}${a.productName}`
      ).join(', ') + '. ';
    }
  }

  if (failedItems.length > 0) {
    for (const f of failedItems) {
      if (f.reason === 'ambiguous') {
        state.pendingQuestion = 'which_product';
        const options = f.options.map(o => o.name).join(', ');
        response += `¿Cuál quieres? ${options}`;
        return response;
      } else if (f.reason === 'not_found') {
        response += `No encontré "${f.query}" en nuestro menú. `;
        const menuResult = executeTool('get_menu', {}, { conversationState: state });
        if (menuResult.success) {
          const cats = menuResult.data.categories.map(c => c.name.toLowerCase()).join(', ');
          response += `Tenemos ${cats}.`;
        }
        state.pendingQuestion = 'which_product';
        return response;
      } else if (f.reason === 'unavailable') {
        response += `${f.productName} no está disponible. `;
        if (f.alternatives && f.alternatives.length > 0) {
          response += `¿Quieres ${f.alternatives.map(a => a.name).join(' o ')}?`;
        }
        state.pendingQuestion = 'which_product';
        return response;
      }
    }
  }

  if (addedItems.length > 0) {
    // Check if any added product has variants that need selection
    for (const a of addedItems) {
      if (a.variants && a.variants.length > 0) {
        state.pendingQuestion = 'variant_selection';
        state._pendingVariantProductId = a.productId;
        response += `¿De cuál sabor? ${a.variants.join(', ')}.`;
        return response;
      }
    }
    state.pendingQuestion = 'anything_else';
    response += '¿Algo más?';
  }

  return response || '¿Qué producto quieres agregar?';
}

function _handleRemoveItem(conv, entities) {
  const { state, draft } = conv;

  if (draft.items.length === 0) {
    return 'No tienes productos en el pedido todavía.';
  }

  const productRef = entities.productRef;
  if (!productRef) {
    state.pendingQuestion = 'which_to_remove';
    const itemList = draft.items.map((it, i) => `${it.quantity}x ${it.productName}`).join(', ');
    return `¿Cuál quieres quitar? Tienes: ${itemList}`;
  }

  const result = removeItemByName(draft, productRef);
  if (result.success) {
    state.pendingQuestion = 'anything_else';
    transitionState(state, STATES.COLLECTING_ORDER);
    if (draft.items.length === 0) {
      return `Quité ${result.removed.productName}. Tu pedido quedó vacío. ¿Qué quieres pedir?`;
    }
    return `Listo, quité ${result.removed.productName}. ¿Algo más?`;
  }

  return `No encontré ese producto en tu pedido.`;
}

function _handleModifyItem(conv, entities) {
  const { state, draft } = conv;

  if (draft.items.length === 0) {
    return 'No tienes productos para modificar. ¿Qué quieres pedir?';
  }

  const mod = entities.modification;
  if (!mod) {
    return '¿Qué modificación quieres hacer?';
  }

  // Find which item to modify
  let targetIdx = -1;
  if (entities.targetProduct) {
    targetIdx = findItemByName(draft, entities.targetProduct);
  }
  if (targetIdx === -1) {
    // Use last mentioned product
    const last = getLastMentionedProduct(state);
    if (last) targetIdx = findItemByProductId(draft, last.productId);
  }
  if (targetIdx === -1 && draft.items.length === 1) {
    targetIdx = 0;
  }
  if (targetIdx === -1) {
    state.pendingQuestion = 'which_to_modify';
    const itemList = draft.items.map(it => it.productName).join(', ');
    return `¿A cuál producto le hago el cambio? Tienes: ${itemList}`;
  }

  // Validate modification via tool
  const valResult = executeTool('validate_modification', {
    product_id: draft.items[targetIdx].productId,
    modification_type: mod.type,
    modification_item: mod.item
  }, { conversationState: state });

  if (mod.type === 'remove') {
    // Check if it's undoing a previous modification
    const existingMod = draft.items[targetIdx].modifications.find(m =>
      m.item.toLowerCase().includes(mod.item.toLowerCase())
    );
    if (existingMod) {
      removeModification(draft, targetIdx, existingMod.item);
      transitionState(state, STATES.COLLECTING_ORDER);
      state.pendingQuestion = 'anything_else';
      return `Listo, le quité el cambio de ${mod.item} a ${draft.items[targetIdx].productName}. ¿Algo más?`;
    }

    // Validate: can this ingredient be removed?
    if (valResult.success && valResult.data.valid) {
      addModification(draft, targetIdx, { type: 'remove', item: mod.item, priceDelta: 0 });
      transitionState(state, STATES.COLLECTING_ORDER);
      state.pendingQuestion = 'anything_else';
      return `${draft.items[targetIdx].productName} sin ${mod.item}. ¿Algo más?`;
    } else if (valResult.success && !valResult.data.valid) {
      // Invalid removal — product doesn't have that ingredient
      let resp = `${draft.items[targetIdx].productName} no lleva ${mod.item}.`;
      if (valResult.data.available_modifications && valResult.data.available_modifications.length > 0) {
        const removes = valResult.data.available_modifications.filter(m => m.type === 'remove');
        if (removes.length > 0) {
          resp += ` Puedes quitar: ${removes.map(m => m.name.replace('sin ', '')).join(', ')}.`;
        }
      }
      return resp;
    }
    // Fallback: allow the modification (graceful degradation)
    addModification(draft, targetIdx, { type: 'remove', item: mod.item, priceDelta: 0 });
    transitionState(state, STATES.COLLECTING_ORDER);
    state.pendingQuestion = 'anything_else';
    return `${draft.items[targetIdx].productName} sin ${mod.item}. ¿Algo más?`;
  } else {
    // Add modifier — validate it
    if (valResult.success && valResult.data.valid) {
      const priceDelta = valResult.data.price_delta || 0;
      addModification(draft, targetIdx, { type: 'add', item: mod.item, priceDelta });
      transitionState(state, STATES.COLLECTING_ORDER);
      state.pendingQuestion = 'anything_else';
      if (priceDelta > 0) {
        return `${draft.items[targetIdx].productName} con ${mod.item} (+${_fmt(priceDelta)}). ¿Algo más?`;
      }
      return `${draft.items[targetIdx].productName} con ${mod.item}. ¿Algo más?`;
    } else if (valResult.success && !valResult.data.valid) {
      // Invalid addition
      let resp = `No podemos agregar "${mod.item}" a ${draft.items[targetIdx].productName}.`;
      if (valResult.data.available_modifications && valResult.data.available_modifications.length > 0) {
        const adds = valResult.data.available_modifications.filter(m => m.type === 'add' || m.type === 'substitute');
        if (adds.length > 0) {
          resp += ` Opciones disponibles: ${adds.map(m => m.name + (m.extra_cost > 0 ? ' (+' + _fmt(m.extra_cost) + ')' : '')).join(', ')}.`;
        }
      }
      return resp;
    }
    // Fallback
    addModification(draft, targetIdx, { type: 'add', item: mod.item, priceDelta: 0 });
    transitionState(state, STATES.COLLECTING_ORDER);
    state.pendingQuestion = 'anything_else';
    return `${draft.items[targetIdx].productName} con ${mod.item}. ¿Algo más?`;
  }
}

function _handleChangeQuantity(conv, entities) {
  const { state, draft } = conv;

  if (draft.items.length === 0) {
    return 'No tienes productos en el pedido. ¿Qué quieres pedir?';
  }

  let qty = entities.quantity;
  if (!qty || qty < 1) {
    state.pendingQuestion = 'quantity';
    return '¿Cuántas quieres?';
  }

  // Find target item
  let targetIdx = -1;
  if (entities.productRef) {
    targetIdx = findItemByName(draft, entities.productRef);
  }
  if (targetIdx === -1) {
    const last = getLastMentionedProduct(state);
    if (last) targetIdx = findItemByProductId(draft, last.productId);
  }
  if (targetIdx === -1 && draft.items.length === 1) {
    targetIdx = 0;
  }

  if (targetIdx === -1) {
    state.pendingQuestion = 'which_to_change';
    return '¿De cuál producto cambio la cantidad?';
  }

  if (entities.quantityType === 'relative') {
    qty = draft.items[targetIdx].quantity + qty;
  }

  changeQuantity(draft, targetIdx, qty);
  transitionState(state, STATES.COLLECTING_ORDER);
  state.pendingQuestion = 'anything_else';
  return `Perfecto, ${qty} ${draft.items[targetIdx].productName}. ¿Algo más?`;
}

function _handleAskPrice(conv, entities) {
  const { state } = conv;
  const productRef = entities.productRef;

  if (!productRef) {
    state.pendingQuestion = 'which_product_price';
    return '¿De cuál producto quieres saber el precio?';
  }

  const searchResult = executeTool('search_product', { query: productRef }, { conversationState: state });
  Logger.logToolCall(state.conversationId, 'search_product', { query: productRef });
  Logger.logToolResult(state.conversationId, 'search_product', searchResult, searchResult.latencyMs);

  if (!searchResult.success || searchResult.data.count === 0) {
    return `No encontré "${productRef}" en el menú.`;
  }

  if (searchResult.data.count === 1) {
    const p = searchResult.data.results[0];
    recordProductMention(state, p.id, p.name);
    return `${p.name} está en ${_fmt(p.price)}.`;
  }

  // Multiple results — record the top result for context
  const topResult = searchResult.data.results[0];
  if (topResult.score && topResult.score >= 0.7) {
    recordProductMention(state, topResult.id, topResult.name);
  }
  const prices = searchResult.data.results.slice(0, 4).map(p => `${p.name}: ${_fmt(p.price)}`).join(', ');
  return `Tenemos: ${prices}`;
}

function _handleAskProduct(conv, entities) {
  const { state } = conv;
  const category = entities.category;

  const menuResult = executeTool('get_menu', { category }, { conversationState: state });
  Logger.logToolCall(state.conversationId, 'get_menu', { category });
  Logger.logToolResult(state.conversationId, 'get_menu', menuResult, menuResult.latencyMs);

  if (!menuResult.success) {
    return 'No pude consultar el menú en este momento.';
  }

  if (category) {
    const cat = menuResult.data.categories[0];
    if (!cat || cat.products.length === 0) {
      return `No tenemos productos en esa categoría.`;
    }
    const list = cat.products.slice(0, 5).map(p =>
      `${p.name} (${_fmt(p.price)})`
    ).join(', ');
    return `En ${cat.name} tenemos: ${list}. ¿Cuál te gustaría?`;
  }

  // General — list categories
  const cats = menuResult.data.categories.map(c => c.name.toLowerCase()).join(', ');
  state.pendingQuestion = 'which_category';
  return `Tenemos ${cats}. ¿Qué se te antoja?`;
}

function _handleAskAvailability(conv, entities) {
  const { state } = conv;
  const productRef = entities.productRef;

  if (!productRef) {
    return '¿Cuál producto quieres consultar?';
  }

  const searchResult = executeTool('search_product', { query: productRef }, { conversationState: state });
  if (!searchResult.success || searchResult.data.count === 0) {
    return `No encontré "${productRef}" en el menú.`;
  }

  const product = searchResult.data.results[0];
  const availResult = executeTool('check_availability', { product_id: product.id }, { conversationState: state });

  if (availResult.success && availResult.data.available) {
    return `Sí, tenemos ${product.name} disponible. ¿La agrego al pedido?`;
  }

  let resp = `${product.name} no está disponible en este momento.`;
  if (availResult.data && availResult.data.alternatives && availResult.data.alternatives.length > 0) {
    resp += ` ¿Quieres ${availResult.data.alternatives.map(a => a.name).join(' o ')}?`;
  }
  return resp;
}

function _handleAskOptions(conv, entities) {
  const { state, draft } = conv;
  let productRef = entities.productRef;

  // Detect "sin X" pattern — user is asking if a modification is valid
  const userMsg = (state.lastUserMessage || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const sinMatch = userMsg.match(/sin\s+([\w\s]+?)(\?|$)/);
  if (sinMatch) {
    const modItem = sinMatch[1].trim();
    // Resolve product from context: last mentioned or single draft item
    let targetProductId = null;
    let targetProductName = null;
    const last = getLastMentionedProduct(state);
    if (last) {
      targetProductId = last.productId;
      targetProductName = last.productName;
    } else if (draft.items.length === 1) {
      targetProductId = draft.items[0].productId;
      targetProductName = draft.items[0].productName;
    }

    if (targetProductId) {
      const valResult = executeTool('validate_modification', {
        product_id: targetProductId,
        modification_type: 'remove',
        modification_item: modItem
      }, { conversationState: state });

      if (valResult.success && valResult.data.valid) {
        return `Sí, puedes pedir ${targetProductName} sin ${modItem}. ¿La agrego al pedido?`;
      } else if (valResult.success && !valResult.data.valid) {
        let resp = `${targetProductName} no lleva ${modItem}.`;
        if (valResult.data.available_modifications && valResult.data.available_modifications.length > 0) {
          const removes = valResult.data.available_modifications.filter(m => m.type === 'remove');
          if (removes.length > 0) {
            resp += ` Puedes quitar: ${removes.map(m => m.name.replace('sin ', '')).join(', ')}.`;
          }
        }
        return resp;
      }
    }
  }

  // If no product specified, try last mentioned or single item in draft
  if (!productRef) {
    const last = getLastMentionedProduct(state);
    if (last) {
      // Use product id directly
      const optResult = executeTool('get_product_options', { product_id: last.productId }, {});
      if (optResult.success) {
        return _formatProductOptions(optResult.data);
      }
    }
    if (draft.items.length === 1) {
      const optResult = executeTool('get_product_options', { product_id: draft.items[0].productId }, {});
      if (optResult.success) {
        return _formatProductOptions(optResult.data);
      }
    }
    state.pendingQuestion = 'which_product';
    return '¿De cuál producto quieres saber las opciones?';
  }

  // Search for the product
  const searchResult = executeTool('search_product', { query: productRef }, { conversationState: state });
  if (!searchResult.success || searchResult.data.count === 0) {
    return `No encontré "${productRef}" en el menú.`;
  }

  const product = searchResult.data.results[0];
  const optResult = executeTool('get_product_options', { product_id: product.id }, {});
  if (!optResult.success) {
    return 'No pude consultar las opciones en este momento.';
  }

  recordProductMention(state, product.id, product.name);
  return _formatProductOptions(optResult.data);
}

function _formatProductOptions(options) {
  let resp = `${options.product_name}:\n`;

  if (options.ingredients.length > 0) {
    resp += `Trae: ${options.ingredients.join(', ')}.\n`;
  }

  if (options.includes && options.includes.length > 0) {
    resp += `Incluye: ${options.includes.join(', ')}.\n`;
  }

  if (options.variants && options.variants.length > 0) {
    resp += `Variantes: ${options.variants.join(', ')}.\n`;
  }

  const removes = options.available_modifiers.filter(m => m.type === 'remove');
  const adds = options.available_modifiers.filter(m => m.type === 'add' || m.type === 'substitute');

  if (removes.length > 0) {
    resp += `Puedes quitar: ${removes.map(m => m.name.replace('sin ', '')).join(', ')}.\n`;
  }

  if (adds.length > 0) {
    const addList = adds.map(m => {
      if (m.extra_cost > 0) return `${m.name} (+${_fmt(m.extra_cost)})`;
      return m.name;
    }).join(', ');
    resp += `Puedes agregar: ${addList}.`;
  }

  if (removes.length === 0 && adds.length === 0) {
    resp += 'Este producto no tiene modificaciones disponibles.';
  }

  return resp;
}

function _handlePromotion(conv) {
  const { state } = conv;
  const result = executeTool('get_promotions', {}, { conversationState: state });
  Logger.logToolCall(state.conversationId, 'get_promotions', {});
  Logger.logToolResult(state.conversationId, 'get_promotions', result, result.latencyMs);

  if (!result.success || result.data.promotions.length === 0) {
    return 'En este momento no tenemos promociones activas. ¿Quieres ver el menú?';
  }

  const promos = result.data.promotions.slice(0, 3);
  if (promos.length === 1) {
    return `Tenemos esta promoción: ${promos[0].description}. ${promos[0].conditions || ''} ¿Te interesa?`;
  }
  const promoList = promos.map((p, i) => `${i + 1}. ${p.description}`).join('\n');
  return `Tenemos estas promociones:\n${promoList}\n¿Te interesa alguna?`;
}

function _handleDelivery(conv, entities) {
  const { state, draft } = conv;

  if (draft.items.length === 0) {
    transitionState(state, STATES.UNDERSTANDING);
    return 'Primero necesitamos armar tu pedido. ¿Qué te gustaría pedir?';
  }

  setDeliveryType(draft, 'delivery');

  // If address was provided
  if (entities.address) {
    return _processAddress(conv, entities.address);
  }

  transitionState(state, STATES.CUSTOMER_DATA);

  // Check if customer has saved addresses
  if (state.customer.addresses && state.customer.addresses.length > 0) {
    const addr = state.customer.addresses[0];
    state.pendingQuestion = 'confirm_address';
    return `¿Te lo envío a ${addr.address}?`;
  }

  state.pendingQuestion = 'address';
  return '¿Cuál es tu dirección?';
}

function _handlePickup(conv) {
  const { state, draft } = conv;

  if (draft.items.length === 0) {
    return 'Primero necesitamos armar tu pedido. ¿Qué te gustaría pedir?';
  }

  setDeliveryType(draft, 'pickup');
  return _advanceToNextRequired(conv);
}

function _handleOrderStatus(conv) {
  const { state } = conv;
  const result = executeTool('get_order_status', {
    customer_phone: state.customer.phone
  }, { conversationState: state });

  if (!result.success || result.data.error) {
    return 'No encontré un pedido reciente con tu número. ¿Quieres hacer un pedido nuevo?';
  }

  return `Tu pedido ${result.data.order_id} está ${result.data.status}. Tiempo estimado: ${result.data.estimated_time_remaining || 'no disponible'}.`;
}

function _handleCancel(conv) {
  const { state, draft } = conv;

  // If a real order was created, try to cancel it via backend
  if (draft.confirmationStatus === 'order_created' && draft.orderId) {
    const cancelResult = executeTool('cancel_order', {
      order_id: draft.orderId,
      reason: 'Cancelado por cliente'
    }, { conversationState: state });

    Logger.logToolCall(state.conversationId, 'cancel_order', { order_id: draft.orderId });
    Logger.logToolResult(state.conversationId, 'cancel_order', cancelResult, cancelResult.latencyMs);

    if (cancelResult.success) {
      clearOrder(draft);
      transitionState(state, STATES.CANCELLED);
      state.pendingQuestion = null;
      return 'Listo, tu pedido fue cancelado. ¿Hay algo más en que te pueda ayudar?';
    } else {
      const reason = cancelResult.data && cancelResult.data.message ? cancelResult.data.message : 'No se pudo cancelar.';
      return reason + ' ¿Necesitas algo más?';
    }
  }

  if (draft.confirmationStatus === 'confirmed') {
    return 'Tu pedido ya fue confirmado. ¿Quieres que intente cancelarlo?';
  }

  clearOrder(draft);
  transitionState(state, STATES.CANCELLED);
  state.pendingQuestion = null;
  return 'Listo, cancelé el pedido. ¿Hay algo más en que te pueda ayudar?';
}

function _handleHelp(conv) {
  const { state } = conv;
  state.pendingQuestion = 'which_category';
  return 'Con gusto te ayudo. ¿Prefieres pizza, hamburguesa o un combo?';
}

function _handlePayment(conv, entities) {
  const { state, draft } = conv;

  if (!entities.paymentMethod) {
    state.pendingQuestion = 'payment_method';
    return '¿Cómo vas a pagar?';
  }

  setPaymentMethod(draft, entities.paymentMethod);
  state.pendingQuestion = null;
  return _advanceToNextRequired(conv);
}

function _handleHumanRequest(conv) {
  const { state } = conv;
  const result = executeTool('request_human', {
    call_id: state.conversationId,
    reason: 'Cliente solicita hablar con persona'
  }, { conversationState: state });

  transitionState(state, STATES.HUMAN_REQUEST);

  if (result.success && result.data.transfer_available) {
    return 'Claro, te paso con una persona. Un momento.';
  }

  const alt = result.data && result.data.alternative_contact ? ` Puedes contactarnos por ${result.data.alternative_contact}.` : '';
  return `En este momento no hay una persona disponible.${alt} ¿Puedo ayudarte yo con tu pedido?`;
}

function _handleConfirmYes(conv) {
  const { state, draft } = conv;

  // Context-dependent yes
  if (state.currentState === STATES.WAITING_CONFIRMATION) {
    draft.confirmationStatus = 'confirmed';
    transitionState(state, STATES.CONFIRMED);

    // FASE 4: Actually create the order via create_order tool
    const idempotencyKey = state.conversationId + '_confirmed';
    const orderItems = draft.items.map(i => ({
      product_id: i.productId,
      quantity: i.quantity,
      modifications: i.modifications.map(m => ({ type: m.type, item: m.item }))
    }));

    const createResult = executeTool('create_order', {
      items: orderItems,
      customer_name: state.customer.name || 'Cliente',
      customer_phone: state.customer.phone || null,
      delivery_type: draft.deliveryType,
      delivery_address: draft.deliveryAddress.raw || null,
      payment_method: draft.paymentMethod,
      total: draft.total,
      idempotency_key: idempotencyKey,
      confirmation_status: draft.confirmationStatus
    }, { conversationState: state, orderDraft: draft });

    Logger.logToolCall(state.conversationId, 'create_order', { idempotency_key: idempotencyKey, itemCount: orderItems.length });
    Logger.logToolResult(state.conversationId, 'create_order', createResult, createResult.latencyMs);

    if (!createResult.success) {
      // Backend rejected — roll back to collecting
      draft.confirmationStatus = 'reviewing';
      transitionState(state, STATES.COLLECTING_ORDER);
      recordError(state, 'create_order', createResult.error, true);

      // User-friendly error
      const errorMap = {
        'PRODUCT_UNAVAILABLE': 'Uno de los productos ya no está disponible. ¿Quieres revisar el pedido?',
        'ZONE_NOT_COVERED': 'La dirección quedó fuera de cobertura. ¿Quieres dar otra dirección?',
        'TOTAL_MISMATCH': 'Hubo un cambio en los precios. Déjame recalcular.',
        'MISSING_PAYMENT': '¿Cómo vas a pagar?',
        'MISSING_ADDRESS': '¿Cuál es tu dirección?'
      };
      return errorMap[createResult.error] || 'Tuve un problema creando el pedido. ¿Me repites?';
    }

    // Order created successfully
    draft.confirmationStatus = 'order_created';
    draft.orderId = createResult.data.order_id;
    draft.orderNumber = createResult.data.order_number;
    transitionState(state, STATES.COMPLETED);
    state.pendingQuestion = null;

    const time = createResult.data.estimated_time || draft.estimatedTime || '25-35 min';
    const orderNum = createResult.data.order_number || createResult.data.order_id;
    return `Perfecto, pedido ${orderNum} confirmado. Tiempo estimado: ${time}. ¡Buen provecho!`;
  }

  if (state.pendingQuestion === 'confirm_address') {
    if (state.customer.addresses && state.customer.addresses.length > 0) {
      const addr = state.customer.addresses[0];
      return _processAddress(conv, addr.address);
    }
  }

  if (state.pendingQuestion === 'anything_else') {
    state.pendingQuestion = 'which_product';
    return '¿Qué más quieres agregar?';
  }

  // Generic yes in collecting state — might mean "yes, that's correct"
  if (state.currentState === STATES.COLLECTING_ORDER) {
    state.pendingQuestion = 'anything_else';
    return '¿Algo más o cerramos el pedido?';
  }

  return '¿En qué te puedo ayudar?';
}

function _handleConfirmNo(conv, entities) {
  const { state, draft } = conv;

  if (state.currentState === STATES.WAITING_CONFIRMATION) {
    const negType = entities.negationType || 'generic_no';
    if (negType === 'cancel_all') {
      return _handleCancel(conv);
    }
    transitionState(state, STATES.COLLECTING_ORDER);
    state.pendingQuestion = 'what_to_change';
    return '¿Qué parte quieres cambiar?';
  }

  if (state.pendingQuestion === 'anything_else') {
    return _handleNothingMore(conv);
  }

  if (state.pendingQuestion === 'confirm_address') {
    state.pendingQuestion = 'address';
    transitionState(state, STATES.CUSTOMER_DATA);
    return '¿Cuál es la dirección entonces?';
  }

  return '¿En qué te ayudo?';
}

function _handleNothingMore(conv) {
  const { state, draft } = conv;

  if (draft.items.length === 0) {
    return '¿Qué te gustaría pedir?';
  }

  state.pendingQuestion = null;
  return _advanceToNextRequired(conv);
}

function _handleUnknown(conv) {
  const { state } = conv;
  state.misunderstandingCount++;

  if (state.misunderstandingCount === 1) {
    return 'Perdón, no alcancé a entenderte. ¿Me lo repites?';
  }
  if (state.misunderstandingCount === 2) {
    return 'Creo que no te entendí bien. ¿Me dices nuevamente qué producto quieres?';
  }
  if (state.misunderstandingCount === 3) {
    return 'No quiero equivocarme con tu pedido. ¿Quieres que te ayude de otra forma o prefieres hablar con una persona?';
  }

  // 4+ misunderstandings — offer human
  transitionState(state, STATES.HUMAN_REQUEST);
  return 'Parece que estamos teniendo dificultades. Te voy a pasar con una persona para que te ayude mejor.';
}

// ==================== HELPERS ====================

function _resolveAndAddProduct(conv, productRef, quantity) {
  const { state, draft } = conv;

  if (!productRef || productRef.length < 2) {
    return { success: false, reason: 'not_found', query: productRef };
  }

  // Search for the product
  const searchResult = executeTool('search_product', { query: productRef }, { conversationState: state });
  Logger.logToolCall(state.conversationId, 'search_product', { query: productRef });
  Logger.logToolResult(state.conversationId, 'search_product', searchResult, searchResult.latencyMs);

  if (!searchResult.success || searchResult.data.count === 0) {
    return { success: false, reason: 'not_found', query: productRef };
  }

  // Multiple results — check if one is an exact/close match
  let product = null;
  if (searchResult.data.count === 1) {
    product = searchResult.data.results[0];
  } else {
    const results = searchResult.data.results;

    // If top result has a strong score and is clearly better than 2nd, pick it
    if (results[0].score && results[0].score >= 0.7) {
      const gap = results.length > 1 ? results[0].score - results[1].score : 1;
      if (gap >= 0.15) {
        product = results[0];
      }
    }

    // Fallback: try name matching
    if (!product) {
      const refLower = productRef.toLowerCase();
      product = results.find(p =>
        p.name.toLowerCase().includes(refLower) ||
        refLower.includes(p.name.toLowerCase().split(' ')[0].toLowerCase())
      );
    }

    if (!product) {
      return {
        success: false,
        reason: 'ambiguous',
        query: productRef,
        options: results.slice(0, 4)
      };
    }
  }

  // Check availability
  const availResult = executeTool('check_availability', { product_id: product.id }, { conversationState: state });
  if (!availResult.success || !availResult.data.available) {
    return {
      success: false,
      reason: 'unavailable',
      productName: product.name,
      alternatives: availResult.data ? availResult.data.alternatives : []
    };
  }

  // Add to draft
  const addResult = addItem(draft, {
    productId: product.id,
    productName: product.name,
    quantity,
    unitPrice: product.price,
    turn: state.turnCount
  });

  if (addResult.success) {
    recordProductMention(state, product.id, product.name);
  }

  // Check if product has variants for the caller to handle
  const fullProduct = executeTool('get_product', { product_id: product.id }, {});
  const variants = (fullProduct.success && fullProduct.data.variants) ? fullProduct.data.variants : [];

  return {
    success: addResult.success,
    productId: product.id,
    productName: product.name,
    quantity,
    price: product.price,
    variants
  };
}

function _processAddress(conv, address) {
  const { state, draft } = conv;

  // Validate zone
  const zoneResult = executeTool('validate_delivery_zone', { address }, { conversationState: state });
  Logger.logToolCall(state.conversationId, 'validate_delivery_zone', { address });
  Logger.logToolResult(state.conversationId, 'validate_delivery_zone', zoneResult, zoneResult.latencyMs);

  if (!zoneResult.success || !zoneResult.data.covered) {
    state.pendingQuestion = 'address';
    return 'Lamentablemente no cubrimos esa zona con domicilio. ¿Quieres dar otra dirección o prefieres recoger en el local?';
  }

  setDeliveryAddress(draft, {
    raw: address,
    formatted: address,
    zoneId: zoneResult.data.zone_id,
    isValid: true
  });

  // Calculate delivery
  const delResult = executeTool('calculate_delivery', {
    address,
    zone_id: zoneResult.data.zone_id
  }, { conversationState: state });

  if (delResult.success) {
    draft.deliveryFee = delResult.data.delivery_fee;
  }

  return _advanceToNextRequired(conv);
}

function _advanceToNextRequired(conv) {
  const { state, draft, config } = conv;
  const next = getNextRequiredInfo(draft);

  if (!next) {
    // Everything filled — calculate and review
    return _calculateAndReview(conv);
  }

  switch (next) {
    case 'items':
      transitionState(state, STATES.COLLECTING_ORDER);
      state.pendingQuestion = 'which_product';
      return '¿Qué te gustaría pedir?';

    case 'delivery_type':
      transitionState(state, STATES.DELIVERY_SELECTION);
      state.pendingQuestion = 'delivery_type';
      return '¿Es para domicilio o para recoger?';

    case 'delivery_address':
      transitionState(state, STATES.CUSTOMER_DATA);
      state.pendingQuestion = 'address';
      if (state.customer.addresses && state.customer.addresses.length > 0) {
        const addr = state.customer.addresses[0];
        state.pendingQuestion = 'confirm_address';
        return `¿Te lo envío a ${addr.address}?`;
      }
      return '¿Cuál es tu dirección?';

    case 'valid_delivery_address':
      transitionState(state, STATES.CUSTOMER_DATA);
      state.pendingQuestion = 'address';
      return 'La dirección anterior no está en nuestra zona. ¿Tienes otra dirección?';

    case 'payment_method':
      state.pendingQuestion = 'payment_method';
      const methods = (config.payment_methods || ['efectivo', 'nequi', 'daviplata', 'tarjeta']).join(', ');
      return `¿Cómo vas a pagar? Aceptamos ${methods}.`;

    default:
      return _calculateAndReview(conv);
  }
}

function _calculateAndReview(conv) {
  const { state, draft } = conv;

  // Calculate order via tool (backend is source of truth)
  const calcItems = draft.items.map(i => ({
    product_id: i.productId,
    quantity: i.quantity,
    modifications: i.modifications.map(m => ({ type: m.type, item: m.item }))
  }));

  const calcResult = executeTool('calculate_order', {
    items: calcItems,
    delivery_type: draft.deliveryType,
    delivery_address: draft.deliveryAddress.raw,
    restaurant_id: state.restaurantId
  }, { conversationState: state, orderDraft: draft });

  Logger.logToolCall(state.conversationId, 'calculate_order', { itemCount: calcItems.length });
  Logger.logToolResult(state.conversationId, 'calculate_order', calcResult, calcResult.latencyMs);

  if (!calcResult.success) {
    recordError(state, 'calculate_order', calcResult.error, true);
    transitionState(state, STATES.COLLECTING_ORDER);
    return 'Tuve un problema calculando el total. ¿Quieres revisar los productos?';
  }

  // Update draft with backend-calculated values
  setCalculation(draft, {
    subtotal: calcResult.data.subtotal,
    deliveryFee: calcResult.data.delivery_fee,
    discounts: calcResult.data.discounts,
    tax: calcResult.data.tax,
    total: calcResult.data.total,
    estimatedTime: calcResult.data.estimated_time
  });

  // Generate summary
  draft.confirmationStatus = 'reviewing';
  const summary = getSummary(draft, _fmt);

  transitionState(state, STATES.ORDER_REVIEW);
  transitionState(state, STATES.WAITING_CONFIRMATION);
  state.pendingQuestion = 'confirmation';

  // Build spoken summary
  let resp = 'Te confirmo el pedido:\n';
  resp += draft.items.map(i => {
    let line = `- ${i.quantity}x ${i.productName}`;
    if (i.modifications.length > 0) {
      line += ', ' + i.modifications.map(m =>
        m.type === 'remove' ? `sin ${m.item}` : `con ${m.item}`
      ).join(', ');
    }
    return line;
  }).join('\n');

  if (draft.deliveryType === 'delivery') {
    resp += `\nDomicilio a ${draft.deliveryAddress.raw}.`;
  } else {
    resp += '\nPara recoger en local.';
  }

  if (draft.paymentMethod) {
    resp += `\nPago: ${draft.paymentMethod}.`;
  }

  resp += `\nTotal: ${_fmt(draft.total)}`;
  if (draft.deliveryFee > 0) {
    resp += ` (incluye ${_fmt(draft.deliveryFee)} de domicilio)`;
  }
  resp += '.\n¿Confirmamos?';

  return resp;
}

function _fmt(n) {
  return '$' + Number(n).toLocaleString('es-CO');
}

function _response(conv, text) {
  const { state, draft } = conv;
  return {
    conversationId: state.conversationId,
    response: text,
    state: state.currentState,
    intent: state.currentIntent,
    needsTool: false,
    needsConfirmation: state.currentState === STATES.WAITING_CONFIRMATION,
    debug: getStateSnapshot(state, draft)
  };
}
