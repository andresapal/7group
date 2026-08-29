/**
 * CONVERSATION STATE
 *
 * Estructura de estado temporal de la conversación.
 * Se crea al iniciar una conversación y se destruye al finalizar.
 * NO persiste entre conversaciones.
 */

// Valid conversation states (state machine)
export const STATES = {
  GREETING: 'GREETING',
  UNDERSTANDING: 'UNDERSTANDING',
  COLLECTING_ORDER: 'COLLECTING_ORDER',
  CLARIFYING: 'CLARIFYING',
  VALIDATING: 'VALIDATING',
  DELIVERY_SELECTION: 'DELIVERY_SELECTION',
  CUSTOMER_DATA: 'CUSTOMER_DATA',
  CALCULATING: 'CALCULATING',
  ORDER_REVIEW: 'ORDER_REVIEW',
  WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  HUMAN_REQUEST: 'HUMAN_REQUEST',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
  ABANDONED: 'ABANDONED'
};

// Valid intents
export const INTENTS = {
  ORDER: 'ORDER',
  ADD_ITEM: 'ADD_ITEM',
  REMOVE_ITEM: 'REMOVE_ITEM',
  MODIFY_ITEM: 'MODIFY_ITEM',
  CHANGE_QUANTITY: 'CHANGE_QUANTITY',
  ASK_PRICE: 'ASK_PRICE',
  ASK_PRODUCT: 'ASK_PRODUCT',
  ASK_AVAILABILITY: 'ASK_AVAILABILITY',
  PROMOTION: 'PROMOTION',
  DELIVERY: 'DELIVERY',
  PICKUP: 'PICKUP',
  CUSTOMER_LOOKUP: 'CUSTOMER_LOOKUP',
  ORDER_STATUS: 'ORDER_STATUS',
  CANCEL_ORDER: 'CANCEL_ORDER',
  HELP: 'HELP',
  HUMAN_REQUEST: 'HUMAN_REQUEST',
  CONFIRM_YES: 'CONFIRM_YES',
  CONFIRM_NO: 'CONFIRM_NO',
  ASK_OPTIONS: 'ASK_OPTIONS',
  NOTHING_MORE: 'NOTHING_MORE',
  UNKNOWN: 'UNKNOWN'
};

// Allowed transitions: { fromState: [toState, toState, ...] }
export const ALLOWED_TRANSITIONS = {
  [STATES.GREETING]:              [STATES.UNDERSTANDING, STATES.COLLECTING_ORDER, STATES.HUMAN_REQUEST, STATES.COMPLETED],
  [STATES.UNDERSTANDING]:         [STATES.COLLECTING_ORDER, STATES.CLARIFYING, STATES.HUMAN_REQUEST, STATES.COMPLETED, STATES.CANCELLED],
  [STATES.COLLECTING_ORDER]:      [STATES.COLLECTING_ORDER, STATES.CLARIFYING, STATES.VALIDATING, STATES.DELIVERY_SELECTION, STATES.CUSTOMER_DATA, STATES.ORDER_REVIEW, STATES.WAITING_CONFIRMATION, STATES.HUMAN_REQUEST, STATES.CANCELLED, STATES.UNDERSTANDING],
  [STATES.CLARIFYING]:            [STATES.COLLECTING_ORDER, STATES.UNDERSTANDING, STATES.DELIVERY_SELECTION, STATES.HUMAN_REQUEST, STATES.CANCELLED],
  [STATES.VALIDATING]:            [STATES.COLLECTING_ORDER, STATES.CLARIFYING, STATES.DELIVERY_SELECTION, STATES.ERROR],
  [STATES.DELIVERY_SELECTION]:    [STATES.CUSTOMER_DATA, STATES.CALCULATING, STATES.ORDER_REVIEW, STATES.WAITING_CONFIRMATION, STATES.COLLECTING_ORDER, STATES.HUMAN_REQUEST, STATES.CANCELLED],
  [STATES.CUSTOMER_DATA]:         [STATES.CALCULATING, STATES.CUSTOMER_DATA, STATES.ORDER_REVIEW, STATES.WAITING_CONFIRMATION, STATES.COLLECTING_ORDER, STATES.DELIVERY_SELECTION, STATES.HUMAN_REQUEST, STATES.CANCELLED],
  [STATES.CALCULATING]:           [STATES.ORDER_REVIEW, STATES.ERROR, STATES.COLLECTING_ORDER],
  [STATES.ORDER_REVIEW]:          [STATES.WAITING_CONFIRMATION, STATES.COLLECTING_ORDER],
  [STATES.WAITING_CONFIRMATION]:  [STATES.CONFIRMED, STATES.COLLECTING_ORDER, STATES.CANCELLED, STATES.HUMAN_REQUEST],
  [STATES.CONFIRMED]:             [STATES.COMPLETED, STATES.ERROR],
  // Terminal states — no transitions out
  [STATES.COMPLETED]:             [],
  [STATES.HUMAN_REQUEST]:         [STATES.COMPLETED],
  [STATES.CANCELLED]:             [STATES.COMPLETED],
  [STATES.ERROR]:                 [STATES.COMPLETED, STATES.COLLECTING_ORDER],
  [STATES.ABANDONED]:             []
};

