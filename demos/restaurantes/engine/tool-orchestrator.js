/**
 * TOOL ORCHESTRATOR
 *
 * Mediates between the conversation engine and the tools (mock or real).
 * Validates requests before execution. Validates responses after.
 * The LLM never calls tools directly — it goes through this layer.
 *
 * FASE 4 additions:
 * - Permission levels (CONSULTA / OPERACION / TRANSACCIONAL)
 * - Enhanced audit trail per tool execution
 * - Transactional tools require extra validation
 * - Argument type validation
 */

import * as MockTools from './mock-tools.js';

// Permission levels — transactional tools have stricter controls
const PERMISSION = {
  CONSULTA: 'consulta',           // read-only, no side effects
  OPERACION: 'operacion',         // calculations, validations
  TRANSACCIONAL: 'transaccional'  // creates/modifies real data
};

// Registry of available tools and their schemas
const TOOL_REGISTRY = {
  // --- CONSULTA ---
  search_product: {
    fn: MockTools.search_product,
    requiredArgs: ['query'],
    argTypes: { query: 'string' },
    description: 'Buscar productos por nombre',
    permission: PERMISSION.CONSULTA
  },
  get_product: {
    fn: MockTools.get_product,
    requiredArgs: ['product_id'],
    argTypes: { product_id: 'string' },
    description: 'Obtener detalles de un producto',
    permission: PERMISSION.CONSULTA
  },
  check_availability: {
    fn: MockTools.check_availability,
    requiredArgs: ['product_id'],
    argTypes: { product_id: 'string' },
    description: 'Verificar disponibilidad',
    permission: PERMISSION.CONSULTA
  },
  get_menu: {
    fn: MockTools.get_menu,
    requiredArgs: [],
    description: 'Obtener menú completo o por categoría',
    permission: PERMISSION.CONSULTA
  },
  get_promotions: {
    fn: MockTools.get_promotions,
    requiredArgs: [],
    description: 'Obtener promociones vigentes',
    permission: PERMISSION.CONSULTA
  },
  get_product_options: {
    fn: MockTools.get_product_options,
    requiredArgs: ['product_id'],
    argTypes: { product_id: 'string' },
    description: 'Obtener opciones de producto',
    permission: PERMISSION.CONSULTA
  },
  validate_modification: {
    fn: MockTools.validate_modification,
    requiredArgs: ['product_id', 'modification_type', 'modification_item'],
    argTypes: { product_id: 'string', modification_type: 'string', modification_item: 'string' },
    description: 'Validar modificacion de producto',
    permission: PERMISSION.CONSULTA
  },
  find_customer: {
    fn: MockTools.find_customer,
    requiredArgs: ['phone'],
    argTypes: { phone: 'string' },
    description: 'Buscar cliente por teléfono',
    permission: PERMISSION.CONSULTA
  },
  get_customer_addresses: {
    fn: MockTools.get_customer_addresses,
    requiredArgs: ['customer_id'],
    argTypes: { customer_id: 'string' },
    description: 'Obtener direcciones del cliente',
    permission: PERMISSION.CONSULTA
  },
  get_order_status: {
    fn: MockTools.get_order_status,
    requiredArgs: [],
    description: 'Consultar estado de pedido',
    permission: PERMISSION.CONSULTA
  },
  get_restaurant_config: {
    fn: MockTools.get_restaurant_config,
    requiredArgs: [],
    description: 'Obtener configuración del restaurante',
    permission: PERMISSION.CONSULTA
  },
  request_human: {
    fn: MockTools.request_human,
    requiredArgs: [],
    description: 'Solicitar transferencia a humano',
    permission: PERMISSION.CONSULTA
  },

  // --- OPERACION ---
  validate_delivery_zone: {
    fn: MockTools.validate_delivery_zone,
    requiredArgs: ['address'],
    argTypes: { address: 'string' },
    description: 'Validar zona de cobertura',
    permission: PERMISSION.OPERACION
  },
  calculate_delivery: {
    fn: MockTools.calculate_delivery,
    requiredArgs: ['address'],
    argTypes: { address: 'string' },
    description: 'Calcular costo de domicilio',
    permission: PERMISSION.OPERACION
  },
  calculate_order: {
    fn: MockTools.calculate_order,
    requiredArgs: ['items'],
    argTypes: { items: 'array' },
    description: 'Calcular total del pedido',
    permission: PERMISSION.OPERACION
  },

  // --- TRANSACCIONAL ---
  create_customer: {
    fn: MockTools.create_customer,
    requiredArgs: ['name', 'phone'],
    argTypes: { name: 'string', phone: 'string' },
    description: 'Crear cliente nuevo',
    permission: PERMISSION.TRANSACCIONAL
  },
  create_order: {
    fn: MockTools.create_order,
    requiredArgs: ['items', 'delivery_type', 'payment_method', 'confirmation_status'],
    argTypes: { items: 'array', delivery_type: 'string', payment_method: 'string', confirmation_status: 'string' },
    description: 'Crear pedido real',
    permission: PERMISSION.TRANSACCIONAL,
    requiresConfirmation: true
  },
  update_order: {
    fn: MockTools.update_order,
    requiredArgs: ['order_id', 'changes'],
    argTypes: { order_id: 'string', changes: 'object' },
    description: 'Modificar pedido existente',
    permission: PERMISSION.TRANSACCIONAL
  },
  cancel_order: {
    fn: MockTools.cancel_order,
    requiredArgs: ['order_id'],
    argTypes: { order_id: 'string' },
    description: 'Cancelar pedido',
    permission: PERMISSION.TRANSACCIONAL
  }
};

// --- Audit trail ---
let _auditLog = [];

