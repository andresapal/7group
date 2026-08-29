/**
 * ERROR HANDLER
 *
 * Converts technical errors into human-friendly responses.
 * The customer should NEVER see a stack trace or error code.
 * The debug panel shows the technical details.
 */

const ERROR_RESPONSES = {
  // Tool errors
  TOOL_NOT_FOUND: 'Tuve un problema interno. ¿Me repites lo que necesitas?',
  TOOL_EXECUTION_ERROR: 'Algo falló al procesar tu solicitud. Intentemos de nuevo.',
  EMPTY_RESPONSE: 'No obtuve respuesta del sistema. ¿Me repites?',
  MISSING_ARGUMENT: 'Me faltó información. ¿Me ayudas con más detalles?',

  // Product errors
  PRODUCT_NOT_FOUND: 'No encontré ese producto en el menú.',
  PRODUCT_UNAVAILABLE: 'Ese producto no está disponible en este momento.',

  // Order errors
  CONFIRMATION_REQUIRED: 'Primero necesito que confirmes el pedido.',
  ORDER_NOT_FOUND: 'No encontré un pedido con esos datos.',
  ZONE_NOT_COVERED: 'Esa dirección está fuera de nuestra zona de cobertura.',
  INVALID_ITEMS: 'Hay un problema con algunos productos del pedido.',

  // State errors
  INVALID_TRANSITION: 'Algo no cuadra. ¿Empezamos de nuevo con el pedido?',
  TERMINAL_STATE: 'Esta conversación ya finalizó. Puedes llamar de nuevo cuando quieras.',

  // Generic
  UNKNOWN: 'Tuve un problema. ¿Me repites lo que necesitas?'
};

/**
 * Get a human-friendly error message
 *
 * @param {string} errorCode - Technical error code
 * @param {object} context - Additional context
 * @returns {string} Human-friendly message
 */
export function getErrorMessage(errorCode, context) {
  if (!errorCode) return ERROR_RESPONSES.UNKNOWN;

  // Extract code from compound errors like "TOOL_EXECUTION_ERROR: ..."
  const code = errorCode.split(':')[0].trim();

  return ERROR_RESPONSES[code] || ERROR_RESPONSES.UNKNOWN;
}

/**
 * Determine error severity
 * @returns {'low'|'medium'|'high'|'critical'}
 */
export function getErrorSeverity(errorCode) {
  const critical = ['TOOL_EXECUTION_ERROR', 'INVALID_TRANSITION'];
  const high = ['MISSING_ARGUMENT', 'INVALID_ITEMS', 'CONFIRMATION_REQUIRED'];
  const medium = ['PRODUCT_UNAVAILABLE', 'ZONE_NOT_COVERED', 'ORDER_NOT_FOUND'];
  const low = ['PRODUCT_NOT_FOUND', 'EMPTY_RESPONSE'];

  const code = (errorCode || '').split(':')[0].trim();

  if (critical.includes(code)) return 'critical';
  if (high.includes(code)) return 'high';
  if (medium.includes(code)) return 'medium';
  if (low.includes(code)) return 'low';
  return 'medium';
}

/**
 * Should the agent retry after this error?
 */
export function shouldRetry(errorCode) {
  const retryable = ['TOOL_EXECUTION_ERROR', 'EMPTY_RESPONSE'];
  const code = (errorCode || '').split(':')[0].trim();
  return retryable.includes(code);
}

/**
 * Should the agent escalate to human after this error?
 */
export function shouldEscalate(errorCode, errorCount) {
  if (errorCount >= 3) return true;
  const escalate = ['INVALID_TRANSITION'];
  const code = (errorCode || '').split(':')[0].trim();
  return escalate.includes(code);
}