/**
 * Create a fresh conversation state
 */
export function createConversationState(restaurantId, callerPhone) {
  return {
    // Call identification
    conversationId: _generateId(),
    restaurantId: restaurantId || 'rest_demo_001',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Customer
    customer: {
      id: null,
      name: null,
      phone: callerPhone || null,
      isNew: null, // null = not checked yet
      addresses: []
    },

    // Conversation flow
    currentState: STATES.GREETING,
    currentIntent: null,
    previousState: null,
    previousIntent: null,

    // Messages
    lastUserMessage: null,
    lastAgentMessage: null,
    pendingQuestion: null,
    turnCount: 0,

    // Error tracking
    misunderstandingCount: 0,
    silenceCount: 0,

    // History for context resolution
    messageHistory: [],
    // Tracks what products were mentioned and when
    mentionedProducts: [],

    // Errors
    errors: []
  };
}

/**
 * Validate a state transition
 */
export function canTransition(fromState, toState) {
  const allowed = ALLOWED_TRANSITIONS[fromState];
  if (!allowed) return false;
  return allowed.includes(toState);
}

/**
 * Transition to a new state (with validation)
 */
export function transitionState(state, newState) {
  if (!canTransition(state.currentState, newState)) {
    console.warn(`[STATE] Invalid transition: ${state.currentState} → ${newState}`);
    return false;
  }
  state.previousState = state.currentState;
  state.currentState = newState;
  state.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Record a message in history
 */
export function recordMessage(state, speaker, text, metadata) {
  state.messageHistory.push({
    speaker, // 'user' | 'agent'
    text,
    timestamp: new Date().toISOString(),
    turn: state.turnCount,
    ...(metadata || {})
  });
  if (speaker === 'user') {
    state.lastUserMessage = text;
    state.turnCount++;
  } else {
    state.lastAgentMessage = text;
  }
  state.updatedAt = new Date().toISOString();
}

/**
 * Record a product mention for context tracking
 */
export function recordProductMention(state, productId, productName) {
  state.mentionedProducts.push({
    productId,
    productName,
    turn: state.turnCount,
    timestamp: new Date().toISOString()
  });
}

/**
 * Get the last mentioned product (for context resolution)
 */
export function getLastMentionedProduct(state) {
  if (state.mentionedProducts.length === 0) return null;
  return state.mentionedProducts[state.mentionedProducts.length - 1];
}

/**
 * Record an error
 */
export function recordError(state, tool, error, handled) {
  state.errors.push({
    timestamp: new Date().toISOString(),
    tool,
    error: typeof error === 'string' ? error : error.message || String(error),
    handled: handled !== false
  });
}

/**
 * Check if conversation is in a terminal state
 */
export function isTerminal(state) {
  return [STATES.COMPLETED, STATES.ABANDONED].includes(state.currentState);
}

/**
 * Get state snapshot for debugging
 */
export function getStateSnapshot(state, orderDraft) {
  return {
    conversationId: state.conversationId,
    currentState: state.currentState,
    currentIntent: state.currentIntent,
    turnCount: state.turnCount,
    customer: state.customer.name || state.customer.phone || '(unknown)',
    itemCount: orderDraft ? orderDraft.items.length : 0,
    pendingQuestion: state.pendingQuestion,
    misunderstandings: state.misunderstandingCount,
    errors: state.errors.length
  };
}

function _generateId() {
  return 'conv_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}