/**
 * Execute a tool request
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} context - { conversationState, orderDraft }
 * @returns {{ success: boolean, data?: object, error?: string, toolName: string, latencyMs: number, permission?: string }}
 */
export function executeTool(toolName, args, context) {
  const start = performance.now();
  const conversationId = context && context.conversationState ? context.conversationState.conversationId : null;

  // Pre-validation
  const preErrors = _preValidate(toolName, args, context);
  if (preErrors) {
    const result = {
      success: false,
      error: preErrors,
      toolName,
      latencyMs: Math.round(performance.now() - start)
    };
    _audit(conversationId, toolName, args, result, performance.now() - start);
    return result;
  }

  try {
    const tool = TOOL_REGISTRY[toolName];
    const fnResult = tool.fn(args);

    // Post-validation
    const postErrors = _postValidate(toolName, fnResult);
    if (postErrors) {
      const result = {
        success: false,
        error: postErrors,
        toolName,
        latencyMs: Math.round(performance.now() - start)
      };
      _audit(conversationId, toolName, args, result, performance.now() - start);
      return result;
    }

    // Check for tool-level errors
    if (fnResult && fnResult.error) {
      const result = {
        success: false,
        error: fnResult.error,
        data: fnResult,
        toolName,
        latencyMs: Math.round(performance.now() - start),
        permission: tool.permission
      };
      _audit(conversationId, toolName, args, result, performance.now() - start);
      return result;
    }

    const result = {
      success: true,
      data: fnResult,
      toolName,
      latencyMs: Math.round(performance.now() - start),
      permission: tool.permission
    };
    _audit(conversationId, toolName, args, result, performance.now() - start);
    return result;
  } catch (err) {
    const result = {
      success: false,
      error: 'TOOL_EXECUTION_ERROR: ' + err.message,
      toolName,
      latencyMs: Math.round(performance.now() - start)
    };
    _audit(conversationId, toolName, args, result, performance.now() - start, err);
    return result;
  }
}

/**
 * Check if a tool exists
 */
export function toolExists(toolName) {
  return toolName in TOOL_REGISTRY;
}

/**
 * List available tools (grouped by permission)
 */
export function listTools() {
  return Object.entries(TOOL_REGISTRY).map(([name, config]) => ({
    name,
    description: config.description,
    requiredArgs: config.requiredArgs,
    permission: config.permission || PERMISSION.CONSULTA,
    requiresConfirmation: config.requiresConfirmation || false
  }));
}

/**
 * Get audit log (for debugging / admin)
 */
export function getAuditLog(conversationId) {
  if (conversationId) {
    return _auditLog.filter(a => a.conversationId === conversationId);
  }
  return [..._auditLog];
}

/**
 * Clear audit log (for testing)
 */
export function clearAuditLog() {
  _auditLog = [];
}

// --- Validation ---

function _preValidate(toolName, args, context) {
  // Tool exists?
  if (!TOOL_REGISTRY[toolName]) {
    return 'TOOL_NOT_FOUND: ' + toolName;
  }

  const tool = TOOL_REGISTRY[toolName];

  // Required args present?
  for (const req of tool.requiredArgs) {
    if (args[req] === undefined || args[req] === null) {
      return `MISSING_ARGUMENT: ${req} es requerido para ${toolName}`;
    }
  }

  // Type validation (when argTypes defined)
  if (tool.argTypes) {
    for (const [argName, expectedType] of Object.entries(tool.argTypes)) {
      const val = args[argName];
      if (val === undefined || val === null) continue; // handled by required check
      if (expectedType === 'string' && typeof val !== 'string') {
        return `INVALID_TYPE: ${argName} debe ser string, recibido ${typeof val}`;
      }
      if (expectedType === 'number' && typeof val !== 'number') {
        return `INVALID_TYPE: ${argName} debe ser number, recibido ${typeof val}`;
      }
      if (expectedType === 'array' && !Array.isArray(val)) {
        return `INVALID_TYPE: ${argName} debe ser array, recibido ${typeof val}`;
      }
      if (expectedType === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
        return `INVALID_TYPE: ${argName} debe ser object, recibido ${typeof val}`;
      }
    }
  }

  // Transactional tools: extra checks
  if (tool.permission === PERMISSION.TRANSACCIONAL) {
    // create_order: must have confirmed draft
    if (toolName === 'create_order') {
      if (context && context.orderDraft && context.orderDraft.confirmationStatus !== 'confirmed') {
        return 'CONFIRMATION_REQUIRED: No se puede crear pedido sin confirmación del cliente';
      }
    }
  }

  return null;
}

function _postValidate(toolName, result) {
  if (result === undefined || result === null) {
    return 'EMPTY_RESPONSE: La herramienta no devolvió datos';
  }
  return null;
}

// --- Audit ---

function _audit(conversationId, toolName, args, result, durationMs, error) {
  const tool = TOOL_REGISTRY[toolName];
  _auditLog.push({
    timestamp: new Date().toISOString(),
    conversationId,
    tool: toolName,
    permission: tool ? tool.permission : 'unknown',
    args: _sanitizeArgs(args),
    success: result.success,
    error: result.error || (error ? error.message : null),
    durationMs: Math.round(durationMs)
  });
}

function _sanitizeArgs(args) {
  // Strip potentially large payloads from audit, keep keys + summary
  if (!args) return {};
  const safe = {};
  for (const [k, v] of Object.entries(args)) {
    if (Array.isArray(v)) {
      safe[k] = `[Array:${v.length}]`;
    } else if (typeof v === 'object' && v !== null) {
      safe[k] = `{Object:${Object.keys(v).join(',')}}`;
    } else {
      safe[k] = v;
    }
  }
  return safe;
}
